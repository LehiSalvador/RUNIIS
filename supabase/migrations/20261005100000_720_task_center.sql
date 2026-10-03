-- P3-D Task Center backend (Master §142-143, §145; Roadmap §9.26). A task is a PROJECTION of a source condition and
-- points to its root object; it is never the source of truth (Master §96): every resolve/waive of a CLOSURE_BLOCKER
-- re-evaluates the root, and the sync below recomputes tasks from the sources, never the other way around.
--
-- Contents:
--   * ADMIN_TASK_MANAGE staff action (ADMIN, OPERATOR); ADMIN_TASK_READ already exists for every role.
--   * Task writers (idempotent): attendance-finalization:{edition}, closure-pending:{edition},
--     closure-integrity:{edition}:{case}, provider-reconciliation:{provider}. The communication-critical-failure,
--     outbox-escalated, communication-quota-exhausted and race-day writers already exist and are reused untouched.
--     The hold-concentration alert (OD-P2-01) is evaluated by migration 721 and driven from the same sync.
--   * Staff API: list (filters), get, start, assign, resolve, waive, refresh. Edition scope comes from the task row.
--   * pg_cron job `admin-task-sync` (SQL only, no HTTP worker) so conditions that appear without a command (a
--     finished Edition, a stuck provider status, expiring holds) still become tasks.

-- ---------------------------------------------------------------------------------------------
-- 1. Staff action
-- ---------------------------------------------------------------------------------------------
insert into private.staff_action (action, global_only) values ('ADMIN_TASK_MANAGE', false)
on conflict (action) do nothing;
insert into private.staff_permission (role, action) values ('ADMIN', 'ADMIN_TASK_MANAGE'), ('OPERATOR', 'ADMIN_TASK_MANAGE')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. Visibility and projection
-- ---------------------------------------------------------------------------------------------

-- ADMIN/OPERATOR see every task of their scope; CHECKIN only race-day tasks, MODERATOR only moderation tasks
-- (least privilege over ADMIN_TASK_READ: operational tasks carry request and message context they do not need).
create function private.admin_task_visible(p_category text, p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.staff_role_assignment sra
    join private.staff_permission sp on sp.role = sra.role and sp.action = 'ADMIN_TASK_READ'
    where sra.staff_member_id = private.current_staff_member_id()
      and sra.revoked_at is null
      and (sra.scope_type = 'GLOBAL' or (p_edition_id is not null and sra.edition_id = p_edition_id))
      and (sra.role in ('ADMIN', 'OPERATOR')
           or (sra.role = 'CHECKIN' and p_category = 'RACE_DAY')
           or (sra.role = 'MODERATOR' and p_category = 'MODERATION')))
$$;

create function private.admin_task_projection(p_admin_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'admin_task_id', t.admin_task_id, 'task_key', t.task_key, 'category', t.category, 'scope_type', t.scope_type,
    'scope_id', t.scope_id, 'edition_id', t.edition_id, 'related_entity_type', t.related_entity_type,
    'related_entity_id', t.related_entity_id, 'title', t.title, 'description', t.description, 'priority', t.priority,
    'blocking_level', t.blocking_level, 'status', t.status, 'assigned_role', t.assigned_role,
    'assigned_staff_id', t.assigned_staff_id, 'detected_at', t.detected_at, 'due_at', t.due_at, 'started_at', t.started_at,
    'resolved_at', t.resolved_at, 'resolution_type', t.resolution_type, 'resolution_reason', t.resolution_reason,
    'source_rule', t.source_rule, 'metadata', t.metadata, 'created_at', t.created_at, 'updated_at', t.updated_at)
  from app.admin_task t
  where t.admin_task_id = p_admin_task_id
$$;

