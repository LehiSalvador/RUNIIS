-- T41 closure kernel (Master §90-101, §154): value sets this domain depends on, universe
-- initialization, projections and the readiness calculators shared by the attendance workspace GET
-- and the finalize/close commands. Signatures here are called by 711/712/713 in this task only.

-- ---------------------------------------------------------------------------------------------
-- Value sets for free-text columns this domain depends on (additive; T41 is the first to read them).
-- ---------------------------------------------------------------------------------------------

alter table app.community_integrity_case drop constraint if exists community_integrity_case_status;
alter table app.community_integrity_case
  add constraint community_integrity_case_status check (status in ('OPEN', 'RESOLVED', 'DISMISSED'));
alter table app.community_integrity_case drop constraint if exists community_integrity_case_severity;
alter table app.community_integrity_case
  add constraint community_integrity_case_severity check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
alter table app.community_integrity_case drop constraint if exists community_integrity_case_blocking_level;
alter table app.community_integrity_case add constraint community_integrity_case_blocking_level
  check (blocking_level in ('NONE', 'BLOCKS_CLOSURE', 'BLOCKS_RANKING'));

-- ---------------------------------------------------------------------------------------------
-- Universe initialization (Master §93): every CONFIRMED registration gets exactly one starting
-- AttendanceResolution (PRESENT preclassified from an active check-in, else PENDING) and one starting
-- SportingEligibilityResolution (ELIGIBLE/ALLOW: only DQ cases need an explicit non-default disposition,
-- Master §92 "toda DQ debe tener disposition explicita", not every participant). Idempotent: only
-- registrations with zero resolution rows are touched; the partial unique "current" indexes make a
-- concurrent double-init a no-op via ON CONFLICT instead of a race error.
-- ---------------------------------------------------------------------------------------------
create or replace function private.attendance_sync_universe(p_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.attendance_resolution (edition_id, registration_id, revision, status, source, checkin_id, resolved_at)
  select r.edition_id, r.registration_id, 1,
    case when ac.attendance_checkin_id is not null then 'PRESENT' else 'PENDING' end,
    case when ac.attendance_checkin_id is not null then 'CHECKIN' else 'INITIAL' end,
    ac.attendance_checkin_id, now()
  from app.registration r
  left join app.attendance_checkin ac
    on ac.registration_id = r.registration_id and ac.status = 'VERIFIED_PRESENT'
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
    and not exists (select 1 from app.attendance_resolution x where x.registration_id = r.registration_id)
  on conflict (registration_id) where superseded_at is null do nothing;

  insert into app.sporting_eligibility_resolution (registration_id, revision, status, distance_credit_disposition, resolved_at)
  select r.registration_id, 1, 'ELIGIBLE', 'ALLOW', now()
  from app.registration r
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
    and not exists (select 1 from app.sporting_eligibility_resolution x where x.registration_id = r.registration_id)
  on conflict (registration_id) where superseded_at is null do nothing;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Projections.
-- ---------------------------------------------------------------------------------------------
create or replace function private.attendance_resolution_projection(p_registration_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('attendance_resolution_id', ar.attendance_resolution_id, 'registration_id', ar.registration_id,
    'revision', ar.revision, 'status', ar.status, 'source', ar.source, 'checkin_id', ar.checkin_id,
    'reason', ar.reason, 'evidence_metadata', ar.evidence_metadata, 'resolved_by_staff_id', ar.resolved_by_staff_id,
    'resolved_at', ar.resolved_at)
  from app.attendance_resolution ar
  where ar.registration_id = p_registration_id and ar.superseded_at is null
$$;

create or replace function private.sporting_eligibility_projection(p_registration_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('sporting_eligibility_resolution_id', s.sporting_eligibility_resolution_id,
    'registration_id', s.registration_id, 'revision', s.revision, 'status', s.status,
    'distance_credit_disposition', s.distance_credit_disposition, 'reason_code', s.reason_code, 'reason', s.reason,
    'resolved_by_staff_id', s.resolved_by_staff_id, 'resolved_at', s.resolved_at)
  from app.sporting_eligibility_resolution s
  where s.registration_id = p_registration_id and s.superseded_at is null
$$;

create or replace function private.attendance_finalization_projection(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('attendance_finalization_id', f.attendance_finalization_id, 'edition_id', f.edition_id,
    'revision', f.revision, 'status', f.status, 'expected_count', f.expected_count, 'present_count', f.present_count,
    'no_show_count', f.no_show_count, 'excluded_count', f.excluded_count,
    'finalized_by_staff_id', f.finalized_by_staff_id, 'finalized_at', f.finalized_at)
  from app.attendance_finalization f
  where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED'
$$;

create or replace function private.administrative_closure_projection(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('administrative_closure_id', c.administrative_closure_id, 'edition_id', c.edition_id,
    'revision', c.revision, 'attendance_finalization_id', c.attendance_finalization_id, 'status', c.status,
    'closed_by_staff_id', c.closed_by_staff_id, 'closed_at', c.closed_at)
  from app.administrative_closure c
  where c.edition_id = p_edition_id and c.superseded_at is null and c.status = 'CLOSED'
$$;

-- ---------------------------------------------------------------------------------------------
-- Readiness (Master §94, §96). Both recompute from live rows every call -- the Task Center is never
-- the source of truth (Master §96 "Task Center no es autoridad").
-- ---------------------------------------------------------------------------------------------
create or replace function private.finalization_readiness(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_universe integer;
  v_pending_attendance integer;
  v_pending_eligibility integer;
  v_already_finalized boolean;
  v_checks jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_ok boolean;
begin
  select count(*) into v_universe from app.registration r where r.edition_id = p_edition_id and r.status = 'CONFIRMED';

  v_already_finalized := exists (
    select 1 from app.attendance_finalization f where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED');
  v_ok := not v_already_finalized;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'NOT_ALREADY_FINALIZED', 'ok', v_ok));
  v_ready := v_ready and v_ok;

  select count(*) into v_pending_attendance
  from app.registration r
  join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and ar.status = 'PENDING';
  v_ok := v_pending_attendance = 0;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'NO_PENDING_ATTENDANCE', 'ok', v_ok,
    'detail', jsonb_build_object('pending_count', v_pending_attendance)));
  v_ready := v_ready and v_ok;

  select count(*) into v_pending_eligibility
  from app.registration r
  join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and s.distance_credit_disposition = 'PENDING';
  v_ok := v_pending_eligibility = 0;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'NO_PENDING_ELIGIBILITY', 'ok', v_ok,
    'detail', jsonb_build_object('pending_count', v_pending_eligibility)));
  v_ready := v_ready and v_ok;

  return jsonb_build_object('ready', v_ready, 'checks', v_checks, 'expected_count', v_universe);
end;
$$;

create or replace function private.closure_readiness(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_edition app.edition%rowtype;
  v_finalization app.attendance_finalization%rowtype;
  v_universe integer;
  v_pending_attendance integer;
  v_pending_eligibility integer;
  v_guardian_pending integer;
  v_open_cases integer;
  v_already_closed boolean;
  v_checks jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_ok boolean;
begin
  select * into v_edition from app.edition e where e.edition_id = p_edition_id;

  v_ok := v_edition.execution_state = 'FINISHED';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'EXECUTION_FINISHED', 'ok', v_ok));
  v_ready := v_ready and v_ok;

  v_already_closed := exists (
    select 1 from app.administrative_closure c where c.edition_id = p_edition_id and c.superseded_at is null and c.status = 'CLOSED');
  v_ok := not v_already_closed;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'NOT_ALREADY_CLOSED', 'ok', v_ok));
  v_ready := v_ready and v_ok;

  select * into v_finalization from app.attendance_finalization f
  where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED';
  v_ok := found;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'FINALIZATION_CURRENT', 'ok', v_ok));
  v_ready := v_ready and v_ok;

  select count(*) into v_universe from app.registration r where r.edition_id = p_edition_id and r.status = 'CONFIRMED';
  v_ok := v_ok and v_universe = v_finalization.expected_count;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'UNIVERSE_STABLE', 'ok', coalesce(v_ok, false),
    'detail', jsonb_build_object('universe_count', v_universe, 'finalized_count', v_finalization.expected_count)));
  v_ready := v_ready and coalesce(v_ok, false);

  select count(*) into v_pending_attendance
  from app.registration r
  join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and ar.status = 'PENDING';
  v_ok := v_pending_attendance = 0;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'NO_PENDING_ATTENDANCE', 'ok', v_ok));
  v_ready := v_ready and v_ok;

  select count(*) into v_pending_eligibility
  from app.registration r
  join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and s.distance_credit_disposition = 'PENDING';
  v_ok := v_pending_eligibility = 0;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'NO_PENDING_ELIGIBILITY', 'ok', v_ok));
  v_ready := v_ready and v_ok;

  select count(*) into v_guardian_pending
  from app.guardian_event_verification gev
  join app.registration r on r.registration_id = gev.registration_id
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and gev.status = 'PENDING';
  v_ok := v_guardian_pending = 0;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'GUARDIAN_RESOLVED', 'ok', v_ok,
    'detail', jsonb_build_object('pending_count', v_guardian_pending)));
  v_ready := v_ready and v_ok;

  select count(*) into v_open_cases
  from app.community_integrity_case c
  where c.edition_id = p_edition_id and c.status = 'OPEN' and c.blocking_level = 'BLOCKS_CLOSURE';
  v_ok := v_open_cases = 0;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'NO_OPEN_INTEGRITY_CASE', 'ok', v_ok,
    'detail', jsonb_build_object('open_count', v_open_cases)));
  v_ready := v_ready and v_ok;

  return jsonb_build_object('ready', v_ready, 'checks', v_checks);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- GET /api/v1/admin/editions/:editionId/attendance (Master §175). Self-healing: syncs the universe
