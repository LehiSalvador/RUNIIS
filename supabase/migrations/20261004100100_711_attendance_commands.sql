-- P3-A attendance commands (Master §91-94, §175), recovered from T41 and reconciled with the current
-- schema: ResolveAttendance, ResolveSportingEligibility, FinalizeAttendance (with an optional bulk
-- MarkRemainingNoShow step, Master §93 -- there is no separate route for it, so the explicit-scope
-- confirmation rides the finalize body) and ReopenAttendanceFinalization. Reuses the events kernel's
-- cfg_* authorization / idempotency plumbing (staff authority from staff_role_assignment, the Edition
-- scope derived from the target row -- SEC-020).
--
-- Differences from the T41 WIP: manual PRESENT needs actor + reason + evidence (Master §91; the WIP only
-- required the reason), EXCLUDED needs a reason, PENDING_REVIEW can only carry the PENDING disposition,
-- every command syncs the universe first so a registration always has a current row, and the bulk
-- MarkRemainingNoShow is audited with its count.

-- ---------------------------------------------------------------------------------------------
-- ResolveAttendance
-- ---------------------------------------------------------------------------------------------
create or replace function private.resolve_attendance(
  p_registration_id uuid, p_status text, p_reason text default null, p_evidence_metadata jsonb default null,
  p_idempotency_key text default null)
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
  v_current app.attendance_resolution%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_source text;
  v_revision integer;
  v_result jsonb;
  v_constraint text;
