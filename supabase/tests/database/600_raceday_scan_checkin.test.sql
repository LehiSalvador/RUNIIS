-- T40 Race Day scanner: credential validation, EVENT_CHECKIN outcomes (Master §85), guardian gate
-- (§21/§90), MANUAL_VERIFY (SEC-032), staff scope (SEC-020). True concurrency (two stations racing the
-- same token, 100 scans) is proved at the HTTP/integration level; this file proves outcome logic.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(25);

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
-- Fixture: a buyer, an adult+minor Guest, an ACTIVE guardian assignment, two FREE Editions
-- (A hosts the station, B supplies a "wrong event" pass), ADMIN/OPERATOR/CHECKIN(scoped to A) staff.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000600001', 'raceday-buyer@example.test'),
  ('00000000-0000-4000-8000-000000600002', 'raceday-admin@example.test'),
  ('00000000-0000-4000-8000-000000600003', 'raceday-operator@example.test'),
  ('00000000-0000-4000-8000-000000600004', 'raceday-checkin@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000600001', '00000000-0000-4000-8000-000000600001', 'READY', 'ACTIVE',
   'Raceday Buyer', '1985-05-05', 'M', '+528110006001', 'Contacto', '+528110006002', 'Hermano', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000600001', 'c0000000-0000-4000-8000-000000600001', 'ELIGIBLE', true);
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000600001', '10000000-0000-4000-8000-000000600001', 'Raceday Guest Minor',
   (now() - interval '16 years')::date, 'F', '+528110006003', 'Contacto', '+528110006004', 'Madre'),
  ('30000000-0000-4000-8000-000000600002', '10000000-0000-4000-8000-000000600001', 'Raceday Guest ToCancel',
   '1990-01-01', 'M', '+528110006005', 'Contacto', '+528110006006', 'Amigo');
insert into app.guardian_assignment (guardian_assignment_id, minor_guest_participant_id, guardian_profile_id,
  relationship_type, status, activated_at) values
  ('35000000-0000-4000-8000-000000600001', '30000000-0000-4000-8000-000000600001', '10000000-0000-4000-8000-000000600001',
   'PARENT', 'ACTIVE', now());

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000600001', event_type_id, 'Test Raceday Evento', 'test-raceday-evento-600'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000600001', '40000000-0000-4000-8000-000000600001', 'test-raceday-a-600',
   'Test Raceday Edition A', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now()),
  ('50000000-0000-4000-8000-000000600002', '40000000-0000-4000-8000-000000600001', 'test-raceday-b-600',
   'Test Raceday Edition B', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000600001', '50000000-0000-4000-8000-000000600001', '10k', '10K', 10000, true, 1),
  ('60000000-0000-4000-8000-000000600002', '50000000-0000-4000-8000-000000600002', '10k', '10K', 10000, true, 1);

insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000600001', '00000000-0000-4000-8000-000000600002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000600002', '00000000-0000-4000-8000-000000600003', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000600003', '00000000-0000-4000-8000-000000600004', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000600001', 'ADMIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000600002', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000600003', 'CHECKIN', 'EDITION', '50000000-0000-4000-8000-000000600001');

insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at)
select '69000000-0000-4000-8000-000000600001', legal_document_id, 1, 'Acepto el deslinde.', 'PUBLISHED', now()
from app.legal_document where document_key = 'SPORT_WAIVER'
on conflict (legal_document_id, version) do nothing;
insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at)
select '69000000-0000-4000-8000-000000600002', legal_document_id, 1, 'Términos de menor.', 'PUBLISHED', now()
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
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000600001", "role": "authenticated"}';

-- Adult (buyer, PROFILE) in Edition A: the plain VALID path.
insert into ids select 'adult_a', public.create_registration_request('50000000-0000-4000-8000-000000600001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000600001',
    'modality_id', '60000000-0000-4000-8000-000000600001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver'))));
select is((select value ->> 'status' from ids where name = 'adult_a'), 'CONFIRMED', 'FREE adult request confirms inline');

-- Minor Guest in Edition A: the guardian gate path.
insert into ids select 'minor_a', public.create_registration_request('50000000-0000-4000-8000-000000600001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000600001',
    'modality_id', '60000000-0000-4000-8000-000000600001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver')),
    jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'minor_terms'))));
