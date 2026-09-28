-- T32 Routes domain (Master §45-50, §170): create/import/validate/publish/duplicate semantics, the
-- route/modality same-Edition rule, GPX-import-stays-DRAFT, "one PUBLISHED per route" and SEC-020
-- Edition scoping. Synthetic ids in a private 2026x range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(30);

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

-- ---------------------------------------------------------------------------------------------
-- Fixtures: GLOBAL ADMIN, an EDITION-scoped OPERATOR (Edition B only, for the SEC-020 test), two
-- DRAFT Editions each with one Modality.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000260001', 'routes-admin@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000260001', '00000000-0000-4000-8000-000000260001', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000260001', 'ADMIN', 'GLOBAL');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000260001', event_type_id, 'Routes Test Event', 'routes-test-event'
from app.event_type where key = 'ROAD_RACE';

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000260001", "role": "authenticated"}';

insert into ids select 'edition_a', public.create_edition('40000000-0000-4000-8000-000000260001',
  jsonb_build_object('slug', 'routes-edition-a', 'name', 'Routes Edition A', 'registration_mode', 'EXTERNAL_WHATSAPP',
    'city', 'Monterrey', 'state_region', 'NL', 'whatsapp_phone_e164', '+528110000001',
    'registration_close_at', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
insert into ids select 'edition_b', public.create_edition('40000000-0000-4000-8000-000000260001',
  jsonb_build_object('slug', 'routes-edition-b', 'name', 'Routes Edition B', 'registration_mode', 'EXTERNAL_WHATSAPP',
    'city', 'Monterrey', 'state_region', 'NL', 'whatsapp_phone_e164', '+528110000002',
    'registration_close_at', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
insert into ids select 'modality_a', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid,
  jsonb_build_object('key', '10k', 'name', '10K', 'official_distance_m', 10000, 'effective_capacity', 100));
insert into ids select 'modality_b', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid,
  jsonb_build_object('key', '10k', 'name', '10K', 'official_distance_m', 10000, 'effective_capacity', 100));

reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000260002', 'routes-op-b@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000260002', '00000000-0000-4000-8000-000000260002', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000260002', 'OPERATOR', 'EDITION', (select value ->> 'edition_id' from ids where name = 'edition_b')::uuid);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000260001", "role": "authenticated"}';

-- ---------------------------------------------------------------------------------------------
-- §45 route/modality same-Edition rule.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'route1', public.create_route((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid,
  jsonb_build_object('name', 'Ruta 10K', 'modality_ids', jsonb_build_array((select value ->> 'modality_id' from ids where name = 'modality_a'))));
select is((select value ->> 'name' from ids where name = 'route1'), 'Ruta 10K', 'create_route');
select is((select value -> 'modality_ids' ->> 0 from ids where name = 'route1')::uuid,
  (select value ->> 'modality_id' from ids where name = 'modality_a')::uuid, 'create_route links the given modality');

select is(pg_temp.err(format(
  $$ select public.create_route(%L, jsonb_build_object('name', 'Cross Edition', 'modality_ids', jsonb_build_array(%L))) $$,
  (select value ->> 'edition_id' from ids where name = 'edition_a'), (select value ->> 'modality_id' from ids where name = 'modality_b')
)) ->> 'code', 'NOT_FOUND', '§45 a Modality of another Edition is refused (composite FK -> NOT_FOUND)');

-- ---------------------------------------------------------------------------------------------
-- Geometry validation at ingest (defense in depth, SEC-006) and manual revisions.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(format(
  $$ select public.create_manual_revision(%L, jsonb_build_object('geometry',
       jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(jsonb_build_array(-100.30, 25.67))))) $$,
  (select value ->> 'route_id' from ids where name = 'route1')
)) ->> 'code', 'VALIDATION_ERROR', 'a single-point LineString is rejected at ingest (invalid_point_count)');

select is(pg_temp.err(format(
  $$ select public.create_manual_revision(%L, jsonb_build_object('geometry',
       jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(jsonb_build_array(-100.30, 999))))) $$,
  (select value ->> 'route_id' from ids where name = 'route1')
)) ->> 'code', 'VALIDATION_ERROR', 'an out-of-range latitude is rejected');

insert into ids select 'rev1', public.create_manual_revision((select value ->> 'route_id' from ids where name = 'route1')::uuid,
  jsonb_build_object('geometry', jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(
    jsonb_build_array(-100.309800, 25.670000), jsonb_build_array(-100.305000, 25.673000),
    jsonb_build_array(-100.300000, 25.676000)))));
