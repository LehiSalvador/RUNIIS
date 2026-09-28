-- T31b-discovery-fixes (F1 follow-up): distance filter same-Modality regression, page media
-- event_media_asset_id exposure, active event types and the platform public contact.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(11);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000251001', event_type_id, 'Discovery Fixes Test Event', 'discovery-fixes-test-event'
from app.event_type where key = 'ROAD_RACE';

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000251001', 'discovery-fx-staff@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000251001', '00000000-0000-4000-8000-000000251001', 'ACTIVE');

-- Edition F: PUBLISHED, PUBLISHED media asset, TWO active Modalities (5K and 21K — nothing between
-- 6km and 10km). Regression target for the distance_min_m/max_m fix (Master §165).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000251001', '40000000-0000-4000-8000-000000251001', 'discovery-fx-multi-modalidad',
   'Carrera Multi Modalidad QA251', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'OPEN', 'FREE', 'America/Monterrey',
   now() + interval '9 days', 'Monterrey', 'NL', 'MX', now());
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000251001', '50000000-0000-4000-8000-000000251001', 1, 'DATE_TIME_CONFIRMED',
   (current_date + 9), '07:00:00', 'America/Monterrey', ((current_date + 9) + time '07:00:00') at time zone 'America/Monterrey', '20000000-0000-4000-8000-000000251001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000251001', '50000000-0000-4000-8000-000000251001', '5k', '5K', 5000, true, 'ACTIVE', 1),
  ('60000000-0000-4000-8000-000000251002', '50000000-0000-4000-8000-000000251001', '21k', '21K', 21097, true, 'ACTIVE', 2);
insert into app.event_media_asset (event_media_asset_id, edition_id, media_type, storage_object_key, alt_text, status, sort_order) values
  ('70000000-0000-4000-8000-000000251001', '50000000-0000-4000-8000-000000251001', 'IMAGE', 'runiis/qa251/cover', 'Portada QA251', 'PUBLISHED', 1);

-- ---------------------------------------------------------------------------------------------
-- Fix 1: distance_min_m/max_m must bound the SAME Modality.
-- ---------------------------------------------------------------------------------------------
select is(
  (select count(*) from jsonb_array_elements(public.search_editions('QA251', null, null, null, 6000, 10000) -> 'items')),
  0::bigint,
  'a 5K+21K Edition does not match a 6-10km range: no single Modality clears both bounds (regression)');
select is(
  (select x ->> 'slug' from jsonb_array_elements(public.search_editions('QA251', null, null, null, 4000, 6000) -> 'items') x),
  'discovery-fx-multi-modalidad',
  'distance_min_m=4000,max_m=6000 matches via the 5K Modality (both bounds on the same row)');
select is(
  (select x ->> 'slug' from jsonb_array_elements(public.search_editions('QA251', null, null, null, 20000, null) -> 'items') x),
  'discovery-fx-multi-modalidad', 'distance_min_m alone (no max) still matches via the 21K Modality');
select is(
  (select x ->> 'slug' from jsonb_array_elements(public.search_editions('QA251', null, null, null, null, 6000) -> 'items') x),
  'discovery-fx-multi-modalidad', 'distance_max_m alone (no min) still matches via the 5K Modality');

-- ---------------------------------------------------------------------------------------------
-- Fix 2: page media exposes event_media_asset_id (so IMAGE/GALLERY/SPONSOR_GROUP content blocks can
-- resolve the same asset id their payload references — private.cfg_media_ref).
-- ---------------------------------------------------------------------------------------------
select is(
  (public.get_edition_page('discovery-fx-multi-modalidad') -> 'edition' -> 'media' -> 0 ->> 'event_media_asset_id'),
  '70000000-0000-4000-8000-000000251001', 'the page media array carries event_media_asset_id, matching the source asset row');
select is(
  (public.get_edition_page('discovery-fx-multi-modalidad') -> 'edition' -> 'media' -> 0 ->> 'storage_object_key'),
  'runiis/qa251/cover', 'the page media array still carries the raw storage_object_key (URL conversion is TS-side, F1/lib/shared/media-url.ts)');

-- ---------------------------------------------------------------------------------------------
-- Fix 3a: active event types (public library filter).
-- ---------------------------------------------------------------------------------------------
insert into app.event_type (key, name, default_generates_distance_credit, active) values
  ('QA251_INACTIVE_TYPE', 'Tipo QA251 Inactivo', false, false);
select ok(
  exists (select 1 from jsonb_array_elements(public.get_active_event_types()) x where x ->> 'key' = 'ROAD_RACE'),
  'get_active_event_types includes an ACTIVE seeded type (ROAD_RACE)');
select ok(
  not exists (select 1 from jsonb_array_elements(public.get_active_event_types()) x where x ->> 'key' = 'QA251_INACTIVE_TYPE'),
  'get_active_event_types excludes an inactive type');

-- ---------------------------------------------------------------------------------------------
-- Fix 3b: platform public contact — effective default WhatsApp only, nothing else from
-- platform_settings (reset at the end so this shared singleton row is left as this test found it).
-- ---------------------------------------------------------------------------------------------
select is((select jsonb_object_keys(public.get_public_platform_contact())), 'whatsapp_phone_e164',
  'get_public_platform_contact exposes exactly one field: whatsapp_phone_e164');
update app.platform_settings set default_whatsapp_phone_e164 = '+528112345678' where settings_id = 1;
select is(public.get_public_platform_contact() ->> 'whatsapp_phone_e164', '+528112345678',
  'get_public_platform_contact reflects the configured platform default');
update app.platform_settings set default_whatsapp_phone_e164 = null where settings_id = 1;
select is(public.get_public_platform_contact() ->> 'whatsapp_phone_e164', null,
  'get_public_platform_contact is null (not an error) when unconfigured');

select * from finish();
rollback;