select is((select value ->> 'status' from ids where name = 'minor_a'), 'CONFIRMED', 'FREE minor Guest request confirms inline (guardian accepted)');

-- Same buyer, Edition B: supplies a real pass whose Edition does not match station A.
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000600001", "role": "authenticated"}';
insert into ids select 'adult_b', public.create_registration_request('50000000-0000-4000-8000-000000600002',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000600001',
    'modality_id', '60000000-0000-4000-8000-000000600002')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver'))));
select is((select value ->> 'status' from ids where name = 'adult_b'), 'CONFIRMED', 'FREE adult request confirms inline in Edition B');

-- A second Edition-A registration, canceled directly (fixture only: cancellation itself is T34 scope).
insert into ids select 'adult_canceled', public.create_registration_request('50000000-0000-4000-8000-000000600001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000600002',
    'modality_id', '60000000-0000-4000-8000-000000600001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver'))));

-- ids -> pass ids
select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_adult_a from ids where name = 'adult_a';
select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_minor_a from ids where name = 'minor_a';
select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_adult_b from ids where name = 'adult_b';
select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_canceled from ids where name = 'adult_canceled';
grant select on t_adult_a, t_adult_b, t_minor_a, t_canceled to authenticated;

reset role;
-- Known, fixed credentials (bypasses the SYSTEM issuance worker; full control over the scan_reference).
insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash,
  token_ciphertext, encryption_key_version, status, revoked_at, replaced_at) values
  ('39000000-0000-4000-8000-000000600001', (select pass_id from t_adult_a)::uuid, 1, repeat('1', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE', null, null),
  ('39000000-0000-4000-8000-000000600002', (select pass_id from t_minor_a)::uuid, 1, repeat('2', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE', null, null),
  ('39000000-0000-4000-8000-000000600003', (select pass_id from t_adult_b)::uuid, 1, repeat('3', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE', null, null),
  ('39000000-0000-4000-8000-000000600004', (select pass_id from t_adult_a)::uuid, 2, repeat('4', 64), decode(repeat('00', 40), 'hex'), 1, 'REVOKED', now(), null),
  ('39000000-0000-4000-8000-000000600005', (select pass_id from t_adult_b)::uuid, 2, repeat('5', 64), decode(repeat('00', 40), 'hex'), 1, 'REPLACED', null, now()),
  ('39000000-0000-4000-8000-000000600006', (select pass_id from t_canceled)::uuid, 1, repeat('6', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE', null, null);
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000600001' where participant_pass_id = (select pass_id from t_adult_a)::uuid;
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000600002' where participant_pass_id = (select pass_id from t_minor_a)::uuid;
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000600003' where participant_pass_id = (select pass_id from t_adult_b)::uuid;
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000600006' where participant_pass_id = (select pass_id from t_canceled)::uuid;
update app.registration set status = 'CANCELED', canceled_at = now(), cancel_reason = 'fixture'
  where registration_id = (select reg_id from t_canceled)::uuid;

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Scan outcomes as CHECKIN staff scoped to Edition A only.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000600004", "role": "authenticated"}';

select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('9', 64), 'S1') ->> 'outcome'),
  'UNKNOWN_PASS', 'a token matching no credential is UNKNOWN_PASS (recorded, not an error)');
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('4', 64), 'S1') ->> 'outcome'),
  'REVOKED_CREDENTIAL', 'a revoked credential scan is REVOKED_CREDENTIAL');
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('3', 64), 'S1') ->> 'outcome'),
  'WRONG_EVENT', 'a real Edition-B pass scanned at the Edition-A station is WRONG_EVENT');

select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('2', 64), 'S1') ->> 'outcome'),
  'GUARDIAN_VERIFICATION_REQUIRED', 'a minor without a VERIFIED guardian cannot complete EVENT_CHECKIN (Master §21)');
reset role;
select is((select gv.status from app.guardian_event_verification gv
  where gv.registration_id = (select reg_id from t_minor_a)::uuid), 'PENDING',
  'the scan lazily created the PENDING guardian_event_verification row');
set local role authenticated;
select lives_ok(format($$ select public.raceday_guardian_verify(%L, 'ID físico + comparación con foto') $$,
  (select reg_id from t_minor_a)), 'CHECKIN also holds GUARDIAN_VERIFY and may resolve it');
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('2', 64), 'S1') ->> 'outcome'),
  'VALID', 'once VERIFIED, the same minor pass now completes EVENT_CHECKIN');

