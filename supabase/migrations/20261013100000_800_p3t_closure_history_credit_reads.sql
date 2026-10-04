-- P3-T: read-only staff APIs for the closure history and the DistanceCredit ledger (Master §94-100, §145, §175).
--
--   1. private.edition_credited_distance_summary: one internal aggregate (ACTIVE credited distance, total and per modality) shared by the
--      attendance workspace and the credit ledger read. Never granted: only the security definer reads below call it.
--   2. private.attendance_workspace: the body of migration 781 plus the additive `credited_distance` key (total and per modality).
--   3. private.admin_list_attendance_finalizations / admin_list_administrative_closures: every revision of the Edition (revision number,
--      status, timestamps, actor labels, reopen reason, counts, superseded_at), newest first, keyset-paginated by revision.
--   4. private.admin_list_distance_credits: the credit ledger (registration, participant label, modality, official and credited distance,
--      sport_date, status, reversal, supersedes link both ways), ordered by closure revision desc then registration number, keyset-paginated.
--
-- RBAC: ATTENDANCE_MANAGE on the Edition (ADMIN, OPERATOR; Edition scope enforced by the permission helper, SEC-020). Master §145 gives
-- attendance to both roles and the closure/credit data is already part of the attendance workspace they read (current closure, has_active_credit);
-- only the closure/reopen COMMANDS are ADMIN-global. The reads are STABLE and write nothing, so they never take the Edition lock.
-- Staff names go through private.staff_display_label (P3-O/P3-P); the participant label is the registration number and the profile's
-- display name (the same data the workspace shows), never contact fields.

-- ---------------------------------------------------------------------------------------------
-- 1. Credited distance aggregate (ACTIVE credits only; REVERSED credits never count).
-- ---------------------------------------------------------------------------------------------
create function private.edition_credited_distance_summary(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total_m', coalesce((select sum(dc.credited_distance_m) from app.distance_credit dc
                         where dc.edition_id = p_edition_id and dc.status = 'ACTIVE'), 0),
    'active_credit_count', (select count(*) from app.distance_credit dc where dc.edition_id = p_edition_id and dc.status = 'ACTIVE'),
    'reversed_credit_count', (select count(*) from app.distance_credit dc where dc.edition_id = p_edition_id and dc.status = 'REVERSED'),
    'by_modality', coalesce((
      select jsonb_agg(jsonb_build_object(
        'modality_id', m.modality_id, 'name', m.name, 'official_distance_m', m.official_distance_m,
        'generates_distance_credit', m.generates_distance_credit,
        'active_credit_count', c.active_count, 'reversed_credit_count', c.reversed_count,
        'credited_distance_m', c.active_distance) order by m.sort_order, m.name, m.modality_id)
      from app.modality m
      cross join lateral (
        select count(*) filter (where dc.status = 'ACTIVE') as active_count,
          count(*) filter (where dc.status = 'REVERSED') as reversed_count,
          coalesce(sum(dc.credited_distance_m) filter (where dc.status = 'ACTIVE'), 0) as active_distance
        from app.distance_credit dc where dc.modality_id = m.modality_id and dc.edition_id = p_edition_id) c
      where m.edition_id = p_edition_id and (m.generates_distance_credit or c.active_count + c.reversed_count > 0)
    ), '[]'::jsonb))
$$;

revoke all on function private.edition_credited_distance_summary(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Attendance workspace: the body of migration 781 plus `credited_distance` (additive).
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
  -- P3SECA-04: the Edition FOR UPDATE lock (inside attendance_sync_universe) is taken ONLY when there are universe rows to reconcile.
  if private.attendance_universe_needs_sync(p_edition_id) then
    perform private.attendance_sync_universe(p_edition_id);
  end if;

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
    'credited_distance', private.edition_credited_distance_summary(p_edition_id),
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

-- ---------------------------------------------------------------------------------------------
-- 3. Finalization and closure revision history.
-- ---------------------------------------------------------------------------------------------
create function private.admin_list_attendance_finalizations(
  p_edition_id uuid, p_cursor_revision integer default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows jsonb;
  v_total integer;
begin
  perform private.require_permission('ATTENDANCE_MANAGE', p_edition_id);
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if p_cursor_revision is not null and p_cursor_revision < 1 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'cursor'));
  end if;

  select count(*)::integer into v_total from app.attendance_finalization f where f.edition_id = p_edition_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'attendance_finalization_id', s.attendance_finalization_id, 'edition_id', s.edition_id, 'revision', s.revision,
      'status', s.status, 'is_current', s.superseded_at is null,
      'expected_count', s.expected_count, 'present_count', s.present_count, 'no_show_count', s.no_show_count,
      'excluded_count', s.excluded_count,
      'finalized_by_staff_id', s.finalized_by_staff_id,
      'finalized_by_staff_label', private.staff_display_label(s.finalized_by_staff_id),
      'finalized_at', s.finalized_at,
      'reopened_at', s.reopened_at, 'reopened_by_staff_id', s.reopened_by_staff_id,
      'reopened_by_staff_label', private.staff_display_label(s.reopened_by_staff_id),
      'reopen_reason', s.reopen_reason, 'superseded_at', s.superseded_at) order by s.revision desc), '[]'::jsonb)
  into v_rows
  from (
    select f.* from app.attendance_finalization f
    where f.edition_id = p_edition_id and (p_cursor_revision is null or f.revision < p_cursor_revision)
    order by f.revision desc
    limit v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_rows) with ordinality t(x, o) where o <= v_limit), '[]'::jsonb),
    'total', v_total,
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then jsonb_build_object(
      'revision', v_rows -> (v_limit - 1) -> 'revision') end);
