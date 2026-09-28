-- T34 staff commands, passes and participants (Master §70-84, §124, §152, §172; SEC-005/020/023/030/034/035).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(37);

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
-- Fixture: one buyer, an unrelated third party (BOLA), two Guests, ADMIN and OPERATOR staff, an
-- EXTERNAL_WHATSAPP Edition requiring a SPORT_WAIVER acceptance for every participant.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000410001', 'reg-staff-buyer@example.test'),
  ('00000000-0000-4000-8000-000000410002', 'reg-staff-third@example.test'),
  ('00000000-0000-4000-8000-000000410003', 'reg-staff-admin@example.test'),
  ('00000000-0000-4000-8000-000000410004', 'reg-staff-operator@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000410001', '00000000-0000-4000-8000-000000410001', 'READY', 'ACTIVE',
   'Staff Test Buyer', '1985-05-05', 'M', '+528110004201', 'Contacto', '+528110004202', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000410002', '00000000-0000-4000-8000-000000410002', 'READY', 'ACTIVE',
   'Staff Test Third Party', '1985-05-05', 'F', '+528110004203', 'Contacto', '+528110004204', 'Hermana', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000410001', 'c0000000-0000-4000-8000-000000410001', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000410002', 'c0000000-0000-4000-8000-000000410002', 'ELIGIBLE', true);
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000410001', '10000000-0000-4000-8000-000000410001', 'Staff Test Guest 1', '1994-01-01',
   'M', '+528110004205', 'Contacto', '+528110004206', 'Amigo'),
  ('30000000-0000-4000-8000-000000410002', '10000000-0000-4000-8000-000000410001', 'Staff Test Guest 2', '1994-01-01',
   'M', '+528110004207', 'Contacto', '+528110004208', 'Amigo');

insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000410001', '00000000-0000-4000-8000-000000410003', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000410002', '00000000-0000-4000-8000-000000410004', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000410001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000410002', 'OPERATOR', 'GLOBAL');

-- Generic seed invariant (020_seeds.test.sql): app.legal_document_version is empty after db:reset, so
-- every task publishes its own version inside its own rolled-back transaction. Guard with ON CONFLICT so
-- a concurrently-running fixture that already published SPORT_WAIVER v1 is reused rather than erroring.
insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown,
  status, published_at)
select '69000000-0000-4000-8000-000000410001', legal_document_id, 1, 'Acepto el deslinde.', 'PUBLISHED', now()
from app.legal_document where document_key = 'SPORT_WAIVER'
on conflict (legal_document_id, version) do nothing;
create temp table doc_ids (name text primary key, value uuid) on commit drop;
insert into doc_ids select 'waiver', (private.current_legal_version(legal_document_id) ->> 'legal_document_version_id')::uuid
from app.legal_document where document_key = 'SPORT_WAIVER';
grant select on doc_ids to authenticated;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000410001', event_type_id, 'Test Staff Registro', 'test-staff-registro-410'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code,
  whatsapp_phone_e164, published_at) values
  ('50000000-0000-4000-8000-000000410001', '40000000-0000-4000-8000-000000410001', 'test-staff-registro-410',
   'Test Staff Registro 410', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'EXTERNAL_WHATSAPP', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', '+528110009998', now());
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000410001', '50000000-0000-4000-8000-000000410001', '21k', '21K', 21000, true, 1);
insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency) values
  ('67000000-0000-4000-8000-000000410001', '60000000-0000-4000-8000-000000410001', 'General', 50000, 'MXN');

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Legal acceptance gate (Master §124): the buyer cannot submit without accepting for themself first.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410001", "role": "authenticated"}';
select is(pg_temp.err(
  $$ select public.create_registration_request('50000000-0000-4000-8000-000000410001',
       jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000410001',
         'modality_id', '60000000-0000-4000-8000-000000410001'))) $$) ->> 'code', 'LEGAL_ACCEPTANCE_REQUIRED',
  'Master §124: a request cannot be submitted before the buyer accepts their own documents');