select is((select value ->> 'status' from ids where name = 'rev1'), 'DRAFT', 'create_manual_revision is always DRAFT');
select is((select value ->> 'source' from ids where name = 'rev1'), 'MANUAL', 'source MANUAL');
select ok((select (value ->> 'computed_distance_m')::integer from ids where name = 'rev1') > 0,
  'computed_distance_m via PostGIS geography length');

insert into ids select 'rev1_valid', public.validate_revision((select value ->> 'route_revision_id' from ids where name = 'rev1')::uuid);
select ok((select value ->> 'valid' from ids where name = 'rev1_valid')::boolean, 'rev1 has no blocking errors');
select ok((select value -> 'warnings' from ids where name = 'rev1_valid') @> '[{"code": "START_FINISH_MISSING"}]',
  '§50 missing start/finish is a warning');

-- Revision 2: with START/FINISH POIs -> the warning disappears.
insert into ids select 'rev2', public.create_manual_revision((select value ->> 'route_id' from ids where name = 'route1')::uuid,
  jsonb_build_object(
    'geometry', jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(
      jsonb_build_array(-100.309800, 25.670000), jsonb_build_array(-100.305000, 25.673000),
      jsonb_build_array(-100.300000, 25.676000))),
    'pois', jsonb_build_array(
      jsonb_build_object('poi_type', 'START', 'name', 'Salida', 'longitude', -100.309800, 'latitude', 25.670000),
      jsonb_build_object('poi_type', 'FINISH', 'name', 'Meta', 'longitude', -100.300000, 'latitude', 25.676000))));
select is((select value ->> 'revision' from ids where name = 'rev2'), '2', 'revisions increment per route');
select is(jsonb_array_length((select value -> 'pois' from ids where name = 'rev2')), 2, 'POIs are persisted with the revision');

insert into ids select 'rev2_valid', public.validate_revision((select value ->> 'route_revision_id' from ids where name = 'rev2')::uuid);
select ok(not ((select value -> 'warnings' from ids where name = 'rev2_valid') @> '[{"code": "START_FINISH_MISSING"}]'),
  'START/FINISH POIs clear the warning');

-- update_revision on a DRAFT revision.
insert into ids select 'rev2_upd', public.update_revision((select value ->> 'route_revision_id' from ids where name = 'rev2')::uuid,
  jsonb_build_object('pois', jsonb_build_array(
    jsonb_build_object('poi_type', 'START', 'name', 'Salida', 'longitude', -100.309800, 'latitude', 25.670000))));
select is(jsonb_array_length((select value -> 'pois' from ids where name = 'rev2_upd')), 1, 'update_revision replaces the POI set');

-- ---------------------------------------------------------------------------------------------
-- Publish semantics: "one PUBLISHED per route" across a supersede, publish requires DRAFT.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'rev2_pub', public.publish_revision((select value ->> 'route_revision_id' from ids where name = 'rev2')::uuid);
select is((select value ->> 'status' from ids where name = 'rev2_pub'), 'PUBLISHED', 'publish_revision publishes');
select is(pg_temp.err(format($$ select public.publish_revision(%L) $$,
  (select value ->> 'route_revision_id' from ids where name = 'rev2'))) ->> 'code', 'CONFLICT',
  'publishing an already-PUBLISHED revision again is refused (not DRAFT)');

insert into ids select 'rev1_pub', public.publish_revision((select value ->> 'route_revision_id' from ids where name = 'rev1')::uuid);
select is((select value ->> 'status' from ids where name = 'rev1_pub'), 'PUBLISHED',
  'publishing another DRAFT revision supersedes the previous PUBLISHED one');
select is((select status from app.route_revision where route_revision_id = (select value ->> 'route_revision_id' from ids where name = 'rev2')::uuid),
  'SUPERSEDED', '§46 the previously PUBLISHED revision becomes SUPERSEDED');
select is((select count(*)::int from app.route_revision
           where route_id = (select value ->> 'route_id' from ids where name = 'route1')::uuid and status = 'PUBLISHED'),
  1, 'exactly one PUBLISHED revision per route at all times');
select is((select active_revision_id from app.route where route_id = (select value ->> 'route_id' from ids where name = 'route1')::uuid),
  (select value ->> 'route_revision_id' from ids where name = 'rev1')::uuid, 'route.active_revision_id follows the newly PUBLISHED revision');

-- Publish requires no blocking errors: a corrupt revision (crafted at the storage layer, unreachable
-- through the validated write path) must fail to publish.
reset role;
insert into app.route_revision (route_revision_id, route_id, revision, status, geometry, geojson_snapshot,
  source, created_by_staff_id)
