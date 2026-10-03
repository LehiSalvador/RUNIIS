-- P3-D Task Center backend (Master §142-143, §145; Roadmap §9.26): the idempotent writers (attendance pending, closure
-- pending, integrity issue, provider reconciliation), the sync lifecycle (open, refresh, clear, never re-raise what staff
-- resolved), the staff API (list/filters/pagination, get, start, assign, resolve, waive, refresh), RBAC with Edition scope
-- (SEC-020), the CLOSURE_BLOCKER rule (the root is re-evaluated, the task row is never trusted), idempotency, audit and the
-- cron job. Synthetic ids in a 720 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(86);

create function pg_temp.err(p_sql text) returns jsonb language plpgsql as $$
declare v_code text; v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('code', v_code, 'detail', case when v_detail ~ '^\{' then v_detail::jsonb end);
end $$;
grant execute on function pg_temp.err(text) to authenticated;
create function pg_temp.sv(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin execute p_sql into v; return v; end $$;
grant execute on function pg_temp.sv(text) to authenticated;
-- Task id by a where-clause, read as the owner (authenticated has no direct grant on app.admin_task).
create function pg_temp.tid(p_where text) returns uuid language plpgsql security definer as $$
declare v uuid;
begin execute 'select admin_task_id from app.admin_task where ' || p_where || ' limit 1' into v; return v; end $$;
grant execute on function pg_temp.tid(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture: E1 is FINISHED with no registrations (the universe is empty, which keeps the finalize/close path trivial),
-- E2 is SCHEDULED. Staff: ADMIN, OPERATOR, CHECKIN, MODERATOR (all GLOBAL), an OPERATOR scoped to E2 and a runner.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000720001', 'p720-admin@example.test'),
  ('00000000-0000-4000-8000-000000720002', 'p720-operator@example.test'),
  ('00000000-0000-4000-8000-000000720003', 'p720-checkin@example.test'),
  ('00000000-0000-4000-8000-000000720004', 'p720-moderator@example.test'),
  ('00000000-0000-4000-8000-000000720005', 'p720-operator-e2@example.test'),
  ('00000000-0000-4000-8000-000000720007', 'p720-revoked@example.test');
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000720006', 'p720-runner@example.test', now());
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000720001', '00000000-0000-4000-8000-000000720001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000720002', '00000000-0000-4000-8000-000000720002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000720003', '00000000-0000-4000-8000-000000720003', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000720004', '00000000-0000-4000-8000-000000720004', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000720005', '00000000-0000-4000-8000-000000720005', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000720007', '00000000-0000-4000-8000-000000720007', 'REVOKED');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name, date_of_birth,
  sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000720006', '00000000-0000-4000-8000-000000720006', 'READY', 'ACTIVE', 'Runner 720',
   '1990-01-01', 'M', '+528110007201', 'Contacto', '+528110007202', 'Hermano', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000720006', 'c0000000-0000-4000-8000-000000720006', 'ELIGIBLE', true);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000720001', event_type_id, 'Task Event', 'p720-task-event'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state,
  registration_state, closure_state, registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000720001', '40000000-0000-4000-8000-000000720001', 'p720-task-2026', 'Task 2026',
   'FREE', 'America/Monterrey', 'FINISHED', 'CLOSED', 'PENDING', now() - interval '1 day', 'Monterrey', 'NL', 'MX'),
  ('50000000-0000-4000-8000-000000720002', '40000000-0000-4000-8000-000000720001', 'p720-task-other-2026', 'Other 2026',
   'FREE', 'America/Monterrey', 'SCHEDULED', 'OPEN', 'OPEN', now() + interval '30 days', 'Monterrey', 'NL', 'MX');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone, created_by_staff_id)
values ('50000000-0000-4000-8000-000000720001', 1, 'DATE_TIME_CONFIRMED', '2026-03-15', '07:00', 'America/Monterrey',
  '20000000-0000-4000-8000-000000720001');

insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000720001', 'ADMIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000720002', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000720003', 'CHECKIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000720004', 'MODERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000720005', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000720002'),
  ('20000000-0000-4000-8000-000000720007', 'OPERATOR', 'GLOBAL', null);
create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert on ids to authenticated;

-- ===========================================================================================
-- SYNC: writers and lifecycle (SYSTEM)
-- ===========================================================================================
select is(private.admin_tasks_sync('50000000-0000-4000-8000-000000720001') ->> 'opened', '1',
  'a FINISHED Edition without a current finalization opens one task');
select is(pg_temp.sv($q$ select task_key || '/' || blocking_level || '/' || category || '/' || status || '/' || source_rule
  from app.admin_task where edition_id = '50000000-0000-4000-8000-000000720001' $q$),
  'attendance-finalization:50000000-0000-4000-8000-000000720001/CLOSURE_BLOCKER/ATTENDANCE/OPEN/attendance-finalization',
  'attendance-finalization:{edition} is a CLOSURE_BLOCKER pointing at the Edition');
select is(pg_temp.sv($q$ select related_entity_type || '/' || related_entity_id from app.admin_task
  where edition_id = '50000000-0000-4000-8000-000000720001' $q$), 'edition/50000000-0000-4000-8000-000000720001',
  'the task points to its root object');
select is(private.admin_tasks_sync('50000000-0000-4000-8000-000000720001') ->> 'opened', '0', 'the sync is idempotent');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where edition_id = '50000000-0000-4000-8000-000000720001' $q$), '1',
  'repeating the sync creates no duplicates');
select is(private.admin_tasks_sync('50000000-0000-4000-8000-000000720002') ->> 'opened', '0',
  'a SCHEDULED Edition produces no attendance/closure task');
select is((select (metadata ->> 'active') from app.admin_task where edition_id = '50000000-0000-4000-8000-000000720001'), 'true',
  'an open projection records that its condition is active');

-- Integrity case that blocks closure, and one that does not.
insert into app.community_integrity_case (community_integrity_case_id, case_type, edition_id, status, severity, blocking_level)
values ('60000000-0000-4000-8000-000000720001', 'DISTANCE_MISMATCH', '50000000-0000-4000-8000-000000720001', 'OPEN', 'HIGH', 'BLOCKS_CLOSURE'),
       ('60000000-0000-4000-8000-000000720002', 'INVALID_SPORT_DATE', '50000000-0000-4000-8000-000000720001', 'OPEN', 'LOW', 'BLOCKS_RANKING');
select is(private.admin_tasks_sync('50000000-0000-4000-8000-000000720001') ->> 'opened', '2', 'two open integrity cases open two tasks');
select is(pg_temp.sv($q$ select blocking_level || '/' || category || '/' || related_entity_type from app.admin_task
  where task_key = 'closure-integrity:50000000-0000-4000-8000-000000720001:60000000-0000-4000-8000-000000720001' $q$),
  'CLOSURE_BLOCKER/INTEGRITY/community_integrity_case', 'a blocking integrity case is a CLOSURE_BLOCKER pointing at the case');
select is(pg_temp.sv($q$ select blocking_level from app.admin_task
  where task_key = 'closure-integrity:50000000-0000-4000-8000-000000720001:60000000-0000-4000-8000-000000720002' $q$),
  'ACTION_REQUIRED', 'a non-blocking integrity case is ACTION_REQUIRED');

-- Provider reconciliation: a message SENT long ago with no terminal provider status.
insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000720002', event_type_id, 'Task Comms Event', 'p720-comms-event' from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000720003', '40000000-0000-4000-8000-000000720002', 'p720-comms-2026', 'Comms 2026', 'PUBLISHED',
   'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey', now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());