select is((select value -> 'subject' ->> 'kind' from (
  select jsonb_array_elements(public.list_my_pending_actions('50000000-0000-4000-8000-000000410001') -> 'items') value) s
  limit 1), 'SELF', 'list_my_pending_actions surfaces the buyer''s own missing acceptance for the Edition');

insert into ids select 'accept', public.accept_edition_documents('50000000-0000-4000-8000-000000410001',
  array[(select value from doc_ids where name = 'waiver')]::uuid[]);
select is((select jsonb_array_length(value -> 'missing_document_version_ids') from ids where name = 'accept'), 0,
  'accept_edition_documents records the buyer''s own acceptance');
select is((select jsonb_array_length(public.list_my_pending_actions('50000000-0000-4000-8000-000000410001') -> 'items')), 0,
  'the accepted document no longer appears as a pending action');

-- req1: buyer self, now unblocked.
insert into ids select 'req1', public.create_registration_request('50000000-0000-4000-8000-000000410001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000410001',
    'modality_id', '60000000-0000-4000-8000-000000410001')));
select is((select value ->> 'status' from ids where name = 'req1'), 'PENDING_CONFIRMATION',
  'req1 is created once the buyer''s own acceptance is on file');

-- ---------------------------------------------------------------------------------------------
-- Staff confirm (Master §71): before expiry, idempotent, REGISTRATION_REQUEST_MANAGE. Confirming req1
-- frees the buyer's "one PENDING request per Edition" slot (Master §179) for req2 below.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410004", "role": "authenticated"}';
insert into ids select 'req1_confirmed', public.confirm_registration_request(
  (select value ->> 'registration_request_id' from ids where name = 'req1')::uuid);
select is((select value ->> 'status' from ids where name = 'req1_confirmed'),
  'CONFIRMED', 'OPERATOR confirms a pending EXTERNAL_WHATSAPP request');
select is(public.confirm_registration_request((select value ->> 'registration_request_id' from ids where name = 'req1')::uuid) ->> 'status',
  'CONFIRMED', 'confirming an already-CONFIRMED request is idempotent (Master §171)');
select is(pg_temp.err(format($$ select public.staff_cancel_registration_request(%L, 'no aplica') $$,
  (select value ->> 'registration_request_id' from ids where name = 'req1'))) -> 'detail' ->> 'reason', 'REQUEST_NOT_CANCELABLE',
  'a CONFIRMED request cannot be staff-cancelled (Master §73: PENDING or EXPIRED only)');

-- req2: a Guest, accepted inline at creation time (acceptor = the owning buyer).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410001", "role": "authenticated"}';
insert into ids select 'req2', public.create_registration_request('50000000-0000-4000-8000-000000410001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000410001',
    'modality_id', '60000000-0000-4000-8000-000000410001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver'))));
select is((select value ->> 'status' from ids where name = 'req2'), 'PENDING_CONFIRMATION',
  'req2 (Guest) is created with the acceptance supplied inline');

-- Third party (BOLA / no staff role): FORBIDDEN, never a state leak.
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410002", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.confirm_registration_request(%L) $$,
  (select value ->> 'registration_request_id' from ids where name = 'req2'))) ->> 'code', 'FORBIDDEN',
  'a non-staff caller cannot confirm a registration request');

-- ---------------------------------------------------------------------------------------------
-- Worker expiry (Master §152) is independent of any command: expires_at alone governs.
-- ---------------------------------------------------------------------------------------------
reset role;
update app.registration_request set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
  where registration_request_id = (select value ->> 'registration_request_id' from ids where name = 'req2')::uuid;
update app.registration_hold set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
  where registration_request_id = (select value ->> 'registration_request_id' from ids where name = 'req2')::uuid;
select isnt(private.worker_expire_registration_requests() ->> 'expired', '0', 'the worker materialises at least one expired request');
select is((select status from app.registration_request
           where registration_request_id = (select value ->> 'registration_request_id' from ids where name = 'req2')::uuid),
  'EXPIRED', 'the worker moved req2 (past expires_at) to EXPIRED');
