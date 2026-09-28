-- T30 Edition configuration commands (Master §34-44, §51, §86; SEC-061): modalities, capacity, price
-- offers, categories, versioned forms, locations, agenda, content blocks and kits. Synthetic ids in a
-- private 2020x range, one DRAFT EXTERNAL_WHATSAPP Edition (avoids readiness/publication noise).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(31);

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

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000202001', 'events-cfg-admin@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000202001', '00000000-0000-4000-8000-000000202001', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000202001', 'ADMIN', 'GLOBAL');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000202001', event_type_id, 'Config Cmd Event', 'config-cmd-event'
from app.event_type where key = 'ROAD_RACE';

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000202001", "role": "authenticated"}';

insert into ids select 'edition', public.create_edition('40000000-0000-4000-8000-000000202001',
  jsonb_build_object('slug', 'config-cmd-edition', 'name', 'Config Edition', 'registration_mode', 'EXTERNAL_WHATSAPP',
    'city', 'Monterrey', 'state_region', 'NL', 'whatsapp_phone_e164', '+528110000001',
    'registration_close_at', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

-- ---------------------------------------------------------------------------------------------
-- Modalities (§34): distance credit default, status transitions, capacity acknowledgement.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'modality', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('key', '10k', 'name', '10K', 'official_distance_m', 10000, 'effective_capacity', 2));
select is((select value ->> 'generates_distance_credit' from ids where name = 'modality'), 'true',
  '§34 generates_distance_credit defaults from the EventType (ROAD_RACE)');

insert into ids select 'modality_v2', public.update_modality((select value ->> 'modality_id' from ids where name = 'modality')::uuid,
  jsonb_build_object('name', '10K Renamed'));
select is((select value ->> 'name' from ids where name = 'modality_v2'), '10K Renamed', 'update_modality renames');

insert into ids select 'modality_closed', public.set_modality_status((select value ->> 'modality_id' from ids where name = 'modality')::uuid,
  jsonb_build_object('status', 'CLOSED'));
select is((select value -> 'modality' ->> 'status' from ids where name = 'modality_closed'), 'CLOSED', 'set_modality_status ACTIVE -> CLOSED');
insert into ids select 'modality_canceled', public.set_modality_status((select value ->> 'modality_id' from ids where name = 'modality')::uuid,
  jsonb_build_object('status', 'CANCELED', 'reason', 'discontinued'));
select is((select value -> 'modality' ->> 'status' from ids where name = 'modality_canceled'), 'CANCELED', 'set_modality_status CLOSED -> CANCELED');
select is(pg_temp.err(format($$ select public.set_modality_status(%L, jsonb_build_object('status', 'ACTIVE')) $$,
  (select value ->> 'modality_id' from ids where name = 'modality'))) ->> 'code', 'CONFLICT',
  '§34 CANCELED is terminal (invalid_transition)');

insert into ids select 'modality2', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('key', '5k', 'name', '5K', 'official_distance_m', 5000, 'effective_capacity', 2));
select is(pg_temp.err(format($$ select public.set_modality_capacity(%L, jsonb_build_object('effective_capacity', -1)) $$,
  (select value ->> 'modality_id' from ids where name = 'modality2'))) ->> 'code', 'VALIDATION_ERROR',
  'set_modality_capacity rejects a negative capacity');

insert into ids select 'delete_check', public.delete_modality((select value ->> 'modality_id' from ids where name = 'modality2')::uuid);
select ok((select value ->> 'deleted' from ids where name = 'delete_check')::boolean, '§34 delete_modality removes an unused Modality on a DRAFT Edition');