end;
$$;

create function private.admin_list_administrative_closures(
  p_edition_id uuid, p_cursor_revision integer default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows jsonb;
  v_total integer;
begin
  perform private.require_permission('ATTENDANCE_MANAGE', p_edition_id);
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if p_cursor_revision is not null and p_cursor_revision < 1 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'cursor'));
  end if;

  select count(*)::integer into v_total from app.administrative_closure c where c.edition_id = p_edition_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'administrative_closure_id', s.administrative_closure_id, 'edition_id', s.edition_id, 'revision', s.revision,
      'status', s.status, 'is_current', s.superseded_at is null,
      'attendance_finalization_id', s.attendance_finalization_id,
      'attendance_finalization_revision', s.finalization_revision,
      'closed_by_staff_id', s.closed_by_staff_id,
      'closed_by_staff_label', private.staff_display_label(s.closed_by_staff_id),
      'closed_at', s.closed_at,
      'reopened_at', s.reopened_at, 'reopened_by_staff_id', s.reopened_by_staff_id,
      'reopened_by_staff_label', private.staff_display_label(s.reopened_by_staff_id),
      'reopen_reason', s.reopen_reason, 'superseded_at', s.superseded_at,
      'credit_count', s.credit_count, 'active_credit_count', s.active_credit_count,
      'reversed_credit_count', s.reversed_credit_count,
      'active_credited_distance_m', s.active_distance) order by s.revision desc), '[]'::jsonb)
  into v_rows
  from (
    select c.*, f.revision as finalization_revision,
      cc.credit_count, cc.active_credit_count, cc.reversed_credit_count, cc.active_distance
    from app.administrative_closure c
    join app.attendance_finalization f on f.attendance_finalization_id = c.attendance_finalization_id
    cross join lateral (
      select count(*) as credit_count,
        count(*) filter (where dc.status = 'ACTIVE') as active_credit_count,
        count(*) filter (where dc.status = 'REVERSED') as reversed_credit_count,
        coalesce(sum(dc.credited_distance_m) filter (where dc.status = 'ACTIVE'), 0) as active_distance
      from app.distance_credit dc where dc.administrative_closure_id = c.administrative_closure_id) cc
    where c.edition_id = p_edition_id and (p_cursor_revision is null or c.revision < p_cursor_revision)
    order by c.revision desc
    limit v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_rows) with ordinality t(x, o) where o <= v_limit), '[]'::jsonb),
    'total', v_total,
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then jsonb_build_object(
      'revision', v_rows -> (v_limit - 1) -> 'revision') end);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. DistanceCredit ledger of the Edition.
