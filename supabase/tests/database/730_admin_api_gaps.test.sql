-- P3-L admin API gaps (P3-AC-06, P3-AC-13, P3-AC-15): the Events catalogue and Event read projection (incl. Events without Editions,
-- scope by role/Edition), the optimistic-concurrency guard on Edition edits and transitions (stale state = CONFLICT STALE_STATE,
-- no change, authorise before disclosing, idempotent replay is not stale, plain commands unchanged) and the idempotent anti-hoarding
-- policy update. Within one transaction now() is constant, so staleness is proven against fixed past tokens (fixture updated_at is
-- explicit); true concurrent races are covered by the integration suite. Synthetic ids in a 730 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(79);

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

-- ---------------------------------------------------------------------------------------------
-- Fixture. Staff: ADMIN, OPERATOR (global), CHECKIN, OPERATOR scoped to E2; a buyer without staff role.
-- Ev1: E1 (DRAFT) + E2 (PUBLISHED). Ev2: no Edition. Ev3 (ARCHIVED): E3 (PUBLISHED). Editions carry an explicit past updated_at (T0).
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000730011', 'p730-admin@example.test'), ('00000000-0000-4000-8000-000000730012', 'p730-operator@example.test'),
  ('00000000-0000-4000-8000-000000730013', 'p730-checkin@example.test'), ('00000000-0000-4000-8000-000000730014', 'p730-operator-e2@example.test'),
  ('00000000-0000-4000-8000-000000730015', 'p730-buyer@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000730011', '00000000-0000-4000-8000-000000730011', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000730012', '00000000-0000-4000-8000-000000730012', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000730013', '00000000-0000-4000-8000-000000730013', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000730014', '00000000-0000-4000-8000-000000730014', 'ACTIVE');
insert into app.event (event_id, event_type_id, name, canonical_key, status)
select v.id::uuid, et.event_type_id, v.name, v.ck, v.st
from app.event_type et,
  (values ('40000000-0000-4000-8000-000000730001', 'Evento Uno 730', 'p730-uno', 'ACTIVE'),
          ('40000000-0000-4000-8000-000000730002', 'Evento Vacio 730', 'p730-vacio', 'ACTIVE'),
          ('40000000-0000-4000-8000-000000730003', 'Evento Tres 730', 'p730-tres', 'ARCHIVED')) v(id, name, ck, st)
where et.key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, registration_mode,
  timezone, registration_close_at, city, state_region, country_code, published_at, created_at, updated_at)