do $$ declare v_recipient uuid; v_contact uuid; v_message uuid; begin
  select o_recipient_id, o_contact_point_id into v_recipient, v_contact
  from private.comms_ensure_runner_recipient('10000000-0000-4000-8000-000000720006');
  v_message := private.comms_enqueue_message('REGISTRATION_OPENED', v_recipient, v_contact, 'TEST:P720:1',
    'EDITION_SCHEDULE_REVISION', gen_random_uuid(),
    private.comms_pick_vars('REGISTRATION_OPENED', private.comms_edition_vars('50000000-0000-4000-8000-000000720003')),
    '50000000-0000-4000-8000-000000720003');
  update app.communication_message set status = 'SENT', provider = 'brevo', provider_message_id = 'brevo-p720-1',
    sent_at = now() - interval '7 hours' where communication_message_id = v_message;
end $$;
select is((private.admin_tasks_sync(null) ->> 'opened')::int >= 1, true, 'the platform sync opens the provider reconciliation task');
select is(pg_temp.sv($q$ select blocking_level || '/' || category || '/' || coalesce(edition_id::text, 'platform')
  from app.admin_task where task_key = 'provider-reconciliation:brevo' $q$), 'ACTION_REQUIRED/RECONCILIATION/platform',
  'provider-reconciliation:{provider} is platform-wide');
select is(pg_temp.sv($q$ select (metadata ->> 'stuck_messages') from app.admin_task where task_key = 'provider-reconciliation:brevo' $q$), '1',
  'the task records how many messages are stuck');
update app.communication_message set status = 'DELIVERED' where provider_message_id = 'brevo-p720-1';
select private.admin_tasks_sync(null);
select is(pg_temp.sv($q$ select status || '/' || resolution_type from app.admin_task where task_key = 'provider-reconciliation:brevo' $q$),
  'RESOLVED/CONDITION_CLEARED', 'once the provider status arrives the task clears itself');

-- ===========================================================================================
-- STAFF API: RBAC and visibility
-- ===========================================================================================
insert into app.admin_task (task_key, category, scope_type, scope_id, edition_id, title, description, priority, blocking_level, source_rule)
values ('raceday_unknown_pass_burst:50000000-0000-4000-8000-000000720001:p720', 'RACE_DAY', 'EDITION',
  '50000000-0000-4000-8000-000000720001', '50000000-0000-4000-8000-000000720001', 'Rafaga', 'Rafaga de pruebas', 'HIGH',
  'ACTION_REQUIRED', 'raceday_unknown_pass_burst');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000720006", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_tasks() $$) ->> 'code', 'FORBIDDEN', 'a runner cannot list tasks');
select is(pg_temp.err($$ select public.start_admin_task(pg_temp.tid('true')) $$) ->> 'code', 'FORBIDDEN',
  'a runner cannot start a task');

select is(has_function_privilege('anon', 'public.admin_list_tasks(uuid, text, text, text, text, integer, timestamptz, uuid, integer)', 'execute'), false,
  'anon has no EXECUTE on the task API');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000720001", "role": "authenticated"}';
select is(jsonb_array_length(public.admin_list_tasks('50000000-0000-4000-8000-000000720001') -> 'items'), 4,
  'ADMIN sees every active task of the Edition (attendance, 2 integrity, race day)');
select is(public.admin_list_tasks('50000000-0000-4000-8000-000000720001') -> 'items' -> 0 ->> 'blocking_level', 'CLOSURE_BLOCKER',
  'blockers come first');
select is(public.admin_list_tasks('50000000-0000-4000-8000-000000720001') -> 'counts' -> 'active_by_blocking_level' ->> 'CLOSURE_BLOCKER', '2',
  'counts report the active tasks per blocking level');
select is(pg_temp.err($$ select public.admin_list_tasks('50000000-0000-4000-8000-000000720999') $$) ->> 'code', 'NOT_FOUND',
  'an unknown Edition is NOT_FOUND');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000720003", "role": "authenticated"}';
select is(jsonb_array_length(public.admin_list_tasks('50000000-0000-4000-8000-000000720001') -> 'items'), 1,
  'CHECKIN sees only race-day tasks');
