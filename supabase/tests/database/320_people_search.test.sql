-- T33 People search (Master §23, §121, §179; ADR-001 A10; SEC-008/120/141).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(27);

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

-- (suffix, full_name, readiness, state, visible, searchable, competition, minor-by-dob)
create temp table people_fixture (s text, full_name text, readiness text, state text, visible boolean,
  searchable boolean, competition text, minor boolean) on commit drop;
insert into people_fixture values
  ('01', 'Buscador Principal', 'READY', 'ACTIVE', true, true, 'ELIGIBLE', false),
  ('02', 'José  Ñúñez', 'READY', 'ACTIVE', true, true, 'ELIGIBLE', false),
  ('03', 'Jose Nunez Dos', 'READY', 'ACTIVE', true, true, 'ELIGIBLE', false),
  ('04', 'Ana López', 'READY', 'ACTIVE', true, true, 'ELIGIBLE', false),
  ('05', 'Mario Suspended', 'READY', 'ACTIVE', true, true, 'SUSPENDED', false),
  ('06', 'Mario Invisible', 'READY', 'ACTIVE', false, true, 'ELIGIBLE', false),
  ('07', 'Mario Baneado', 'READY', 'BANNED', true, true, 'ELIGIBLE', false),
  ('08', 'Mario Bloqueado', 'READY', 'IDENTITY_LOCKED', true, true, 'ELIGIBLE', false),
  ('09', 'Mario Desactivado', 'READY', 'DEACTIVATED', true, true, 'ELIGIBLE', false),
  ('10', 'Mario Nosearch', 'READY', 'ACTIVE', true, false, 'ELIGIBLE', false),
  ('11', 'Mario Menor', 'READY', 'ACTIVE', true, false, 'MINOR_NONCOMPETITIVE', true),
  ('12', 'Mario Menor Mal Marcado', 'READY', 'ACTIVE', true, true, 'ELIGIBLE', true),
  ('13', 'Mario Identidad Bloqueada', 'READY', 'ACTIVE', true, true, 'ELIGIBLE', false),
  ('14', 'Mario Incompleto', 'PROFILE_INCOMPLETE', 'ACTIVE', true, true, 'ELIGIBLE', false),
  ('15', 'Roberto Secreto', 'READY', 'ACTIVE', true, true, 'ELIGIBLE', false),
  ('16', 'Limite Cuota', 'READY', 'ACTIVE', true, true, 'ELIGIBLE', false),
  ('17', 'Buscador Baneado', 'READY', 'BANNED', true, true, 'ELIGIBLE', false);
insert into people_fixture
select lpad((100 + g)::text, 3, '0'), 'Paginado ' || lpad(g::text, 2, '0'), 'READY', 'ACTIVE', true, true, 'ELIGIBLE', false
from generate_series(1, 25) g;

insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000332' || lpad(s, 3, '0'))::uuid, 'people-s-' || s || '@example.test' from people_fixture;
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-000000332' || lpad(s, 3, '0'))::uuid, ('00000000-0000-4000-8000-000000332' || lpad(s, 3, '0'))::uuid,
  readiness, state, full_name,
  case when minor then (current_date - interval '16 years')::date else date '1990-01-01' end,
  'F', '+528119990001', 'Contacto Emergencia', '+528119990002', 'Madre',
  case when readiness = 'READY' then now() end
from people_fixture;
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible, is_searchable,
  verified_distance_projection_m, verified_participation_count)
select ('10000000-0000-4000-8000-000000332' || lpad(s, 3, '0'))::uuid, ('c0000000-0000-4000-8000-000000332' || lpad(s, 3, '0'))::uuid,
  competition, visible, searchable, 42195, 3
from people_fixture;
update app.community_profile set display_name = 'Alias Corredor'
where runner_profile_id = '10000000-0000-4000-8000-000000332015';
insert into private.blocked_identity (runner_profile_id, normalized_email)
values ('10000000-0000-4000-8000-000000332013', 'people-s-13@example.test');
insert into app.profile_image_asset (profile_image_asset_id, runner_profile_id, staging_object_key, public_object_key, status, approved_at)
values ('50000000-0000-4000-8000-000000332004', '10000000-0000-4000-8000-000000332004', 'stg/ana', 'pub/ana.webp', 'APPROVED', now()),
       ('50000000-0000-4000-8000-000000332005', '10000000-0000-4000-8000-000000332005', 'stg/mario', null, 'PENDING_REVIEW', null);
