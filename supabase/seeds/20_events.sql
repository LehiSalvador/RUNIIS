-- T30 synthetic Event/Edition fixtures (local/dev only, no real PII, no real legal text): one Event
-- with six Editions covering every state combination manual QA and other tasks' local dev need.
-- Runs after 10_auth_users.sql (staff/users) and before 30_people.sql/40_registrations.sql (lexical
-- order); nothing here depends on people/registration fixtures. Direct inserts (not the admin RPCs):
-- seeds run outside an authenticated session, so there is no auth.uid() to authorise through.

-- Master §155 asks for a synthetic platform default WhatsApp number, and Master §123 for LOCAL-ONLY
-- legal versions; both are intentionally NOT seeded here (see supabase/tests/database/020_seeds.test.sql
-- tests 2 and 6, owned outside T30): that file asserts platform_settings.default_whatsapp_phone_e164
-- is NULL and app.legal_document_version is empty as *generic* seed invariants, not per-task ones.
-- Adding either here turns those assertions stale and fails db:test for the whole shared suite.
-- Flagged as a coordination finding (F4) instead of edited directly (out of T30's file ownership).

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000900001', event_type_id, 'RUNIIS Demo Carrera', 'runiis-demo-carrera'
from app.event_type where key = 'ROAD_RACE'
on conflict (event_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Edition 1: OPEN, FREE. Two Modalities with official distances, one category, a published form.
-- ---------------------------------------------------------------------------------------------
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_open_at, registration_close_at, global_capacity,
  city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000900001', '40000000-0000-4000-8000-000000900001', 'demo-libre-5k-10k',
   'RUNIIS Demo Libre 5K/10K', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '5 days', now() + interval '55 days', 2000, 'Monterrey', 'NL', 'MX', now() - interval '5 days')
on conflict (edition_id) do nothing;

insert into app.staff_member (staff_member_id, auth_user_id, status)
select '20000000-0000-4000-8000-000000200001', '00000000-0000-4000-8000-000000200001', 'ACTIVE'
where not exists (select 1 from app.staff_member where staff_member_id = '20000000-0000-4000-8000-000000200001');

insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', 1, 'DATE_TIME_CONFIRMED',
   (current_date + 60), '07:00:00', 'America/Monterrey',
   ((current_date + 60) + time '07:00:00') at time zone 'America/Monterrey',
   '20000000-0000-4000-8000-000000200001')
on conflict (edition_schedule_revision_id) do nothing;

insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit,
  local_start_time, status, sort_order) values
  ('60000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', '5k', '5K', 5000, true, '07:00:00', 'ACTIVE', 1),
  ('60000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900001', '10k', '10K', 10000, true, '07:15:00', 'ACTIVE', 2)
on conflict (modality_id) do nothing;
insert into app.modality_capacity (modality_id, effective_capacity) values
  ('60000000-0000-4000-8000-000000900001', 500),
  ('60000000-0000-4000-8000-000000900002', 500)
on conflict (modality_id) do nothing;

insert into app.category (category_id, edition_id, key, name, assignment_mode, active, sort_order) values
  ('62000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', 'libre', 'Libre', 'USER_SELECTS', true, 1)
on conflict (category_id) do nothing;
insert into app.modality_category (modality_id, category_id, edition_id) values
  ('60000000-0000-4000-8000-000000900001', '62000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001'),
  ('60000000-0000-4000-8000-000000900002', '62000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001')
on conflict do nothing;