select is(public.admin_list_tasks('50000000-0000-4000-8000-000000720001') -> 'items' -> 0 ->> 'category', 'RACE_DAY', 'and it is the race-day one');
select is(pg_temp.err($$ select public.admin_get_task(pg_temp.tid($t$task_key = 'attendance-finalization:50000000-0000-4000-8000-000000720001'$t$)) $$) ->> 'code',
  'NOT_FOUND', 'a task outside the role view is indistinguishable from a missing one');
select is(pg_temp.err($$ select public.start_admin_task(pg_temp.tid($t$category = 'RACE_DAY'$t$)) $$) ->> 'code',
  'FORBIDDEN', 'CHECKIN reads but cannot start tasks');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000720004", "role": "authenticated"}';
select is(jsonb_array_length(public.admin_list_tasks() -> 'items'), 0, 'MODERATOR sees no operational task');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000720005", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_tasks('50000000-0000-4000-8000-000000720001') $$) ->> 'code', 'FORBIDDEN',
  'an OPERATOR scoped to another Edition cannot list this Edition (SEC-020)');
select is(jsonb_array_length(public.admin_list_tasks() -> 'items'), 0, 'its unscoped list contains only its own Edition (none here)');
select is(pg_temp.err($$ select public.start_admin_task(pg_temp.tid($t$task_key = 'attendance-finalization:50000000-0000-4000-8000-000000720001'$t$)) $$) ->> 'code',
  'FORBIDDEN', 'nor can it start a task of this Edition (scope derived from the task row)');
select is(pg_temp.err($$ select public.refresh_admin_tasks('50000000-0000-4000-8000-000000720001') $$) ->> 'code', 'FORBIDDEN',
  'nor refresh it');

-- ===========================================================================================
-- STAFF API: list filters and pagination
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000720002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_tasks(null, 'NOPE') $$) -> 'detail' ->> 'field', 'status', 'an unknown status filter is a validation error');
select is(pg_temp.err($$ select public.admin_list_tasks(null, null, null, 'NOPE') $$) -> 'detail' ->> 'field', 'blocking_level',
  'an unknown blocking level is a validation error');
select is(pg_temp.err($$ select public.admin_list_tasks(null, null, null, null, 'EVERYONE') $$) -> 'detail' ->> 'field', 'assigned',
  'an unknown assigned filter is a validation error');
select is(jsonb_array_length(public.admin_list_tasks('50000000-0000-4000-8000-000000720001', null, 'INTEGRITY') -> 'items'), 2,
  'filter by category');
select is(jsonb_array_length(public.admin_list_tasks('50000000-0000-4000-8000-000000720001', null, null, 'ACTION_REQUIRED') -> 'items'), 2,
  'filter by blocking level');
select is(jsonb_array_length(public.admin_list_tasks('50000000-0000-4000-8000-000000720001', null, null, null, 'UNASSIGNED') -> 'items'), 4,
  'filter unassigned');
select is(jsonb_array_length(public.admin_list_tasks('50000000-0000-4000-8000-000000720001', null, null, null, 'ME') -> 'items'), 0,
  'filter assigned to me (none yet)');
select is(jsonb_array_length(public.admin_list_tasks(null, 'RESOLVED') -> 'items'), 1,
  'status RESOLVED lists the provider task the system resolved (all editions)');
select is(jsonb_array_length(public.admin_list_tasks(null, 'ALL') -> 'items') >= 5, true, 'status ALL lists everything');

insert into ids select 'page1', public.admin_list_tasks('50000000-0000-4000-8000-000000720001', null, null, null, null, null, null, null, 3);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'page1')), 3, 'a page honours the limit');
select ok((select value -> 'next_cursor' from ids where name = 'page1') is not null, 'and returns a cursor when more rows exist');
insert into ids select 'page2', public.admin_list_tasks('50000000-0000-4000-8000-000000720001', null, null, null, null,
  ((select value -> 'next_cursor' ->> 'rank' from ids where name = 'page1'))::int,
  ((select value -> 'next_cursor' ->> 'detected_at' from ids where name = 'page1'))::timestamptz,
  ((select value -> 'next_cursor' ->> 'id' from ids where name = 'page1'))::uuid, 3);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'page2')), 1, 'the second page holds the remainder');