values ('90000000-0000-4000-8000-000000260001', (select value ->> 'route_id' from ids where name = 'route1')::uuid, 3, 'DRAFT',
  extensions.st_setsrid(extensions.st_makeline(array[extensions.st_makepoint(-100.3, 25.67)]), 4326),
  '{"type":"LineString","coordinates":[[-100.3,25.67]]}'::jsonb, 'MANUAL', '20000000-0000-4000-8000-000000260001');
select is((private.compute_route_validation('90000000-0000-4000-8000-000000260001') -> 'errors' -> 0 ->> 'code'),
  'LINESTRING_DEGENERATE', 'compute_route_validation flags a 1-point stored geometry as a blocking error');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000260001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.publish_revision('90000000-0000-4000-8000-000000260001') $$) ->> 'code',
  'BUSINESS_RULE_VIOLATION', '§50 publish is refused when validation reports a blocking error');

-- ---------------------------------------------------------------------------------------------
-- GPX import always stays DRAFT (Master §49 step 15) and never touches official_distance_m.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'gpx_rev', public.import_gpx_revision((select value ->> 'route_id' from ids where name = 'route1')::uuid,
  jsonb_build_object('source_filename', 'course.gpx',
    'geometry', jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(
      jsonb_build_array(-100.309800, 25.670000), jsonb_build_array(-100.305000, 25.673000))),
    'pois', jsonb_build_array(jsonb_build_object('poi_type', 'HYDRATION', 'name', 'Water stop', 'longitude', -100.307, 'latitude', 25.671))));
select is((select value ->> 'status' from ids where name = 'gpx_rev'), 'DRAFT', 'GPX import always creates a DRAFT revision');
select is((select value ->> 'source' from ids where name = 'gpx_rev'), 'GPX_IMPORT', 'source is GPX_IMPORT');
select is((select official_distance_m from app.modality where modality_id = (select value ->> 'modality_id' from ids where name = 'modality_a')::uuid),
  10000, 'GPX import never changes official_distance_m');

-- ---------------------------------------------------------------------------------------------
-- Duplicate route.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'route1_dup', public.duplicate_route((select value ->> 'route_id' from ids where name = 'route1')::uuid, '{}'::jsonb);
select isnt((select value ->> 'route_id' from ids where name = 'route1_dup'), (select value ->> 'route_id' from ids where name = 'route1'),
  'duplicate_route creates a new Route');
insert into ids select 'route1_dup_detail', public.admin_get_route((select value ->> 'route_id' from ids where name = 'route1_dup')::uuid);
select is((select value -> 'revisions' -> 0 ->> 'source' from ids where name = 'route1_dup_detail'),
  'DUPLICATED', 'the duplicated revision is tagged DUPLICATED');

-- ---------------------------------------------------------------------------------------------
-- TOCTOU / configurability re-checks (code review fix): update_revision and publish_revision must
-- re-check status under the row lock, not just on the pre-lock read, and publish_revision must
-- respect cfg_assert_configurable like every other command in this file.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(format($$ select public.update_revision(%L, jsonb_build_object('pois', '[]'::jsonb)) $$,
  (select value ->> 'route_revision_id' from ids where name = 'rev1'))) ->> 'code', 'CONFLICT',
  'update_revision on an already-PUBLISHED revision is refused (status re-checked under the lock)');

insert into ids select 'rev3', public.create_manual_revision((select value ->> 'route_id' from ids where name = 'route1')::uuid,
  jsonb_build_object('geometry', jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(
    jsonb_build_array(-100.31, 25.65), jsonb_build_array(-100.32, 25.66)))));
reset role;
update app.edition set execution_state = 'FINISHED' where edition_id = (select value ->> 'edition_id' from ids where name = 'edition_a')::uuid;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000260001", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.publish_revision(%L) $$,
  (select value ->> 'route_revision_id' from ids where name = 'rev3'))) ->> 'code', 'BUSINESS_RULE_VIOLATION',
  'publish_revision respects cfg_assert_configurable (Edition FINISHED freezes content, like every other command in this file)');
reset role;
update app.edition set execution_state = 'SCHEDULED' where edition_id = (select value ->> 'edition_id' from ids where name = 'edition_a')::uuid;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000260001", "role": "authenticated"}';

-- ---------------------------------------------------------------------------------------------
-- SEC-020: an EDITION-scoped OPERATOR of Edition B is denied on Edition A's route.
-- ---------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000260002", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.create_manual_revision(%L, jsonb_build_object('geometry',
    jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(jsonb_build_array(-100.3, 25.6), jsonb_build_array(-100.31, 25.61))))) $$,
  (select value ->> 'route_id' from ids where name = 'route1'))) ->> 'code', 'FORBIDDEN',
  'SEC-020: Edition-B-scoped staff cannot act on Edition A''s route');

select * from finish();
rollback;