-- before projecting so a freshly FINISHED Edition shows every registration, not just resolved ones.
-- ---------------------------------------------------------------------------------------------
create or replace function private.attendance_workspace(p_edition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_permission('ATTENDANCE_MANAGE', p_edition_id);
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.attendance_sync_universe(p_edition_id);

  select jsonb_build_object(
    'edition_id', p_edition_id,
    'universe_count', (select count(*) from app.registration r where r.edition_id = p_edition_id and r.status = 'CONFIRMED'),
    'attendance_counts', (
      select jsonb_object_agg(status, cnt) from (
        select coalesce(ar.status, 'PENDING') as status, count(*) as cnt
        from app.registration r
        join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
        where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        group by 1) s),
    'eligibility_counts', (
      select jsonb_object_agg(status, cnt) from (
        select s.status, count(*) as cnt
        from app.registration r
        join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
        where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        group by 1) s),
    'disposition_pending_count', (
      select count(*) from app.registration r
      join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
      where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and s.distance_credit_disposition = 'PENDING'),
    'current_finalization', private.attendance_finalization_projection(p_edition_id),
    'current_closure', private.administrative_closure_projection(p_edition_id),
    'finalize_readiness', private.finalization_readiness(p_edition_id),
    'close_readiness', private.closure_readiness(p_edition_id),
    'participants', (
      select coalesce(jsonb_agg(item.row order by item.sort_name), '[]'::jsonb) from (
        select
          coalesce(rp.full_name, g.full_name, '') as sort_name,
          jsonb_build_object(
            'registration_id', r.registration_id, 'registration_number', r.registration_number,
            'participant_kind', case when r.runner_profile_id is not null then 'PROFILE' else 'GUEST' end,
            'display_name', coalesce(rp.full_name, g.full_name),
            'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
            'attendance', jsonb_build_object('status', ar.status, 'source', ar.source, 'reason', ar.reason,
              'resolved_at', ar.resolved_at),
            'eligibility', jsonb_build_object('status', s.status, 'distance_credit_disposition', s.distance_credit_disposition,
              'reason_code', s.reason_code, 'resolved_at', s.resolved_at),
            'guardian_status', gev.status,
            'has_active_credit', exists (select 1 from app.distance_credit dc
              where dc.registration_id = r.registration_id and dc.status = 'ACTIVE')) as row
        from app.registration r
        join app.modality m on m.modality_id = r.modality_id
        left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
        left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
        left join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
        left join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
        left join app.guardian_event_verification gev on gev.registration_id = r.registration_id
        where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        order by 1
        limit 2000) item)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.attendance_workspace(p_edition_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.attendance_workspace(p_edition_id) $$;

revoke all on function private.attendance_workspace(uuid), public.attendance_workspace(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.attendance_workspace(uuid), public.attendance_workspace(uuid) to authenticated;