select is((select value -> 'next_cursor' from ids where name = 'page2') = 'null'::jsonb, true, 'and no further cursor');
select is((select count(distinct i ->> 'admin_task_id') from ids, jsonb_array_elements(value -> 'items') i where name in ('page1', 'page2')), 4::bigint,
  'the two pages are disjoint and complete');

-- ===========================================================================================
-- STAFF API: start / assign / resolve / waive
-- ===========================================================================================
insert into ids values
  ('att', to_jsonb(pg_temp.tid($t$task_key = 'attendance-finalization:50000000-0000-4000-8000-000000720001'$t$))),
  ('warn', to_jsonb(pg_temp.tid($t$task_key like '%:60000000-0000-4000-8000-000000720002'$t$))),
  ('blocker', to_jsonb(pg_temp.tid($t$task_key like '%:60000000-0000-4000-8000-000000720001'$t$))),
  ('race', to_jsonb(pg_temp.tid($t$category = 'RACE_DAY'$t$)));

select is(public.admin_get_task((select (value #>> '{}')::uuid from ids where name = 'att')) ->> 'source_holds', 'true',
  'get reports whether the root condition still holds');
select is(pg_temp.err($$ select public.admin_get_task('90000000-0000-4000-8000-000000720999') $$) ->> 'code', 'NOT_FOUND', 'an unknown task is NOT_FOUND');

insert into ids select 'started', public.start_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'), 'p720-start-key-0001');
select is((select value ->> 'status' from ids where name = 'started'), 'IN_PROGRESS', 'start moves OPEN to IN_PROGRESS');
select is((select value ->> 'assigned_staff_id' from ids where name = 'started'), '20000000-0000-4000-8000-000000720002',
  'the starter takes the task when it was unassigned');
select ok((select value ->> 'started_at' from ids where name = 'started') is not null, 'started_at is recorded');
select is(public.start_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'), 'p720-start-key-0001'),
  (select value from ids where name = 'started'), 'the same key replays the stored response');
select is(pg_temp.err($$ select public.start_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'), 'p720-start-key-0002') $$)
  -> 'detail' ->> 'reason', 'invalid_transition', 'starting an IN_PROGRESS task with another key is an invalid transition');
select is(jsonb_array_length(public.admin_list_tasks('50000000-0000-4000-8000-000000720001', null, null, null, 'ME') -> 'items'), 1,
  'the started task is listed under "assigned to me"');

select is(pg_temp.err($$ select public.assign_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'),
  '20000000-0000-4000-8000-000000720007', null, 'p720-assign-key-0001') $$) -> 'detail' ->> 'field', 'assignee_id',
  'a REVOKED staff member cannot be assigned');
select is(pg_temp.err($$ select public.assign_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'),
  '20000000-0000-4000-8000-000000720005', null, 'p720-assign-key-0002') $$) -> 'detail' ->> 'field', 'assignee_id',
  'a staff member scoped to another Edition cannot be assigned');
select is(pg_temp.err($$ select public.assign_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'), null, 'JANITOR') $$)
  -> 'detail' ->> 'field', 'assigned_role', 'an unknown role is a validation error');
select is(public.assign_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'),
  '20000000-0000-4000-8000-000000720001', 'ADMIN', 'p720-assign-key-0003') ->> 'assigned_staff_id', '20000000-0000-4000-8000-000000720001',
  'assign moves the task to another staff member of the Edition');

-- CLOSURE_BLOCKER: the root decides, not the task row.
select is(pg_temp.err($$ select public.resolve_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'), 'ya lo hice', 'p720-resolve-key-0001') $$)
  -> 'detail' ->> 'reason', 'source_condition_open', 'a CLOSURE_BLOCKER cannot be resolved while attendance is not finalized');
select is(pg_temp.err($$ select public.waive_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'), 'no aplica', 'p720-waive-key-0001') $$)
  -> 'detail' ->> 'reason', 'source_condition_open', 'nor waived');
select is(pg_temp.err($$ select public.waive_admin_task((select (value #>> '{}')::uuid from ids where name = 'blocker'), 'no aplica', 'p720-waive-key-0002') $$)
  -> 'detail' ->> 'reason', 'source_condition_open', 'a blocking integrity case blocks resolve and waive while it is OPEN');
select is(pg_temp.err($$ select public.resolve_admin_task((select (value #>> '{}')::uuid from ids where name = 'att'), '   ') $$) -> 'detail' ->> 'field', 'reason',
  'a reason is mandatory');
select is(pg_temp.sv($q$ select status from app.admin_task where task_key = 'attendance-finalization:50000000-0000-4000-8000-000000720001' $q$), 'IN_PROGRESS', 'a refused resolve changed nothing');

-- A non-blocking task can be resolved or waived by staff with a reason.
select is(public.resolve_admin_task((select (value #>> '{}')::uuid from ids where name = 'warn'), 'Revisado, fecha correcta', 'p720-resolve-key-0002') ->> 'resolution_type',
  'MANUAL', 'a non-blocking task is resolved by staff');
select is(pg_temp.sv($q$ select status || '/' || resolution_reason from app.admin_task where task_key like '%:60000000-0000-4000-8000-000000720002' $q$),
  'RESOLVED/Revisado, fecha correcta', 'with the reason recorded');
select is(pg_temp.err($$ select public.resolve_admin_task((select (value #>> '{}')::uuid from ids where name = 'warn'), 'otra vez', 'p720-resolve-key-0003') $$)
  -> 'detail' ->> 'reason', 'invalid_transition', 'a RESOLVED task cannot be resolved again');
select is(public.waive_admin_task((select (value #>> '{}')::uuid from ids where name = 'race'), 'Falsa alarma del escáner', 'p720-waive-key-0003') ->> 'status',
  'WAIVED', 'a non-blocking task can be waived');

-- Sync never re-raises what staff resolved or waived while its condition still holds.
reset role;
select private.admin_tasks_sync('50000000-0000-4000-8000-000000720001');
select is(pg_temp.sv($q$ select status from app.admin_task where task_key like '%:60000000-0000-4000-8000-000000720002' $q$), 'RESOLVED',
  'a task staff resolved is not re-raised while the case is still open');
select is(pg_temp.sv($q$ select status from app.admin_task where category = 'RACE_DAY' $q$), 'WAIVED', 'a waived task stays waived');

-- ===========================================================================================
-- Sources clear: the system resolves, staff can then close, and recurrence reopens
-- ===========================================================================================
update app.community_integrity_case set status = 'RESOLVED', resolved_at = now(), resolution = 'ok'
where community_integrity_case_id = '60000000-0000-4000-8000-000000720001';
select is(pg_temp.sv($q$ select status from app.admin_task where task_key like '%:60000000-0000-4000-8000-000000720001' $q$), 'OPEN',
  'the projection does not change until the sync recomputes it (never the source of truth)');
select is(pg_temp.err($$ select 1 $$), null, 'sanity: helper returns null without an error');
select private.admin_tasks_sync('50000000-0000-4000-8000-000000720001');
select is(pg_temp.sv($q$ select status || '/' || resolution_type from app.admin_task where task_key like '%:60000000-0000-4000-8000-000000720001' $q$),
  'RESOLVED/CONDITION_CLEARED', 'a closed integrity case clears its task');
update app.community_integrity_case set status = 'OPEN', resolved_at = null, resolution = null
where community_integrity_case_id = '60000000-0000-4000-8000-000000720001';
select private.admin_tasks_sync('50000000-0000-4000-8000-000000720001');
select is(pg_temp.sv($q$ select status from app.admin_task where task_key like '%:60000000-0000-4000-8000-000000720001' $q$), 'OPEN',
  'a recurrence after the condition had cleared reopens the task');
update app.community_integrity_case set status = 'RESOLVED', resolved_at = now(), resolution = 'ok'
where edition_id = '50000000-0000-4000-8000-000000720001';
select private.admin_tasks_sync('50000000-0000-4000-8000-000000720001');

-- Finalize (empty universe) as ADMIN: the attendance task clears and the closure task opens.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000720001", "role": "authenticated"}';
select is(public.finalize_attendance('50000000-0000-4000-8000-000000720001', false, null, 'p720-finalize-key-0001') ->> 'status', 'FINALIZED',
  'attendance is finalized through the real command');
reset role;
select is(pg_temp.sv($q$ select status from app.admin_task where task_key = 'attendance-finalization:50000000-0000-4000-8000-000000720001' $q$), 'IN_PROGRESS',
  'the task still shows the old state until the next sync');
select private.admin_tasks_sync('50000000-0000-4000-8000-000000720001');
select is(pg_temp.sv($q$ select status || '/' || resolution_type from app.admin_task where task_key = 'attendance-finalization:50000000-0000-4000-8000-000000720001' $q$), 'RESOLVED/CONDITION_CLEARED',
  'an in-progress CLOSURE_BLOCKER whose source cleared is resolved by the system');
select is(pg_temp.sv($q$ select blocking_level || '/' || status || '/' || (metadata ->> 'ready') from app.admin_task
  where task_key = 'closure-pending:50000000-0000-4000-8000-000000720001' $q$), 'ACTION_REQUIRED/OPEN/true',
  'closure-pending opens with the P3-C readiness in its metadata');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000720001", "role": "authenticated"}';
select is(public.refresh_admin_tasks('50000000-0000-4000-8000-000000720001', 'p720-refresh-key-0001') ->> 'edition_id', '50000000-0000-4000-8000-000000720001',
  'staff can refresh one Edition on demand');
select is(public.close_edition('50000000-0000-4000-8000-000000720001', 'p720-close-key-0001') ->> 'status', 'CLOSED', 'the Edition is closed through the real command');
select is(public.refresh_admin_tasks('50000000-0000-4000-8000-000000720001', 'p720-refresh-key-0002') ->> 'cleared', '1', 'refresh clears the closure task');
reset role;
select is(pg_temp.sv($q$ select status from app.admin_task where task_key = 'closure-pending:50000000-0000-4000-8000-000000720001' $q$), 'RESOLVED',
  'once the Edition is CLOSED the closure task is resolved');

-- ===========================================================================================
-- Audit, idempotency records, cron
-- ===========================================================================================
select is(pg_temp.sv($q$ select string_agg(action, ',' order by action) from (select distinct action from audit.audit_log
  where entity_type = 'admin_task' and entity_id in (select admin_task_id from app.admin_task where edition_id = '50000000-0000-4000-8000-000000720001')) a $q$),
  'ADMIN_TASK_ASSIGNED,ADMIN_TASK_RESOLVED,ADMIN_TASK_STARTED,ADMIN_TASK_WAIVED', 'every staff transition is audited');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'ADMIN_TASK_RESOLVED' and reason = 'Revisado, fecha correcta'
  and actor_staff_member_id = '20000000-0000-4000-8000-000000720002' $q$), '1', 'the audit row carries the actor and the reason');
select is(pg_temp.sv($q$ select count(*) from infra.idempotency_record where operation_key like 'tasks.%' and actor_auth_user_id is not null $q$),
  '6', 'one idempotency record per successful command (start, assign, resolve, waive, refresh x2); refused commands leave none');
select is(pg_temp.sv($q$ select schedule from cron.job where jobname = 'admin-task-sync' $q$), '*/5 * * * *', 'the sync is scheduled every 5 minutes');
select is(pg_temp.sv($q$ select command from cron.job where jobname = 'admin-task-sync' $q$), 'select private.worker_admin_tasks_sync()',
  'as a SQL-only job (no HTTP worker)');
select is(private.worker_admin_tasks_sync() ? 'worker_run_id', true, 'the worker records a run');
select is(pg_temp.sv($q$ select status from infra.worker_run where worker_key = 'admin-task-sync' order by started_at desc limit 1 $q$), 'SUCCEEDED',
  'which succeeded');

select * from finish();
rollback;