values
  ('50000000-0000-4000-8000-000000730001', '40000000-0000-4000-8000-000000730001', 'p730-e1', 'E1 draft', 'DRAFT', 'SCHEDULED', 'NOT_OPEN', 'FREE',
   'America/Monterrey', now() + interval '60 days', 'Monterrey', 'NL', 'MX', null, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('50000000-0000-4000-8000-000000730002', '40000000-0000-4000-8000-000000730001', 'p730-e2', 'E2 publicada', 'PUBLISHED', 'SCHEDULED', 'NOT_OPEN', 'FREE',
   'America/Monterrey', now() + interval '60 days', 'Monterrey', 'NL', 'MX', now(), '2026-01-02 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('50000000-0000-4000-8000-000000730003', '40000000-0000-4000-8000-000000730003', 'p730-e3', 'E3 publicada', 'PUBLISHED', 'SCHEDULED', 'NOT_OPEN', 'FREE',
   'America/Monterrey', now() + interval '60 days', 'Monterrey', 'NL', 'MX', now(), '2026-01-03 00:00:00+00', '2026-01-01 00:00:00+00');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000730011', 'ADMIN', 'GLOBAL', null), ('20000000-0000-4000-8000-000000730012', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000730013', 'CHECKIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000730014', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000730002');

-- ===========================================================================================
-- Grants: API roles reach only the facades they are meant to
-- ===========================================================================================
select ok(not has_function_privilege('anon', 'public.admin_list_events(text, text, text, timestamptz, uuid, integer)', 'execute'), 'anon cannot list Events');
select ok(not has_function_privilege('anon', 'public.admin_get_event(uuid)', 'execute'), 'anon cannot read an Event');
select ok(not has_function_privilege('anon', 'public.guarded_edition_command(uuid, text, timestamptz, jsonb, text)', 'execute'), 'anon cannot run guarded commands');
select ok(not has_function_privilege('anon', 'public.update_anti_hoarding_policy_idempotent(jsonb, text)', 'execute'), 'anon cannot update the policy');
select ok(has_function_privilege('authenticated', 'public.guarded_edition_command(uuid, text, timestamptz, jsonb, text)', 'execute'), 'authenticated reaches the guard (it authorises inside)');
select ok(not has_function_privilege('authenticated', 'private.event_visible(uuid)', 'execute'), 'the visibility helper has no API grant');
select ok(not has_function_privilege('service_role', 'public.guarded_edition_command(uuid, text, timestamptz, jsonb, text)', 'execute'), 'service_role has no grant either (no actor)');

-- ===========================================================================================
-- Events catalogue
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730011", "role": "authenticated"}';
select is(jsonb_array_length(public.admin_list_events(p_search => 'p730') -> 'items'), 3, 'ADMIN: the catalogue lists the 3 Events, including the one with no Edition');
select is(public.admin_list_events(p_search => 'p730-vacio') -> 'items' -> 0 ->> 'edition_count', '0', 'an Event without Editions has edition_count 0');
select is(public.admin_list_events(p_search => 'p730-vacio') -> 'items' -> 0 -> 'latest_edition_created_at', 'null'::jsonb, '... and no latest Edition date');
select is(public.admin_list_events(p_search => 'p730-uno') -> 'items' -> 0 ->> 'edition_count', '2', 'Ev1 counts its 2 Editions');
select is(public.admin_list_events(p_search => 'p730-uno') -> 'items' -> 0 ->> 'event_type_key', 'ROAD_RACE', 'the type key is readable');
select is(public.admin_list_events(p_search => 'p730-uno') -> 'items' -> 0 ->> 'canonical_key', 'p730-uno', 'the canonical key is readable');
select is(public.admin_list_events(p_search => 'p730-uno') -> 'items' -> 0 ->> 'status', 'ACTIVE', 'the status is readable');
select is(public.admin_list_events(p_search => 'Evento Vacio') -> 'items' -> 0 ->> 'canonical_key', 'p730-vacio', 'search by name (accent/case-insensitive normaliser)');
select is(jsonb_array_length(public.admin_list_events(p_search => 'p730', p_status => 'ARCHIVED') -> 'items'), 1, 'status filter ARCHIVED');
select is(public.admin_list_events(p_search => 'p730', p_status => 'ARCHIVED') -> 'items' -> 0 ->> 'canonical_key', 'p730-tres', '... returns the archived Event');
select is(jsonb_array_length(public.admin_list_events(p_search => 'p730', p_event_type_key => 'NO_SUCH_TYPE') -> 'items'), 0, 'type filter narrows to nothing for an unknown type');
select is(pg_temp.err($$ select public.admin_list_events(p_status => 'DELETED') $$) -> 'detail' ->> 'field', 'status', 'invalid status is a validation error');
select is(pg_temp.err($$ select public.admin_list_events(p_event_type_key => 'bad key!') $$) -> 'detail' ->> 'field', 'event_type_key', 'invalid type key is a validation error');
select is(jsonb_array_length(public.admin_list_events(p_search => 'p730', p_limit => 2) -> 'items'), 2, 'limit 2 returns 2');
select isnt(public.admin_list_events(p_search => 'p730', p_limit => 2) -> 'next_cursor', 'null'::jsonb, '... with a next cursor');
select is(jsonb_array_length(public.admin_list_events(p_search => 'p730', p_limit => 2,
  p_cursor_created_at => (public.admin_list_events(p_search => 'p730', p_limit => 2) -> 'next_cursor' ->> 'created_at')::timestamptz,
  p_cursor_id => (public.admin_list_events(p_search => 'p730', p_limit => 2) -> 'next_cursor' ->> 'event_id')::uuid) -> 'items'), 1,
  'the cursor continues with the remaining Event');

-- Scope
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730012", "role": "authenticated"}';
select is(jsonb_array_length(public.admin_list_events(p_search => 'p730') -> 'items'), 3, 'global OPERATOR sees every Event (EVENT_CONTENT_MANAGE)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730014", "role": "authenticated"}';
select is(jsonb_array_length(public.admin_list_events(p_search => 'p730') -> 'items'), 1, 'EDITION-scoped OPERATOR sees only the Event of their Edition');
select is(public.admin_list_events(p_search => 'p730') -> 'items' -> 0 ->> 'canonical_key', 'p730-uno', '... Ev1');
select is(public.admin_list_events(p_search => 'p730') -> 'items' -> 0 ->> 'edition_count', '1', '... counting only the Editions they can manage');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730013", "role": "authenticated"}';
select is(jsonb_array_length(public.admin_list_events(p_search => 'p730') -> 'items'), 0, 'CHECKIN gets an empty catalogue, not an error');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730015", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_events() $$) ->> 'code', 'FORBIDDEN', 'a user without a staff role is FORBIDDEN');

-- ===========================================================================================
-- Event read projection
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730011", "role": "authenticated"}';
select is(public.admin_get_event('40000000-0000-4000-8000-000000730001') ->> 'event_type_key', 'ROAD_RACE', 'get: type key');
select is(public.admin_get_event('40000000-0000-4000-8000-000000730001') ->> 'canonical_key', 'p730-uno', 'get: canonical key');
select is(public.admin_get_event('40000000-0000-4000-8000-000000730003') ->> 'status', 'ARCHIVED', 'get: status');
select is(public.admin_get_event('40000000-0000-4000-8000-000000730001') ->> 'edition_count', '2', 'get: edition count');
select is(public.admin_get_event('40000000-0000-4000-8000-000000730001') -> 'editions' -> 0 ->> 'slug', 'p730-e2', 'get: Editions newest first');
select is(public.admin_get_event('40000000-0000-4000-8000-000000730001') -> 'editions' -> 1 ->> 'updated_at', '2026-01-01T00:00:00+00:00', 'get: each Edition carries its updated_at version');
select is(public.admin_get_event('40000000-0000-4000-8000-000000730002') -> 'editions', '[]'::jsonb, 'get: an Event without Editions has an empty array');
select is(pg_temp.err($$ select public.admin_get_event('40000000-0000-4000-8000-0000007309ff') $$) ->> 'code', 'NOT_FOUND', 'get: unknown Event is NOT_FOUND');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730014", "role": "authenticated"}';
select is(jsonb_array_length(public.admin_get_event('40000000-0000-4000-8000-000000730001') -> 'editions'), 1, 'get as EDITION-scoped OPERATOR: only their Edition');
select is(pg_temp.err($$ select public.admin_get_event('40000000-0000-4000-8000-000000730002') $$) ->> 'code', 'FORBIDDEN', 'get: an Event outside their scope is FORBIDDEN');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730013", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_get_event('40000000-0000-4000-8000-000000730001') $$) ->> 'code', 'FORBIDDEN', 'get: CHECKIN is FORBIDDEN');

-- ===========================================================================================
-- Optimistic concurrency: Edition edit (E1, DRAFT)
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730012", "role": "authenticated"}';
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', null, '{"name": "x"}') $$) -> 'detail' ->> 'reason',
  'required', 'the guard needs a token');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'EXPLODE', '2026-01-01T00:00:00+00:00', '{}') $$) -> 'detail' ->> 'field',
  'command', 'an unknown command is refused');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-0000007309ff', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "x"}') $$) ->> 'code',
  'NOT_FOUND', 'an unknown Edition is NOT_FOUND');
