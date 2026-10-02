-- T41 closure commands (Master §97-102, §175): CloseEdition and ReopenEdition. ADMIN only
-- (EDITION_CLOSURE_MANAGE). CloseEdition creates DistanceCredits idempotently in the same
-- transaction as the AdministrativeClosure revision (Master §220 "closure retry safe": a retried
-- call with the same Idempotency-Key replays the stored response; a retry without one hits the
-- ordinary "already closed" conflict instead of duplicating credits, Master §161 #18/#19).

create or replace function private.distance_credit_projection(p_distance_credit_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('distance_credit_id', dc.distance_credit_id, 'runner_profile_id', dc.runner_profile_id,
    'registration_id', dc.registration_id, 'edition_id', dc.edition_id, 'modality_id', dc.modality_id,
    'official_distance_snapshot_m', dc.official_distance_snapshot_m, 'credited_distance_m', dc.credited_distance_m,
    'sport_date', dc.sport_date, 'sport_timezone', dc.sport_timezone, 'status', dc.status, 'created_at', dc.created_at)
  from app.distance_credit dc
  where dc.distance_credit_id = p_distance_credit_id
$$;

-- ---------------------------------------------------------------------------------------------
-- CloseEdition (Master §97).
-- ---------------------------------------------------------------------------------------------
create or replace function private.close_edition(p_edition_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := private.cfg_authorize('EDITION_CLOSURE_MANAGE', p_edition_id);
  v_idem jsonb;
  v_edition app.edition%rowtype;
  v_readiness jsonb;
  v_revision integer;
  v_closure_id uuid;
  v_finalization_id uuid;
  v_row record;
  v_official_distance integer;
  v_effective jsonb;
  v_sport_date date;
  v_sport_timezone text;
  v_credit_id uuid;
  v_credited_count integer := 0;
  v_epoch_candidate date;
  v_result jsonb;
  v_constraint text;
begin
  v_idem := private.cfg_idempotency_begin('closure.close_edition', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  select * into v_edition from app.edition e where e.edition_id = p_edition_id for update;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if v_edition.closure_state <> 'PENDING' then
    perform private.cfg_invalid_transition('closure_state', v_edition.closure_state);
  end if;

  v_readiness := private.closure_readiness(p_edition_id);
  if not (v_readiness ->> 'ready')::boolean then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
      jsonb_build_object('reason', 'not_ready', 'readiness', v_readiness));
  end if;

  select f.attendance_finalization_id into v_finalization_id from app.attendance_finalization f
  where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED';

  select coalesce(max(c.revision), 0) + 1 into v_revision from app.administrative_closure c where c.edition_id = p_edition_id;
  insert into app.administrative_closure (edition_id, revision, attendance_finalization_id, closed_by_staff_id)
  values (p_edition_id, v_revision, v_finalization_id, v_staff_id)
  returning administrative_closure_id into v_closure_id;

  -- Eligible PROFILE registrations only: the FK to app.registration(registration_id, edition_id,
  -- runner_profile_id) makes a Guest row structurally impossible to reference here (Master §220).
  for v_row in
    select r.registration_id, r.runner_profile_id, r.modality_id, m.official_distance_m, m.generates_distance_credit,
      ar.attendance_resolution_id, s.sporting_eligibility_resolution_id
    from app.registration r
    join app.modality m on m.modality_id = r.modality_id
    join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
    join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
    where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and r.runner_profile_id is not null
      and ar.status = 'PRESENT' and s.distance_credit_disposition = 'ALLOW' and m.generates_distance_credit
  loop
    if v_row.official_distance_m is null or v_row.official_distance_m <= 0 then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
        jsonb_build_object('reason', 'official_distance_missing', 'modality_id', v_row.modality_id));
    end if;
    v_effective := private.effective_start(p_edition_id, v_row.modality_id);
    if v_effective is null or v_effective ->> 'sport_date' is null then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
        jsonb_build_object('reason', 'sport_date_unknown', 'modality_id', v_row.modality_id));
    end if;
    v_sport_date := (v_effective ->> 'sport_date')::date;
    v_sport_timezone := v_edition.timezone;

    insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
      attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
      official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone)
    values (v_row.runner_profile_id, v_row.registration_id, p_edition_id, v_row.modality_id,
      v_row.attendance_resolution_id, v_finalization_id, v_closure_id, v_row.sporting_eligibility_resolution_id,
      v_row.official_distance_m, v_row.official_distance_m, v_sport_date, v_sport_timezone)
    on conflict (registration_id) where status = 'ACTIVE' do nothing
    returning distance_credit_id into v_credit_id;

    if v_credit_id is not null then
      v_credited_count := v_credited_count + 1;
      perform private.enqueue_outbox('DistanceCreditGranted', 'DistanceCredit', v_credit_id,
        'DistanceCreditGranted:' || v_credit_id, jsonb_build_object('distance_credit_id', v_credit_id,
          'runner_profile_id', v_row.runner_profile_id, 'edition_id', p_edition_id));
    end if;
  end loop;

  -- Ranking epoch bootstrap (Master §102): first-ever competitively eligible credit only, never moved
  -- silently afterwards. Competitive eligibility facts (T42 rebuilds this same test from live data):
  -- runner ACTIVE, adult (>=18) as of sport_date, disposition ALLOW, modality generates credit, credit ACTIVE.
  select min(dc.sport_date) into v_epoch_candidate
  from app.distance_credit dc
  join app.runner_profile rp on rp.runner_profile_id = dc.runner_profile_id
  where dc.administrative_closure_id = v_closure_id and dc.status = 'ACTIVE'
    and rp.account_state = 'ACTIVE' and age(dc.sport_date, rp.date_of_birth) >= interval '18 years';
  if v_epoch_candidate is not null then
    update app.competition_settings set ranking_epoch = v_epoch_candidate, ranking_epoch_frozen_at = now(),
      updated_at = now(), updated_by_staff_id = v_staff_id
    where settings_id = 1 and ranking_epoch is null;
  end if;

  update app.edition set closure_state = 'CLOSED' where edition_id = p_edition_id;

  perform private.audit('EDITION_ADMINISTRATIVELY_CLOSED', 'edition', p_edition_id, p_edition_id, null,
    jsonb_build_object('revision', v_revision, 'credits_created', v_credited_count));
  perform private.enqueue_outbox('EditionAdministrativelyClosed', 'Edition', p_edition_id,
    'EditionAdministrativelyClosed:' || p_edition_id || ':' || v_revision, jsonb_build_object('edition_id', p_edition_id));

  v_result := private.administrative_closure_projection(p_edition_id) || jsonb_build_object('credits_created', v_credited_count);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ReopenEdition (Master §98). ADMIN, reason mandatory. Reverses every ACTIVE credit the superseded
