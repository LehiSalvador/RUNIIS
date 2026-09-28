-- T31 public discovery read side (Master §53-60, §165): draft invisibility, filter AND/OR,
-- accent-insensitive normalization, distance filtering, ordering (incl. past separation) and slug
-- history redirects. All fixtures are inserted directly (no auth.uid() — discovery is anon-only).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(20);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000250001', event_type_id, 'Discovery Test Event', 'discovery-test-event'
from app.event_type where key = 'ROAD_RACE';

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000250001', 'discovery-q-staff@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000250001', '00000000-0000-4000-8000-000000250001', 'ACTIVE');

-- Edition A: PUBLISHED, OPEN, FREE, future (in 10 days), accented name+city, 5K modality.
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000250001', '40000000-0000-4000-8000-000000250001', 'discovery-edicion-monterrey',
   'Carrera Edición Montañés QA250', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'OPEN', 'FREE', 'America/Monterrey',
   now() + interval '9 days', 'León', 'GTO', 'MX', now());
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000250001', '50000000-0000-4000-8000-000000250001', 1, 'DATE_TIME_CONFIRMED',
   (current_date + 10), '07:00:00', 'America/Monterrey', ((current_date + 10) + time '07:00:00') at time zone 'America/Monterrey', '20000000-0000-4000-8000-000000250001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000250001', '50000000-0000-4000-8000-000000250001', '5k', '5K', 5000, true, 'ACTIVE', 1);

-- Edition B: PUBLISHED, EXTERNAL_WHATSAPP (paid), future (in 20 days), 21K modality (for distance filter).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000250002', '40000000-0000-4000-8000-000000250001', 'discovery-edicion-pago',
   'Media Maratón de Prueba QA250', 'PUBLISHED', 'SCHEDULED', 'NOT_OPEN', 'OPEN', 'EXTERNAL_WHATSAPP', 'America/Monterrey',
   now() + interval '25 days', 'Monterrey', 'NL', 'MX', now());
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000250002', '50000000-0000-4000-8000-000000250002', 1, 'DATE_TIME_CONFIRMED',
   (current_date + 20), '06:00:00', 'America/Monterrey', ((current_date + 20) + time '06:00:00') at time zone 'America/Monterrey', '20000000-0000-4000-8000-000000250001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000250002', '50000000-0000-4000-8000-000000250002', '21k', '21K', 21097, true, 'ACTIVE', 1);

-- Edition C: PUBLISHED, past (10 days ago).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000250003', '40000000-0000-4000-8000-000000250001', 'discovery-edicion-pasada',
   'Carrera Pasada de Prueba QA250', 'PUBLISHED', 'FINISHED', 'CLOSED', 'PENDING', 'FREE', 'America/Monterrey',
   now() - interval '15 days', 'Monterrey', 'NL', 'MX', now() - interval '20 days');
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000250003', '50000000-0000-4000-8000-000000250003', 1, 'DATE_TIME_CONFIRMED',
   (current_date - 10), '07:00:00', 'America/Monterrey', ((current_date - 10) + time '07:00:00') at time zone 'America/Monterrey', '20000000-0000-4000-8000-000000250001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000250004', '50000000-0000-4000-8000-000000250003', '5k', '5K', 5000, true, 'ACTIVE', 1);

-- Edition D: DRAFT (never visible to anon), otherwise identical shape to Edition A.
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000250004', '40000000-0000-4000-8000-000000250001', 'discovery-edicion-borrador',
   'Carrera Sin Publicar', 'DRAFT', 'SCHEDULED', 'NOT_OPEN', 'OPEN', 'FREE', 'America/Monterrey', now() + interval '9 days',
   'Monterrey', 'NL', 'MX');

-- Slug history: Edition A used to live at an old slug.
insert into app.edition_slug_history (edition_slug_history_id, edition_id, old_slug, new_slug, changed_at) values
  (gen_random_uuid(), '50000000-0000-4000-8000-000000250001', 'discovery-slug-viejo', 'discovery-edicion-monterrey', now());

-- Edition E: PUBLISHED with its only Modality CANCELED (regression: private.discovery_modality_summary
-- must not let bool_or(...) return SQL NULL for price_pending over a zero-row group — that would fail
-- the strict zod schema closed and 500 the whole list/page response for every visitor).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000250005', '40000000-0000-4000-8000-000000250001', 'discovery-edicion-sin-modalidad',
   'Carrera Sin Modalidad Activa QA250', 'PUBLISHED', 'SCHEDULED', 'NOT_OPEN', 'OPEN', 'FREE', 'America/Monterrey',
   now() + interval '9 days', 'Monterrey', 'NL', 'MX', now());
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000250005', '50000000-0000-4000-8000-000000250005', 1, 'DATE_TIME_CONFIRMED',
   (current_date + 10), '07:00:00', 'America/Monterrey', ((current_date + 10) + time '07:00:00') at time zone 'America/Monterrey', '20000000-0000-4000-8000-000000250001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000250005', '50000000-0000-4000-8000-000000250005', '5k', '5K', 5000, true, 'CANCELED', 1);

-- ---------------------------------------------------------------------------------------------
-- Draft invisibility (Master §165: read models expose only PUBLISHED Editions).
-- ---------------------------------------------------------------------------------------------
select is(public.get_edition_page('discovery-edicion-borrador'), null, 'a DRAFT Edition is invisible via its slug (404, not leaked)');
select is(
  (select count(*) from jsonb_array_elements(public.search_editions('Sin Publicar') -> 'items')),
  0::bigint, 'a DRAFT Edition never appears in search results, even when its name matches q');

