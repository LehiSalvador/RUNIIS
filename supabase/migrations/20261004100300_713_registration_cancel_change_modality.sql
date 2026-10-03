-- P3-A registration lifecycle after confirmation (Master §77-79, §172), recovered from T41:
-- CancelRegistration and ChangeRegistrationModality. Capacity is a live count of CONFIRMED registrations
-- (events kernel), so cancelling releases capacity by status alone -- there is no counter to decrement. Both
-- commands are blocked once attendance is finalized or the Edition is administratively closed (Master §77
-- "despues de AttendanceFinalization requiere reopen/correction workflow"): staff reopen first.
--
-- Lock order is the canonical one (ADR-001 §3): Edition -> ModalityCapacity rows by modality_id -> registration.
--
-- OWN-04 (the owner's cancellation policy) is CLOSED and equals T41's rule, which lives ONLY in
-- private.registration_cancel_policy_check(): staff with REGISTRATION_MANAGE (ADMIN/OPERATOR, authorized by
-- the command) may cancel a CONFIRMED registration at any time until attendance is finalized; afterwards only
-- through reopen/correction. Reason mandatory, no refund (Master §77), never DELETE. The participant is always
-- notified by email: RegistrationCanceled carries the recipient reference and a closed reason category, never
-- the free-text reason. A future change to the rule edits that one function and nothing else.

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
-- The cancellation policy (OWN-04). Called by CancelRegistration after the row is locked; raises a domain
-- error when the cancellation is not allowed. Keep every rule about WHEN and WHO MAY cancel in here.
-- ---------------------------------------------------------------------------------------------
create or replace function private.registration_cancel_policy_check(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg app.registration%rowtype;
begin
  select * into v_reg from app.registration r where r.registration_id = p_registration_id;
  -- Only a CONFIRMED registration can be cancelled; a second cancel is an invalid transition, not a no-op.
  if v_reg.status <> 'CONFIRMED' then perform private.cfg_invalid_transition('status', v_reg.status); end if;
  -- After AttendanceFinalization or administrative closure the correction workflow (reopen) applies.
  perform private.registration_assert_not_closure_blocked(v_reg.edition_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- CancelRegistration (Master §77). Never DELETE.
-- ---------------------------------------------------------------------------------------------
create or replace function private.cancel_registration(
  p_registration_id uuid, p_reason text, p_reason_category text default 'OTHER', p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_idem jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_category text := coalesce(p_reason_category, 'OTHER');
  v_reg app.registration%rowtype;
  v_credit_id uuid;
  v_kit_released integer;
  v_kit_review boolean;
  v_result jsonb;
begin
  select r.edition_id into v_edition_id from app.registration r where r.registration_id = p_registration_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('REGISTRATION_MANAGE', v_edition_id);
  if v_reason is null then perform private.cfg_fail('reason', 'required'); end if;
  if length(v_reason) > 500 then perform private.cfg_fail('reason', 'too_long'); end if;
  -- The category is the ONLY thing about the reason that may reach the participant (OWN-04): a closed set.
  if v_category not in ('PARTICIPANT_REQUEST', 'DUPLICATE_REGISTRATION', 'ELIGIBILITY', 'EVENT_CHANGE', 'ADMINISTRATIVE', 'OTHER') then
    perform private.cfg_fail('reason_category', 'invalid_value');
  end if;

  v_idem := private.cfg_idempotency_begin('closure.cancel_registration', p_registration_id::text, p_idempotency_key,
    jsonb_build_object('registration_id', p_registration_id, 'reason', v_reason, 'reason_category', v_category));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform 1 from app.registration r where r.registration_id = p_registration_id for update;
  perform private.registration_cancel_policy_check(p_registration_id);
  select * into v_reg from app.registration r where r.registration_id = p_registration_id;

  update app.registration set status = 'CANCELED', canceled_at = now(), cancel_reason = v_reason
  where registration_id = p_registration_id;

  -- The pass dies with the registration; a REVOKED pass keeps its stronger state.
  update app.participant_pass set status = 'CANCELED', canceled_at = now()
  where registration_id = p_registration_id and status = 'ACTIVE';

  -- Kit review: an undelivered allocation is released; a physically DELIVERED kit stays as the evidence of
  -- what left the warehouse and is flagged for staff review (the pickup row is never rewritten).
  update app.kit_allocation set status = 'CANCELED', notes = coalesce(notes || ' | ', '') || 'registration canceled'
  where registration_id = p_registration_id and status in ('ASSIGNED', 'READY');
  get diagnostics v_kit_released = row_count;
  update app.kit_allocation set notes = coalesce(notes || ' | ', '') || 'registration canceled after delivery: review kit'
  where registration_id = p_registration_id and status in ('DELIVERED', 'EXCEPTION')
    and coalesce(notes, '') not like '%registration canceled after delivery%';
  v_kit_review := exists (select 1 from app.kit_allocation k
                          where k.registration_id = p_registration_id and k.status in ('DELIVERED', 'EXCEPTION'));

  -- Only reachable if the Edition was reopened and the credit was not reversed with it (defensive: the
  -- finalization/closure block above makes this the exceptional path).
  select dc.distance_credit_id into v_credit_id from app.distance_credit dc
  where dc.registration_id = p_registration_id and dc.status = 'ACTIVE' for update;
  if v_credit_id is not null then
    update app.distance_credit set status = 'REVERSED', reversed_at = now(), reversed_by_staff_id = v_staff_id,
      reversal_reason = v_reason
    where distance_credit_id = v_credit_id;
    perform private.enqueue_outbox('DistanceCreditReversed', 'DistanceCredit', v_credit_id,
      'DistanceCreditReversed:' || v_credit_id, jsonb_build_object('distance_credit_id', v_credit_id, 'edition_id', v_edition_id));
  end if;

  perform private.audit('REGISTRATION_CANCELED', 'registration', p_registration_id, v_edition_id,
    jsonb_build_object('status', 'CONFIRMED'),
    jsonb_build_object('status', 'CANCELED', 'reason_category', v_category, 'kit_allocations_released', v_kit_released, 'kit_review_required', v_kit_review,
      'distance_credit_reversed', v_credit_id is not null), v_reason);
  perform private.enqueue_outbox('RegistrationCanceled', 'Registration', p_registration_id,
    'RegistrationCanceled:' || p_registration_id,
    -- Everything the comms layer needs and nothing else: ids only (SEC-072), the recipient as a profile
    -- reference (the participant's own profile, or the buyer for a Guest who has no account) and the closed
    -- reason category. The free-text reason stays in the registration and the audit log, never in the event.
    jsonb_build_object('registration_id', p_registration_id, 'edition_id', v_edition_id,
      'participant_kind', case when v_reg.runner_profile_id is not null then 'PROFILE' else 'GUEST' end,
      'recipient_profile_id', coalesce(v_reg.runner_profile_id, v_reg.buyer_profile_id),
      'buyer_profile_id', v_reg.buyer_profile_id,
      'reason_category', v_category, 'kit_review_required', v_kit_review));

  v_result := private.registration_status_projection(p_registration_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Capacity for moving ONE already-counted registration into a modality (Master §78). The registration keeps
-- its slot in the global count, so only the target modality needs a free place; the global limit is checked
-- on the same terms as registration_assert_capacity with the registration's own slot given back (a move can
-- never be refused by a limit it does not change, except when the Edition is already over its global limit).
-- ---------------------------------------------------------------------------------------------
create or replace function private.registration_assert_move_capacity(p_edition_id uuid, p_target_modality_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_availability jsonb := private.edition_availability(p_edition_id);
  v_modality jsonb;
begin
  select m into v_modality from jsonb_array_elements(v_availability -> 'modalities') m
  where (m ->> 'modality_id')::uuid = p_target_modality_id;
  if v_modality ->> 'effective_capacity' is not null
     and (v_modality ->> 'effective_capacity')::integer - (v_modality ->> 'confirmed')::integer
         - (v_modality ->> 'active_holds')::integer < 1 then
    perform private.raise_domain_error('CAPACITY_UNAVAILABLE', jsonb_build_object('modality_id', p_target_modality_id));
  end if;
  if v_availability -> 'global' ->> 'capacity' is not null
     and (v_availability -> 'global' ->> 'capacity')::integer - (v_availability -> 'global' ->> 'confirmed')::integer
         - (v_availability -> 'global' ->> 'active_holds')::integer < 0 then
    perform private.raise_domain_error('GLOBAL_CAPACITY_UNAVAILABLE');
  end if;
end;
$$;

-- Registration forms are answered once, at request time, against the request participant. A target modality
-- whose published forms ask for a REQUIRED field that was never answered cannot be entered by staff (they have
-- no way to supply the response here): FORM_INVALID names the first missing field.
create or replace function private.registration_assert_form_requirements(p_registration_id uuid, p_target_modality_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text;
begin
  select ff.field_key into v_missing
  from app.registration r
  join app.registration_form f on f.edition_id = r.edition_id and f.status = 'PUBLISHED'
    and (f.modality_id is null or f.modality_id = p_target_modality_id)
  join app.registration_form_field ff on ff.registration_form_id = f.registration_form_id and ff.required
  where r.registration_id = p_registration_id
    and not exists (
      select 1 from app.registration_field_response fr
      where fr.request_participant_id = r.request_participant_id
        and fr.registration_form_field_id = ff.registration_form_field_id
        and jsonb_typeof(fr.value_json) <> 'null'
        and not (jsonb_typeof(fr.value_json) = 'string' and btrim(fr.value_json #>> '{}') = ''))
  order by ff.sort_order, ff.field_key
  limit 1;
  if v_missing is not null then
    perform private.raise_domain_error('FORM_INVALID',
      jsonb_build_object('field_key', v_missing, 'reason', 'required_for_target_modality'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ChangeRegistrationModality (Master §78-79). Staff only in V1. Validates the same rules a new registration
-- would (Edition, ACTIVE modality, participant eligibility, modality + global capacity, category, form
-- requirements) then records a RegistrationRevision. modality_id is not part of the registration's frozen
-- identity (request, request participant, Edition, runner/guest and buyer are), so the row is updated in
-- place and the revision chain is the audit trail. Kits are defined per Edition, not per modality, so the
-- kit allocation is unchanged; the official distance impact is reported and flows into the next CloseEdition.
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
  v_reason text := nullif(btrim(p_reason), '');
  v_reg app.registration%rowtype;
  v_old_modality app.modality%rowtype;
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
  if v_reason is null then perform private.cfg_fail('reason', 'required'); end if;
  if length(v_reason) > 500 then perform private.cfg_fail('reason', 'too_long'); end if;
  if p_new_modality_id is null then perform private.cfg_fail('new_modality_id', 'required'); end if;

  v_idem := private.cfg_idempotency_begin('closure.change_modality', p_registration_id::text, p_idempotency_key,
    jsonb_build_object('registration_id', p_registration_id, 'new_modality_id', p_new_modality_id,
      'category_id', p_category_id, 'reason', v_reason));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  -- Canonical lock order: Edition, ModalityCapacity rows by modality_id, then the registration.
  perform 1 from app.edition e where e.edition_id = v_reg.edition_id for update;
  perform 1 from app.modality_capacity mc where mc.modality_id in (v_reg.modality_id, p_new_modality_id)
    order by mc.modality_id for update;
  select * into v_reg from app.registration r where r.registration_id = p_registration_id for update;
  if v_reg.status <> 'CONFIRMED' then perform private.cfg_invalid_transition('status', v_reg.status); end if;
  perform private.registration_assert_not_closure_blocked(v_reg.edition_id);
  if p_new_modality_id = v_reg.modality_id then perform private.cfg_fail('new_modality_id', 'same_as_current'); end if;

  select * into v_modality from app.modality m where m.modality_id = p_new_modality_id and m.edition_id = v_reg.edition_id;
  if not found or v_modality.status <> 'ACTIVE' then perform private.raise_domain_error('MODALITY_NOT_AVAILABLE'); end if;
  select * into v_old_modality from app.modality m where m.modality_id = v_reg.modality_id;

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

  perform private.registration_assert_form_requirements(p_registration_id, p_new_modality_id);
  perform private.registration_assert_move_capacity(v_reg.edition_id, p_new_modality_id);

  -- The chain must be reconstructible from its first link: a registration confirmed before this command
  -- existed has no revision yet, so the pre-change state is recorded as revision 1 first.
  if not exists (select 1 from app.registration_revision rr where rr.registration_id = p_registration_id) then
    insert into app.registration_revision (registration_id, revision, modality_id, category_id, status, effective_from,
      reason, changed_by_staff_id)
    select p_registration_id, 1, v_reg.modality_id, rca.category_id, 'ACTIVE', v_reg.confirmed_at,
      'Baseline before modality change', v_staff_id
    from (select 1) one
    left join app.registration_category_assignment rca on rca.registration_id = p_registration_id;
  end if;

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
  update app.registration_revision set status = 'SUPERSEDED', superseded_at = now()
  where registration_id = p_registration_id and superseded_at is null;
  insert into app.registration_revision (registration_id, revision, modality_id, category_id, status, effective_from,
    reason, changed_by_staff_id)
  values (p_registration_id, v_revision, p_new_modality_id, v_category_id, 'ACTIVE', now(), v_reason, v_staff_id);

  -- Official distance impact: a still-ACTIVE credit (only reachable through a reopened Edition) is reversed;
  -- the next CloseEdition issues the new one against the new modality's distance, linked by supersedes.
  select dc.distance_credit_id into v_credit_id from app.distance_credit dc
  where dc.registration_id = p_registration_id and dc.status = 'ACTIVE' for update;
  if v_credit_id is not null then
    update app.distance_credit set status = 'REVERSED', reversed_at = now(), reversed_by_staff_id = v_staff_id,
      reversal_reason = v_reason
    where distance_credit_id = v_credit_id;
    perform private.enqueue_outbox('DistanceCreditReversed', 'DistanceCredit', v_credit_id,
      'DistanceCreditReversed:' || v_credit_id, jsonb_build_object('distance_credit_id', v_credit_id, 'edition_id', v_reg.edition_id));
  end if;

  perform private.audit('REGISTRATION_MODALITY_CHANGED', 'registration', p_registration_id, v_reg.edition_id,
    jsonb_build_object('modality_id', v_reg.modality_id, 'official_distance_m', v_old_modality.official_distance_m,
      'generates_distance_credit', v_old_modality.generates_distance_credit),
    jsonb_build_object('modality_id', p_new_modality_id, 'official_distance_m', v_modality.official_distance_m,
      'generates_distance_credit', v_modality.generates_distance_credit, 'revision', v_revision,
      'distance_credit_reversed', v_credit_id is not null), v_reason);
  perform private.enqueue_outbox('RegistrationModalityChanged', 'Registration', p_registration_id,
    'RegistrationModalityChanged:' || p_registration_id || ':' || v_revision,
    jsonb_build_object('registration_id', p_registration_id, 'edition_id', v_reg.edition_id));

  v_result := jsonb_build_object('registration_id', p_registration_id, 'modality_id', p_new_modality_id,
    'category_id', v_category_id, 'revision', v_revision,
    'official_distance_impact', jsonb_build_object(
      'from_m', v_old_modality.official_distance_m, 'to_m', v_modality.official_distance_m,
      'from_generates_credit', v_old_modality.generates_distance_credit, 'to_generates_credit', v_modality.generates_distance_credit));
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public wrappers + grants.
-- ---------------------------------------------------------------------------------------------
create or replace function public.cancel_registration(p_registration_id uuid, p_reason text,
  p_reason_category text default 'OTHER', p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_registration(p_registration_id, p_reason, p_reason_category, p_idempotency_key) $$;

create or replace function public.change_registration_modality(p_registration_id uuid, p_new_modality_id uuid,
  p_category_id uuid default null, p_reason text default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.change_registration_modality(p_registration_id, p_new_modality_id, p_category_id, p_reason, p_idempotency_key) $$;

revoke all on function
  private.registration_status_projection(uuid), private.registration_assert_not_closure_blocked(uuid),
  private.registration_cancel_policy_check(uuid), private.registration_assert_move_capacity(uuid, uuid),
  private.registration_assert_form_requirements(uuid, uuid),
  private.cancel_registration(uuid, text, text, text), public.cancel_registration(uuid, text, text, text),
  private.change_registration_modality(uuid, uuid, uuid, text, text),
  public.change_registration_modality(uuid, uuid, uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.cancel_registration(uuid, text, text, text), public.cancel_registration(uuid, text, text, text),
  private.change_registration_modality(uuid, uuid, uuid, text, text),
  public.change_registration_modality(uuid, uuid, uuid, text, text)
to authenticated;