-- ---------------------------------------------------------------------------------------------
-- Order: closure revision desc, registration number asc, credit id asc (a registration holds at most one credit per closure). The keyset cursor
-- carries the three values. `summary` is the Edition-wide ACTIVE aggregate, independent of the filters; `total` counts the filtered rows.
create function private.admin_list_distance_credits(
  p_edition_id uuid,
  p_status text default null,
  p_modality_id uuid default null,
  p_registration_id uuid default null,
  p_cursor_revision integer default null,
  p_cursor_registration_number text default null,
  p_cursor_id uuid default null,
  p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
  v_total integer;
begin
  perform private.require_permission('ATTENDANCE_MANAGE', p_edition_id);
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'REVERSED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'status'));
  end if;
  if (p_cursor_revision is null) <> (p_cursor_registration_number is null) or (p_cursor_revision is null) <> (p_cursor_id is null)
     or p_cursor_revision < 1 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'cursor'));
  end if;

  select count(*)::integer into v_total
  from app.distance_credit dc
  where dc.edition_id = p_edition_id
    and (p_status is null or dc.status = p_status)
    and (p_modality_id is null or dc.modality_id = p_modality_id)
    and (p_registration_id is null or dc.registration_id = p_registration_id);

  select coalesce(jsonb_agg(s.item order by s.closure_revision desc, s.registration_number, s.distance_credit_id), '[]'::jsonb)
  into v_rows
  from (
    select c.revision as closure_revision, r.registration_number, dc.distance_credit_id,
      jsonb_build_object(
        'distance_credit_id', dc.distance_credit_id, 'edition_id', dc.edition_id,
        'registration_id', dc.registration_id, 'registration_number', r.registration_number,
        'participant_kind', 'PROFILE', 'participant_label', rp.full_name,
        'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
        'official_distance_snapshot_m', dc.official_distance_snapshot_m, 'credited_distance_m', dc.credited_distance_m,
        'sport_date', dc.sport_date, 'sport_timezone', dc.sport_timezone,
        'status', dc.status, 'source', dc.source, 'created_at', dc.created_at,
        'administrative_closure_id', dc.administrative_closure_id, 'closure_revision', c.revision,
        'reversed_at', dc.reversed_at, 'reversed_by_staff_id', dc.reversed_by_staff_id,
        'reversed_by_staff_label', private.staff_display_label(dc.reversed_by_staff_id),
        'reversal_reason', dc.reversal_reason,
        'supersedes_distance_credit_id', dc.supersedes_distance_credit_id,
        'superseded_by_distance_credit_id', (select n.distance_credit_id from app.distance_credit n
                                             where n.supersedes_distance_credit_id = dc.distance_credit_id)) as item
    from app.distance_credit dc
    join app.registration r on r.registration_id = dc.registration_id
    join app.runner_profile rp on rp.runner_profile_id = dc.runner_profile_id
    join app.modality m on m.modality_id = dc.modality_id
    join app.administrative_closure c on c.administrative_closure_id = dc.administrative_closure_id
    where dc.edition_id = p_edition_id
      and (p_status is null or dc.status = p_status)
      and (p_modality_id is null or dc.modality_id = p_modality_id)
      and (p_registration_id is null or dc.registration_id = p_registration_id)
      and (p_cursor_revision is null
           or c.revision < p_cursor_revision
           or (c.revision = p_cursor_revision and (r.registration_number > p_cursor_registration_number
               or (r.registration_number = p_cursor_registration_number and dc.distance_credit_id > p_cursor_id))))
    order by c.revision desc, r.registration_number, dc.distance_credit_id
    limit v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_rows) with ordinality t(x, o) where o <= v_limit), '[]'::jsonb),
    'total', v_total,
    'summary', private.edition_credited_distance_summary(p_edition_id),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then jsonb_build_object(
      'revision', v_rows -> (v_limit - 1) -> 'closure_revision',
      'registration_number', v_rows -> (v_limit - 1) -> 'registration_number',
      'id', v_rows -> (v_limit - 1) -> 'distance_credit_id') end);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public wrappers and grants: closed by default, authenticated only. The summary helper stays internal.
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_attendance_finalizations(
  p_edition_id uuid, p_cursor_revision integer default null, p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_list_attendance_finalizations(p_edition_id, p_cursor_revision, p_limit) $$;

create function public.admin_list_administrative_closures(
  p_edition_id uuid, p_cursor_revision integer default null, p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_list_administrative_closures(p_edition_id, p_cursor_revision, p_limit) $$;

create function public.admin_list_distance_credits(
  p_edition_id uuid, p_status text default null, p_modality_id uuid default null, p_registration_id uuid default null,
  p_cursor_revision integer default null, p_cursor_registration_number text default null, p_cursor_id uuid default null,
  p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_list_distance_credits(p_edition_id, p_status, p_modality_id, p_registration_id,
  p_cursor_revision, p_cursor_registration_number, p_cursor_id, p_limit) $$;

revoke all on function
  private.admin_list_attendance_finalizations(uuid, integer, integer), public.admin_list_attendance_finalizations(uuid, integer, integer),
  private.admin_list_administrative_closures(uuid, integer, integer), public.admin_list_administrative_closures(uuid, integer, integer),
  private.admin_list_distance_credits(uuid, text, uuid, uuid, integer, text, uuid, integer),
  public.admin_list_distance_credits(uuid, text, uuid, uuid, integer, text, uuid, integer)
from public, anon, authenticated, service_role;

grant execute on function
  private.admin_list_attendance_finalizations(uuid, integer, integer), public.admin_list_attendance_finalizations(uuid, integer, integer),
  private.admin_list_administrative_closures(uuid, integer, integer), public.admin_list_administrative_closures(uuid, integer, integer),
  private.admin_list_distance_credits(uuid, text, uuid, uuid, integer, text, uuid, integer),
  public.admin_list_distance_credits(uuid, text, uuid, uuid, integer, text, uuid, integer)
to authenticated;