update app.community_profile set avatar_asset_id = '50000000-0000-4000-8000-000000332004'
where runner_profile_id = '10000000-0000-4000-8000-000000332004';
insert into app.friendship (requester_profile_id, addressee_profile_id, status, responded_at) values
  ('10000000-0000-4000-8000-000000332001', '10000000-0000-4000-8000-000000332002', 'ACCEPTED', now()),
  ('10000000-0000-4000-8000-000000332001', '10000000-0000-4000-8000-000000332004', 'PENDING', null),
  ('10000000-0000-4000-8000-000000332003', '10000000-0000-4000-8000-000000332001', 'PENDING', null);

create temp table results (name text primary key, value jsonb) on commit drop;
grant select, insert on results to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000332001", "role": "authenticated"}';
insert into results values
  ('jose', public.search_people('JOSÉ   ñuñez ')),
  ('mario', public.search_people('mario')),
  ('ana', public.search_people('ana lo')),
  ('page1', public.search_people('paginado')),
  ('self', public.search_people('buscador')),
  ('alias', public.search_people('secreto')),
  ('wild', public.search_people('ma%io'));
insert into results
select 'page2', public.search_people('paginado', r.value -> 'next_cursor' ->> 'sort_key', (r.value -> 'next_cursor' ->> 'id')::uuid)
from results r where r.name = 'page1';

-- ---------------------------------------------------------------------------------------------
-- Projection allowlist (§23, SEC-120): never DOB, email, phone, emergency, guardian or auth ids
-- ---------------------------------------------------------------------------------------------
select is_empty($$ select k from results r, jsonb_array_elements(r.value -> 'items') i, jsonb_object_keys(i) k
  where k not in ('public_profile_id', 'display_name', 'avatar_object_key', 'public_stats', 'friendship') $$,
  '§23 every result carries only the allowlisted keys');
select is_empty($$ select 1 from results r where r.value::text ~ '(1990-01-01|\+52811999|example\.test|Emergencia|10000000-0000-4000-8000-000000332|00000000-0000-4000-8000-000000332)' $$,
  '§23 no DOB, phone, email, emergency contact, runner or auth id anywhere in the response');
select is((select array_agg(k order by k) from results r, jsonb_object_keys(r.value -> 'items' -> 0 -> 'public_stats') k where r.name = 'jose'),
  array['achievement_count', 'verified_distance_m', 'verified_participation_count'], '§23 public stats are km/participations/achievements only');

-- ---------------------------------------------------------------------------------------------
-- Normalisation and matching (§23: lowercase, unaccent, collapsed spaces, trim; display/search name)
-- ---------------------------------------------------------------------------------------------
select is((select array_agg(i ->> 'display_name' order by (i ->> 'display_name') collate "C") from results r, jsonb_array_elements(r.value -> 'items') i where r.name = 'jose'),
  array['Jose Nunez Dos', 'José  Ñúñez'], '§23 accents, case and spaces are normalised');
select is((select r.value -> 'items' -> 0 ->> 'display_name' from results r where r.name = 'alias'), 'Alias Corredor',
  '§23 search_name (derived from the real name) is searchable');
select is((select jsonb_array_length(r.value -> 'items') from results r where r.name = 'wild'), 0,
  'LIKE wildcards in the query are literals');
select is((select jsonb_array_length(r.value -> 'items') from results r where r.name = 'self'), 0, 'the caller is not in their own results');

-- ---------------------------------------------------------------------------------------------
-- Exclusions (§121 banned/locked, A10 minors, visibility, searchability, blocked identity)
-- ---------------------------------------------------------------------------------------------
select is((select array_agg(i ->> 'display_name') from results r, jsonb_array_elements(r.value -> 'items') i where r.name = 'mario'),
  array['Mario Suspended'], '§121/A10 banned, locked, deactivated, incomplete, invisible, non-searchable, blocked and minor profiles are excluded');
select is((select r.value -> 'items' -> 0 -> 'public_stats' from results r where r.name = 'mario'), 'null'::jsonb,
  'public km/achievements are hidden unless competition_status is ELIGIBLE');