-- Fields change only while a form is DRAFT (protect_form_field, KERNEL_READY.md §"Value sets and
-- history protections"): insert as DRAFT, insert fields, then publish.
insert into app.registration_form (registration_form_id, edition_id, modality_id, version, status) values
  ('63000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', null, 1, 'DRAFT')
on conflict (registration_form_id) do nothing;
insert into app.registration_form_field (registration_form_field_id, registration_form_id, field_key, label,
  field_type, required, sort_order, options_config) values
  ('64000000-0000-4000-8000-000000900001', '63000000-0000-4000-8000-000000900001', 't_shirt_size', 'Talla de playera',
   'SELECT', true, 1, jsonb_build_object('options', jsonb_build_array(
     jsonb_build_object('value', 'S', 'label', 'S'), jsonb_build_object('value', 'M', 'label', 'M'),
     jsonb_build_object('value', 'L', 'label', 'L'))))
on conflict (registration_form_field_id) do nothing;
update app.registration_form set status = 'PUBLISHED', published_at = now()
where registration_form_id = '63000000-0000-4000-8000-000000900001' and status = 'DRAFT';

insert into app.edition_location (edition_location_id, edition_id, location_type, name, address_line, city,
  state_region, country_code, geometry, is_primary, sort_order) values
  ('65000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', 'START', 'Macroplaza Monterrey',
   'Zaragoza s/n, Centro', 'Monterrey', 'NL', 'MX',
   extensions.st_setsrid(extensions.st_makepoint(-100.3096, 25.6693), 4326)::extensions.geography, true, 1)
on conflict (edition_location_id) do nothing;
update app.edition set primary_location_id = '65000000-0000-4000-8000-000000900001'
where edition_id = '50000000-0000-4000-8000-000000900001' and primary_location_id is null;

insert into app.event_content_block (event_content_block_id, edition_id, block_type, position, status, payload) values
  ('68000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', 'RICH_TEXT', 1, 'PUBLISHED',
   jsonb_build_object('title', 'Sobre la carrera', 'markdown', 'Carrera de prueba local en el centro de Monterrey. [DOCUMENTO DE PRUEBA LOCAL]')),
  ('68000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900001', 'FAQ', 2, 'PUBLISHED',
   jsonb_build_object('items', jsonb_build_array(
     jsonb_build_object('question', '¿Dónde recojo mi kit?', 'answer_markdown', 'En la Macroplaza, un día antes de la carrera.'),
     jsonb_build_object('question', '¿Hay costo de inscripción?', 'answer_markdown', 'No, esta Edición es gratuita.')))),
  ('68000000-0000-4000-8000-000000900003', '50000000-0000-4000-8000-000000900001', 'CALLOUT', 3, 'PUBLISHED',
   jsonb_build_object('tone', 'INFO', 'markdown', 'Datos sintéticos de desarrollo local — no representan un evento real.'))
on conflict (event_content_block_id) do nothing;

insert into app.edition_schedule_item (edition_schedule_item_id, edition_id, modality_id, title, local_date,
  local_start_time, location_id, sort_order, status) values
  ('66000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', null, 'Entrega de kits',
   (current_date + 59), '16:00:00', '65000000-0000-4000-8000-000000900001', 1, 'ACTIVE'),
  ('66000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900001',
   '60000000-0000-4000-8000-000000900001', 'Salida 5K', (current_date + 60), '07:00:00',
   '65000000-0000-4000-8000-000000900001', 2, 'ACTIVE')
on conflict (edition_schedule_item_id) do nothing;

insert into app.kit_definition (kit_definition_id, edition_id, name, status) values
  ('69000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', 'Kit Corredor', 'ACTIVE')
on conflict (kit_definition_id) do nothing;
insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, capacity, status) values
  ('6a000000-0000-4000-8000-000000900001', '69000000-0000-4000-8000-000000900001', 'S', 'Chica', 200, 'ACTIVE'),
  ('6a000000-0000-4000-8000-000000900002', '69000000-0000-4000-8000-000000900001', 'M', 'Mediana', 200, 'ACTIVE'),
  ('6a000000-0000-4000-8000-000000900003', '69000000-0000-4000-8000-000000900001', 'L', 'Grande', 200, 'ACTIVE'),
  ('6a000000-0000-4000-8000-000000900004', '69000000-0000-4000-8000-000000900001', 'XL', 'Extra grande', 100, 'ACTIVE')
on conflict (kit_variant_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Edition 2: OPEN, EXTERNAL_WHATSAPP. Global + per-Modality capacity, 2-3 Modalities, prices incl.
-- an overlapping later tier, USER_SELECTS + SYSTEM_DERIVES categories, a published form, kit S-XL.
-- ---------------------------------------------------------------------------------------------
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_open_at, registration_close_at, global_capacity,
  city, state_region, country_code, whatsapp_phone_e164, published_at) values
  ('50000000-0000-4000-8000-000000900002', '40000000-0000-4000-8000-000000900001', 'demo-pago-10k-21k',
   'RUNIIS Demo Pago 10K/21K', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'OPEN', 'EXTERNAL_WHATSAPP', 'America/Monterrey',
   now() - interval '10 days', now() + interval '80 days', 1000, 'San Pedro Garza García', 'NL', 'MX',
   '+528110000001', now() - interval '10 days')