-- ---------------------------------------------------------------------------------------------
-- Accent-insensitive normalization (Master §54: trim/lowercase/unaccent/whitespace-collapse).
-- ---------------------------------------------------------------------------------------------
-- Every assertion below that isn't already scoped by a unique q/slug is scoped with the 'QA250'
-- token shared by every fixture Edition's name, so it never counts other agents' or the dev seed's
-- concurrently-committed Editions in this shared local database (COMMON-DOMAIN.md).
select is(
  (select count(*) from jsonb_array_elements(public.search_editions('EDICION MONTANES QA250') -> 'items')),
  1::bigint, 'q normalizes accents/case/whitespace: "EDICION MONTANES QA250" matches "Edición Montañés QA250"');
select is(
  (select x ->> 'slug' from jsonb_array_elements(public.search_editions('QA250', null, null, null, null, null, 'leon') -> 'items') x),
  'discovery-edicion-monterrey', 'location search normalizes accents: "leon" matches city "León"');

-- ---------------------------------------------------------------------------------------------
-- Filter AND across dimensions, OR within a multiselect dimension (Master §54).
-- ---------------------------------------------------------------------------------------------
select is(
  (select count(*) from jsonb_array_elements(public.search_editions('QA250', null, null, null, null, null, null, array['FREE']) -> 'items')),
  3::bigint, 'price=FREE (OR within the dimension has one value here) matches the three FREE Editions A, C and E');
select is(
  (select count(*) from jsonb_array_elements(
     public.search_editions('QA250', null, null, null, null, null, null, array['FREE', 'PAID']) -> 'items')),
  4::bigint, 'price=FREE,PAID (OR within dimension) matches all four PUBLISHED Editions');
select is(
  (select count(*) from jsonb_array_elements(
     public.search_editions('QA250', null, null, null, null, null, null, array['PAID'], true) -> 'items')),
  0::bigint, 'AND across dimensions: price=PAID AND registration_open=true matches nothing (Edition B is NOT_OPEN)');
select is(
  (select x ->> 'slug' from jsonb_array_elements(public.search_editions('QA250', null, null, null, null, null, null, array['PAID']) -> 'items') x),
  'discovery-edicion-pago', 'price=PAID alone (no registration_open filter) matches Edition B');

-- ---------------------------------------------------------------------------------------------
-- Distance filter on Modalities (Master §165 distance_min_m/max_m: a race-distance bound, not geo).
-- ---------------------------------------------------------------------------------------------
select is(
  (select x ->> 'slug' from jsonb_array_elements(public.search_editions('QA250', null, null, null, 20000, null) -> 'items') x),
  'discovery-edicion-pago', 'distance_min_m=20000 matches only the Edition with a 21K Modality');
select is(
  (select count(*) from jsonb_array_elements(public.search_editions('QA250', null, null, null, null, 6000) -> 'items')),
  2::bigint, 'distance_max_m=6000 matches both 5K Editions (A and the past one, C)');

-- ---------------------------------------------------------------------------------------------
-- Ordering: nearest future date first, past Editions in a separate (most-recent-first) bucket.
-- ---------------------------------------------------------------------------------------------
select is(
  (select jsonb_agg(x ->> 'slug') from jsonb_array_elements(public.search_editions('Prueba QA250') -> 'items') x),
  '["discovery-edicion-pago", "discovery-edicion-pasada"]'::jsonb,
  'future Edition (in 20 days) sorts before the past Edition (10 days ago) despite the past one being "closer to zero"');

-- ---------------------------------------------------------------------------------------------
-- Slug history lookup (Master §59: permanent redirect on slug change).
-- ---------------------------------------------------------------------------------------------
select is(public.get_edition_page('discovery-slug-viejo'), jsonb_build_object('redirect', true, 'slug', 'discovery-edicion-monterrey'),
  'a historical slug resolves to {redirect:true, slug:<current>}');
select is((public.get_edition_page('discovery-edicion-monterrey') ->> 'redirect')::boolean, false, 'the current slug never redirects');
select is(public.get_edition_page('this-slug-never-existed'), null, 'an unknown slug returns null (caller: 404)');

-- ---------------------------------------------------------------------------------------------
-- Regression: an Edition whose only Modality is CANCELED must not fail the strict card/page schema.
-- ---------------------------------------------------------------------------------------------
select is(
  (select x -> 'modality_summary' ->> 'count' from jsonb_array_elements(public.search_editions('Sin Modalidad Activa QA250') -> 'items') x),
  '0', 'an Edition with only a CANCELED Modality has modality_summary.count = 0, not an error');
select is(
  (select x -> 'modality_summary' ->> 'price_pending' from jsonb_array_elements(public.search_editions('Sin Modalidad Activa QA250') -> 'items') x),
  'false', 'price_pending is a real boolean (false), never SQL NULL, when there are zero priceable Modalities');

-- ---------------------------------------------------------------------------------------------
-- Event page projection shape and public-safe availability (Master §36-37, §58).
-- ---------------------------------------------------------------------------------------------
select is(
  (public.get_edition_page('discovery-edicion-monterrey') -> 'edition' -> 'edition' ->> 'slug'),
  'discovery-edicion-monterrey', 'the page projection carries the resolved Edition');
select is(
  (public.get_edition_page('discovery-edicion-monterrey') -> 'edition' -> 'availability' ->> 'global_state'),
  'AVAILABLE', 'the page projection exposes public availability state (no raw counts — see the schema itself)');
select isnt(public.get_edition_page_availability('discovery-edicion-monterrey'), null, 'availability by slug resolves for a PUBLISHED Edition');
select is(public.get_edition_page_availability('discovery-edicion-borrador'), null, 'availability by slug is null for a DRAFT Edition (never leaked)');

select * from finish();
rollback;
