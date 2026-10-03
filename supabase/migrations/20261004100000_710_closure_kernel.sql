-- P3-A closure kernel (Master §90-101, §154), recovered from the T41 WIP and reconciled with the schema as of
-- 20261003130000_164: value sets this domain depends on, universe initialization and reconciliation,
-- projections and the readiness calculators shared by the attendance workspace GET and the
-- finalize/close commands. Signatures here are called by 711/712/713 only.
--
-- Differences from the T41 WIP (see .salvaops-agent-evidence/P3-A-t41-db-recovery/reconciliation.md):
--  * the universe sync also reconciles AUTOMATIC rows with check-in evidence (a scan after the first sync used to
--    leave a stale PENDING; a reversed scan used to leave a stale PRESENT) and never touches MANUAL/CORRECTION rows
--    or a finalized Edition;
--  * the guardian blocker only applies to participants resolved PRESENT (a minor who never came cannot be
--    verified in person, so a PENDING verification of a NO_SHOW must not block closure forever);
--  * the readiness exposes the credit-basis checks (official distance and sport date known) before the command runs.

-- ---------------------------------------------------------------------------------------------
-- Value sets for free-text columns this domain depends on (additive; the closure is the first reader).
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

-- A reversed credit is replaced by at most one successor (reopen -> correction -> close again): the
-- supersedes chain stays linear and can be walked without ambiguity.
create unique index distance_credit_supersedes_uidx on app.distance_credit (supersedes_distance_credit_id)
  where supersedes_distance_credit_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Universe initialization (Master §93): every CONFIRMED registration gets exactly one starting
-- AttendanceResolution (PRESENT preclassified from an active check-in, else PENDING) and one starting
-- SportingEligibilityResolution (ELIGIBLE/ALLOW: only DQ cases need an explicit non-default disposition,
-- Master §92). Idempotent and serialized by the Edition lock, which every closure command already takes
-- first (canonical lock order); the partial unique "current" indexes stay as the last line of defence.
--
-- Reconciliation (Master §90 "check-in es evidencia"): automatic rows follow the evidence until staff or
-- finalization takes over. PENDING/INITIAL + active check-in becomes PRESENT/CHECKIN; PRESENT/CHECKIN whose
-- check-in was reversed (and no other active one) goes back to PENDING/INITIAL -- never to NO_SHOW (no scan
-- is not NO_SHOW). MANUAL and CORRECTION rows are explicit decisions and are never touched, and nothing
-- moves once the attendance is finalized.
-- ---------------------------------------------------------------------------------------------
create or replace function private.attendance_sync_universe(p_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  if not found then return; end if;

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

  if exists (select 1 from app.attendance_finalization f
             where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED') then
    return;
  end if;

  -- Evidence arrived after the starting row: PENDING/INITIAL -> PRESENT/CHECKIN.
  with promote as (
    select ar.attendance_resolution_id, ar.registration_id, ar.revision, ac.attendance_checkin_id
    from app.attendance_resolution ar
    join app.registration r on r.registration_id = ar.registration_id
    join app.attendance_checkin ac on ac.registration_id = ar.registration_id and ac.status = 'VERIFIED_PRESENT'
    where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and ar.superseded_at is null
      and ar.status = 'PENDING' and ar.source = 'INITIAL'
  ), closed as (
    update app.attendance_resolution set superseded_at = now()
    where attendance_resolution_id in (select attendance_resolution_id from promote)
    returning attendance_resolution_id
  )
  insert into app.attendance_resolution (edition_id, registration_id, revision, status, source, checkin_id, resolved_at)
  select p_edition_id, p.registration_id, p.revision + 1, 'PRESENT', 'CHECKIN', p.attendance_checkin_id, now()
  from promote p
  join closed c on c.attendance_resolution_id = p.attendance_resolution_id;

  -- Evidence withdrawn: PRESENT/CHECKIN with no remaining active check-in -> PENDING/INITIAL.
  with demote as (
    select ar.attendance_resolution_id, ar.registration_id, ar.revision
    from app.attendance_resolution ar
    join app.registration r on r.registration_id = ar.registration_id
    where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and ar.superseded_at is null
      and ar.status = 'PRESENT' and ar.source = 'CHECKIN'
      and not exists (select 1 from app.attendance_checkin ac
                      where ac.registration_id = ar.registration_id and ac.status = 'VERIFIED_PRESENT')
  ), closed as (
    update app.attendance_resolution set superseded_at = now()
    where attendance_resolution_id in (select attendance_resolution_id from demote)
    returning attendance_resolution_id
  )
  insert into app.attendance_resolution (edition_id, registration_id, revision, status, source, resolved_at)
  select p_edition_id, d.registration_id, d.revision + 1, 'PENDING', 'INITIAL', now()
  from demote d
  join closed c on c.attendance_resolution_id = d.attendance_resolution_id;
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
  v_edition app.edition%rowtype;
  v_universe integer;
  v_pending_attendance integer;
  v_pending_eligibility integer;
  v_already_finalized boolean;
  v_checks jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_ok boolean;
begin
  select * into v_edition from app.edition e where e.edition_id = p_edition_id;
  select count(*) into v_universe from app.registration r where r.edition_id = p_edition_id and r.status = 'CONFIRMED';

  v_ok := coalesce(v_edition.execution_state = 'FINISHED', false);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'EXECUTION_FINISHED', 'ok', v_ok));
  v_ready := v_ready and v_ok;

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
  v_has_finalization boolean;
  v_universe integer;
  v_present integer;
  v_no_show integer;
  v_excluded integer;
  v_pending_attendance integer;
  v_pending_eligibility integer;
  v_guardian_pending integer;
  v_open_cases integer;
  v_missing_distance integer;
  v_missing_date integer;
  v_already_closed boolean;
  v_checks jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_ok boolean;
