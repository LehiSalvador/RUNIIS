-- P3-Q race-day API gaps (P3-AC-09, P3-AC-10): guardian name + relationship on the scan view and the
-- Guardian desk, REJECTED presented as final, kit ids on the participant row and on the lookup,
-- public_code lookup, and the PASS_SCAN Edition list. Additive over 600/601: nothing here relaxes a gate.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(50);

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
-- Fixture: guardian/buyer, two minor Guests (one will be verified, one rejected) with ACTIVE
-- assignments, an adult Guest; Edition A (PUBLISHED/SCHEDULED, where the stations work), B (DRAFT),
-- C (HIDDEN/IN_PROGRESS), D (PUBLISHED/FINISHED); staff of every role/scope the Edition list must tell apart.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000770001', 'p3q-buyer@example.test'),
  ('00000000-0000-4000-8000-000000770002', 'p3q-admin@example.test'),
  ('00000000-0000-4000-8000-000000770003', 'p3q-checkin-a@example.test'),
  ('00000000-0000-4000-8000-000000770004', 'p3q-checkin-b@example.test'),
  ('00000000-0000-4000-8000-000000770005', 'p3q-moderator@example.test'),
  ('00000000-0000-4000-8000-000000770006', 'p3q-operator-c@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000770001', '00000000-0000-4000-8000-000000770001', 'READY', 'ACTIVE',
   'Tutor Prueba Setecientos', '1985-05-05', 'M', '+528110077001', 'Contacto', '+528110077002', 'Hermano', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000770001', 'c0000000-0000-4000-8000-000000770001', 'ELIGIBLE', true);
-- Same rows onboarding writes for the CURRENT account-level documents (a no-op on a database with none published),
-- so the fixture also runs on a local database that already holds published TERMS/PRIVACY versions.
insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context)
select '10000000-0000-4000-8000-000000770001', c.legal_document_version_id, '{"via": "test-fixture"}'::jsonb
from private.account_legal_current_versions() c;
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000770001', '10000000-0000-4000-8000-000000770001', 'Menor Verificada Setenta',
   (now() - interval '16 years')::date, 'F', '+528110077003', 'Contacto', '+528110077004', 'Madre'),
  ('30000000-0000-4000-8000-000000770002', '10000000-0000-4000-8000-000000770001', 'Menor Rechazada Setenta',
   (now() - interval '16 years')::date, 'F', '+528110077005', 'Contacto', '+528110077006', 'Madre'),
  ('30000000-0000-4000-8000-000000770003', '10000000-0000-4000-8000-000000770001', 'Adulto Kit Setenta',
   '1990-01-01', 'M', '+528110077007', 'Contacto', '+528110077008', 'Amigo');