on conflict (edition_id) do nothing;

insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900002', 1, 'DATE_TIME_CONFIRMED',
   (current_date + 90), '06:30:00', 'America/Monterrey',
   ((current_date + 90) + time '06:30:00') at time zone 'America/Monterrey',
   '20000000-0000-4000-8000-000000200001')
on conflict (edition_schedule_revision_id) do nothing;

insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit,
  local_start_time, status, sort_order) values
  ('60000000-0000-4000-8000-000000900003', '50000000-0000-4000-8000-000000900002', '10k', '10K', 10000, true, '06:30:00', 'ACTIVE', 1),
  ('60000000-0000-4000-8000-000000900004', '50000000-0000-4000-8000-000000900002', '21k', '21K Medio Maratón', 21097, true, '06:45:00', 'ACTIVE', 2)
on conflict (modality_id) do nothing;
insert into app.modality_capacity (modality_id, effective_capacity) values
  ('60000000-0000-4000-8000-000000900003', 400),
  ('60000000-0000-4000-8000-000000900004', 300)
on conflict (modality_id) do nothing;

-- Two ACTIVE, overlapping price tiers on the 10K (Master §38: overlap is a warning, never an error).
insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency, starts_at, ends_at, status, priority) values
  ('67000000-0000-4000-8000-000000900001', '60000000-0000-4000-8000-000000900003', 'Precio anticipado', 35000, 'MXN',
   now() - interval '10 days', now() + interval '40 days', 'ACTIVE', 0),
  ('67000000-0000-4000-8000-000000900002', '60000000-0000-4000-8000-000000900003', 'Precio regular (traslape intencional)',
   45000, 'MXN', now() + interval '30 days', now() + interval '80 days', 'ACTIVE', 1),
  ('67000000-0000-4000-8000-000000900003', '60000000-0000-4000-8000-000000900004', 'Precio único 21K', 60000, 'MXN',
   now() - interval '10 days', now() + interval '80 days', 'ACTIVE', 0)
on conflict (price_offer_id) do nothing;

insert into app.category (category_id, edition_id, key, name, assignment_mode, active, sort_order) values
  ('62000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900002', 'libre', 'Libre', 'USER_SELECTS', true, 1),
  ('62000000-0000-4000-8000-000000900003', '50000000-0000-4000-8000-000000900002', 'master', 'Máster 40+', 'SYSTEM_DERIVES', true, 2)
on conflict (category_id) do nothing;
update app.category set eligibility_rule = jsonb_build_object('min_age', 40)
where category_id = '62000000-0000-4000-8000-000000900003';
insert into app.modality_category (modality_id, category_id, edition_id) values
  ('60000000-0000-4000-8000-000000900003', '62000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900002'),
  ('60000000-0000-4000-8000-000000900004', '62000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900002'),
  ('60000000-0000-4000-8000-000000900003', '62000000-0000-4000-8000-000000900003', '50000000-0000-4000-8000-000000900002'),
  ('60000000-0000-4000-8000-000000900004', '62000000-0000-4000-8000-000000900003', '50000000-0000-4000-8000-000000900002')
on conflict do nothing;

insert into app.registration_form (registration_form_id, edition_id, modality_id, version, status) values
  ('63000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900002', null, 1, 'DRAFT')
on conflict (registration_form_id) do nothing;
insert into app.registration_form_field (registration_form_field_id, registration_form_id, field_key, label,
  field_type, required, sort_order, options_config) values
  ('64000000-0000-4000-8000-000000900002', '63000000-0000-4000-8000-000000900002', 't_shirt_size', 'Talla de playera',
   'SELECT', true, 1, jsonb_build_object('options', jsonb_build_array(
     jsonb_build_object('value', 'S', 'label', 'S'), jsonb_build_object('value', 'M', 'label', 'M'),
     jsonb_build_object('value', 'L', 'label', 'L'))))
on conflict (registration_form_field_id) do nothing;
insert into app.registration_form_field (registration_form_field_id, registration_form_id, field_key, label,
  field_type, required, sort_order, validation_config) values
  ('64000000-0000-4000-8000-000000900003', '63000000-0000-4000-8000-000000900002', 'club', 'Club o equipo', 'TEXT',
   false, 2, jsonb_build_object('max_length', 120))