begin
  select * into v_edition from app.edition e where e.edition_id = p_edition_id;

  v_ok := coalesce(v_edition.execution_state = 'FINISHED', false);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'EXECUTION_FINISHED', 'ok', v_ok));
  v_ready := v_ready and v_ok;

  v_already_closed := exists (
    select 1 from app.administrative_closure c where c.edition_id = p_edition_id and c.superseded_at is null and c.status = 'CLOSED');
  v_ok := not v_already_closed;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'NOT_ALREADY_CLOSED', 'ok', v_ok));
  v_ready := v_ready and v_ok;

  select * into v_finalization from app.attendance_finalization f
  where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED';
  v_has_finalization := found;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'FINALIZATION_CURRENT', 'ok', v_has_finalization));
  v_ready := v_ready and v_has_finalization;

  -- The universe is reconstructible from live rows and must still match what was finalized (Master §93-94).
  select count(*) into v_universe from app.registration r where r.edition_id = p_edition_id and r.status = 'CONFIRMED';
  select count(*) filter (where ar.status = 'PRESENT'), count(*) filter (where ar.status = 'NO_SHOW'),
         count(*) filter (where ar.status = 'EXCLUDED'), count(*) filter (where ar.status = 'PENDING')
    into v_present, v_no_show, v_excluded, v_pending_attendance
  from app.registration r
  join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED';
  v_ok := v_has_finalization and v_universe = v_finalization.expected_count
    and v_present = v_finalization.present_count and v_no_show = v_finalization.no_show_count
    and v_excluded = v_finalization.excluded_count;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'UNIVERSE_STABLE', 'ok', coalesce(v_ok, false),
    'detail', jsonb_build_object('universe_count', v_universe, 'finalized_count', v_finalization.expected_count)));
  v_ready := v_ready and coalesce(v_ok, false);

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

  -- Guardian blockers (Master §96): only a participant counted PRESENT needs the in-person verification;
  -- a NO_SHOW/EXCLUDED minor can never be verified and must not hold the Edition open.
  select count(*) into v_guardian_pending
  from app.guardian_event_verification gev
  join app.registration r on r.registration_id = gev.registration_id
  join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and gev.status = 'PENDING' and ar.status = 'PRESENT';
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

  -- Credit basis (Master §99-100): every credit-bearing registration needs an official distance and a
  -- known sport date, otherwise CloseEdition would fail half way through.
  select count(*) into v_missing_distance
  from app.registration r
  join app.modality m on m.modality_id = r.modality_id
  join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and r.runner_profile_id is not null
    and ar.status = 'PRESENT' and s.distance_credit_disposition = 'ALLOW' and m.generates_distance_credit
    and (m.official_distance_m is null or m.official_distance_m <= 0);
  v_ok := v_missing_distance = 0;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'OFFICIAL_DISTANCE_KNOWN', 'ok', v_ok,
    'detail', jsonb_build_object('registration_count', v_missing_distance)));
  v_ready := v_ready and v_ok;

  select count(*) into v_missing_date
  from app.registration r
  join app.modality m on m.modality_id = r.modality_id
  join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
  where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and r.runner_profile_id is not null
    and ar.status = 'PRESENT' and s.distance_credit_disposition = 'ALLOW' and m.generates_distance_credit
    and (private.effective_start(p_edition_id, r.modality_id) ->> 'sport_date') is null;
  v_ok := v_missing_date = 0;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code', 'SPORT_DATE_KNOWN', 'ok', v_ok,
    'detail', jsonb_build_object('registration_count', v_missing_date)));
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
    'attendance_counts', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select ar.status as status, count(*) as cnt
        from app.registration r
        join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
        where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        group by 1) s), '{}'::jsonb),
    'eligibility_counts', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select s.status, count(*) as cnt
        from app.registration r
        join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
        where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
        group by 1) s), '{}'::jsonb),
    'disposition_pending_count', (
      select count(*) from app.registration r
      join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
      where r.edition_id = p_edition_id and r.status = 'CONFIRMED' and s.distance_credit_disposition = 'PENDING'),
    'current_finalization', private.attendance_finalization_projection(p_edition_id),
    'current_closure', private.administrative_closure_projection(p_edition_id),
    'finalize_readiness', private.finalization_readiness(p_edition_id),
    'close_readiness', private.closure_readiness(p_edition_id),
    'participants', (
      select coalesce(jsonb_agg(item.row order by item.sort_name, item.registration_number), '[]'::jsonb) from (
        select
          coalesce(rp.full_name, g.full_name, '') as sort_name,
          r.registration_number,
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
        order by 1, 2
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

-- Helpers are only reached through the security definer commands above and below; no role calls them directly.
revoke all on function
  private.attendance_sync_universe(uuid), private.attendance_resolution_projection(uuid),
  private.sporting_eligibility_projection(uuid), private.attendance_finalization_projection(uuid),
  private.administrative_closure_projection(uuid), private.finalization_readiness(uuid), private.closure_readiness(uuid)
from public, anon, authenticated, service_role;

revoke all on function private.attendance_workspace(uuid), public.attendance_workspace(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.attendance_workspace(uuid), public.attendance_workspace(uuid) to authenticated;
