begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(94);

-- Synthetic fixture: two Editions (ED1, ED2) so cross-edition references can be attempted.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'runner-a@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'runner-b@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'staff@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name) values
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001', 'Runner Alfa'),
  ('10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000002', 'Runner Beta');
insert into app.staff_member (staff_member_id, auth_user_id) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'Invitado Gamma', '1990-01-01',
   'M', '+528110000001', 'Contacto Gamma', '+528110000002', 'Hermano');
insert into app.event (event_id, event_type_id, name, canonical_key)
  select '40000000-0000-4000-8000-000000000001', event_type_id, 'Carrera Sintética', 'carrera-sintetica'
  from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, registration_close_at,
  city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'carrera-sintetica-2026',
   'Carrera Sintética 2026', 'EXTERNAL_WHATSAPP', 'America/Monterrey', now() + interval '30 days', 'Monterrey', 'NL', 'MX'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'carrera-sintetica-2027',
   'Carrera Sintética 2027', 'EXTERNAL_WHATSAPP', 'America/Monterrey', now() + interval '400 days', 'Monterrey', 'NL', 'MX');
insert into app.edition_location (edition_location_id, edition_id, location_type, name, geometry, sort_order) values
  ('51000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'VENUE', 'Parque',
   extensions.st_geogfromtext('SRID=4326;POINT(-100.31 25.67)'), 1);
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10k', '10K', 10000, true, 1),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '10k', '10K', 10000, true, 1),
  ('60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '5k', '5K', 5000, true, 2);
insert into app.registration_form (registration_form_id, edition_id, modality_id, version) values
  ('65000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', null, 1),
  ('65000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', 1),
  ('65000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', null, 1);
insert into app.registration_form_field (registration_form_field_id, registration_form_id, field_key, label, field_type,
  required, sort_order) values
  ('66000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', 'shirt', 'Playera', 'TEXT', true, 1),
  ('66000000-0000-4000-8000-000000000003', '65000000-0000-4000-8000-000000000003', 'club', 'Club', 'TEXT', false, 1),
  ('66000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000002', 'shirt', 'Playera', 'TEXT', true, 1);
insert into app.modality_capacity (modality_id, effective_capacity) values ('60000000-0000-4000-8000-000000000001', 100);
insert into app.category (category_id, edition_id, name, key, assignment_mode, sort_order) values
  ('61000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Libre', 'libre', 'USER_SELECTS', 1),
  ('61000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'Libre', 'libre', 'USER_SELECTS', 1);
insert into app.kit_definition (kit_definition_id, edition_id, name, status) values
  ('62000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Kit', 'ACTIVE'),
  ('62000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'Kit', 'ACTIVE');
insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, capacity, status) values
  ('63000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'M', 'M', 50, 'ACTIVE'),
  ('63000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000002', 'M', 'M', 50, 'ACTIVE');
insert into app.route (route_id, edition_id, name) values
  ('64000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Ruta 10K');
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor, expires_at) values
  ('70000000-0000-4000-8000-000000000001', 'R-0001-AAAA', '10000000-0000-4000-8000-00000000000a',
   '50000000-0000-4000-8000-000000000001', 'EXTERNAL_WHATSAPP', 'MXN', 0, now() + interval '24 hours'),
  ('70000000-0000-4000-8000-000000000003', 'R-0003-AAAA', '10000000-0000-4000-8000-00000000000b',
   '50000000-0000-4000-8000-000000000001', 'EXTERNAL_WHATSAPP', 'MXN', 0, now() + interval '24 hours');
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, guest_participant_id, modality_id, category_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'PROFILE',
   '10000000-0000-4000-8000-00000000000a', null, '60000000-0000-4000-8000-000000000001',
   '61000000-0000-4000-8000-000000000001', 0, 'MXN', '{}'),
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'GUEST',
   null, '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', null, 0, 'MXN', '{}'),
  ('71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 'PROFILE',
   '10000000-0000-4000-8000-00000000000a', null, '60000000-0000-4000-8000-000000000001', null, 0, 'MXN', '{}'),
  ('71000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000003', 'GUEST',
   null, '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', null, 0, 'MXN', '{}');