select is(public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "Uno"}') ->> 'name', 'Uno',
  'a fresh token lets the OPERATOR edit');
select isnt(pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000730001' $$), '2026-01-01 00:00:00+00',
  'and the version moved');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "Dos"}') $$) ->> 'code',
  'CONFLICT', 'the same (now stale) token is a CONFLICT');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "Dos"}') $$) -> 'detail' ->> 'reason',
  'STALE_STATE', '... with reason STALE_STATE');
select isnt(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "Dos"}') $$) -> 'detail' ->> 'current_updated_at',
  null, '... and the current version so the client can refetch');
select is(pg_temp.sv($$ select name from app.edition where edition_id = '50000000-0000-4000-8000-000000730001' $$), 'Uno', 'a stale refusal changes nothing');
select is(public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE',
  (pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000730001' $$))::timestamptz, '{"name": "Tres"}') ->> 'name', 'Tres',
  'the re-read token works');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', '2025-06-01T00:00:00+00:00', '{"registration_close_at": "2027-01-01T00:00:00+00:00"}') $$) ->> 'code',
  'FORBIDDEN', 'a lifecycle field needs the lifecycle permission BEFORE staleness is revealed');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', '2025-06-01T00:00:00+00:00', '{"registration_close_at": "2027-01-01T00:00:00+00:00"}') $$) -> 'detail' ->> 'current_updated_at',
  null, '... and no version leaks in that refusal');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "x"}', 'p730-no-idem-key') $$) -> 'detail' ->> 'reason',
  'unsupported', 'edits take no Idempotency-Key');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'SET_SCHEDULE', '2026-01-01T00:00:00+00:00', '{"local_date": "2027-03-01"}') $$) -> 'detail' ->> 'reason',
  'STALE_STATE', 'the schedule command is guarded too');
