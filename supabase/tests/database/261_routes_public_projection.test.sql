-- T32 public route projection (get_edition_routes): the exact shape F1 (event page, via T31
-- discovery) and F4 (admin route editor, for the full-precision path) consume. Draft invisibility,
-- published-route-only, preview simplification vs. full precision.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000261001', event_type_id, 'Routes Public Test Event', 'routes-public-test-event'
from app.event_type where key = 'ROAD_RACE';

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000261001', 'routes-pub-staff@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000261001', '00000000-0000-4000-8000-000000261001', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000261001', 'ADMIN', 'GLOBAL');

-- Edition PUBLISHED directly (mirrors 250_discovery_queries.test.sql: no readiness gate needed here).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000261001', '40000000-0000-4000-8000-000000261001', 'routes-public-edicion',
   'Routes Public Edition', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'OPEN', 'FREE', 'America/Monterrey',
   now() + interval '9 days', 'Monterrey', 'NL', 'MX', now());
-- A second, DRAFT Edition: proves a published Route inside a DRAFT Edition stays invisible.
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000261002', '40000000-0000-4000-8000-000000261001', 'routes-draft-edicion',
   'Routes Draft Edition', 'DRAFT', 'SCHEDULED', 'NOT_OPEN', 'OPEN', 'FREE', 'America/Monterrey',
   now() + interval '9 days', 'Monterrey', 'NL', 'MX');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000261001', '50000000-0000-4000-8000-000000261001', '10k', '10K', 10000, true, 'ACTIVE', 1),
  ('60000000-0000-4000-8000-000000261002', '50000000-0000-4000-8000-000000261002', '10k', '10K', 10000, true, 'ACTIVE', 1);

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated, anon;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000261001", "role": "authenticated"}';

-- A dense, wiggly line (many points) so the simplified preview measurably differs from the full path.
insert into ids select 'route_pub', public.create_route('50000000-0000-4000-8000-000000261001'::uuid,
  jsonb_build_object('name', 'Ruta Pública', 'modality_ids', jsonb_build_array('60000000-0000-4000-8000-000000261001')));
insert into ids select 'rev_pub', public.create_manual_revision((select value ->> 'route_id' from ids where name = 'route_pub')::uuid,
  jsonb_build_object('geometry', jsonb_build_object('type', 'LineString', 'coordinates', (
    select jsonb_agg(jsonb_build_array(-100.30 + (n * 0.0000001), 25.67 + (n * 0.00003 * sin(n))))
    from generate_series(0, 200) as n))));
insert into ids select 'rev_pub_publish', public.publish_revision((select value ->> 'route_revision_id' from ids where name = 'rev_pub')::uuid);

insert into ids select 'route_draft', public.create_route('50000000-0000-4000-8000-000000261002'::uuid,
  jsonb_build_object('name', 'Ruta en Edición Draft', 'modality_ids', jsonb_build_array('60000000-0000-4000-8000-000000261002')));
insert into ids select 'rev_draft', public.create_manual_revision((select value ->> 'route_id' from ids where name = 'route_draft')::uuid,
  jsonb_build_object('geometry', jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(
    jsonb_build_array(-100.30, 25.67), jsonb_build_array(-100.31, 25.68)))));
insert into ids select 'rev_draft_publish', public.publish_revision((select value ->> 'route_revision_id' from ids where name = 'rev_draft')::uuid);

reset role;
set local role anon;

insert into ids select 'pub_a', public.get_edition_routes('50000000-0000-4000-8000-000000261001'::uuid);
insert into ids select 'pub_b', public.get_edition_routes('50000000-0000-4000-8000-000000261002'::uuid);

select is(jsonb_array_length((select value from ids where name = 'pub_a')), 1,
  'the PUBLISHED route of a PUBLISHED Edition is visible to anon');
select is(jsonb_array_length((select value from ids where name = 'pub_b')), 0,
  'a PUBLISHED route inside a DRAFT Edition stays invisible (draft invisibility)');

select is((select value -> 0 ->> 'name' from ids where name = 'pub_a'), 'Ruta Pública', 'route name');
select is((select value -> 0 -> 'modality_ids' ->> 0 from ids where name = 'pub_a'), '60000000-0000-4000-8000-000000261001',
  'per-modality association is exposed');
select is((select value -> 0 -> 'revision' -> 'geometry_full' ->> 'type' from ids where name = 'pub_a'), 'LineString',
  'geometry_full is a GeoJSON LineString');
select is((select value -> 0 -> 'revision' -> 'geometry_preview' ->> 'type' from ids where name = 'pub_a'), 'LineString',
  'geometry_preview is a GeoJSON LineString');
select ok(
  jsonb_array_length((select value -> 0 -> 'revision' -> 'geometry_preview' -> 'coordinates' from ids where name = 'pub_a'))
    <= jsonb_array_length((select value -> 0 -> 'revision' -> 'geometry_full' -> 'coordinates' from ids where name = 'pub_a')),
  'the simplified preview never has more points than the full-precision geometry (Master §191 payload budget)');
select ok((select (value -> 0 -> 'revision' ->> 'computed_distance_m')::integer from ids where name = 'pub_a') > 0,
  'computed_distance_m is exposed');
select is(jsonb_typeof((select value -> 0 -> 'revision' -> 'pois' from ids where name = 'pub_a')), 'array', 'pois is an array');

select * from finish();
rollback;