on conflict (registration_form_field_id) do nothing;
update app.registration_form set status = 'PUBLISHED', published_at = now()
where registration_form_id = '63000000-0000-4000-8000-000000900002' and status = 'DRAFT';

insert into app.edition_location (edition_location_id, edition_id, location_type, name, city, state_region,
  country_code, geometry, is_primary, sort_order) values
  ('65000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900002', 'START', 'Parque La Huasteca',
   'Santa Catarina', 'NL', 'MX',
   extensions.st_setsrid(extensions.st_makepoint(-100.4067, 25.6392), 4326)::extensions.geography, true, 1)
on conflict (edition_location_id) do nothing;
update app.edition set primary_location_id = '65000000-0000-4000-8000-000000900002'
where edition_id = '50000000-0000-4000-8000-000000900002' and primary_location_id is null;

insert into app.event_content_block (event_content_block_id, edition_id, block_type, position, status, payload) values
  ('68000000-0000-4000-8000-000000900006', '50000000-0000-4000-8000-000000900002', 'RICH_TEXT', 1, 'PUBLISHED',
   jsonb_build_object('title', 'Sobre la carrera', 'markdown', 'Carrera de pago de prueba local en San Pedro Garza García. [DOCUMENTO DE PRUEBA LOCAL]')),
  ('68000000-0000-4000-8000-000000900004', '50000000-0000-4000-8000-000000900002', 'FAQ', 2, 'PUBLISHED',
   jsonb_build_object('items', jsonb_build_array(
     jsonb_build_object('question', '¿Cómo pago mi inscripción?', 'answer_markdown', 'Un miembro del staff te contacta por WhatsApp para confirmar el pago.')))),
  ('68000000-0000-4000-8000-000000900005', '50000000-0000-4000-8000-000000900002', 'CALLOUT', 3, 'PUBLISHED',
   jsonb_build_object('tone', 'WARNING', 'markdown', 'Cupo limitado por Modalidad — datos sintéticos de desarrollo local.'))
on conflict (event_content_block_id) do nothing;

insert into app.kit_definition (kit_definition_id, edition_id, name, status) values
  ('69000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900002', 'Kit Corredor Pago', 'ACTIVE')
on conflict (kit_definition_id) do nothing;
insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, capacity, status) values
  ('6a000000-0000-4000-8000-000000900005', '69000000-0000-4000-8000-000000900002', 'S', 'Chica', 150, 'ACTIVE'),
  ('6a000000-0000-4000-8000-000000900006', '69000000-0000-4000-8000-000000900002', 'M', 'Mediana', 150, 'ACTIVE'),
  ('6a000000-0000-4000-8000-000000900007', '69000000-0000-4000-8000-000000900002', 'L', 'Grande', 150, 'ACTIVE'),
  ('6a000000-0000-4000-8000-000000900008', '69000000-0000-4000-8000-000000900002', 'XL', 'Extra grande', 50, 'ACTIVE')
on conflict (kit_variant_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Edition 3: NOT_OPEN, PUBLISHED, scheduled in the future (registration has not opened yet).
-- ---------------------------------------------------------------------------------------------
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_open_at, registration_close_at, city, state_region,
  country_code, published_at) values
  ('50000000-0000-4000-8000-000000900003', '40000000-0000-4000-8000-000000900001', 'demo-proximamente',
   'RUNIIS Demo Próximamente', 'PUBLISHED', 'SCHEDULED', 'NOT_OPEN', 'OPEN', 'FREE', 'America/Monterrey',
   now() + interval '20 days', now() + interval '100 days', 'Monterrey', 'NL', 'MX', now() - interval '2 days')
on conflict (edition_id) do nothing;
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000900003', '50000000-0000-4000-8000-000000900003', 1, 'DATE_TIME_CONFIRMED',
   (current_date + 120), '07:00:00', 'America/Monterrey',
   ((current_date + 120) + time '07:00:00') at time zone 'America/Monterrey',
   '20000000-0000-4000-8000-000000200001')