select is(public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'SET_SCHEDULE',
  (pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000730001' $$))::timestamptz, '{"local_date": "2027-03-01"}') ->> 'changed', 'true',
  '... and accepts a fresh token');
select is(public.update_edition('50000000-0000-4000-8000-000000730001', '{"name": "Cuatro"}') ->> 'name', 'Cuatro', 'without a token the plain command is unchanged (last write wins)');

-- Authority of the guard
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730013", "role": "authenticated"}';
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730001', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "x"}') $$) ->> 'code',
  'FORBIDDEN', 'CHECKIN cannot use the guard');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730014", "role": "authenticated"}';
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730003', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "x"}') $$) ->> 'code',
  'FORBIDDEN', 'an Edition-scoped OPERATOR cannot use it on another Edition');
select is(public.guarded_edition_command('50000000-0000-4000-8000-000000730002', 'UPDATE', '2026-01-01T00:00:00+00:00', '{"name": "E2 editada"}') ->> 'name', 'E2 editada',
  '... but can on their own');

-- ===========================================================================================
-- Optimistic concurrency: transition (E2, PUBLISHED -> HIDDEN) and idempotent replay
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730012", "role": "authenticated"}';
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730002', 'HIDE', '2026-01-01T00:00:00+00:00', '{"reason": "x"}', 'p730-hide-key-op') $$) ->> 'code',
  'FORBIDDEN', 'an OPERATOR cannot publish/hide through the guard');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730011", "role": "authenticated"}';
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730003', 'HIDE', '2025-01-01T00:00:00+00:00', '{"reason": "x"}', 'p730-hide-key-st') $$) -> 'detail' ->> 'reason',
  'STALE_STATE', 'a stale transition is refused');
select is(pg_temp.sv($$ select publication_state from app.edition where edition_id = '50000000-0000-4000-8000-000000730003' $$), 'PUBLISHED', '... and nothing moved');
select is(pg_temp.sv($$ select count(*)::text from infra.idempotency_record where idempotency_key = 'p730-hide-key-st' $$), '0', '... and no idempotency record was left behind');
select is(public.guarded_edition_command('50000000-0000-4000-8000-000000730003', 'HIDE', '2026-01-01T00:00:00+00:00', '{"reason": "ocultar"}', 'p730-hide-key-01') -> 'edition' ->> 'publication_state',
  'HIDDEN', 'a fresh token runs the transition');