-- ---------------------------------------------------------------------------------------------
-- Capacity occupation acknowledgement (§35-37): confirmed occupation blocks a lower cap unless acked.
-- ---------------------------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000202002', 'events-cfg-buyer@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
values ('10000000-0000-4000-8000-000000202001', '00000000-0000-4000-8000-000000202002', 'READY', 'ACTIVE', 'Buyer',
  '1990-01-01', 'F', '+528110020201', 'Contacto', '+528110020202', 'Madre', now());
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  status, registration_mode, currency, total_snapshot_minor, expires_at, confirmed_at)
values ('80000000-0000-4000-8000-000000202001', 'R-CFG1-0001', '10000000-0000-4000-8000-000000202001',
  (select value ->> 'edition_id' from ids where name = 'edition')::uuid, 'CONFIRMED', 'EXTERNAL_WHATSAPP', 'MXN', 0, now() + interval '1 day', now());
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
values ('81000000-0000-4000-8000-000000202001', '80000000-0000-4000-8000-000000202001', 'PROFILE',
  '10000000-0000-4000-8000-000000202001', (select value ->> 'modality_id' from ids where name = 'modality')::uuid, 0, 'MXN', '{}');
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, buyer_profile_id, registration_number, status)
values ('83000000-0000-4000-8000-000000202001', '80000000-0000-4000-8000-000000202001', '81000000-0000-4000-8000-000000202001',
  (select value ->> 'edition_id' from ids where name = 'edition')::uuid, (select value ->> 'modality_id' from ids where name = 'modality')::uuid,
  '10000000-0000-4000-8000-000000202001', '10000000-0000-4000-8000-000000202001', 'I-CFG1-0001', 'CONFIRMED');
set local role authenticated;

select is(pg_temp.err(format($$ select public.set_modality_capacity(%L, jsonb_build_object('effective_capacity', 0)) $$,
  (select value ->> 'modality_id' from ids where name = 'modality'))) ->> 'code', 'BUSINESS_RULE_VIOLATION',
  '§35-37 lowering capacity below the 1 CONFIRMED occupation without acknowledgement is refused');
insert into ids select 'capacity_ack', public.set_modality_capacity((select value ->> 'modality_id' from ids where name = 'modality')::uuid,
  jsonb_build_object('effective_capacity', 0, 'acknowledge_below_occupation', true));
select is(jsonb_array_length((select value -> 'warnings' from ids where name = 'capacity_ack')), 1,
  '§35-37 acknowledged lowering returns a CAPACITY_BELOW_OCCUPATION warning');