select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('1', 64), 'S1') ->> 'outcome'),
  'VALID', 'an adult with no prior check-in is VALID');
select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('1', 64), 'S2') ->> 'outcome'),
  'ALREADY_CHECKED_IN', 'a second scan of the same token (a different station) is ALREADY_CHECKED_IN, never a second VALID');
reset role;
select is((select count(*)::int from app.attendance_checkin where registration_id = (select reg_id from t_adult_a)::uuid and status = 'VERIFIED_PRESENT'), 1,
  'exactly one VERIFIED_PRESENT attendance_checkin row exists for the adult (no double check-in)');
set local role authenticated;

select is((public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('6', 64), 'S1') ->> 'outcome'),
  'CANCELED_REGISTRATION', 'a pass whose registration was canceled is CANCELED_REGISTRATION');

-- ---------------------------------------------------------------------------------------------
-- MANUAL_VERIFY (SEC-032): requires a reason, is audited, and follows the same outcome ladder.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(format($$ select public.raceday_manual_verify('50000000-0000-4000-8000-000000600001', %L, '') $$,
  (select pass_id from t_adult_b))) ->> 'code', 'VALIDATION_ERROR', 'MANUAL_VERIFY rejects an empty reason');
select is((public.raceday_manual_verify('50000000-0000-4000-8000-000000600001', (select pass_id from t_adult_b)::uuid,
  'runner sin telefono, verificado con INE') ->> 'outcome'), 'WRONG_EVENT',
  'MANUAL_VERIFY applies the same Edition check as the scanner');
reset role;
select is((select count(*)::int from audit.audit_log where action = 'EVENT_CHECKIN_RECORDED'
  and entity_id = (select reg_id from t_adult_a)::uuid), 1, 'the VALID check-in was audited exactly once');

-- ---------------------------------------------------------------------------------------------
-- Every attempt is logged, including UNKNOWN_PASS (Master §85 "for EVERY attempt").
-- ---------------------------------------------------------------------------------------------
select is((select count(*)::int from app.participant_pass_scan where outcome = 'UNKNOWN_PASS'
  and edition_id = '50000000-0000-4000-8000-000000600001'), 1, 'the UNKNOWN_PASS attempt was logged');
select is((select count(*)::int from app.participant_pass_scan where staff_member_id = '20000000-0000-4000-8000-000000600003'), 9,
  'every scan attempt by this staff member is logged, valid or not (the denied cross-Edition attempt writes none)');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Staff scope (SEC-020): CHECKIN scoped only to Edition A cannot scan for Edition B.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.raceday_check_in_scan('50000000-0000-4000-8000-000000600002', repeat('3', 64), 'S1') $$) ->> 'code',
  'FORBIDDEN', 'a CHECKIN staff scoped to Edition A cannot scan at Edition B (SEC-020)');

-- A non-staff caller is denied outright.
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000600001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.raceday_check_in_scan('50000000-0000-4000-8000-000000600001', repeat('1', 64), 'S1') $$) ->> 'code',
  'FORBIDDEN', 'a non-staff runner cannot call the scanner');

-- ---------------------------------------------------------------------------------------------
-- Guardian desk: verifying an already-VERIFIED record is an idempotent no-op, not a state change.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000600002", "role": "authenticated"}';
select is((public.raceday_guardian_verify((select reg_id from t_minor_a)::uuid, 'repetido') ->> 'status'), 'VERIFIED',
  'verifying an already-VERIFIED guardian record is idempotent');
select is((public.raceday_list_guardian_verifications('50000000-0000-4000-8000-000000600001') -> 'items'), '[]'::jsonb,
  'no PENDING/REJECTED guardian verification remains once the minor was VERIFIED');

-- Credential + no-leak checks (SEC-011/033).
reset role;
select is((select count(*)::int from infra.outbox_event where aggregate_type in ('Registration', 'KitAllocation')
           and payload::text like '%RN1.%'), 0, 'SEC-011/033: no outbox payload for this domain ever carries an RN1 token');
select is((select count(*)::int from app.participant_pass_scan where metadata::text like '%RN1.%'), 0,
  'SEC-031: participant_pass_scan never stores the token');

select * from finish();
rollback;