select is(public.guarded_edition_command('50000000-0000-4000-8000-000000730003', 'HIDE', '2026-01-01T00:00:00+00:00', '{"reason": "ocultar"}', 'p730-hide-key-01') -> 'edition' ->> 'publication_state',
  'HIDDEN', 'the replay of a completed key returns the stored result even though the old token is now stale');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730003', 'HIDE', '2026-01-01T00:00:00+00:00', '{"reason": "ocultar"}', 'p730-hide-key-02') $$) -> 'detail' ->> 'reason',
  'STALE_STATE', 'a NEW key with the stale token is stale, not an invalid transition');
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730003', 'HIDE', '2026-01-01T00:00:00+00:00', '{"reason": "otra"}', 'p730-hide-key-01') $$) ->> 'code',
  'IDEMPOTENCY_CONFLICT', 'the same key with another body is still an IDEMPOTENCY_CONFLICT');
select is(pg_temp.err(format($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000730003', 'HIDE', %L::timestamptz, '{"reason": "otra vez"}', 'p730-hide-key-03') $$,
  pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000730003' $$))) -> 'detail' ->> 'reason',
  'invalid_transition', 'with a fresh token the state machine still answers invalid_transition (the guard adds, never replaces, the checks)');

-- ===========================================================================================
-- Anti-hoarding policy: idempotent update
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730012", "role": "authenticated"}';
select is(pg_temp.err($$ select public.update_anti_hoarding_policy_idempotent('{"captcha_new_account_hours": 12}', 'p730-policy-op-01') $$) ->> 'code',
  'FORBIDDEN', 'an OPERATOR cannot update the policy');
select is(pg_temp.err($$ select public.admin_get_anti_hoarding_policy() $$) ->> 'code', 'FORBIDDEN', '... nor read it (PLATFORM_SETTINGS_MANAGE is ADMIN only)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000730011", "role": "authenticated"}';
select is(pg_temp.err($$ select public.update_anti_hoarding_policy_idempotent('{"captcha_new_account_hours": 12}', null) $$) -> 'detail' ->> 'header', 'Idempotency-Key', 'the key is required');
select is(pg_temp.err($$ select public.update_anti_hoarding_policy_idempotent('{"captcha_new_account_hours": 12}', 'short') $$) -> 'detail' ->> 'reason', 'invalid_format', '... and validated');
select is(pg_temp.err($$ select public.update_anti_hoarding_policy_idempotent('{"captcha_new_account_hours": 0}', 'p730-policy-key-bad') $$) -> 'detail' ->> 'field',
  'captcha_new_account_hours', 'values are range-validated');
select is(pg_temp.sv($$ select count(*)::text from infra.idempotency_record where idempotency_key = 'p730-policy-key-bad' $$), '0', '... and a refused update leaves no record');
select set_config('p730.audit_before', pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'ANTI_HOARDING_POLICY_UPDATED' $$), true);
select is(public.update_anti_hoarding_policy_idempotent('{"captcha_new_account_hours": 12}', 'p730-policy-key-01') ->> 'captcha_new_account_hours', '12', 'ADMIN updates the policy');
select is(public.admin_get_anti_hoarding_policy() ->> 'captcha_new_account_hours', '12', '... and reads it back');
select is(public.update_anti_hoarding_policy_idempotent('{"captcha_new_account_hours": 12}', 'p730-policy-key-01') ->> 'captcha_new_account_hours', '12', 'the replay returns the stored policy');
select is(pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'ANTI_HOARDING_POLICY_UPDATED' $$)::int - current_setting('p730.audit_before')::int, 1, '... and audited exactly once');
select is(pg_temp.err($$ select public.update_anti_hoarding_policy_idempotent('{"captcha_new_account_hours": 13}', 'p730-policy-key-01') $$) ->> 'code', 'IDEMPOTENCY_CONFLICT', 'the same key with another body conflicts');

select * from finish();
rollback;