reset role;
select is((select count(*)::int from app.registration where registration_id = '83000000-0000-4000-8000-000000202001' and status = 'CONFIRMED'),
  1, '§35-37 the existing CONFIRMED Registration is untouched by the capacity change');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Price offers (§38): overlap warning, never an error.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'price1', public.create_price_offer((select value ->> 'modality_id' from ids where name = 'modality')::uuid,
  jsonb_build_object('name', 'Early', 'amount_minor', 30000,
    'starts_at', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
insert into ids select 'price2', public.create_price_offer((select value ->> 'modality_id' from ids where name = 'modality')::uuid,
  jsonb_build_object('name', 'Late (overlapping)', 'amount_minor', 40000, 'priority', 1,
    'starts_at', to_char(now() + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at', to_char(now() + interval '60 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
select ok(jsonb_array_length((select value -> 'warnings' from ids where name = 'price2')) > 0,
  '§38 overlapping ACTIVE price offers produce a PRICE_OFFER_OVERLAP warning, not an error');
select is(pg_temp.err($$ select public.update_price_offer('70000000-0000-4000-8000-000000202099', jsonb_build_object('name', 'x')) $$) ->> 'code',
  'NOT_FOUND', 'update_price_offer on an unknown id is NOT_FOUND');

-- ---------------------------------------------------------------------------------------------
-- Categories (§39): modality linking round-trips.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'category', public.create_category((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('key', 'open', 'name', 'Open', 'assignment_mode', 'USER_SELECTS',
    'modality_ids', jsonb_build_array((select value ->> 'modality_id' from ids where name = 'modality'))));
select is(jsonb_array_length((select value -> 'modality_ids' from ids where name = 'category')), 1, '§39 create_category links the given Modalities');
insert into ids select 'category_v2', public.update_category((select value ->> 'category_id' from ids where name = 'category')::uuid,
  jsonb_build_object('modality_ids', '[]'::jsonb));
select is(jsonb_array_length((select value -> 'modality_ids' from ids where name = 'category_v2')), 0, '§39 update_category replaces the modality_ids set');

-- ---------------------------------------------------------------------------------------------
-- Registration forms (§41): field validation, publish supersedes, DRAFT-only field changes.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'form', public.create_registration_form((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('copy_published_fields', false, 'fields', jsonb_build_array(
    jsonb_build_object('field_key', 't_shirt', 'label', 'T-Shirt size', 'field_type', 'SELECT',
      'options_config', jsonb_build_object('options', jsonb_build_array(
        jsonb_build_object('value', 'S', 'label', 'S'), jsonb_build_object('value', 'M', 'label', 'M')))))));
select is(jsonb_array_length((select value -> 'fields' from ids where name = 'form')), 1, '§41 create_registration_form inserts the given fields');
select is(pg_temp.err(format($$ select public.replace_registration_form_fields(%L, jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('field_key', 'dup', 'label', 'A', 'field_type', 'TEXT'),
    jsonb_build_object('field_key', 'dup', 'label', 'B', 'field_type', 'TEXT')))) $$,
  (select value ->> 'registration_form_id' from ids where name = 'form'))) ->> 'code', 'VALIDATION_ERROR',
  '§41 duplicate field_key is rejected');

insert into ids select 'form_pub', public.publish_registration_form((select value ->> 'registration_form_id' from ids where name = 'form')::uuid);
select is((select value ->> 'status' from ids where name = 'form_pub'), 'PUBLISHED', 'publish_registration_form DRAFT -> PUBLISHED');
select is(pg_temp.err(format($$ select public.replace_registration_form_fields(%L, jsonb_build_object('fields', '[]'::jsonb)) $$,
  (select value ->> 'registration_form_id' from ids where name = 'form'))) ->> 'code', 'CONFLICT',
  '§41 fields change only while the form is DRAFT (protect_form_field/cfg_lock_draft_form)');

insert into ids select 'form2', public.create_registration_form((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('copy_published_fields', true));
select is(jsonb_array_length((select value -> 'fields' from ids where name = 'form2')), 1,
  '§41 a new DRAFT version copies the current PUBLISHED fields by default');
insert into ids select 'form2_pub', public.publish_registration_form((select value ->> 'registration_form_id' from ids where name = 'form2')::uuid);
select is((select value ->> 'superseded_registration_form_id' from ids where name = 'form2_pub'),
  (select value ->> 'registration_form_id' from ids where name = 'form'), '§41 publishing a new version supersedes the previous PUBLISHED one');

-- ---------------------------------------------------------------------------------------------
-- Locations (§43): primary sync.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'loc1', public.create_edition_location((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('location_type', 'START', 'name', 'Macroplaza', 'city', 'Monterrey', 'state_region', 'NL',
    'country_code', 'MX', 'latitude', 25.6693, 'longitude', -100.3096, 'is_primary', true));
select ok((select value ->> 'is_primary' from ids where name = 'loc1')::boolean, '§43 create_edition_location honours is_primary');
insert into ids select 'loc2', public.create_edition_location((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('location_type', 'FINISH', 'name', 'Parque Fundidora', 'is_primary', true));
reset role;
select is((select primary_location_id from app.edition where edition_id = (select value ->> 'edition_id' from ids where name = 'edition')::uuid)::text,
  (select value ->> 'edition_location_id' from ids where name = 'loc2'), '§43 setting a new primary Location clears the previous one');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Agenda (§44).
-- ---------------------------------------------------------------------------------------------
insert into ids select 'agenda1', public.create_schedule_item((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('title', 'Kit pickup', 'local_date', (current_date + 29)::text, 'location_id', (select value ->> 'edition_location_id' from ids where name = 'loc2')));
insert into ids select 'agenda1_v2', public.update_schedule_item((select value ->> 'edition_schedule_item_id' from ids where name = 'agenda1')::uuid,
  jsonb_build_object('status', 'CANCELED'));
select is((select value ->> 'status' from ids where name = 'agenda1_v2'), 'CANCELED', '§44 update_schedule_item');
insert into ids select 'agenda1_del', public.delete_schedule_item((select value ->> 'edition_schedule_item_id' from ids where name = 'agenda1')::uuid);
select ok((select value ->> 'deleted' from ids where name = 'agenda1_del')::boolean, '§44 delete_schedule_item');

-- ---------------------------------------------------------------------------------------------
-- Content blocks (§51, SEC-061): markdown text only (no HTML), allowed link schemes only.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'block_ok', public.create_content_block((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('block_type', 'RICH_TEXT', 'payload', jsonb_build_object('markdown', 'Plain **markdown** with a [link](/faq).')));
select is((select value -> 'payload' ->> 'markdown' from ids where name = 'block_ok'), 'Plain **markdown** with a [link](/faq).',
  '§51 a plain-markdown RICH_TEXT block with a relative link is accepted');
select is(pg_temp.err(format($$ select public.create_content_block(%L, jsonb_build_object('block_type', 'RICH_TEXT',
    'payload', jsonb_build_object('markdown', 'Click <script>alert(1)</script>'))) $$,
  (select value ->> 'edition_id' from ids where name = 'edition'))) ->> 'code', 'VALIDATION_ERROR',
  'SEC-061 raw HTML in markdown is rejected (html_not_allowed)');
select is(pg_temp.err(format($$ select public.create_content_block(%L, jsonb_build_object('block_type', 'DOCUMENT_LINK',
    'payload', jsonb_build_object('label', 'Rules', 'url', 'javascript:alert(1)'))) $$,
  (select value ->> 'edition_id' from ids where name = 'edition'))) ->> 'code', 'VALIDATION_ERROR',
  'SEC-061 a disallowed link scheme (javascript:) is rejected');
insert into ids select 'block_faq', public.create_content_block((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('block_type', 'FAQ', 'payload', jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('question', 'Where?', 'answer_markdown', 'At the Macroplaza.')))));
select is((select value -> 'payload' -> 'items' -> 0 ->> 'question' from ids where name = 'block_faq'), 'Where?', 'FAQ content block payload round-trips');

-- ---------------------------------------------------------------------------------------------
-- Kits (§86, configuration only).
-- ---------------------------------------------------------------------------------------------
insert into ids select 'kit', public.create_kit_definition((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('name', 'Race Kit', 'variants', jsonb_build_array(
    jsonb_build_object('variant_key', 'S', 'label', 'Small'), jsonb_build_object('variant_key', 'M', 'label', 'Medium'))));
select is(jsonb_array_length((select value -> 'variants' from ids where name = 'kit')), 2, '§86 create_kit_definition inserts variants');
insert into ids select 'kit_v2', public.create_kit_variant(
  (select value ->> 'kit_definition_id' from ids where name = 'kit')::uuid, jsonb_build_object('variant_key', 'L', 'label', 'Large'));
select is(jsonb_array_length((select value -> 'variants' from ids where name = 'kit_v2')), 3, '§86 create_kit_variant appends a variant');
insert into ids select 'variant_upd', public.update_kit_variant(
  (select (value -> 'variants' -> 0 ->> 'kit_variant_id') from ids where name = 'kit_v2')::uuid, jsonb_build_object('capacity', 50));
select is((select value -> 'kit' -> 'variants' -> 0 ->> 'capacity' from ids where name = 'variant_upd'), '50', '§86 update_kit_variant sets capacity');

select * from finish();
rollback;