select is((select status from app.registration_hold
           where registration_request_id = (select value ->> 'registration_request_id' from ids where name = 'req2')::uuid),
  'EXPIRED', 'the worker released req2''s hold');

-- ---------------------------------------------------------------------------------------------
-- RevalidateExpiredRegistrationRequestAndConfirm (Master §72): PRICE_CHANGED blocks until acknowledged.
-- ---------------------------------------------------------------------------------------------
update app.price_offer set amount_minor = 60000 where price_offer_id = '67000000-0000-4000-8000-000000410001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410004", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.revalidate_and_confirm_registration_request(%L) $$,
  (select value ->> 'registration_request_id' from ids where name = 'req2'))) ->> 'code', 'PRICE_CHANGED',
  'a changed price blocks revalidate-and-confirm until acknowledged');
insert into ids select 'req2_revalidated', public.revalidate_and_confirm_registration_request(
  (select value ->> 'registration_request_id' from ids where name = 'req2')::uuid, 60000::bigint);
select is((select value ->> 'status' from ids where name = 'req2_revalidated'), 'CONFIRMED',
  'acknowledging the new total (p_expected_total_minor) confirms the revalidated request');
select is((select value ->> 'revalidated_from_expired' from ids where name = 'req2_revalidated'), 'true',
  'the confirmed request is flagged revalidated_from_expired (Master §72)');

-- req3: a second Guest, cancellable while still PENDING or EXPIRED (never CONFIRMED).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410001", "role": "authenticated"}';
insert into ids select 'req3', public.create_registration_request('50000000-0000-4000-8000-000000410001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000410002',
    'modality_id', '60000000-0000-4000-8000-000000410001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver'))));
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410003", "role": "authenticated"}';
select is(public.staff_cancel_registration_request((select value ->> 'registration_request_id' from ids where name = 'req3')::uuid,
  'comprador solicitó cancelación') ->> 'status', 'CANCELED_BY_STAFF', 'ADMIN staff-cancels a PENDING request (Master §73)');
select is(public.staff_cancel_registration_request((select value ->> 'registration_request_id' from ids where name = 'req3')::uuid,
  'repetido') ->> 'status', 'CANCELED_BY_STAFF', 'staff cancel is idempotent once CANCELED_BY_STAFF');

-- ---------------------------------------------------------------------------------------------
-- Pass viewer rules (Master §80-84, A3): the titular and the buyer-of-a-GUEST see their pass; a
-- third party never does (SEC-010).
-- ---------------------------------------------------------------------------------------------
select value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id into temp t_pass1
  from ids where name = 'req1_confirmed';
select value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id into temp t_pass2
  from ids where name = 'req2_revalidated';
grant select on t_pass1, t_pass2 to authenticated;

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410001", "role": "authenticated"}';
select lives_ok(format($$ select public.authorize_pass_render(%L) $$, (select pass_id from t_pass1)),
  'the titular can authorise rendering their own pass');
select lives_ok(format($$ select public.authorize_pass_render(%L) $$, (select pass_id from t_pass2)),
  'the buyer can authorise rendering the GUEST pass they bought');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410002", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.authorize_pass_render(%L) $$, (select pass_id from t_pass1))) ->> 'code',
  'NOT_FOUND', 'SEC-010 a third party gets NOT_FOUND rendering someone else''s pass, never PASS_REVOKED or a state leak');
select is(pg_temp.err(format($$ select public.get_my_pass(%L) $$, (select pass_id from t_pass1))) ->> 'code', 'NOT_FOUND',
  'SEC-010 a third party gets NOT_FOUND reading someone else''s pass');

-- ---------------------------------------------------------------------------------------------
-- Credential issuance is SYSTEM-only (A1); staff replacement only retires the ACTIVE credential.
-- ---------------------------------------------------------------------------------------------
select is(has_function_privilege('authenticated',
  'public.issue_pass_credential(uuid, uuid, text, bytea, integer)', 'EXECUTE'), false,
  'A1: issue_pass_credential is never executable by authenticated');