insert into app.registration_participant_claim (edition_id, registration_request_id, request_participant_id,
  runner_profile_id, guest_participant_id, expires_at) values
  ('50000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', null, now() + interval '24 hours'),
  ('50000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000002', null, '30000000-0000-4000-8000-000000000001', now() + interval '24 hours');
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, guest_participant_id, buyer_profile_id, registration_number) values
  ('72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-00000000000a', null, '10000000-0000-4000-8000-00000000000a', 'I-0001-AAAA'),
  ('72000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
   null, '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'I-0002-AAAA');
insert into app.participant_pass (participant_pass_id, registration_id, public_code) values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'P-0001-AAAA'),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'P-0002-AAAA');
insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash,
  token_ciphertext, encryption_key_version) values
  ('74000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 1, repeat('a', 64),
   decode(repeat('00', 60), 'hex'), 1),
  ('74000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000002', 1, repeat('c', 64),
   decode(repeat('00', 60), 'hex'), 1);
update app.participant_pass set current_credential_id = '74000000-0000-4000-8000-000000000001'
  where participant_pass_id = '73000000-0000-4000-8000-000000000001';
insert into app.kit_allocation (kit_allocation_id, registration_id, kit_definition_id, kit_variant_id) values
  ('75000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
   '62000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001');