-- closure produced and returns to closure_state PENDING; a fresh CloseEdition regenerates credits.
-- ---------------------------------------------------------------------------------------------
create or replace function private.reopen_edition(p_edition_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := private.cfg_authorize('EDITION_CLOSURE_MANAGE', p_edition_id);
  v_idem jsonb;
  v_closure app.administrative_closure%rowtype;
  v_reversed_ids uuid[];
  v_credit_id uuid;
  v_result jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then perform private.cfg_fail('reason', 'required'); end if;
  v_idem := private.cfg_idempotency_begin('closure.reopen_edition', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  select * into v_closure from app.administrative_closure c
  where c.edition_id = p_edition_id and c.superseded_at is null and c.status = 'CLOSED' for update;
  if not found then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'not_closed'));
  end if;

  update app.administrative_closure set status = 'SUPERSEDED', superseded_at = now(), reopened_at = now(),
    reopened_by_staff_id = v_staff_id, reopen_reason = p_reason
  where administrative_closure_id = v_closure.administrative_closure_id;

  v_reversed_ids := '{}';
  for v_credit_id in
    select dc.distance_credit_id from app.distance_credit dc
    where dc.administrative_closure_id = v_closure.administrative_closure_id and dc.status = 'ACTIVE'
    for update
  loop
    update app.distance_credit set status = 'REVERSED', reversed_at = now(), reversed_by_staff_id = v_staff_id,
      reversal_reason = p_reason
    where distance_credit_id = v_credit_id;
    v_reversed_ids := v_reversed_ids || v_credit_id;
    perform private.enqueue_outbox('DistanceCreditReversed', 'DistanceCredit', v_credit_id,
      'DistanceCreditReversed:' || v_credit_id || ':' || v_closure.administrative_closure_id,
      jsonb_build_object('distance_credit_id', v_credit_id, 'edition_id', p_edition_id));
  end loop;

  update app.edition set closure_state = 'PENDING' where edition_id = p_edition_id;

  perform private.audit('EDITION_ADMINISTRATIVE_CLOSURE_REOPENED', 'edition', p_edition_id, p_edition_id,
    jsonb_build_object('administrative_closure_id', v_closure.administrative_closure_id),
    jsonb_build_object('reversed_distance_credit_ids', to_jsonb(v_reversed_ids)), p_reason);
  perform private.enqueue_outbox('EditionAdministrativeClosureReopened', 'Edition', p_edition_id,
    'EditionAdministrativeClosureReopened:' || v_closure.administrative_closure_id,
    jsonb_build_object('edition_id', p_edition_id));

  v_result := jsonb_build_object('edition_id', p_edition_id, 'reopened', true,
    'reversed_credit_count', array_length(v_reversed_ids, 1));
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public wrappers + grants.
-- ---------------------------------------------------------------------------------------------
create or replace function public.close_edition(p_edition_id uuid, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.close_edition(p_edition_id, p_idempotency_key) $$;

create or replace function public.reopen_edition(p_edition_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.reopen_edition(p_edition_id, p_reason, p_idempotency_key) $$;

revoke all on function
  private.close_edition(uuid, text), public.close_edition(uuid, text),
  private.reopen_edition(uuid, text, text), public.reopen_edition(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.close_edition(uuid, text), public.close_edition(uuid, text),
  private.reopen_edition(uuid, text, text), public.reopen_edition(uuid, text, text)
to authenticated;