select is(has_function_privilege('authenticated',
  'public.get_pass_credential_material(uuid)', 'EXECUTE'), false,
  'A1: get_pass_credential_material is never executable by authenticated (no direct RPC credential leak)');
select is(has_function_privilege('service_role',
  'public.issue_pass_credential(uuid, uuid, text, bytea, integer)', 'EXECUTE'), true,
  'A1: the SYSTEM (service_role) client is the only issuer');

reset role;
select private.issue_pass_credential((select pass_id from t_pass1)::uuid, gen_random_uuid(), repeat('a', 64),
  decode(repeat('00', 40), 'hex'), 1);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410004", "role": "authenticated"}';
insert into ids select 'replaced', public.replace_pass_credential((select pass_id from t_pass1)::uuid, 'runner reportó pérdida del QR');
select is((select value ->> 'replaced_version' from ids where name = 'replaced'), '1',
  'replace_pass_credential retires the version the SYSTEM had issued');
select is((select value ->> 'next_version' from ids where name = 'replaced'), '2',
  'replace_pass_credential reserves the next version for the SYSTEM to issue');
reset role;
select is((select status from app.participant_pass_credential
           where participant_pass_credential_id = ((select value ->> 'replaced_credential_id' from ids where name = 'replaced'))::uuid),
  'REPLACED', 'the old credential is REPLACED, never deleted (append-only)');
select is((select current_credential_id from app.participant_pass where participant_pass_id = (select pass_id from t_pass1)::uuid),
  null, 'the pass has no ACTIVE credential until the SYSTEM issues the next version');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Participants list/export: PII_EXPORT (ADMIN only, global) gates contact data and CSV export
-- (Master §145, §172; SEC-023).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410004", "role": "authenticated"}';
select is((public.admin_list_participants('50000000-0000-4000-8000-000000410001') ->> 'contact_visible'), 'false',
  'OPERATOR (PARTICIPANT_LIST_READ, no PII_EXPORT) sees the roster without contact data');
select is((select bool_and(i ->> 'contact' is null) from jsonb_array_elements(
  public.admin_list_participants('50000000-0000-4000-8000-000000410001') -> 'items') i), true,
  'contact is null for every row when the caller lacks PII_EXPORT');
select is(pg_temp.err($$ select public.admin_export_participants('50000000-0000-4000-8000-000000410001', 'auditoria') $$)
  ->> 'code', 'FORBIDDEN', 'OPERATOR cannot export participants: PII_EXPORT is ADMIN-only and global_only');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000410003", "role": "authenticated"}';
select is((public.admin_list_participants('50000000-0000-4000-8000-000000410001') ->> 'contact_visible'), 'true',
  'ADMIN (global PII_EXPORT) sees contact_visible=true');
select is((select count(*) > 0 from jsonb_array_elements(
  public.admin_list_participants('50000000-0000-4000-8000-000000410001') -> 'items') i
  where i -> 'contact' ->> 'phone_e164' is not null), true, 'ADMIN sees populated contact data');
insert into ids select 'export', public.admin_export_participants('50000000-0000-4000-8000-000000410001', 'auditoria trimestral');
select is(((select value ->> 'row_count' from ids where name = 'export'))::int >= 2, true,
  'admin_export_participants returns every CONFIRMED registration of the Edition');
reset role;
select is((select count(*)::int from audit.audit_log where action = 'PARTICIPANT_EXPORT'), 1,
  'SEC-023 the export is audited (row count and filters, never the exported rows)');

-- ---------------------------------------------------------------------------------------------
-- No bearer token ever reaches the outbox (SEC-011/033).
-- ---------------------------------------------------------------------------------------------
reset role;
select is((select count(*)::int from infra.outbox_event where aggregate_type in ('Registration', 'ParticipantPass')
           and payload::text like '%RN1.%'), 0, 'SEC-011/033: no outbox payload for this domain ever carries an RN1 token');

select * from finish();
rollback;