insert into app.guardian_assignment (guardian_assignment_id, minor_guest_participant_id, guardian_profile_id,
  relationship_type, status, activated_at) values
  ('35000000-0000-4000-8000-000000770001', '30000000-0000-4000-8000-000000770001', '10000000-0000-4000-8000-000000770001',
   'PARENT', 'ACTIVE', now()),
  ('35000000-0000-4000-8000-000000770002', '30000000-0000-4000-8000-000000770002', '10000000-0000-4000-8000-000000770001',
   'LEGAL_GUARDIAN', 'ACTIVE', now());

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000770001', event_type_id, 'Test Raceday Evento 770', 'test-raceday-evento-770'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000770001', '40000000-0000-4000-8000-000000770001', 'test-raceday-a-770',
   'Test Raceday Edition A 770', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now()),
  ('50000000-0000-4000-8000-000000770002', '40000000-0000-4000-8000-000000770001', 'test-raceday-b-770',
   'Test Raceday Edition B DRAFT 770', 'DRAFT', 'SCHEDULED', 'NOT_OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', null),
  ('50000000-0000-4000-8000-000000770003', '40000000-0000-4000-8000-000000770001', 'test-raceday-c-770',
   'Test Raceday Edition C HIDDEN 770', 'HIDDEN', 'IN_PROGRESS', 'CLOSED', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now()),
  ('50000000-0000-4000-8000-000000770004', '40000000-0000-4000-8000-000000770001', 'test-raceday-d-770',
   'Test Raceday Edition D FINISHED 770', 'PUBLISHED', 'FINISHED', 'CLOSED', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000770001', '50000000-0000-4000-8000-000000770001', '10k', '10K', 10000, true, 1);

insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000770001', '00000000-0000-4000-8000-000000770002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000770002', '00000000-0000-4000-8000-000000770003', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000770003', '00000000-0000-4000-8000-000000770004', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000770004', '00000000-0000-4000-8000-000000770005', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000770005', '00000000-0000-4000-8000-000000770006', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000770001', 'ADMIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000770002', 'CHECKIN', 'EDITION', '50000000-0000-4000-8000-000000770001'),
  ('20000000-0000-4000-8000-000000770003', 'CHECKIN', 'EDITION', '50000000-0000-4000-8000-000000770002'),
  ('20000000-0000-4000-8000-000000770004', 'MODERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000770005', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000770003');

insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at)
select '69000000-0000-4000-8000-000000770001', legal_document_id, 1, 'Acepto el deslinde.', 'PUBLISHED', now()
from app.legal_document where document_key = 'SPORT_WAIVER'
on conflict (legal_document_id, version) do nothing;
insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at)
select '69000000-0000-4000-8000-000000770002', legal_document_id, 1, 'Términos de menor.', 'PUBLISHED', now()
from app.legal_document where document_key = 'MINOR_TERMS'
on conflict (legal_document_id, version) do nothing;
create temp table doc_ids (name text primary key, value uuid) on commit drop;
insert into doc_ids select 'waiver', (private.current_legal_version(legal_document_id) ->> 'legal_document_version_id')::uuid
from app.legal_document where document_key = 'SPORT_WAIVER';
insert into doc_ids select 'minor_terms', (private.current_legal_version(legal_document_id) ->> 'legal_document_version_id')::uuid
from app.legal_document where document_key = 'MINOR_TERMS';
grant select on doc_ids to authenticated;

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770001", "role": "authenticated"}';

insert into ids select 'minor_ok', public.create_registration_request('50000000-0000-4000-8000-000000770001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000770001',
    'modality_id', '60000000-0000-4000-8000-000000770001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver')),
    jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'minor_terms'))));
insert into ids select 'minor_rej', public.create_registration_request('50000000-0000-4000-8000-000000770001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000770002',
    'modality_id', '60000000-0000-4000-8000-000000770001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver')),
    jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'minor_terms'))));
insert into ids select 'adult', public.create_registration_request('50000000-0000-4000-8000-000000770001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000770003',
    'modality_id', '60000000-0000-4000-8000-000000770001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver'))));

select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_minor_ok from ids where name = 'minor_ok';
select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_minor_rej from ids where name = 'minor_rej';
select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_adult from ids where name = 'adult';
grant select on t_minor_ok, t_minor_rej, t_adult to authenticated;