on conflict (edition_schedule_revision_id) do nothing;
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000900005', '50000000-0000-4000-8000-000000900003', '5k', '5K', 5000, true, 'ACTIVE', 1)
on conflict (modality_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Edition 4: POSTPONED (execution_state), registration PAUSED, schedule revision with no new date.
-- ---------------------------------------------------------------------------------------------
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_open_at, registration_close_at, city, state_region,
  country_code, published_at) values
  ('50000000-0000-4000-8000-000000900004', '40000000-0000-4000-8000-000000900001', 'demo-pospuesta',
   'RUNIIS Demo Pospuesta', 'PUBLISHED', 'POSTPONED', 'PAUSED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '15 days', now() + interval '5 days', 'Monterrey', 'NL', 'MX', now() - interval '20 days')
on conflict (edition_id) do nothing;
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id, superseded_at) values
  ('6c000000-0000-4000-8000-000000900010', '50000000-0000-4000-8000-000000900004', 1, 'DATE_TIME_CONFIRMED',
   (current_date + 10), '07:00:00', 'America/Monterrey',
   ((current_date + 10) + time '07:00:00') at time zone 'America/Monterrey',
   '20000000-0000-4000-8000-000000200001', now())
on conflict (edition_schedule_revision_id) do nothing;
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  timezone, reason, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000900004', '50000000-0000-4000-8000-000000900004', 2, 'POSTPONED_NO_NEW_DATE',
   'America/Monterrey', 'Condiciones climáticas (dato sintético)', '20000000-0000-4000-8000-000000200001')
on conflict (edition_schedule_revision_id) do nothing;
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000900006', '50000000-0000-4000-8000-000000900004', '5k', '5K', 5000, true, 'ACTIVE', 1)
on conflict (modality_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Edition 5: CANCELED (execution_state), registration CLOSED, the page stays (Master §33).
-- ---------------------------------------------------------------------------------------------
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_open_at, registration_close_at, city, state_region,
  country_code, published_at) values
  ('50000000-0000-4000-8000-000000900005', '40000000-0000-4000-8000-000000900001', 'demo-cancelada',
   'RUNIIS Demo Cancelada', 'PUBLISHED', 'CANCELED', 'CLOSED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '30 days', now() - interval '2 days', 'Monterrey', 'NL', 'MX', now() - interval '35 days')
on conflict (edition_id) do nothing;
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000900005', '50000000-0000-4000-8000-000000900005', 1, 'DATE_TIME_CONFIRMED',
   (current_date - interval '1 day')::date, '07:00:00', 'America/Monterrey',
   ((current_date - interval '1 day')::date + time '07:00:00') at time zone 'America/Monterrey',
   '20000000-0000-4000-8000-000000200001')
on conflict (edition_schedule_revision_id) do nothing;
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000900007', '50000000-0000-4000-8000-000000900005', '5k', '5K', 5000, true, 'ACTIVE', 1)
on conflict (modality_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Edition 6: FINISHED (past), registration CLOSED, closure_state PENDING (awaiting closure work).
-- ---------------------------------------------------------------------------------------------
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  closure_state, registration_mode, timezone, registration_open_at, registration_close_at, city, state_region,
  country_code, published_at) values
  ('50000000-0000-4000-8000-000000900006', '40000000-0000-4000-8000-000000900001', 'demo-finalizada-2025',
   'RUNIIS Demo Finalizada 2025', 'PUBLISHED', 'FINISHED', 'CLOSED', 'PENDING', 'FREE', 'America/Monterrey',
   now() - interval '120 days', now() - interval '95 days', 'Monterrey', 'NL', 'MX', now() - interval '125 days')
on conflict (edition_id) do nothing;
insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state,
  local_date, local_start_time, timezone, effective_start_at, created_by_staff_id) values
  ('6c000000-0000-4000-8000-000000900006', '50000000-0000-4000-8000-000000900006', 1, 'DATE_TIME_CONFIRMED',
   (current_date - interval '90 days')::date, '07:00:00', 'America/Monterrey',
   ((current_date - interval '90 days')::date + time '07:00:00') at time zone 'America/Monterrey',
   '20000000-0000-4000-8000-000000200001')
on conflict (edition_schedule_revision_id) do nothing;
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000900008', '50000000-0000-4000-8000-000000900006', '5k', '5K', 5000, true, 'ACTIVE', 1)
on conflict (modality_id) do nothing;