-- ---------------------------------------------------------------------------------------------
-- Avatar and friendship_state
-- ---------------------------------------------------------------------------------------------
select is((select r.value -> 'items' -> 0 ->> 'avatar_object_key' from results r where r.name = 'ana'), 'pub/ana.webp',
  'the approved avatar key is returned');
select is((select r.value -> 'items' -> 0 ->> 'avatar_object_key' from results r where r.name = 'mario'), null,
  'a pending avatar is never returned');
select is((select jsonb_object_agg(i ->> 'display_name', i -> 'friendship' ->> 'state') from results r, jsonb_array_elements(r.value -> 'items') i where r.name in ('jose', 'ana')),
  '{"José  Ñúñez": "FRIENDS", "Jose Nunez Dos": "PENDING_INCOMING", "Ana López": "PENDING_OUTGOING"}'::jsonb,
  '§23 friendship_state is relative to the caller');
select is((select r.value -> 'items' -> 0 -> 'friendship' from results r where r.name = 'alias'),
  '{"state": "NONE", "friendship_id": null}'::jsonb, 'no relation: NONE');

-- ---------------------------------------------------------------------------------------------
-- Paging (§23: 20 per page; SEC-008 server-side cap; keyset cursor)
-- ---------------------------------------------------------------------------------------------
select is((select jsonb_array_length(r.value -> 'items') from results r where r.name = 'page1'), 20, '§23 first page has 20 results');
select isnt((select r.value -> 'next_cursor' from results r where r.name = 'page1'), 'null'::jsonb, 'first page has a next cursor');
select is((select jsonb_array_length(r.value -> 'items') from results r where r.name = 'page2'), 5, 'second page has the remaining 5');
select is((select r.value -> 'next_cursor' from results r where r.name = 'page2'), 'null'::jsonb, 'last page has no cursor');
select is_empty($$ select i ->> 'public_profile_id' from results r, jsonb_array_elements(r.value -> 'items') i where r.name = 'page1'
  intersect select i ->> 'public_profile_id' from results r, jsonb_array_elements(r.value -> 'items') i where r.name = 'page2' $$,
  'pages do not overlap');

-- ---------------------------------------------------------------------------------------------
-- Validation, auth and grants
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.search_people(' a ') $$), '{"code": "VALIDATION_ERROR", "detail": {"field": "q", "reason": "length"}}'::jsonb,
  'queries shorter than 2 normalised characters are rejected');
select is(pg_temp.err(format('select public.search_people(%L)', repeat('x', 81))) ->> 'code', 'VALIDATION_ERROR', 'queries over 80 characters are rejected');
select is(pg_temp.err($$ select public.search_people(null) $$) ->> 'code', 'VALIDATION_ERROR', 'a missing query is rejected');
select is(pg_temp.err($$ select public.search_people('paginado', 'paginado 01', null) $$) ->> 'code', 'VALIDATION_ERROR', 'a half cursor is rejected');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000332017", "role": "authenticated"}';
select is(pg_temp.err($$ select public.search_people('paginado') $$) ->> 'code', 'ACCOUNT_BANNED', '§121 a banned caller cannot search');
set local "request.jwt.claims" = '';
select is(pg_temp.err($$ select public.search_people('paginado') $$) ->> 'code', 'AUTH_REQUIRED', '§23 search requires a session');

-- Rate limit for direct callers (§179 60 / 10 min, command counter).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000332016", "role": "authenticated"}';
-- LATERAL RHS must depend on g: otherwise Postgres treats it as an uncorrelated subplan and
-- materializes a single call's result across all 60 outer rows instead of invoking it 60 times.
select is((select count(*)::int from generate_series(1, 60) g,
  lateral (select public.search_people('paginado') where g > 0) s), 60,
  '§179 sixty searches in the window are allowed');
select is(pg_temp.err($$ select public.search_people('paginado') $$) ->> 'code', 'RATE_LIMITED', '§179 the 61st search is RATE_LIMITED');

reset role;
select ok(not has_function_privilege('anon', 'public.search_people(text, text, uuid)', 'execute'), 'anon cannot execute search_people');

select * from finish();
rollback;
