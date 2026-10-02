-- T41 registration lifecycle-after-confirmation commands (Master §77-79, §172): CancelRegistration and
-- ChangeRegistrationModality. Capacity is a live count (T30 kernel), so cancellation releases capacity
-- automatically once status flips to CANCELED -- no separate release step. Both commands are blocked
-- once attendance is finalized or the Edition is administratively closed (Master §77 "despues de
-- AttendanceFinalization requiere reopen/correction workflow"): staff must reopen first.

create or replace function private.registration_status_projection(p_registration_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('registration_id', r.registration_id, 'registration_number', r.registration_number,
    'status', r.status, 'modality_id', r.modality_id, 'canceled_at', r.canceled_at, 'cancel_reason', r.cancel_reason)
  from app.registration r
  where r.registration_id = p_registration_id
$$;

-- Blocks that apply to both commands once the Edition has moved past open attendance work.
create or replace function private.registration_assert_not_closure_blocked(p_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from app.administrative_closure c
             where c.edition_id = p_edition_id and c.superseded_at is null and c.status = 'CLOSED') then
    perform private.raise_domain_error('CLOSURE_BLOCKED', jsonb_build_object('reason', 'edition_closed'));
  end if;
  if exists (select 1 from app.attendance_finalization f
             where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED') then
    perform private.raise_domain_error('CLOSURE_BLOCKED', jsonb_build_object('reason', 'attendance_finalized'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- CancelRegistration (Master §77). Never DELETE.
-- ---------------------------------------------------------------------------------------------
create or replace function private.cancel_registration(p_registration_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_idem jsonb;
  v_reg app.registration%rowtype;
  v_credit_id uuid;
  v_result jsonb;
begin
  select r.edition_id into v_edition_id from app.registration r where r.registration_id = p_registration_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('REGISTRATION_MANAGE', v_edition_id);
  if p_reason is null or btrim(p_reason) = '' then perform private.cfg_fail('reason', 'required'); end if;

  v_idem := private.cfg_idempotency_begin('closure.cancel_registration', p_registration_id::text, p_idempotency_key,
    jsonb_build_object('registration_id', p_registration_id));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  select * into v_reg from app.registration r where r.registration_id = p_registration_id for update;
  if v_reg.status <> 'CONFIRMED' then perform private.cfg_invalid_transition('status', v_reg.status); end if;
  perform private.registration_assert_not_closure_blocked(v_edition_id);

  update app.registration set status = 'CANCELED', canceled_at = now(), cancel_reason = p_reason
  where registration_id = p_registration_id;

  update app.participant_pass set status = 'CANCELED', canceled_at = now()
  where registration_id = p_registration_id and status <> 'CANCELED';

  -- Kit review: undelivered allocations are released; a physically DELIVERED kit is left for staff review.
  update app.kit_allocation set status = 'CANCELED', notes = coalesce(notes || ' | ', '') || 'registration canceled'
  where registration_id = p_registration_id and status in ('ASSIGNED', 'READY');

  -- Defensive: only reachable if the Edition was reopened after closing with this registration credited.
  select dc.distance_credit_id into v_credit_id from app.distance_credit dc
  where dc.registration_id = p_registration_id and dc.status = 'ACTIVE' for update;
  if v_credit_id is not null then
    update app.distance_credit set status = 'REVERSED', reversed_at = now(), reversed_by_staff_id = v_staff_id,
      reversal_reason = p_reason
    where distance_credit_id = v_credit_id;
    perform private.enqueue_outbox('DistanceCreditReversed', 'DistanceCredit', v_credit_id,
      'DistanceCreditReversed:' || v_credit_id || ':cancel', jsonb_build_object('distance_credit_id', v_credit_id, 'edition_id', v_edition_id));
  end if;

  perform private.audit('REGISTRATION_CANCELED', 'registration', p_registration_id, v_edition_id,
    jsonb_build_object('status', 'CONFIRMED'), jsonb_build_object('status', 'CANCELED'), p_reason);
  perform private.enqueue_outbox('RegistrationCanceled', 'Registration', p_registration_id,
    'RegistrationCanceled:' || p_registration_id, jsonb_build_object('registration_id', p_registration_id, 'edition_id', v_edition_id));

  v_result := private.registration_status_projection(p_registration_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ChangeRegistrationModality (Master §78-79). Staff only in V1. Validates the same rules a new
-- registration would (Edition, ACTIVE modality, eligibility, capacity, category) then records a
-- RegistrationRevision. modality_id is not part of the registration's frozen identity (only
-- registration_request_id/request_participant_id/edition_id/runner_profile_id/guest_participant_id/
-- buyer_profile_id are), so the row is updated in place and the revision is the audit trail.
-- ---------------------------------------------------------------------------------------------
create or replace function private.change_registration_modality(
  p_registration_id uuid, p_new_modality_id uuid, p_category_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_idem jsonb;
  v_reg app.registration%rowtype;
  v_modality app.modality%rowtype;
  v_check jsonb;
  v_age integer;
  v_sex text;
  v_kind text;
  v_category app.category%rowtype;
  v_category_id uuid;
  v_source text;
  v_snapshot jsonb;
  v_revision integer;
  v_credit_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  select * into v_reg from app.registration r where r.registration_id = p_registration_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('REGISTRATION_MANAGE', v_reg.edition_id);
  if p_reason is null or btrim(p_reason) = '' then perform private.cfg_fail('reason', 'required'); end if;
  if p_new_modality_id = v_reg.modality_id then perform private.cfg_fail('new_modality_id', 'same_as_current'); end if;

  v_idem := private.cfg_idempotency_begin('closure.change_modality', p_registration_id::text, p_idempotency_key,
    jsonb_build_object('registration_id', p_registration_id, 'new_modality_id', p_new_modality_id, 'category_id', p_category_id));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_reg.edition_id for update;
  perform 1 from app.modality_capacity mc where mc.modality_id in (v_reg.modality_id, p_new_modality_id)
    order by mc.modality_id for update;
  select * into v_reg from app.registration r where r.registration_id = p_registration_id for update;
  if v_reg.status <> 'CONFIRMED' then perform private.cfg_invalid_transition('status', v_reg.status); end if;
  perform private.registration_assert_not_closure_blocked(v_reg.edition_id);

  select * into v_modality from app.modality m where m.modality_id = p_new_modality_id and m.edition_id = v_reg.edition_id;
  if not found or v_modality.status <> 'ACTIVE' then perform private.raise_domain_error('MODALITY_NOT_AVAILABLE'); end if;

  v_kind := case when v_reg.runner_profile_id is not null then 'PROFILE' else 'GUEST' end;
  v_check := private.participant_inclusion_check(v_reg.edition_id, v_kind, v_reg.runner_profile_id, v_reg.guest_participant_id,
    v_reg.buyer_profile_id);
  if not (v_check ->> 'eligible')::boolean then
    perform private.raise_domain_error('PARTICIPANT_NOT_ELIGIBLE',
      jsonb_build_object('reasons', v_check -> 'client_reasons'));
  end if;
  v_age := (v_check ->> 'age_at_event')::integer;
  if v_kind = 'PROFILE' then
    select rp.sex_code into v_sex from app.runner_profile rp where rp.runner_profile_id = v_reg.runner_profile_id;
  else
    select g.sex_code into v_sex from app.guest_participant g where g.guest_participant_id = v_reg.guest_participant_id;
  end if;
  if not private.registration_rule_matches(v_modality.eligibility_rules, v_age, v_sex) then
    perform private.raise_domain_error('PARTICIPANT_NOT_ELIGIBLE', jsonb_build_object('reasons', jsonb_build_array('MODALITY_RULE')));
  end if;

  if p_category_id is not null then
    select c.* into v_category from app.category c
    join app.modality_category mc on mc.category_id = c.category_id and mc.modality_id = p_new_modality_id
    where c.category_id = p_category_id and c.edition_id = v_reg.edition_id and c.active and c.assignment_mode = 'USER_SELECTS';
    if not found then perform private.raise_domain_error('FORM_INVALID', jsonb_build_object('field_key', 'category_id', 'reason', 'invalid_category')); end if;
    v_source := 'USER_SELECTION';
  elsif exists (select 1 from app.category c join app.modality_category mc on mc.category_id = c.category_id
                where mc.modality_id = p_new_modality_id and c.active and c.assignment_mode = 'USER_SELECTS') then
    perform private.raise_domain_error('FORM_INVALID', jsonb_build_object('field_key', 'category_id', 'reason', 'required'));
  elsif exists (select 1 from app.category c join app.modality_category mc on mc.category_id = c.category_id
                where mc.modality_id = p_new_modality_id and c.active and c.assignment_mode = 'SYSTEM_DERIVES') then
    select c.* into v_category from app.category c join app.modality_category mc on mc.category_id = c.category_id
    where mc.modality_id = p_new_modality_id and c.active and c.assignment_mode = 'SYSTEM_DERIVES'
      and private.registration_rule_matches(c.eligibility_rule, v_age, v_sex)
    order by c.sort_order, c.key limit 1;
    if not found then perform private.raise_domain_error('PARTICIPANT_NOT_ELIGIBLE', jsonb_build_object('reasons', jsonb_build_array('NO_CATEGORY_MATCH'))); end if;
    v_source := 'DERIVED';
  end if;
  if v_category.category_id is not null and not private.registration_rule_matches(v_category.eligibility_rule, v_age, v_sex) then
    perform private.raise_domain_error('PARTICIPANT_NOT_ELIGIBLE', jsonb_build_object('reasons', jsonb_build_array('CATEGORY_RULE')));
  end if;
  v_category_id := v_category.category_id;

  perform private.registration_assert_capacity(v_reg.edition_id, jsonb_build_object(p_new_modality_id::text, 1));

  update app.registration set modality_id = p_new_modality_id where registration_id = p_registration_id;

  v_snapshot := jsonb_build_object('is_minor', v_check ->> 'is_minor', 'age_at_event', v_age, 'age_basis', v_check ->> 'age_basis',
    'event_date', v_check ->> 'event_date', 'sex_code', v_sex, 'modality_rule_version', v_modality.eligibility_rule_version,
    'category_assignment_source', v_source, 'evaluated_at', now());
  if v_category_id is not null then
    insert into app.registration_category_assignment (registration_id, category_id, assignment_source, eligibility_snapshot)
    values (p_registration_id, v_category_id, coalesce(v_source, 'DERIVED'), v_snapshot)
    on conflict (registration_id) do update set category_id = excluded.category_id,
      assignment_source = excluded.assignment_source, eligibility_snapshot = excluded.eligibility_snapshot, assigned_at = now();
  else
    delete from app.registration_category_assignment where registration_id = p_registration_id;
  end if;

  select coalesce(max(rr.revision), 0) + 1 into v_revision from app.registration_revision rr where rr.registration_id = p_registration_id;
  update app.registration_revision set superseded_at = now() where registration_id = p_registration_id and superseded_at is null;
  insert into app.registration_revision (registration_id, revision, modality_id, category_id, status, effective_from,
    reason, changed_by_staff_id)
  values (p_registration_id, v_revision, p_new_modality_id, v_category_id, 'ACTIVE', now(), p_reason, v_staff_id);

  -- Official distance impact: reverse a still-ACTIVE credit (only reachable via a reopened Edition);
  -- the next CloseEdition regenerates it against the new modality's distance.
  select dc.distance_credit_id into v_credit_id from app.distance_credit dc
  where dc.registration_id = p_registration_id and dc.status = 'ACTIVE' for update;
  if v_credit_id is not null then
    update app.distance_credit set status = 'REVERSED', reversed_at = now(), reversed_by_staff_id = v_staff_id,
      reversal_reason = p_reason
    where distance_credit_id = v_credit_id;
    perform private.enqueue_outbox('DistanceCreditReversed', 'DistanceCredit', v_credit_id,
      'DistanceCreditReversed:' || v_credit_id || ':modality_change',
      jsonb_build_object('distance_credit_id', v_credit_id, 'edition_id', v_reg.edition_id));
  end if;

  perform private.audit('REGISTRATION_MODALITY_CHANGED', 'registration', p_registration_id, v_reg.edition_id,
    jsonb_build_object('modality_id', v_reg.modality_id), jsonb_build_object('modality_id', p_new_modality_id), p_reason);
  perform private.enqueue_outbox('RegistrationModalityChanged', 'Registration', p_registration_id,
    'RegistrationModalityChanged:' || p_registration_id || ':' || v_revision,
    jsonb_build_object('registration_id', p_registration_id, 'edition_id', v_reg.edition_id));

  v_result := jsonb_build_object('registration_id', p_registration_id, 'modality_id', p_new_modality_id,
    'category_id', v_category_id, 'revision', v_revision);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public wrappers + grants.
-- ---------------------------------------------------------------------------------------------
create or replace function public.cancel_registration(p_registration_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_registration(p_registration_id, p_reason, p_idempotency_key) $$;

create or replace function public.change_registration_modality(p_registration_id uuid, p_new_modality_id uuid,
  p_category_id uuid default null, p_reason text default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.change_registration_modality(p_registration_id, p_new_modality_id, p_category_id, p_reason, p_idempotency_key) $$;

revoke all on function
  private.cancel_registration(uuid, text, text), public.cancel_registration(uuid, text, text),
  private.change_registration_modality(uuid, uuid, uuid, text, text),
  public.change_registration_modality(uuid, uuid, uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.cancel_registration(uuid, text, text), public.cancel_registration(uuid, text, text),
  private.change_registration_modality(uuid, uuid, uuid, text, text),
  public.change_registration_modality(uuid, uuid, uuid, text, text)
to authenticated;