create function private.admin_task_rank(p_blocking_level text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_blocking_level when 'CLOSURE_BLOCKER' then 4 when 'EVENT_DAY_BLOCKER' then 3 when 'ACTION_REQUIRED' then 2 else 1 end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Root-condition evaluator. TRUE while the condition that justifies the task still holds.
--    A CLOSURE_BLOCKER whose rule has no evaluator is treated as still holding (fail closed).
-- ---------------------------------------------------------------------------------------------
create function private.admin_task_source_holds(p_admin_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task app.admin_task%rowtype;
  v_edition app.edition%rowtype;
begin
  select * into v_task from app.admin_task t where t.admin_task_id = p_admin_task_id;
  if not found then return false; end if;
  if v_task.edition_id is not null then
    select * into v_edition from app.edition e where e.edition_id = v_task.edition_id;
  end if;

  case v_task.source_rule
    when 'attendance-finalization' then
      return v_edition.execution_state = 'FINISHED' and not exists (
        select 1 from app.attendance_finalization f
        where f.edition_id = v_task.edition_id and f.superseded_at is null and f.status = 'FINALIZED');
    when 'closure-pending' then
      return v_edition.execution_state = 'FINISHED' and not exists (
        select 1 from app.administrative_closure c
        where c.edition_id = v_task.edition_id and c.superseded_at is null and c.status = 'CLOSED');
    when 'closure-integrity' then
      return exists (
        select 1 from app.community_integrity_case c
        where c.community_integrity_case_id = v_task.related_entity_id and c.status = 'OPEN' and c.blocking_level = 'BLOCKS_CLOSURE');
    else
      return v_task.blocking_level = 'CLOSURE_BLOCKER';
  end case;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Idempotent writers
-- ---------------------------------------------------------------------------------------------

-- Opens or refreshes the task of a still-holding condition. Returns CREATED | UPDATED | REOPENED | UNCHANGED.
-- A WAIVED task stays waived. A RESOLVED task is reopened only when its condition had cleared in between
-- (metadata.active = false): a task staff resolved while the condition still holds is not re-raised on every sweep.
create function private.admin_task_sync_open(
  p_task_key text, p_category text, p_edition_id uuid, p_entity_type text, p_entity_id uuid, p_title text,
  p_description text, p_priority text, p_blocking_level text, p_assigned_role text, p_metadata jsonb default '{}')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('active', true);
  v_task app.admin_task%rowtype;
  v_inserted integer;
begin
  insert into app.admin_task (task_key, category, scope_type, scope_id, edition_id, related_entity_type, related_entity_id,
    title, description, priority, blocking_level, status, assigned_role, source_rule, metadata)
  values (p_task_key, p_category, case when p_edition_id is null then 'PLATFORM' else 'EDITION' end, p_edition_id, p_edition_id,
    p_entity_type, p_entity_id, p_title, p_description, p_priority, p_blocking_level, 'OPEN', p_assigned_role,
    pg_catalog.split_part(p_task_key, ':', 1), v_meta)
  on conflict (task_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then return 'CREATED'; end if;

  select * into v_task from app.admin_task t where t.task_key = p_task_key for update;
  if v_task.status = 'WAIVED' then
    return 'UNCHANGED';
  elsif v_task.status in ('OPEN', 'IN_PROGRESS', 'WAITING_EXTERNAL') then
    if (v_task.title, v_task.description, v_task.priority, v_task.blocking_level, v_task.metadata)
       is distinct from (p_title, p_description, p_priority, p_blocking_level, v_meta) then
      update app.admin_task
      set title = p_title, description = p_description, priority = p_priority, blocking_level = p_blocking_level, metadata = v_meta
      where admin_task_id = v_task.admin_task_id;
      return 'UPDATED';
    end if;
    return 'UNCHANGED';
  elsif coalesce((v_task.metadata ->> 'active')::boolean, false) then
    return 'UNCHANGED';
  end if;
  update app.admin_task
  set status = 'OPEN', resolved_at = null, resolution_type = null, resolution_reason = null, started_at = null,
      detected_at = pg_catalog.now(), title = p_title, description = p_description, priority = p_priority,
      blocking_level = p_blocking_level, metadata = v_meta
  where admin_task_id = v_task.admin_task_id;
  return 'REOPENED';
end;
$$;

-- The condition no longer holds: an unfinished task is resolved by the system (never a request, never a registration).
-- Returns RESOLVED | MARKED | NONE.
create function private.admin_task_sync_clear(p_task_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task app.admin_task%rowtype;
begin
  select * into v_task from app.admin_task t where t.task_key = p_task_key for update;
  if not found then return 'NONE'; end if;
  if v_task.status in ('OPEN', 'IN_PROGRESS', 'WAITING_EXTERNAL') then
    update app.admin_task
    set status = 'RESOLVED', resolved_at = pg_catalog.now(), resolution_type = 'CONDITION_CLEARED',
        resolution_reason = 'La condición de origen ya no se cumple.', metadata = v_task.metadata || jsonb_build_object('active', false)
    where admin_task_id = v_task.admin_task_id;
    return 'RESOLVED';
  end if;
  if coalesce((v_task.metadata ->> 'active')::boolean, true) then
    update app.admin_task set metadata = v_task.metadata || jsonb_build_object('active', false)
    where admin_task_id = v_task.admin_task_id;
    return 'MARKED';
  end if;
  return 'NONE';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Sync: recompute the projected tasks from their sources. SYSTEM / definer only (cron, refresh command).
-- ---------------------------------------------------------------------------------------------
create function private.admin_tasks_sync(p_edition_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition record;
  v_case record;
  v_provider record;
  v_task record;
  v_pending_attendance integer;
  v_pending_eligibility integer;
  v_expected integer;
  v_has_finalization boolean;
  v_closed boolean;
  v_readiness jsonb;
  v_opened integer := 0;
  v_cleared integer := 0;
  v_errors integer := 0;
  v_result text;
begin
  -- Attendance / closure tasks of FINISHED Editions (and the tasks that must now clear).
  for v_edition in
    select e.edition_id, e.execution_state
    from app.edition e
    where (p_edition_id is null or e.edition_id = p_edition_id)
      and (e.execution_state = 'FINISHED'
           or exists (select 1 from app.admin_task t
                      where t.edition_id = e.edition_id and t.source_rule in ('attendance-finalization', 'closure-pending')
                        and t.status in ('OPEN', 'IN_PROGRESS', 'WAITING_EXTERNAL')))
    order by e.edition_id
  loop
    begin
      v_has_finalization := exists (select 1 from app.attendance_finalization f
        where f.edition_id = v_edition.edition_id and f.superseded_at is null and f.status = 'FINALIZED');
      v_closed := exists (select 1 from app.administrative_closure c
        where c.edition_id = v_edition.edition_id and c.superseded_at is null and c.status = 'CLOSED');

      if v_edition.execution_state = 'FINISHED' and not v_has_finalization then
        select count(*) into v_expected from app.registration r where r.edition_id = v_edition.edition_id and r.status = 'CONFIRMED';
        select count(*) filter (where ar.registration_id is null or ar.status = 'PENDING') into v_pending_attendance
        from app.registration r
        left join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
        where r.edition_id = v_edition.edition_id and r.status = 'CONFIRMED';
        select count(*) into v_pending_eligibility
        from app.registration r
        join app.sporting_eligibility_resolution s on s.registration_id = r.registration_id and s.superseded_at is null
        where r.edition_id = v_edition.edition_id and r.status = 'CONFIRMED' and s.distance_credit_disposition = 'PENDING';
        v_result := private.admin_task_sync_open('attendance-finalization:' || v_edition.edition_id, 'ATTENDANCE',
          v_edition.edition_id, 'edition', v_edition.edition_id, 'Asistencia pendiente de finalizar',
          pg_catalog.format('Faltan %s de %s participantes por resolver y hay %s elegibilidades pendientes. Resuelve la asistencia y finaliza la edición.',
            v_pending_attendance, v_expected, v_pending_eligibility),
          'HIGH', 'CLOSURE_BLOCKER', 'OPERATOR',
          jsonb_build_object('expected_count', v_expected, 'pending_attendance', v_pending_attendance,
            'pending_eligibility', v_pending_eligibility));
        if v_result in ('CREATED', 'REOPENED') then v_opened := v_opened + 1; end if;
      else
        if private.admin_task_sync_clear('attendance-finalization:' || v_edition.edition_id) = 'RESOLVED' then
          v_cleared := v_cleared + 1;
        end if;
      end if;

      if v_edition.execution_state = 'FINISHED' and v_has_finalization and not v_closed then
        v_readiness := private.closure_readiness(v_edition.edition_id);
        v_result := private.admin_task_sync_open('closure-pending:' || v_edition.edition_id, 'CLOSURE',
          v_edition.edition_id, 'edition', v_edition.edition_id, 'Cierre administrativo pendiente',
          case when (v_readiness ->> 'ready')::boolean
               then 'La asistencia está finalizada y la edición está lista para cerrarse.'
               else 'La asistencia está finalizada, pero el cierre aún tiene bloqueos. Revisa la preparación del cierre.' end,
          'HIGH', 'ACTION_REQUIRED', 'ADMIN',
          jsonb_build_object('ready', (v_readiness ->> 'ready')::boolean,
            'failing_checks', coalesce((select jsonb_agg(c ->> 'code' order by c ->> 'code')
                                        from jsonb_array_elements(v_readiness -> 'checks') c
                                        where not (c ->> 'ok')::boolean), '[]'::jsonb)));
        if v_result in ('CREATED', 'REOPENED') then v_opened := v_opened + 1; end if;
      else
        if private.admin_task_sync_clear('closure-pending:' || v_edition.edition_id) = 'RESOLVED' then
          v_cleared := v_cleared + 1;
        end if;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'admin_tasks_sync edition failed: %', sqlstate;
    end;
  end loop;

  -- Integrity cases that block (or concern) an Edition.
  begin
    for v_case in
      select c.community_integrity_case_id, c.edition_id, c.case_type, c.severity, c.blocking_level
      from app.community_integrity_case c
      where c.status = 'OPEN' and c.edition_id is not null and (p_edition_id is null or c.edition_id = p_edition_id)
      order by c.community_integrity_case_id
    loop
      v_result := private.admin_task_sync_open('closure-integrity:' || v_case.edition_id || ':' || v_case.community_integrity_case_id,
        'INTEGRITY', v_case.edition_id, 'community_integrity_case', v_case.community_integrity_case_id,
        'Caso de integridad abierto',
        pg_catalog.format('Caso %s abierto (severidad %s). Resuélvelo desde su caso de integridad%s.', v_case.case_type,
          v_case.severity, case when v_case.blocking_level = 'BLOCKS_CLOSURE' then ': bloquea el cierre de la edición' else '' end),
        case when v_case.blocking_level = 'BLOCKS_CLOSURE' then 'HIGH' else 'NORMAL' end,
        case when v_case.blocking_level = 'BLOCKS_CLOSURE' then 'CLOSURE_BLOCKER' else 'ACTION_REQUIRED' end,
        'ADMIN', jsonb_build_object('case_type', v_case.case_type, 'severity', v_case.severity));
      if v_result in ('CREATED', 'REOPENED') then v_opened := v_opened + 1; end if;
    end loop;
    for v_task in
      select t.task_key from app.admin_task t
      where t.source_rule = 'closure-integrity' and t.status in ('OPEN', 'IN_PROGRESS', 'WAITING_EXTERNAL')
        and (p_edition_id is null or t.edition_id = p_edition_id)
        and not exists (select 1 from app.community_integrity_case c
                        where c.community_integrity_case_id = t.related_entity_id and c.status = 'OPEN')
    loop
      if private.admin_task_sync_clear(v_task.task_key) = 'RESOLVED' then v_cleared := v_cleared + 1; end if;
    end loop;
  exception when others then
    v_errors := v_errors + 1;
    raise warning 'admin_tasks_sync integrity failed: %', sqlstate;
  end;

  -- Provider reconciliation (platform-wide): messages SENT long ago that still have no terminal provider status even
  -- though communication-reconcile polls them every 15 minutes (a lost webhook plus an unreachable provider API).
  if p_edition_id is null then
    begin
      for v_provider in
        select m.provider, count(*)::integer as stuck
        from app.communication_message m
        where m.status = 'SENT' and m.provider is not null and m.provider_message_id is not null
          and m.sent_at < pg_catalog.now() - interval '6 hours'
        group by m.provider
        order by m.provider
      loop
        v_result := private.admin_task_sync_open('provider-reconciliation:' || v_provider.provider, 'RECONCILIATION', null,
          'provider', null, 'Conciliación con el proveedor pendiente',
          pg_catalog.format('%s mensajes enviados por %s siguen sin estado final del proveedor tras 6 horas. Revisa el proveedor y concilia.',
            v_provider.stuck, v_provider.provider),
          'NORMAL', 'ACTION_REQUIRED', 'ADMIN', jsonb_build_object('provider', v_provider.provider, 'stuck_messages', v_provider.stuck));
        if v_result in ('CREATED', 'REOPENED') then v_opened := v_opened + 1; end if;
      end loop;
      for v_task in
        select t.task_key from app.admin_task t
        where t.source_rule = 'provider-reconciliation' and t.status in ('OPEN', 'IN_PROGRESS', 'WAITING_EXTERNAL')
          and not exists (select 1 from app.communication_message m
                          where m.status = 'SENT' and m.provider is not null and m.provider_message_id is not null
                            and m.sent_at < pg_catalog.now() - interval '6 hours'
                            and 'provider-reconciliation:' || m.provider = t.task_key)
      loop
        if private.admin_task_sync_clear(v_task.task_key) = 'RESOLVED' then v_cleared := v_cleared + 1; end if;
      end loop;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'admin_tasks_sync provider failed: %', sqlstate;
    end;
  end if;

  -- OD-P2-01 hold concentration of EXTERNAL_WHATSAPP Editions (evaluator: migration 721).
  for v_edition in
    select e.edition_id
    from app.edition e
    where e.registration_mode = 'EXTERNAL_WHATSAPP' and (p_edition_id is null or e.edition_id = p_edition_id)
      and (exists (select 1 from app.registration_request r where r.edition_id = e.edition_id and r.status = 'PENDING_CONFIRMATION')
           or exists (select 1 from app.admin_task t where t.edition_id = e.edition_id and t.source_rule = 'hold-concentration'
                        and t.status in ('OPEN', 'IN_PROGRESS', 'WAITING_EXTERNAL')))
    order by e.edition_id
  loop
    begin
      perform private.registration_evaluate_hold_concentration(v_edition.edition_id);
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'admin_tasks_sync hold concentration failed: %', sqlstate;
    end;
  end loop;

  return jsonb_build_object('opened', v_opened, 'cleared', v_cleared, 'errors', v_errors);
end;
$$;

create function private.worker_admin_tasks_sync()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_result jsonb;
begin
  insert into infra.worker_run (worker_key) values ('admin-task-sync') returning worker_run_id into v_run_id;
  v_result := private.admin_tasks_sync(null);
  update infra.worker_run
  set status = case when (v_result ->> 'errors')::integer = 0 then 'SUCCEEDED' else 'PARTIAL' end, completed_at = pg_catalog.now(),
      processed_count = (v_result ->> 'opened')::integer + (v_result ->> 'cleared')::integer,
      error_count = (v_result ->> 'errors')::integer
  where worker_run_id = v_run_id;
  return v_result || jsonb_build_object('worker_run_id', v_run_id);
end;
$$;

select cron.schedule('admin-task-sync', '*/5 * * * *', 'select private.worker_admin_tasks_sync()');

-- ---------------------------------------------------------------------------------------------
-- 6. Staff API
-- ---------------------------------------------------------------------------------------------

-- Default status filter ACTIVE = not RESOLVED/WAIVED; ALL = everything. Pure read (stable): the sync runs on cron and on
-- the refresh command, never as a side effect of listing.
create function private.admin_list_tasks(
  p_edition_id uuid default null, p_status text default null, p_category text default null, p_blocking_level text default null,
  p_assigned text default null, p_cursor_rank integer default null, p_cursor_detected_at timestamptz default null,
  p_cursor_id uuid default null, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_staff uuid;
  v_status text := pg_catalog.upper(coalesce(nullif(pg_catalog.btrim(p_status), ''), 'ACTIVE'));
  v_assigned text := pg_catalog.upper(nullif(pg_catalog.btrim(p_assigned), ''));
  v_page jsonb;
  v_counts jsonb;
begin
  perform private.require_actor();
  v_staff := private.current_staff_member_id();
  if v_staff is null then perform private.raise_domain_error('FORBIDDEN'); end if;
  if p_edition_id is not null then
    if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
      perform private.raise_domain_error('NOT_FOUND');
    end if;
    perform private.require_permission('ADMIN_TASK_READ', p_edition_id);
  end if;
  if v_status not in ('ACTIVE', 'ALL', 'OPEN', 'IN_PROGRESS', 'WAITING_EXTERNAL', 'RESOLVED', 'WAIVED') then
    perform private.cfg_fail('status', 'invalid_value');
  end if;
  if p_blocking_level is not null and p_blocking_level not in ('INFORMATION', 'ACTION_REQUIRED', 'EVENT_DAY_BLOCKER', 'CLOSURE_BLOCKER') then
    perform private.cfg_fail('blocking_level', 'invalid_value');
  end if;
  if v_assigned is not null and v_assigned not in ('ME', 'UNASSIGNED') then
    perform private.cfg_fail('assigned', 'invalid_value');
  end if;
  if p_category is not null and p_category !~ '^[A-Z][A-Z0-9_]{1,31}$' then
    perform private.cfg_fail('category', 'invalid_value');
  end if;

  select coalesce(jsonb_agg(x.item order by x.rank desc, x.detected_at desc, x.admin_task_id desc), '[]'::jsonb) into v_page
  from (
    select private.admin_task_projection(t.admin_task_id) as item, private.admin_task_rank(t.blocking_level) as rank,
           t.detected_at, t.admin_task_id
    from app.admin_task t
    where (p_edition_id is null or t.edition_id = p_edition_id)
      and private.admin_task_visible(t.category, t.edition_id)
      and (v_status = 'ALL' or (v_status = 'ACTIVE' and t.status not in ('RESOLVED', 'WAIVED')) or t.status = v_status)
      and (p_category is null or t.category = p_category)
      and (p_blocking_level is null or t.blocking_level = p_blocking_level)
      and (v_assigned is null or (v_assigned = 'ME' and t.assigned_staff_id = v_staff)
           or (v_assigned = 'UNASSIGNED' and t.assigned_staff_id is null))
      and (p_cursor_id is null
           or (private.admin_task_rank(t.blocking_level), t.detected_at, t.admin_task_id)
              < (p_cursor_rank, p_cursor_detected_at, p_cursor_id))
    order by private.admin_task_rank(t.blocking_level) desc, t.detected_at desc, t.admin_task_id desc
    limit v_limit + 1
  ) x;

  select jsonb_build_object(
    'by_status', coalesce(jsonb_object_agg(s.status, s.n) filter (where s.status is not null), '{}'::jsonb),
    'active_by_blocking_level', coalesce((
      select jsonb_object_agg(b.blocking_level, b.n) from (
        select t.blocking_level, count(*)::integer as n
        from app.admin_task t
        where (p_edition_id is null or t.edition_id = p_edition_id) and private.admin_task_visible(t.category, t.edition_id)
          and t.status not in ('RESOLVED', 'WAIVED')
        group by t.blocking_level) b), '{}'::jsonb))
  into v_counts
  from (
    select t.status, count(*)::integer as n
    from app.admin_task t
    where (p_edition_id is null or t.edition_id = p_edition_id) and private.admin_task_visible(t.category, t.edition_id)
    group by t.status) s;

  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(p.e order by p.n), '[]'::jsonb) from jsonb_array_elements(v_page) with ordinality p(e, n)
              where p.n <= v_limit),
    'counts', v_counts,
    'next_cursor', case when jsonb_array_length(v_page) > v_limit then jsonb_build_object(
      'rank', private.admin_task_rank(v_page -> (v_limit - 1) ->> 'blocking_level'),
      'detected_at', v_page -> (v_limit - 1) -> 'detected_at', 'id', v_page -> (v_limit - 1) -> 'admin_task_id') end);
end;
$$;

create function private.admin_get_task(p_admin_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task app.admin_task%rowtype;
begin
  perform private.require_actor();
  select * into v_task from app.admin_task t where t.admin_task_id = p_admin_task_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.require_permission('ADMIN_TASK_READ', v_task.edition_id);
  -- A task outside the caller's view is indistinguishable from a missing one.
  if not private.admin_task_visible(v_task.category, v_task.edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  return private.admin_task_projection(p_admin_task_id)
    || jsonb_build_object('source_holds', private.admin_task_source_holds(p_admin_task_id));
end;
$$;

-- Shared transition guard: authorise on the task's Edition (SEC-020), take the row lock, begin idempotency.
-- Returns the staff member and the idempotency state; the caller locks the row after the replay check.
create function private.admin_task_command_begin(
  p_admin_task_id uuid, p_operation text, p_idempotency_key text, p_args jsonb, out o_staff uuid, out o_idem jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
begin
  select t.edition_id into v_edition_id from app.admin_task t where t.admin_task_id = p_admin_task_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  o_staff := private.cfg_authorize('ADMIN_TASK_MANAGE', v_edition_id);
  o_idem := private.cfg_idempotency_begin(p_operation, p_admin_task_id::text, p_idempotency_key, p_args);
end;
$$;

create function private.start_admin_task(p_admin_task_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task app.admin_task%rowtype;
  v_staff uuid;
  v_idem jsonb;
  v_result jsonb;
begin
  select h.o_staff, h.o_idem into v_staff, v_idem
  from private.admin_task_command_begin(p_admin_task_id, 'tasks.start', p_idempotency_key,
    jsonb_build_object('admin_task_id', p_admin_task_id)) h;
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;
  select * into v_task from app.admin_task t where t.admin_task_id = p_admin_task_id for update;
  if v_task.status not in ('OPEN', 'WAITING_EXTERNAL') then
    perform private.cfg_invalid_transition('status', v_task.status);
  end if;

  update app.admin_task
  set status = 'IN_PROGRESS', started_at = coalesce(started_at, pg_catalog.now()),
      assigned_staff_id = coalesce(assigned_staff_id, v_staff)
  where admin_task_id = p_admin_task_id;
  perform private.audit('ADMIN_TASK_STARTED', 'admin_task', p_admin_task_id, v_task.edition_id,
    jsonb_build_object('status', v_task.status), jsonb_build_object('status', 'IN_PROGRESS'), null);
  v_result := private.admin_task_projection(p_admin_task_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

-- Assign to a staff member who can see the task's Edition, to a role, or both; both null clears the assignment.
create function private.assign_admin_task(
  p_admin_task_id uuid, p_assignee_id uuid default null, p_assigned_role text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task app.admin_task%rowtype;
  v_staff uuid;
  v_idem jsonb;
  v_result jsonb;
begin
  if p_assigned_role is not null and p_assigned_role not in ('ADMIN', 'OPERATOR', 'CHECKIN', 'MODERATOR') then
    perform private.cfg_fail('assigned_role', 'invalid_value');
  end if;
  select h.o_staff, h.o_idem into v_staff, v_idem
  from private.admin_task_command_begin(p_admin_task_id, 'tasks.assign', p_idempotency_key,
    jsonb_build_object('admin_task_id', p_admin_task_id, 'assignee_id', p_assignee_id, 'assigned_role', p_assigned_role)) h;
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;
  select * into v_task from app.admin_task t where t.admin_task_id = p_admin_task_id for update;
  if v_task.status in ('RESOLVED', 'WAIVED') then
    perform private.cfg_invalid_transition('status', v_task.status);
  end if;
  if p_assignee_id is not null and not exists (
    select 1
    from app.staff_member sm
    join app.staff_role_assignment sra on sra.staff_member_id = sm.staff_member_id and sra.revoked_at is null
    where sm.staff_member_id = p_assignee_id and sm.status = 'ACTIVE'
      and (sra.scope_type = 'GLOBAL' or (v_task.edition_id is not null and sra.edition_id = v_task.edition_id))) then
    perform private.cfg_fail('assignee_id', 'not_assignable');
  end if;

  update app.admin_task set assigned_staff_id = p_assignee_id, assigned_role = p_assigned_role
  where admin_task_id = p_admin_task_id;
  perform private.audit('ADMIN_TASK_ASSIGNED', 'admin_task', p_admin_task_id, v_task.edition_id,
    jsonb_build_object('assigned_staff_id', v_task.assigned_staff_id, 'assigned_role', v_task.assigned_role),
    jsonb_build_object('assigned_staff_id', p_assignee_id, 'assigned_role', p_assigned_role), null);
  v_result := private.admin_task_projection(p_admin_task_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

-- Shared by resolve and waive. A CLOSURE_BLOCKER cannot be closed visually while its source condition holds
-- (Master §142): the root object is re-evaluated here, the task row is never trusted.
create function private.admin_task_close(p_admin_task_id uuid, p_mode text, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task app.admin_task%rowtype;
  v_staff uuid;
  v_idem jsonb;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_result jsonb;
begin
  if v_reason is null then perform private.cfg_fail('reason', 'required'); end if;
  if pg_catalog.char_length(v_reason) > 500 then perform private.cfg_fail('reason', 'too_long'); end if;
  select h.o_staff, h.o_idem into v_staff, v_idem
  from private.admin_task_command_begin(p_admin_task_id, 'tasks.' || pg_catalog.lower(p_mode), p_idempotency_key,
    jsonb_build_object('admin_task_id', p_admin_task_id, 'reason', v_reason)) h;
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;
  select * into v_task from app.admin_task t where t.admin_task_id = p_admin_task_id for update;
  if v_task.status in ('RESOLVED', 'WAIVED') then
    perform private.cfg_invalid_transition('status', v_task.status);
  end if;
  if v_task.blocking_level = 'CLOSURE_BLOCKER' and private.admin_task_source_holds(p_admin_task_id) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'source_condition_open',
      'task_key', v_task.task_key, 'blocking_level', 'CLOSURE_BLOCKER',
      'related_entity_type', v_task.related_entity_type, 'related_entity_id', v_task.related_entity_id));
  end if;

  update app.admin_task
  set status = case p_mode when 'RESOLVE' then 'RESOLVED' else 'WAIVED' end, resolved_at = pg_catalog.now(),
      resolution_type = case p_mode when 'RESOLVE' then 'MANUAL' else 'WAIVED' end, resolution_reason = v_reason
  where admin_task_id = p_admin_task_id;
  perform private.audit(case p_mode when 'RESOLVE' then 'ADMIN_TASK_RESOLVED' else 'ADMIN_TASK_WAIVED' end, 'admin_task',
    p_admin_task_id, v_task.edition_id, jsonb_build_object('status', v_task.status),
    jsonb_build_object('status', case p_mode when 'RESOLVE' then 'RESOLVED' else 'WAIVED' end,
      'blocking_level', v_task.blocking_level), v_reason);
  v_result := private.admin_task_projection(p_admin_task_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

create function private.resolve_admin_task(p_admin_task_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.admin_task_close(p_admin_task_id, 'RESOLVE', p_reason, p_idempotency_key) $$;

create function private.waive_admin_task(p_admin_task_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.admin_task_close(p_admin_task_id, 'WAIVE', p_reason, p_idempotency_key) $$;

-- Explicit refresh of one Edition's projected tasks (the cron job covers the platform). Authorised on that Edition.
create function private.refresh_admin_tasks(p_edition_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idem jsonb;
  v_result jsonb;
begin
  if p_edition_id is null or not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('ADMIN_TASK_MANAGE', p_edition_id);
  v_idem := private.cfg_idempotency_begin('tasks.refresh', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;
  v_result := jsonb_build_object('edition_id', p_edition_id) || private.admin_tasks_sync(p_edition_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Public wrappers and grants
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_tasks(
  p_edition_id uuid default null, p_status text default null, p_category text default null, p_blocking_level text default null,
  p_assigned text default null, p_cursor_rank integer default null, p_cursor_detected_at timestamptz default null,
  p_cursor_id uuid default null, p_limit integer default 25)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_list_tasks(p_edition_id, p_status, p_category, p_blocking_level, p_assigned, p_cursor_rank,
  p_cursor_detected_at, p_cursor_id, p_limit) $$;
create function public.admin_get_task(p_admin_task_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_get_task(p_admin_task_id) $$;
create function public.start_admin_task(p_admin_task_id uuid, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.start_admin_task(p_admin_task_id, p_idempotency_key) $$;
create function public.assign_admin_task(
  p_admin_task_id uuid, p_assignee_id uuid default null, p_assigned_role text default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.assign_admin_task(p_admin_task_id, p_assignee_id, p_assigned_role, p_idempotency_key) $$;
create function public.resolve_admin_task(p_admin_task_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.resolve_admin_task(p_admin_task_id, p_reason, p_idempotency_key) $$;
create function public.waive_admin_task(p_admin_task_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.waive_admin_task(p_admin_task_id, p_reason, p_idempotency_key) $$;
create function public.refresh_admin_tasks(p_edition_id uuid, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.refresh_admin_tasks(p_edition_id, p_idempotency_key) $$;

revoke all on function
  private.admin_task_visible(text, uuid), private.admin_task_projection(uuid), private.admin_task_rank(text),
  private.admin_task_source_holds(uuid),
  private.admin_task_sync_open(text, text, uuid, text, uuid, text, text, text, text, text, jsonb),
  private.admin_task_sync_clear(text), private.admin_tasks_sync(uuid), private.worker_admin_tasks_sync(),
  private.admin_task_command_begin(uuid, text, text, jsonb), private.admin_task_close(uuid, text, text, text),
  private.admin_list_tasks(uuid, text, text, text, text, integer, timestamptz, uuid, integer),
  public.admin_list_tasks(uuid, text, text, text, text, integer, timestamptz, uuid, integer),
  private.admin_get_task(uuid), public.admin_get_task(uuid),
  private.start_admin_task(uuid, text), public.start_admin_task(uuid, text),
  private.assign_admin_task(uuid, uuid, text, text), public.assign_admin_task(uuid, uuid, text, text),
  private.resolve_admin_task(uuid, text, text), public.resolve_admin_task(uuid, text, text),
  private.waive_admin_task(uuid, text, text), public.waive_admin_task(uuid, text, text),
  private.refresh_admin_tasks(uuid, text), public.refresh_admin_tasks(uuid, text)
from public, anon, authenticated, service_role;

-- admin_task_visible is called by the authenticated wrappers' definer bodies only; no direct grant is needed.
grant execute on function
  private.admin_list_tasks(uuid, text, text, text, text, integer, timestamptz, uuid, integer),
  public.admin_list_tasks(uuid, text, text, text, text, integer, timestamptz, uuid, integer),
  private.admin_get_task(uuid), public.admin_get_task(uuid),
  private.start_admin_task(uuid, text), public.start_admin_task(uuid, text),
  private.assign_admin_task(uuid, uuid, text, text), public.assign_admin_task(uuid, uuid, text, text),
  private.resolve_admin_task(uuid, text, text), public.resolve_admin_task(uuid, text, text),
  private.waive_admin_task(uuid, text, text), public.waive_admin_task(uuid, text, text),
  private.refresh_admin_tasks(uuid, text), public.refresh_admin_tasks(uuid, text)
to authenticated;