reset role;
insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash,
  token_ciphertext, encryption_key_version, status) values
  ('39000000-0000-4000-8000-000000770001', (select pass_id from t_minor_ok)::uuid, 1, repeat('a', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE'),
  ('39000000-0000-4000-8000-000000770002', (select pass_id from t_minor_rej)::uuid, 1, repeat('b', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE'),
  ('39000000-0000-4000-8000-000000770003', (select pass_id from t_adult)::uuid, 1, repeat('c', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE');
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000770001' where participant_pass_id = (select pass_id from t_minor_ok)::uuid;
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000770002' where participant_pass_id = (select pass_id from t_minor_rej)::uuid;
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000770003' where participant_pass_id = (select pass_id from t_adult)::uuid;
-- The scanner's NOT_YET_ALLOWED window (opens the day before the sport date) is irrelevant here; the
-- Edition has no schedule revision, so it fails open exactly as in 600.

insert into app.kit_definition (kit_definition_id, edition_id, name, status) values
  ('70000000-0000-4000-8000-000000770001', '50000000-0000-4000-8000-000000770001', 'Playera', 'ACTIVE');
insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, capacity, status) values
  ('71000000-0000-4000-8000-000000770001', '70000000-0000-4000-8000-000000770001', 'M', 'Mediana', null, 'ACTIVE');
insert into app.kit_allocation (kit_allocation_id, registration_id, kit_definition_id, kit_variant_id, status, assigned_at) values
  ('72000000-0000-4000-8000-000000770001', (select reg_id from t_adult)::uuid, '70000000-0000-4000-8000-000000770001',
   '71000000-0000-4000-8000-000000770001', 'ASSIGNED', now());

create temp table codes (name text primary key, value text) on commit drop;
insert into codes select 'adult', public_code from app.participant_pass where participant_pass_id = (select pass_id from t_adult)::uuid;
grant select on codes to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- D1: guardian name + relationship on the scan view (CHECKIN scoped to Edition A).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770003", "role": "authenticated"}';
create temp table scan_ok (r jsonb) on commit drop;
grant select, insert on scan_ok to authenticated;
insert into scan_ok select public.raceday_check_in_scan('50000000-0000-4000-8000-000000770001', repeat('a', 64), 'S1');
select is((select r ->> 'outcome' from scan_ok), 'GUARDIAN_VERIFICATION_REQUIRED', 'the unverified minor scan requires guardian verification');
select is((select r -> 'participant' -> 'guardian' ->> 'display_name' from scan_ok), 'Tutor Prueba Setecientos',
  'D1 the scan view names the guardian to verify in person');
select is((select r -> 'participant' -> 'guardian' ->> 'relationship_type' from scan_ok), 'PARENT',
  'D1 the scan view carries the relationship_type of the assignment');
select is((select array_agg(k order by k) from scan_ok, jsonb_object_keys(r -> 'participant' -> 'guardian') k),
  array['display_name', 'relationship_type'],
  'P3-AC-09 the guardian block carries exactly name and relationship (no email, phone, DOB or ids)');
select is((select position('1985' in (r -> 'participant')::text) from scan_ok), 0,
  'P3-AC-09 the guardian date of birth is nowhere in the scan participant view');
select is((select position('+52811007' in (r -> 'participant')::text) from scan_ok), 0,
  'P3-AC-09 no phone number appears in the scan participant view');
select is((select r -> 'participant' ->> 'guardian_state' from scan_ok), 'PENDING', 'the minor''s own fields are unchanged (guardian_state)');
select is((select r -> 'participant' ->> 'display_name' from scan_ok), 'Menor Verificada Setenta', 'the minor''s display name is unchanged');

-- A second minor, same guardian, a different relationship: each view names its own assignment.
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000770001', repeat('b', 64), 'S1') -> 'participant' -> 'guardian' ->> 'relationship_type'),
  'LEGAL_GUARDIAN', 'D1 each minor''s view uses its own guardian assignment');

-- An adult has no guardian block at all.
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000770001', repeat('c', 64), 'S1') -> 'participant' ->> 'guardian'),
  null, 'an adult participant carries no guardian block');

-- ---------------------------------------------------------------------------------------------
-- D1 + D6: Guardian desk list. PENDING is actionable; REJECTED is final.
-- ---------------------------------------------------------------------------------------------
select is((select jsonb_array_length(public.raceday_list_guardian_verifications('50000000-0000-4000-8000-000000770001') -> 'items')), 2,
  'both minors are listed as PENDING');
select is((select i -> 'participant' -> 'guardian' ->> 'display_name'
    from jsonb_array_elements(public.raceday_list_guardian_verifications('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i -> 'participant' ->> 'display_name' = 'Menor Verificada Setenta'),
  'Tutor Prueba Setecientos', 'D1 the desk row names the guardian');
select is((select i -> 'actions' from jsonb_array_elements(public.raceday_list_guardian_verifications('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i -> 'participant' ->> 'display_name' = 'Menor Rechazada Setenta'),
  '["VERIFY", "REJECT"]'::jsonb, 'a PENDING row offers verify and reject');
select is((select (i ->> 'is_final')::boolean from jsonb_array_elements(public.raceday_list_guardian_verifications('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i -> 'participant' ->> 'display_name' = 'Menor Rechazada Setenta'),
  false, 'a PENDING row is not final');

select is((public.raceday_guardian_reject((select reg_id from t_minor_rej)::uuid, 'el adulto no acredita ser el tutor') ->> 'status'), 'REJECTED',
  'CHECKIN rejects the guardian verification');
select is((select i ->> 'is_final' from jsonb_array_elements(public.raceday_list_guardian_verifications('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i -> 'participant' ->> 'display_name' = 'Menor Rechazada Setenta'),
  'true', 'D6 a REJECTED row is final');
select is((select i -> 'actions' from jsonb_array_elements(public.raceday_list_guardian_verifications('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i -> 'participant' ->> 'display_name' = 'Menor Rechazada Setenta'),
  '[]'::jsonb, 'D6 a REJECTED row offers no actions');
select is((select i ->> 'status' from jsonb_array_elements(public.raceday_list_guardian_verifications('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i -> 'participant' ->> 'display_name' = 'Menor Rechazada Setenta'),
  'REJECTED', 'the final row is still listed with its status');
select is(pg_temp.err(format($$ select public.raceday_guardian_verify(%L, 'ID físico') $$, (select reg_id from t_minor_rej))) -> 'detail' ->> 'reason',
  'ALREADY_REJECTED', 'D6 there is no re-open: verifying a REJECTED verification is CONFLICT ALREADY_REJECTED');
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000770001', repeat('b', 64), 'S1') ->> 'outcome'),
  'OTHER_REVIEW', 'a rejected minor re-scans as OTHER_REVIEW');

-- Once VERIFIED the guardian block disappears: nothing more to verify, nothing more exposed.
select is((public.raceday_guardian_verify((select reg_id from t_minor_ok)::uuid, 'ID físico + comparación con foto') ->> 'status'), 'VERIFIED',
  'the other minor is verified');
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000770001', repeat('a', 64), 'S1') ->> 'outcome'), 'VALID',
  'the verified minor now checks in');
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000770001', repeat('a', 64), 'S1') -> 'participant' ->> 'guardian'), null,
  'P3-AC-09 a VERIFIED minor''s view no longer carries the guardian block');

-- ---------------------------------------------------------------------------------------------
-- D8: lookup by public_code (exact, case-insensitive), scoped to the Edition and role.
-- ---------------------------------------------------------------------------------------------
select is((select jsonb_array_length(public.raceday_participant_search('50000000-0000-4000-8000-000000770001',
    (select value from codes where name = 'adult')) -> 'items')), 1, 'D8 the exact public_code finds the participant');
select is((public.raceday_participant_search('50000000-0000-4000-8000-000000770001', (select lower(value) from codes where name = 'adult'))
    -> 'items' -> 0 ->> 'registration_id'), (select reg_id from t_adult), 'D8 the match is case-insensitive');
select is((public.raceday_participant_search('50000000-0000-4000-8000-000000770001', (select value from codes where name = 'adult'))
    -> 'items' -> 0 ->> 'public_code'), (select value from codes where name = 'adult'), 'the item exposes its public_code');
select is((select jsonb_array_length(public.raceday_participant_search('50000000-0000-4000-8000-000000770001',
    (select left(value, length(value) - 1) from codes where name = 'adult')) -> 'items')), 0,
  'D8 a partial public_code does not match (exact only)');
select is(pg_temp.err(format($$ select public.raceday_participant_search('50000000-0000-4000-8000-000000770002', %L) $$,
    (select value from codes where name = 'adult'))) ->> 'code', 'FORBIDDEN',
  'D8 the lookup stays scoped: CHECKIN of Edition A cannot search Edition B by code');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770001", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.raceday_participant_search('50000000-0000-4000-8000-000000770001', %L) $$,
    (select value from codes where name = 'adult'))) ->> 'code', 'FORBIDDEN',
  'a non-staff account cannot use the lookup, by code or by name');
-- ---------------------------------------------------------------------------------------------
-- D2: kit ids on the admin participant row and on the lookup (ADMIN global holds every action).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770002", "role": "authenticated"}';
select is((select i -> 'kit' ->> 'kit_allocation_id' from jsonb_array_elements(public.admin_list_participants('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i ->> 'registration_id' = (select reg_id from t_adult)), '72000000-0000-4000-8000-000000770001',
  'D2 the admin participant row carries kit_allocation_id');
select is((select i -> 'kit' ->> 'kit_definition_id' from jsonb_array_elements(public.admin_list_participants('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i ->> 'registration_id' = (select reg_id from t_adult)), '70000000-0000-4000-8000-000000770001',
  'D2 the admin participant row carries kit_definition_id');
select is((select i -> 'kit' ->> 'kit_pickup_id' from jsonb_array_elements(public.admin_list_participants('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i ->> 'registration_id' = (select reg_id from t_adult)), null,
  'D2 nothing delivered yet: kit_pickup_id is null');
select is((select i ->> 'kit' from jsonb_array_elements(public.admin_list_participants('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i ->> 'registration_id' = (select reg_id from t_minor_ok)), null,
  'a participant without an allocation still has kit = null');
select is((select i -> 'kit' ->> 'kit_allocation_id' from jsonb_array_elements(public.raceday_participant_search(
    '50000000-0000-4000-8000-000000770001', 'Adulto Kit') -> 'items') i), '72000000-0000-4000-8000-000000770001',
  'D2 the lookup carries kit_allocation_id');
select is((select array_agg(k order by k) from jsonb_array_elements(public.raceday_participant_search(
    '50000000-0000-4000-8000-000000770001', 'Adulto Kit') -> 'items') i, jsonb_object_keys(i -> 'kit') k),
  array['kit_allocation_id', 'kit_definition_id', 'kit_pickup_id', 'kit_variant_id', 'status', 'variant_label'],
  'the lookup kit object holds ids, size and state only');

create temp table pickup (kit_pickup_id uuid) on commit drop;
grant select, insert on pickup to authenticated;
insert into pickup select (public.raceday_record_kit_pickup('50000000-0000-4000-8000-000000770001', '70000000-0000-4000-8000-000000770001',
  null, (select reg_id from t_adult)::uuid, 'K1') ->> 'kit_pickup_id')::uuid;
select is((select i -> 'kit' ->> 'kit_pickup_id' from jsonb_array_elements(public.admin_list_participants('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i ->> 'registration_id' = (select reg_id from t_adult)), (select kit_pickup_id::text from pickup),
  'D2 after delivery the admin row carries the active kit_pickup_id (reversal reachable from the UI)');
select is((select i -> 'kit' ->> 'kit_pickup_id' from jsonb_array_elements(public.raceday_participant_search(
    '50000000-0000-4000-8000-000000770001', 'Adulto Kit') -> 'items') i), (select kit_pickup_id::text from pickup),
  'D2 after delivery the lookup carries the active kit_pickup_id');
select is((public.raceday_reverse_kit_pickup((select kit_pickup_id from pickup), 'entrega registrada por error') ->> 'status'), 'REVERSED',
  'the exposed kit_pickup_id is the one the reversal API accepts');
select is((select i -> 'kit' ->> 'kit_pickup_id' from jsonb_array_elements(public.admin_list_participants('50000000-0000-4000-8000-000000770001') -> 'items') i
    where i ->> 'registration_id' = (select reg_id from t_adult)), null,
  'after the reversal there is no active kit_pickup_id again');
select is(pg_temp.err(format($$ select public.raceday_change_kit_allocation_size(%L, '71000000-0000-4000-8000-000000770001', 'misma talla') $$,
    (select i -> 'kit' ->> 'kit_allocation_id' from jsonb_array_elements(public.admin_list_participants('50000000-0000-4000-8000-000000770001') -> 'items') i
      where i ->> 'registration_id' = (select reg_id from t_adult)))) -> 'detail' ->> 'field', 'new_kit_variant_id',
  'D2 the exposed kit_allocation_id is the one the size-change API accepts (it answers on the variant, not NOT_FOUND)');

-- ---------------------------------------------------------------------------------------------
-- D3: Editions a scanner staff member may operate (PASS_SCAN per scope; never DRAFT / not runnable).
-- ---------------------------------------------------------------------------------------------
select is((select array_agg(i ->> 'edition_id' order by i ->> 'edition_id') from jsonb_array_elements(public.raceday_list_scanner_editions() -> 'items') i
    where i ->> 'edition_id' like '50000000-0000-4000-8000-00000077%'),
  array['50000000-0000-4000-8000-000000770001', '50000000-0000-4000-8000-000000770003'],
  'D3 a GLOBAL ADMIN sees the published and the hidden-in-progress Edition, not the DRAFT nor the FINISHED one');
select is((select array_agg(k order by k) from jsonb_array_elements(public.raceday_list_scanner_editions() -> 'items') i, jsonb_object_keys(i) k
    where i ->> 'edition_id' = '50000000-0000-4000-8000-000000770001'),
  array['date', 'edition_id', 'event_name', 'name', 'publication_state', 'state', 'timezone'],
  'D3 the item carries id, name, date, timezone and state (plus the event name and publication state)');
select is((select i ->> 'state' from jsonb_array_elements(public.raceday_list_scanner_editions() -> 'items') i
    where i ->> 'edition_id' = '50000000-0000-4000-8000-000000770003'), 'IN_PROGRESS',
  'D3 a non-public (HIDDEN) Edition the role may operate is listed with its state');
select is((select i ->> 'timezone' from jsonb_array_elements(public.raceday_list_scanner_editions() -> 'items') i
    where i ->> 'edition_id' = '50000000-0000-4000-8000-000000770001'), 'America/Monterrey', 'D3 the item carries the Edition timezone');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770003", "role": "authenticated"}';
select is((select array_agg(i ->> 'edition_id') from jsonb_array_elements(public.raceday_list_scanner_editions() -> 'items') i
    where i ->> 'edition_id' like '50000000-0000-4000-8000-00000077%'),
  array['50000000-0000-4000-8000-000000770001'],
  'D3 CHECKIN scoped to Edition A sees only Edition A (the role the admin Editions list could not serve)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770004", "role": "authenticated"}';
select is((select count(*)::int from jsonb_array_elements(public.raceday_list_scanner_editions() -> 'items') i
    where i ->> 'edition_id' like '50000000-0000-4000-8000-00000077%'), 0,
  'D3 CHECKIN scoped only to a DRAFT Edition is never offered it');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770006", "role": "authenticated"}';
select is((select array_agg(i ->> 'edition_id') from jsonb_array_elements(public.raceday_list_scanner_editions() -> 'items') i
    where i ->> 'edition_id' like '50000000-0000-4000-8000-00000077%'),
  array['50000000-0000-4000-8000-000000770003'], 'D3 an EDITION-scoped OPERATOR sees only their own Edition');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770005", "role": "authenticated"}';
select is(pg_temp.err($$ select public.raceday_list_scanner_editions() $$) ->> 'code', 'FORBIDDEN', 'D3 a MODERATOR holds no PASS_SCAN: FORBIDDEN');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000770001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.raceday_list_scanner_editions() $$) ->> 'code', 'FORBIDDEN', 'D3 a non-staff account is FORBIDDEN');
reset role;
select is(has_function_privilege('anon', 'public.raceday_list_scanner_editions()', 'execute'), false, 'D3 anon cannot execute the Edition list');

select * from finish();
rollback;