begin
  select r.edition_id into v_edition_id from app.registration r where r.registration_id = p_registration_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('ATTENDANCE_MANAGE', v_edition_id);

  if p_status is null or p_status not in ('PRESENT', 'NO_SHOW', 'EXCLUDED') then perform private.cfg_fail('status', 'invalid_value'); end if;
  if v_reason is not null and length(v_reason) > 500 then perform private.cfg_fail('reason', 'too_long'); end if;
  if p_status in ('PRESENT', 'EXCLUDED') and v_reason is null then
    perform private.cfg_fail('reason', 'required');
  end if;
  if p_evidence_metadata is not null and jsonb_typeof(p_evidence_metadata) <> 'object' then
    perform private.cfg_fail('evidence_metadata', 'invalid_type');
  end if;
  if p_evidence_metadata is not null and length(p_evidence_metadata::text) > 4096 then
    perform private.cfg_fail('evidence_metadata', 'too_long');
  end if;
  -- Master §91: a manual PRESENT needs actor, reason and evidence (a scan is evidence, a human claim is not).
  if p_status = 'PRESENT' and (p_evidence_metadata is null or p_evidence_metadata = '{}'::jsonb) then
    perform private.cfg_fail('evidence_metadata', 'required');
  end if;

  v_idem := private.cfg_idempotency_begin('closure.attendance_resolve', p_registration_id::text, p_idempotency_key,
    jsonb_build_object('registration_id', p_registration_id, 'status', p_status, 'reason', v_reason,
      'evidence_metadata', p_evidence_metadata));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform private.attendance_sync_universe(v_edition_id);
  select * into v_reg from app.registration r where r.registration_id = p_registration_id for update;
  if v_reg.status <> 'CONFIRMED' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'not_in_universe'));
  end if;
  if exists (select 1 from app.attendance_finalization f
             where f.edition_id = v_edition_id and f.superseded_at is null and f.status = 'FINALIZED') then
    perform private.raise_domain_error('CLOSURE_BLOCKED', jsonb_build_object('reason', 'attendance_finalized'));
  end if;

  select * into v_current from app.attendance_resolution ar
  where ar.registration_id = p_registration_id and ar.superseded_at is null;
  -- Settling a PENDING row is MANUAL; changing an already settled row is a CORRECTION (never an overwrite).
  v_source := case when found and v_current.status <> 'PENDING' then 'CORRECTION' else 'MANUAL' end;
  select coalesce(max(ar.revision), 0) + 1 into v_revision from app.attendance_resolution ar where ar.registration_id = p_registration_id;

  update app.attendance_resolution set superseded_at = now()
  where registration_id = p_registration_id and superseded_at is null;

  insert into app.attendance_resolution (edition_id, registration_id, revision, status, source, reason,
    evidence_metadata, resolved_by_staff_id, resolved_at)
  values (v_edition_id, p_registration_id, v_revision, p_status, v_source, v_reason,
    coalesce(p_evidence_metadata, '{}'::jsonb), v_staff_id, now());

  perform private.audit('ATTENDANCE_RESOLVED', 'registration', p_registration_id, v_edition_id,
    jsonb_build_object('status', v_current.status, 'source', v_current.source),
    jsonb_build_object('status', p_status, 'source', v_source, 'revision', v_revision), v_reason);
  perform private.enqueue_outbox('AttendanceResolved', 'Registration', p_registration_id,
    'AttendanceResolved:' || p_registration_id || ':' || v_revision,
    jsonb_build_object('registration_id', p_registration_id, 'edition_id', v_edition_id));

  v_result := private.attendance_resolution_projection(p_registration_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ResolveSportingEligibility
-- ---------------------------------------------------------------------------------------------
create or replace function private.resolve_sporting_eligibility(
  p_registration_id uuid, p_status text, p_disposition text, p_reason_code text default null,
  p_reason text default null, p_idempotency_key text default null)
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
  v_current app.sporting_eligibility_resolution%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_revision integer;
  v_result jsonb;
  v_constraint text;
begin
  select r.edition_id into v_edition_id from app.registration r where r.registration_id = p_registration_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('ATTENDANCE_MANAGE', v_edition_id);

  if p_status is null or p_status not in ('ELIGIBLE', 'DISQUALIFIED', 'EXCLUDED', 'PENDING_REVIEW') then
    perform private.cfg_fail('status', 'invalid_value');
  end if;
  if p_disposition is null or p_disposition not in ('ALLOW', 'DENY', 'PENDING') then
    perform private.cfg_fail('distance_credit_disposition', 'invalid_value');
  end if;
  if v_reason is not null and length(v_reason) > 500 then perform private.cfg_fail('reason', 'too_long'); end if;
  if p_status in ('DISQUALIFIED', 'EXCLUDED') and v_reason is null then
    perform private.cfg_fail('reason', 'required');
  end if;
  -- A review still open can never release kilometres (Master §92: PENDING is the closure blocker).
  if p_status = 'PENDING_REVIEW' and p_disposition <> 'PENDING' then
    perform private.cfg_fail('distance_credit_disposition', 'pending_review_requires_pending');
  end if;

  v_idem := private.cfg_idempotency_begin('closure.eligibility_resolve', p_registration_id::text, p_idempotency_key,
    jsonb_build_object('registration_id', p_registration_id, 'status', p_status, 'distance_credit_disposition', p_disposition,
      'reason_code', p_reason_code, 'reason', v_reason));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform private.attendance_sync_universe(v_edition_id);
  select * into v_reg from app.registration r where r.registration_id = p_registration_id for update;
  if v_reg.status <> 'CONFIRMED' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'not_in_universe'));
  end if;
  if exists (select 1 from app.administrative_closure c
             where c.edition_id = v_edition_id and c.superseded_at is null and c.status = 'CLOSED') then
    perform private.raise_domain_error('CLOSURE_BLOCKED', jsonb_build_object('reason', 'edition_closed'));
  end if;

  select * into v_current from app.sporting_eligibility_resolution s
  where s.registration_id = p_registration_id and s.superseded_at is null;
  select coalesce(max(s.revision), 0) + 1 into v_revision
  from app.sporting_eligibility_resolution s where s.registration_id = p_registration_id;

  update app.sporting_eligibility_resolution set superseded_at = now()
  where registration_id = p_registration_id and superseded_at is null;

  insert into app.sporting_eligibility_resolution (registration_id, revision, status, distance_credit_disposition,
    reason_code, reason, resolved_by_staff_id, resolved_at)
  values (p_registration_id, v_revision, p_status, p_disposition, p_reason_code, v_reason, v_staff_id, now());

  perform private.audit('SPORTING_ELIGIBILITY_RESOLVED', 'registration', p_registration_id, v_edition_id,
    jsonb_build_object('status', v_current.status, 'distance_credit_disposition', v_current.distance_credit_disposition),
    jsonb_build_object('status', p_status, 'distance_credit_disposition', p_disposition, 'revision', v_revision), v_reason);
  perform private.enqueue_outbox('SportingEligibilityResolved', 'Registration', p_registration_id,
    'SportingEligibilityResolved:' || p_registration_id || ':' || v_revision,
    jsonb_build_object('registration_id', p_registration_id, 'edition_id', v_edition_id));

  v_result := private.sporting_eligibility_projection(p_registration_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- FinalizeAttendance (Master §94). p_mark_remaining_no_show carries the explicit scope confirmation
-- for bulk MarkRemainingNoShow (Master §93): it only ever touches currently PENDING rows, never
-- PRESENT or EXCLUDED, and it runs in the same transaction as the readiness check so a refused
-- finalization leaves nothing marked.
-- ---------------------------------------------------------------------------------------------
create or replace function private.finalize_attendance(
  p_edition_id uuid, p_mark_remaining_no_show boolean default false, p_reason text default null,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := private.cfg_authorize('ATTENDANCE_MANAGE', p_edition_id);
  v_idem jsonb;
  v_edition app.edition%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_readiness jsonb;
  v_revision integer;
  v_marked integer := 0;
  v_result jsonb;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if coalesce(p_mark_remaining_no_show, false) and v_reason is null then
    perform private.cfg_fail('reason', 'required');
  end if;
  if v_reason is not null and length(v_reason) > 500 then perform private.cfg_fail('reason', 'too_long'); end if;

  v_idem := private.cfg_idempotency_begin('closure.attendance_finalize', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id, 'mark_remaining_no_show', coalesce(p_mark_remaining_no_show, false),
      'reason', v_reason));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  select * into v_edition from app.edition e where e.edition_id = p_edition_id for update;
  if v_edition.execution_state <> 'FINISHED' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'edition_not_finished'));
  end if;
  if exists (select 1 from app.attendance_finalization f
             where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED') then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'already_finalized'));
  end if;
  perform private.attendance_sync_universe(p_edition_id);

  if coalesce(p_mark_remaining_no_show, false) then
    with pending as (
      select ar.attendance_resolution_id, ar.registration_id, ar.revision
      from app.registration r
      join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
      where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and ar.status = 'PENDING'
    ), superseded as (
      update app.attendance_resolution set superseded_at = now()
      where attendance_resolution_id in (select attendance_resolution_id from pending)
      returning attendance_resolution_id
    ), inserted as (
      insert into app.attendance_resolution (edition_id, registration_id, revision, status, source, reason,
        resolved_by_staff_id, resolved_at)
      select p_edition_id, p.registration_id, p.revision + 1, 'NO_SHOW', 'MANUAL', v_reason, v_staff_id, now()
      from pending p
      join superseded s on s.attendance_resolution_id = p.attendance_resolution_id
      returning 1
    )
    select count(*) into v_marked from inserted;

    if v_marked > 0 then
      perform private.audit('ATTENDANCE_BULK_NO_SHOW_MARKED', 'edition', p_edition_id, p_edition_id, null,
        jsonb_build_object('marked_count', v_marked), v_reason);
    end if;
  end if;

  v_readiness := private.finalization_readiness(p_edition_id);
  if not (v_readiness ->> 'ready')::boolean then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
      jsonb_build_object('reason', 'not_ready', 'readiness', v_readiness));
  end if;

  select coalesce(max(f.revision), 0) + 1 into v_revision from app.attendance_finalization f where f.edition_id = p_edition_id;

  insert into app.attendance_finalization (edition_id, revision, expected_count, present_count, no_show_count,
    excluded_count, finalized_by_staff_id)
  select p_edition_id, v_revision, (v_readiness ->> 'expected_count')::integer,
    count(*) filter (where ar.status = 'PRESENT'), count(*) filter (where ar.status = 'NO_SHOW'),
    count(*) filter (where ar.status = 'EXCLUDED'), v_staff_id
  from app.registration r
  join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED';

  perform private.audit('ATTENDANCE_FINALIZED', 'edition', p_edition_id, p_edition_id, null,
    jsonb_build_object('revision', v_revision, 'bulk_no_show_marked', v_marked), v_reason);
  perform private.enqueue_outbox('AttendanceFinalized', 'Edition', p_edition_id,
    'AttendanceFinalized:' || p_edition_id || ':' || v_revision, jsonb_build_object('edition_id', p_edition_id));

  v_result := private.attendance_finalization_projection(p_edition_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ReopenAttendanceFinalization: only while no CLOSED AdministrativeClosure is current (Master §98
-- requires ReopenEdition first once the Edition is administratively closed).
-- ---------------------------------------------------------------------------------------------
create or replace function private.reopen_attendance_finalization(
  p_edition_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := private.cfg_authorize('ATTENDANCE_MANAGE', p_edition_id);
  v_idem jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_finalization app.attendance_finalization%rowtype;
  v_result jsonb;
begin
  if v_reason is null then perform private.cfg_fail('reason', 'required'); end if;
  if length(v_reason) > 500 then perform private.cfg_fail('reason', 'too_long'); end if;
  v_idem := private.cfg_idempotency_begin('closure.attendance_reopen', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id, 'reason', v_reason));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if exists (select 1 from app.administrative_closure c
             where c.edition_id = p_edition_id and c.superseded_at is null and c.status = 'CLOSED') then
    perform private.raise_domain_error('CLOSURE_BLOCKED', jsonb_build_object('reason', 'edition_closed'));
  end if;
  select * into v_finalization from app.attendance_finalization f
  where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED' for update;
  if not found then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'no_current_finalization'));
  end if;

  update app.attendance_finalization set status = 'SUPERSEDED', superseded_at = now(), reopened_at = now(),
    reopened_by_staff_id = v_staff_id, reopen_reason = v_reason
  where attendance_finalization_id = v_finalization.attendance_finalization_id;

  perform private.audit('ATTENDANCE_FINALIZATION_REOPENED', 'edition', p_edition_id, p_edition_id,
    jsonb_build_object('attendance_finalization_id', v_finalization.attendance_finalization_id,
      'revision', v_finalization.revision), null, v_reason);
  perform private.enqueue_outbox('AttendanceFinalizationReopened', 'Edition', p_edition_id,
    'AttendanceFinalizationReopened:' || v_finalization.attendance_finalization_id,
    jsonb_build_object('edition_id', p_edition_id));

  v_result := jsonb_build_object('edition_id', p_edition_id, 'reopened', true);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public wrappers + grants.