insert into app.kit_pickup (registration_id, kit_allocation_id, edition_id, delivered_by_staff_id, verification_method) values
  ('72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'QR');
insert into app.attendance_checkin (attendance_checkin_id, edition_id, registration_id, verification_method,
  checked_in_by_staff_id) values
  ('76000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '72000000-0000-4000-8000-000000000001', 'QR', '20000000-0000-4000-8000-000000000001');
insert into app.attendance_resolution (attendance_resolution_id, edition_id, registration_id, revision, status, source,
  checkin_id) values
  ('77000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '72000000-0000-4000-8000-000000000001', 1, 'PRESENT', 'CHECKIN', '76000000-0000-4000-8000-000000000001'),
  ('77000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001',
   '72000000-0000-4000-8000-000000000002', 1, 'PENDING', 'INITIAL', null);
insert into app.sporting_eligibility_resolution (sporting_eligibility_resolution_id, registration_id, revision, status,
  distance_credit_disposition) values
  ('78000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 1, 'ELIGIBLE', 'ALLOW'),
  ('78000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 1, 'ELIGIBLE', 'ALLOW');
insert into app.attendance_finalization (attendance_finalization_id, edition_id, revision, expected_count, present_count,
  no_show_count, excluded_count, finalized_by_staff_id) values
  ('79000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 1, 2, 2, 0, 0,
   '20000000-0000-4000-8000-000000000001');
insert into app.administrative_closure (administrative_closure_id, edition_id, revision, attendance_finalization_id,
  closed_by_staff_id) values
  ('7a000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 1,
   '79000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
insert into app.distance_credit (distance_credit_id, runner_profile_id, registration_id, edition_id, modality_id,
  attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
  official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone) values
  ('7b000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001',
   '79000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001',
   10000, 10000, '2026-10-25', 'America/Monterrey');
insert into app.ranking_period (ranking_period_id, period_type, period_key, starts_at, ends_at, timezone) values
  ('7c000000-0000-4000-8000-000000000001', 'MONTHLY', '2026-10', '2026-10-01 06:00+00', '2026-11-01 06:00+00',
   'America/Monterrey');
insert into app.ranking_snapshot (ranking_snapshot_id, ranking_period_id, revision, cutoff_at, ranking_epoch_snapshot,
  ledger_watermark, eligibility_rule_version, generated_by) values
  ('7d000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000001', 1, '2026-11-01 06:00+00',
   '2026-10-25', 'wm-1', 1, 'test');
insert into app.ranking_snapshot_entry (ranking_snapshot_id, runner_profile_id, rank_position, credited_distance_m,
  credit_count, display_name_snapshot, eligibility_snapshot) values
  ('7d000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 1, 10000, 1, 'Runner Alfa', '{}');
insert into app.achievement_grant (achievement_grant_id, achievement_definition_id, runner_profile_id, ranking_period_id,
  ranking_snapshot_id, place, grant_key)
  select '7e000000-0000-4000-8000-000000000001', achievement_definition_id, '10000000-0000-4000-8000-00000000000a',
         '7c000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', 1, 'MONTHLY_PODIUM_1:2026-10:a'
  from app.achievement_definition where family = 'MONTHLY_PODIUM' and place = 1;
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone,
  created_by_staff_id) values
  ('50000000-0000-4000-8000-000000000001', 1, 'DATE_TIME_CONFIRMED', '2026-10-25', '07:00', 'America/Monterrey',
   '20000000-0000-4000-8000-000000000001');
insert into app.registration_revision (registration_id, revision, modality_id, status, effective_from, reason,
  changed_by_staff_id) values
  ('72000000-0000-4000-8000-000000000001', 1, '60000000-0000-4000-8000-000000000001', 'CURRENT', now(), 'Alta',
   '20000000-0000-4000-8000-000000000001');
insert into audit.audit_log (action, entity_type) values ('TEST', 'fixture');

------------------------------------------------------------------------------------------------------------------------
-- Foreign keys and cross-edition coherence (Master §161 #28, §204)
------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ insert into app.registration_request_participant (registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('70000000-0000-4000-8000-000000000003', 'PROFILE', '10000000-0000-4000-8000-00000000000b',
   '60000000-0000-4000-8000-0000000000ff', 0, 'MXN', '{}') $$, '23503', null, 'FK: unknown modality is rejected');
select throws_ok($$ insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at)
  values ('70000000-0000-4000-8000-0000000000ff', '60000000-0000-4000-8000-000000000001', 1, now() + interval '1 hour') $$,
  '23503', null, 'FK: hold for unknown request is rejected');
select throws_ok($$ insert into app.registration_request_participant (registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('70000000-0000-4000-8000-000000000003', 'PROFILE', '10000000-0000-4000-8000-00000000000b',
   '60000000-0000-4000-8000-000000000002', 0, 'MXN', '{}') $$, '23503', null,
  'cross-edition: request participant modality from another Edition');
select throws_ok($$ insert into app.registration_request_participant (registration_request_id, participant_kind,
  runner_profile_id, modality_id, category_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('70000000-0000-4000-8000-000000000003', 'PROFILE', '10000000-0000-4000-8000-00000000000b',
   '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 0, 'MXN', '{}') $$, '23503', null,
  'cross-edition: request participant category from another Edition');
select throws_ok($$ insert into app.modality_category (modality_id, category_id, edition_id) values
  ('60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'cross-edition: modality_category mixing Editions');
select lives_ok($$ insert into app.modality_category (modality_id, category_id, edition_id) values
  ('60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001') $$,
  'same-edition modality_category is accepted');
select throws_ok($$ insert into app.route_modality (route_id, modality_id, edition_id) values
  ('64000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'cross-edition: route_modality mixing Editions');
select throws_ok($$ insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at)
  values ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', 1, now() + interval '1 hour') $$,
  '23503', null, 'cross-edition: hold modality from another Edition');
select throws_ok($$ insert into app.kit_selection (request_participant_id, kit_definition_id, kit_variant_id) values
  ('71000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'cross-edition: kit selection of another Edition''s kit');
select throws_ok($$ insert into app.kit_selection (request_participant_id, kit_definition_id, kit_variant_id) values
  ('71000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'kit selection variant must belong to the selected kit');
select throws_ok($$ insert into app.kit_allocation (registration_id, kit_definition_id, kit_variant_id) values
  ('72000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'cross-edition: kit allocation of another Edition''s kit');
select throws_ok($$ insert into app.registration_category_assignment (registration_id, category_id, assignment_source,
  eligibility_snapshot) values ('72000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002',
  'USER_SELECTION', '{}') $$, '23503', null, 'cross-edition: category assignment from another Edition');
select throws_ok($$ update app.edition set primary_location_id = '51000000-0000-4000-8000-000000000002'
  where edition_id = '50000000-0000-4000-8000-000000000001' $$, '23503', null,
  'cross-edition: primary location of another Edition');
select throws_ok($$ insert into app.attendance_checkin (edition_id, registration_id, verification_method,
  checked_in_by_staff_id) values ('50000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'QR',
  '20000000-0000-4000-8000-000000000001') $$, '23503', null, 'cross-edition: check-in Edition differs from registration');
select throws_ok($$ insert into app.administrative_closure (edition_id, revision, attendance_finalization_id,
  closed_by_staff_id) values ('50000000-0000-4000-8000-000000000002', 1, '79000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001') $$, '23503', null, 'cross-edition: closure over another Edition''s finalization');
select lives_ok($$ insert into app.registration_field_response (request_participant_id, registration_form_field_id,
  value_json, field_snapshot) values ('71000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001',
  '"M"', '{}') $$, 'response to an Edition-wide form field is accepted');
select throws_ok($$ insert into app.registration_field_response (request_participant_id, registration_form_field_id,
  value_json, field_snapshot) values ('71000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000002',
  '"M"', '{}') $$, '23503', null, 'cross-edition: form field from another Edition');
select throws_ok($$ insert into app.registration_field_response (request_participant_id, registration_form_field_id,
  value_json, field_snapshot) values ('71000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000003',
  '"Club"', '{}') $$, '23503', null, 'cross-modality: form field of another Modality''s form');
select throws_ok($$ update app.modality set edition_id = '50000000-0000-4000-8000-000000000002'
  where modality_id = '60000000-0000-4000-8000-000000000001' $$, '23001', null, 'modality Edition scope is immutable');

------------------------------------------------------------------------------------------------------------------------
-- Registration invariants
------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ insert into app.registration_request (public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor, expires_at) values ('R-0002-AAAA', '10000000-0000-4000-8000-00000000000a',
  '50000000-0000-4000-8000-000000000001', 'EXTERNAL_WHATSAPP', 'MXN', 0, now() + interval '24 hours') $$, '23505', null,
  'one PENDING_CONFIRMATION request per buyer + Edition');
select throws_ok($$ insert into app.registration_request (public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor) values ('R-0009-AAAA', '10000000-0000-4000-8000-00000000000a',
  '50000000-0000-4000-8000-000000000002', 'EXTERNAL_WHATSAPP', 'MXN', 0) $$, '23514', null,
  'EXTERNAL_WHATSAPP request requires expires_at');
select throws_ok($$ insert into app.registration_request (public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor) values ('R-0010-AAAA', '10000000-0000-4000-8000-00000000000a',
  '50000000-0000-4000-8000-000000000002', 'FREE', 'mxn', 0) $$, '23514', null, 'currency must be ISO upper-case');
select throws_ok($$ insert into app.registration_request_participant (registration_request_id, participant_kind,
  runner_profile_id, guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('70000000-0000-4000-8000-000000000003', 'PROFILE', '10000000-0000-4000-8000-00000000000b',
   '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 0, 'MXN', '{}') $$, '23514', null,
  'PROFILE/GUEST exclusivity on request participants');
select throws_ok($$ insert into app.registration_request_participant (registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('70000000-0000-4000-8000-000000000001', 'PROFILE', '10000000-0000-4000-8000-00000000000a',
   '60000000-0000-4000-8000-000000000001', 0, 'MXN', '{}') $$, '23505', null,
  'the same participant cannot repeat within a request');
select throws_ok($$ insert into app.registration_request_participant (registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('70000000-0000-4000-8000-000000000003', 'PROFILE', '10000000-0000-4000-8000-00000000000b',
   '60000000-0000-4000-8000-000000000001', -1, 'MXN', '{}') $$, '23514', null, 'price snapshot must be >= 0');
select throws_ok($$ insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at)
  values ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 0, now() + interval '1 hour') $$,
  '23514', null, 'hold quantity must be > 0');
select throws_ok($$ insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at)
  values ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 1, now()) $$,
  '23514', null, 'hold expires_at must be after created_at');
select throws_ok($$ update app.modality_capacity set effective_capacity = -1 $$, '23514', null,
  'modality capacity must be >= 0');
select throws_ok($$ update app.edition set global_capacity = -1 where edition_id = '50000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'edition global_capacity must be >= 0');
select throws_ok($$ insert into app.price_offer (modality_id, name, amount_minor, currency) values
  ('60000000-0000-4000-8000-000000000001', 'General', -100, 'MXN') $$, '23514', null, 'price amount must be >= 0');

select throws_ok($$ insert into app.registration_participant_claim (edition_id, registration_request_id,
  request_participant_id, runner_profile_id) values ('50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a') $$,
  '23505', null, 'duplicate ACTIVE participant claim (profile) in the same Edition');
select throws_ok($$ insert into app.registration_participant_claim (edition_id, registration_request_id,
  request_participant_id, guest_participant_id) values ('50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'duplicate ACTIVE participant claim (guest) in the same Edition');
select throws_ok($$ insert into app.registration_participant_claim (edition_id, registration_request_id,
  request_participant_id, runner_profile_id) values ('50000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a') $$,
  '23503', null, 'claim Edition must be the request Edition');
select throws_ok($$ insert into app.registration_participant_claim (edition_id, registration_request_id,
  request_participant_id, runner_profile_id) values ('50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000b') $$,
  '23503', null, 'claim must name the participant''s own runner');

select throws_ok($$ insert into app.registration (registration_request_id, request_participant_id, edition_id,
  modality_id, runner_profile_id, buyer_profile_id, registration_number) values ('70000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000b', 'I-0003-AAAA') $$, '23505', null,
  'duplicate CONFIRMED registration for a runner in the same Edition');
select throws_ok($$ insert into app.registration (registration_request_id, request_participant_id, edition_id,
  modality_id, guest_participant_id, buyer_profile_id, registration_number) values ('70000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000b', 'I-0004-AAAA') $$, '23505', null,
  'duplicate CONFIRMED registration for a guest in the same Edition');
select throws_ok($$ insert into app.registration (registration_request_id, request_participant_id, edition_id,
  modality_id, runner_profile_id, buyer_profile_id, registration_number) values ('70000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b', 'I-0005-AAAA') $$, '23503', null,
  'registration must name the request participant''s runner');
select throws_ok($$ insert into app.registration (registration_request_id, request_participant_id, edition_id,
  modality_id, runner_profile_id, buyer_profile_id, registration_number, status, canceled_at) values
  ('70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   'I-0006-AAAA', 'CANCELED', now()) $$, '23503', null, 'registration buyer must be the request buyer');
select throws_ok($$ insert into app.registration (registration_request_id, request_participant_id, edition_id,
  modality_id, runner_profile_id, buyer_profile_id, registration_number, status, canceled_at) values
  ('70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000b',
   'I-0007-AAAA', 'CANCELED', now()) $$, '23503', null, 'cross-edition: registration modality');
select throws_ok($$ update app.registration set runner_profile_id = '10000000-0000-4000-8000-00000000000b'
  where registration_id = '72000000-0000-4000-8000-000000000001' $$, '23001', null, 'registration identity is immutable');

select throws_ok($$ insert into app.participant_pass (registration_id, public_code) values
  ('72000000-0000-4000-8000-000000000001', 'P-0009-AAAA') $$, '23505', null, 'one ParticipantPass per registration');
select throws_ok($$ insert into app.participant_pass_credential (participant_pass_id, version, token_hash,
  token_ciphertext, encryption_key_version) values ('73000000-0000-4000-8000-000000000001', 2, repeat('b', 64),
  decode(repeat('00', 60), 'hex'), 1) $$, '23505', null, 'duplicate ACTIVE credential per pass');
select throws_ok($$ insert into app.participant_pass_credential (participant_pass_id, version, token_hash,
  token_ciphertext, encryption_key_version, status, replaced_at) values ('73000000-0000-4000-8000-000000000002', 2,
  repeat('a', 64), decode(repeat('00', 60), 'hex'), 1, 'REPLACED', now()) $$, '23505', null, 'token_hash is globally unique');
select throws_ok($$ insert into app.participant_pass_credential (participant_pass_id, version, token_hash,
  token_ciphertext, encryption_key_version) values ('73000000-0000-4000-8000-000000000001', 3, 'not-a-sha256',
  decode(repeat('00', 60), 'hex'), 1) $$, '23514', null, 'token_hash must be sha256 hex');
select throws_ok($$ update app.participant_pass set current_credential_id = '74000000-0000-4000-8000-000000000002'
  where participant_pass_id = '73000000-0000-4000-8000-000000000001' $$, '23503', null,
  'current credential must belong to the same pass');
select throws_ok($$ insert into app.kit_pickup (registration_id, kit_allocation_id, edition_id, delivered_by_staff_id,
  verification_method) values ('72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'QR') $$, '23505', null,
  'one DELIVERED kit pickup per allocation');

select throws_ok($$ insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date,
  timezone, created_by_staff_id) values ('50000000-0000-4000-8000-000000000001', 2, 'DATE_CONFIRMED_TIME_PENDING',
  '2026-10-26', 'America/Monterrey', '20000000-0000-4000-8000-000000000001') $$, '23505', null,
  'one current schedule revision per Edition');
select throws_ok($$ insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date,
  timezone, created_by_staff_id) values ('50000000-0000-4000-8000-000000000002', 1, 'DATE_TIME_CONFIRMED',
  '2027-10-26', 'America/Monterrey', '20000000-0000-4000-8000-000000000001') $$, '23514', null,
  'DATE_TIME_CONFIRMED requires a start time (no invented 00:00)');
select throws_ok($$ insert into app.registration_revision (registration_id, revision, modality_id, status,
  effective_from, reason, changed_by_staff_id) values ('72000000-0000-4000-8000-000000000001', 2,
  '60000000-0000-4000-8000-000000000001', 'CURRENT', now(), 'Cambio', '20000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'one current registration revision per registration');
select throws_ok($$ insert into app.registration_revision (registration_id, revision, modality_id, status,
  effective_from, reason, changed_by_staff_id) values ('72000000-0000-4000-8000-000000000002', 1,
  '60000000-0000-4000-8000-000000000002', 'CURRENT', now(), 'Cambio', '20000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'cross-edition: registration revision modality');

------------------------------------------------------------------------------------------------------------------------
-- Race day, closure, credit, ranking
------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ insert into app.attendance_resolution (edition_id, registration_id, revision, status, source)
  values ('50000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 2, 'NO_SHOW', 'CORRECTION') $$,
  '23505', null, 'one current AttendanceResolution per registration');
select throws_ok($$ insert into app.attendance_resolution (edition_id, registration_id, revision, status, source)
  values ('50000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 2, 'PRESENT', 'MANUAL') $$,
  '23514', null, 'manual PRESENT requires actor and reason');
select throws_ok($$ insert into app.sporting_eligibility_resolution (registration_id, revision, status,
  distance_credit_disposition) values ('72000000-0000-4000-8000-000000000001', 2, 'DISQUALIFIED', 'PENDING') $$,
  '23505', null, 'one current SportingEligibilityResolution per registration');
select throws_ok($$ insert into app.attendance_finalization (edition_id, revision, expected_count, present_count,
  no_show_count, excluded_count, finalized_by_staff_id) values ('50000000-0000-4000-8000-000000000001', 2, 2, 2, 0, 0,
  '20000000-0000-4000-8000-000000000001') $$, '23505', null, 'one current AttendanceFinalization per Edition');
select throws_ok($$ insert into app.administrative_closure (edition_id, revision, attendance_finalization_id,
  closed_by_staff_id) values ('50000000-0000-4000-8000-000000000001', 2, '79000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001') $$, '23505', null, 'one current AdministrativeClosure per Edition');

select throws_ok($$ update app.administrative_closure set reopened_at = now(),
  reopened_by_staff_id = '20000000-0000-4000-8000-000000000001', reopen_reason = 'Corrección' $$, '23514', null,
  'a reopened closure cannot stay current (must be SUPERSEDED)');
select throws_ok($$ update app.attendance_finalization set status = 'SUPERSEDED', superseded_at = now(), reopened_at = now(),
  reopened_by_staff_id = '20000000-0000-4000-8000-000000000001' $$, '23514', null, 'reopening a finalization requires a reason');

select throws_ok($$ insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
  attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
  official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone) values
  ('10000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001',
   '7a000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', 10000, 10000, '2026-10-25',
   'America/Monterrey') $$, '23505', null, 'one ACTIVE DistanceCredit per registration');
select throws_ok($$ insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
  attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
  official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone) values
  ('10000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001',
   '7a000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000002', 10000, 10000, '2026-10-25',
   'America/Monterrey') $$, '23503', null, 'Guest registration can never hold a DistanceCredit');
select throws_ok($$ insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
  attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
  official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone, status, reversed_at) values
  ('10000000-0000-4000-8000-00000000000b', '72000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001',
   '7a000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', 10000, 10000, '2026-10-25',
   'America/Monterrey', 'REVERSED', now()) $$, '23503', null, 'credit runner must be the registration runner');
select throws_ok($$ insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
  attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
  official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone, status, reversed_at) values
  ('10000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001',
   '7a000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', 10000, 10000, '2026-10-25',
   'America/Monterrey', 'REVERSED', now()) $$, '23503', null, 'credit attendance basis must be the same registration');
select throws_ok($$ insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
  attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
  official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone, status, reversed_at) values
  ('10000000-0000-4000-8000-00000000000a', '72000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001',
   '7a000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', 0, 0, '2026-10-25',
   'America/Monterrey', 'REVERSED', now()) $$, '23514', null, 'official_distance_snapshot_m must be > 0');

select throws_ok($$ insert into app.ranking_snapshot (ranking_period_id, revision, cutoff_at, ranking_epoch_snapshot,
  ledger_watermark, eligibility_rule_version, generated_by) values ('7c000000-0000-4000-8000-000000000001', 2,
  '2026-11-01 06:00+00', '2026-10-25', 'wm-2', 1, 'test') $$, '23505', null, 'one CURRENT RankingSnapshot per period');
select throws_ok($$ insert into app.ranking_projection_entry (projection_type, ranking_period_id, runner_profile_id,
  credited_distance_m, credit_count, rank_position, ledger_watermark) values ('WEEKLY',
  '7c000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 10000, 1, 1, 'wm-1') $$, '23503', null,
  'WEEKLY projection cannot point at a MONTHLY period');
select throws_ok($$ insert into app.ranking_projection_entry (projection_type, ranking_period_id, runner_profile_id,
  credited_distance_m, credit_count, rank_position, ledger_watermark) values ('HISTORICAL_LIVE',
  '7c000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 10000, 1, 1, 'wm-1') $$, '23514', null,
  'HISTORICAL_LIVE projection has no period');
insert into app.ranking_projection_entry (projection_type, runner_profile_id, credited_distance_m, credit_count,
  rank_position, ledger_watermark) values ('HISTORICAL_LIVE', '10000000-0000-4000-8000-00000000000a', 10000, 1, 1, 'wm-1');
select throws_ok($$ insert into app.ranking_projection_entry (projection_type, runner_profile_id, credited_distance_m,
  credit_count, rank_position, ledger_watermark) values ('HISTORICAL_LIVE', '10000000-0000-4000-8000-00000000000a',
  10000, 1, 1, 'wm-1') $$, '23505', null, 'one HISTORICAL_LIVE projection row per runner');

------------------------------------------------------------------------------------------------------------------------
-- Append-only and no-delete history
------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ delete from app.registration where registration_id = '72000000-0000-4000-8000-000000000002' $$,
  '23001', null, 'registration rows cannot be deleted');
select throws_ok($$ delete from app.registration_request where registration_request_id = '70000000-0000-4000-8000-000000000003' $$,
  '23001', null, 'registration_request rows cannot be deleted');
select throws_ok($$ update app.registration_request_participant set price_snapshot_minor = 5
  where request_participant_id = '71000000-0000-4000-8000-000000000003' $$, '23001', null,
  'request participant snapshots are immutable');
select throws_ok($$ delete from app.participant_pass where participant_pass_id = '73000000-0000-4000-8000-000000000002' $$,
  '23001', null, 'participant_pass rows cannot be deleted');
select throws_ok($$ delete from app.participant_pass_credential
  where participant_pass_credential_id = '74000000-0000-4000-8000-000000000002' $$, '23001', null,
  'credential rows cannot be deleted');
select throws_ok($$ update app.participant_pass_credential set token_hash = repeat('d', 64)
  where participant_pass_credential_id = '74000000-0000-4000-8000-000000000002' $$, '23001', null,
  'credential token cannot be rewritten');
select throws_ok($$ delete from app.kit_pickup $$, '23001', null, 'kit_pickup rows cannot be deleted');
select throws_ok($$ delete from app.attendance_checkin $$, '23001', null, 'attendance_checkin rows cannot be deleted');
select throws_ok($$ delete from app.attendance_resolution
  where attendance_resolution_id = '77000000-0000-4000-8000-000000000002' $$, '23001', null,
  'attendance_resolution rows cannot be deleted');
select throws_ok($$ update app.attendance_resolution set status = 'NO_SHOW'
  where attendance_resolution_id = '77000000-0000-4000-8000-000000000002' $$, '23001', null,
  'attendance_resolution is corrected by a new revision, not rewritten');
select throws_ok($$ delete from app.sporting_eligibility_resolution
  where sporting_eligibility_resolution_id = '78000000-0000-4000-8000-000000000002' $$, '23001', null,
  'sporting_eligibility_resolution rows cannot be deleted');
select throws_ok($$ delete from app.attendance_finalization $$, '23001', null, 'attendance_finalization rows cannot be deleted');
select throws_ok($$ delete from app.administrative_closure $$, '23001', null, 'administrative_closure rows cannot be deleted');
select throws_ok($$ delete from app.distance_credit $$, '23001', null, 'distance_credit rows cannot be deleted');
select throws_ok($$ update app.distance_credit set credited_distance_m = 20000 $$, '23001', null,
  'credited distance cannot be rewritten');
select throws_ok($$ truncate app.distance_credit cascade $$, '23001', null, 'distance_credit cannot be truncated');
select throws_ok($$ delete from app.ranking_snapshot $$, '23001', null, 'ranking_snapshot rows cannot be deleted');
select throws_ok($$ update app.ranking_snapshot_entry set rank_position = 2 $$, '23001', null,
  'ranking_snapshot_entry rows are immutable');
select throws_ok($$ delete from app.ranking_snapshot_entry $$, '23001', null, 'ranking_snapshot_entry rows cannot be deleted');
select throws_ok($$ delete from app.achievement_grant $$, '23001', null, 'achievement_grant rows cannot be deleted');
select throws_ok($$ update app.achievement_grant set place = 2 $$, '23001', null, 'achievement place cannot be rewritten');
select throws_ok($$ update audit.audit_log set action = 'TAMPERED' $$, '23001', null, 'audit_log rejects UPDATE');
select throws_ok($$ delete from audit.audit_log $$, '23001', null, 'audit_log rejects DELETE');
select throws_ok($$ truncate audit.audit_log $$, '23001', null, 'audit_log rejects TRUNCATE');

------------------------------------------------------------------------------------------------------------------------
-- Allowed supersede/reverse transitions keep exactly one current row
------------------------------------------------------------------------------------------------------------------------
select lives_ok($$
  update app.participant_pass_credential set status = 'REPLACED', replaced_at = now()
    where participant_pass_credential_id = '74000000-0000-4000-8000-000000000001';
  insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash,
    token_ciphertext, encryption_key_version) values ('74000000-0000-4000-8000-000000000003',
    '73000000-0000-4000-8000-000000000001', 2, repeat('b', 64), decode(repeat('00', 60), 'hex'), 1);
  update app.participant_pass set current_credential_id = '74000000-0000-4000-8000-000000000003'
    where participant_pass_id = '73000000-0000-4000-8000-000000000001' $$,
  'credential replacement: old REPLACED, new version ACTIVE and current');
select lives_ok($$
  update app.attendance_resolution set superseded_at = now()
    where attendance_resolution_id = '77000000-0000-4000-8000-000000000002';
  insert into app.attendance_resolution (edition_id, registration_id, revision, status, source, resolved_by_staff_id, reason)
    values ('50000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 2, 'NO_SHOW', 'MANUAL',
            '20000000-0000-4000-8000-000000000001', 'Sin evidencia de presencia') $$,
  'attendance correction supersedes and appends a new revision');
select lives_ok($$
  update app.distance_credit set status = 'REVERSED', reversed_at = now(),
    reversed_by_staff_id = '20000000-0000-4000-8000-000000000001', reversal_reason = 'Corrección'
    where distance_credit_id = '7b000000-0000-4000-8000-000000000001' $$,
  'distance credit can be reversed through its reversal columns');
select lives_ok($$
  update app.registration set status = 'CANCELED', canceled_at = now(), cancel_reason = 'Baja'
    where registration_id = '72000000-0000-4000-8000-000000000001';
  insert into app.registration (registration_request_id, request_participant_id, edition_id, modality_id,
    runner_profile_id, buyer_profile_id, registration_number) values ('70000000-0000-4000-8000-000000000003',
    '71000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000b', 'I-0010-AAAA') $$,
  'after cancellation the runner can hold a new CONFIRMED registration in the Edition');

select * from finish();
rollback;