-- ---------------------------------------------------------------------------------------------
create or replace function public.resolve_attendance(p_registration_id uuid, p_status text, p_reason text default null,
  p_evidence_metadata jsonb default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.resolve_attendance(p_registration_id, p_status, p_reason, p_evidence_metadata, p_idempotency_key) $$;

create or replace function public.resolve_sporting_eligibility(p_registration_id uuid, p_status text, p_disposition text,
  p_reason_code text default null, p_reason text default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.resolve_sporting_eligibility(p_registration_id, p_status, p_disposition, p_reason_code, p_reason, p_idempotency_key) $$;

create or replace function public.finalize_attendance(p_edition_id uuid, p_mark_remaining_no_show boolean default false,
  p_reason text default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.finalize_attendance(p_edition_id, p_mark_remaining_no_show, p_reason, p_idempotency_key) $$;

create or replace function public.reopen_attendance_finalization(p_edition_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.reopen_attendance_finalization(p_edition_id, p_reason, p_idempotency_key) $$;

revoke all on function
  private.resolve_attendance(uuid, text, text, jsonb, text), public.resolve_attendance(uuid, text, text, jsonb, text),
  private.resolve_sporting_eligibility(uuid, text, text, text, text, text),
  public.resolve_sporting_eligibility(uuid, text, text, text, text, text),
  private.finalize_attendance(uuid, boolean, text, text), public.finalize_attendance(uuid, boolean, text, text),
  private.reopen_attendance_finalization(uuid, text, text), public.reopen_attendance_finalization(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.resolve_attendance(uuid, text, text, jsonb, text), public.resolve_attendance(uuid, text, text, jsonb, text),
  private.resolve_sporting_eligibility(uuid, text, text, text, text, text),
  public.resolve_sporting_eligibility(uuid, text, text, text, text, text),
  private.finalize_attendance(uuid, boolean, text, text), public.finalize_attendance(uuid, boolean, text, text),
  private.reopen_attendance_finalization(uuid, text, text), public.reopen_attendance_finalization(uuid, text, text)
to authenticated;
