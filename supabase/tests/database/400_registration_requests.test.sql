-- T34 RegistrationRequest (Master §61-74, §124, §179; SEC-005/006/010/012/020/140-142).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(29);

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
-- Fixture: buyer A, buyer B, a Guest owned by A, a FREE Edition and an EXTERNAL_WHATSAPP Edition
-- with a 1-slot Modality (capacity test) and a global_capacity=1 Edition with two unlimited Modalities
-- (global capacity test). All in a private id range unrelated to supabase/seeds/40_registrations.sql.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000400001', 'reg-buyer-a@example.test'),
  ('00000000-0000-4000-8000-000000400002', 'reg-buyer-b@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000400001', '00000000-0000-4000-8000-000000400001', 'READY', 'ACTIVE',
   'Reg Buyer A', '1990-01-01', 'M', '+528110004101', 'Contacto', '+528110004102', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000400002', '00000000-0000-4000-8000-000000400002', 'READY', 'ACTIVE',
   'Reg Buyer B', '1991-01-01', 'F', '+528110004103', 'Contacto', '+528110004104', 'Hermana', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000400001', 'c0000000-0000-4000-8000-000000400001', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000400002', 'c0000000-0000-4000-8000-000000400002', 'ELIGIBLE', true);
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000400001', '10000000-0000-4000-8000-000000400001', 'Reg Guest A', '1996-01-01',
   'M', '+528110004105', 'Contacto', '+528110004106', 'Amigo');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000400001', event_type_id, 'Test Registro', 'test-registro-400'
from app.event_type where key = 'ROAD_RACE';

-- E1: FREE, single Modality, unlimited capacity.
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000400001', '40000000-0000-4000-8000-000000400001', 'test-registro-400-free',
   'Test Registro 400 FREE', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000400001', '50000000-0000-4000-8000-000000400001', '5k', '5K', 5000, true, 1);
insert into app.category (category_id, edition_id, name, key, assignment_mode, sort_order) values
  ('61000000-0000-4000-8000-000000400001', '50000000-0000-4000-8000-000000400001', 'Libre', 'libre', 'SYSTEM_DERIVES', 1);
insert into app.modality_category (modality_id, category_id, edition_id) values
  ('60000000-0000-4000-8000-000000400001', '61000000-0000-4000-8000-000000400001', '50000000-0000-4000-8000-000000400001');

-- E2: EXTERNAL_WHATSAPP, Modality with effective_capacity=1 (modality-level capacity test).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code,
  whatsapp_phone_e164, published_at) values
  ('50000000-0000-4000-8000-000000400002', '40000000-0000-4000-8000-000000400001', 'test-registro-400-wa',
   'Test Registro 400 WhatsApp', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'EXTERNAL_WHATSAPP', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', '+528110009999', now());
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000400002', '50000000-0000-4000-8000-000000400002', '10k', '10K', 10000, true, 1);
insert into app.modality_capacity (modality_id, effective_capacity) values
  ('60000000-0000-4000-8000-000000400002', 1);
insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency) values
  ('67000000-0000-4000-8000-000000400001', '60000000-0000-4000-8000-000000400002', 'General', 20000, 'MXN');

-- E3: EXTERNAL_WHATSAPP, global_capacity=1 across two unlimited Modalities (global capacity test).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, global_capacity, city, state_region,
  country_code, whatsapp_phone_e164, published_at) values
  ('50000000-0000-4000-8000-000000400003', '40000000-0000-4000-8000-000000400001', 'test-registro-400-global',
   'Test Registro 400 Global', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'EXTERNAL_WHATSAPP', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 1, 'Monterrey', 'NL', 'MX', '+528110009999', now());
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000400003', '50000000-0000-4000-8000-000000400003', 'a', 'A', 5000, true, 1),
  ('60000000-0000-4000-8000-000000400004', '50000000-0000-4000-8000-000000400003', 'b', 'B', 5000, true, 2);
insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency) values
  ('67000000-0000-4000-8000-000000400002', '60000000-0000-4000-8000-000000400003', 'General', 0, 'MXN'),
  ('67000000-0000-4000-8000-000000400003', '60000000-0000-4000-8000-000000400004', 'General', 0, 'MXN');

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;

-- Buyer-accepted-now documents (Master §124: buyer/guardian acceptance is supplied at submit time,
-- for every Edition used below; only an adult Friend's own acceptance may be deferred to confirmation).
-- Generic seed invariant (020_seeds.test.sql): app.legal_document_version is empty after db:reset, so
-- this fixture publishes its own version inside its own rolled-back transaction (ON CONFLICT guards
-- against a concurrently-running fixture that already published the same SPORT_WAIVER v1).
insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown,
  status, published_at)
select '69000000-0000-4000-8000-000000400099', legal_document_id, 1, 'Acepto el deslinde.', 'PUBLISHED', now()
from app.legal_document where document_key = 'SPORT_WAIVER'
on conflict (legal_document_id, version) do nothing;
insert into ids select 'waiver_e1', to_jsonb((select legal_document_version_id
  from private.registration_required_documents('50000000-0000-4000-8000-000000400001', false) where document_type = 'SPORT_WAIVER'));
insert into ids select 'waiver_e2', to_jsonb((select legal_document_version_id
  from private.registration_required_documents('50000000-0000-4000-8000-000000400002', false) where document_type = 'SPORT_WAIVER'));
insert into ids select 'waiver_e3', to_jsonb((select legal_document_version_id
  from private.registration_required_documents('50000000-0000-4000-8000-000000400003', false) where document_type = 'SPORT_WAIVER'));

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- FREE atomic (Master §65-68, §74): request + participant + confirmation + Registration + Pass in
-- one transaction, no staff step.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400001", "role": "authenticated"}';
insert into ids select 'free', public.create_registration_request(
  '50000000-0000-4000-8000-000000400001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400001',
    'modality_id', '60000000-0000-4000-8000-000000400001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from ids where name = 'waiver_e1'))));
select is((select value ->> 'status' from ids where name = 'free'), 'CONFIRMED', 'FREE request confirms inline (Master §74)');
select is((select value -> 'participants' -> 0 -> 'registration' ->> 'status' from ids where name = 'free'), 'CONFIRMED',
  'FREE atomic transaction created the Registration');
select isnt((select value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' from ids where name = 'free'), null,
  'FREE atomic transaction issued a ParticipantPass row');
select is((select count(*)::int from app.registration_category_assignment ca
           join app.registration r on r.registration_id = ca.registration_id
           where r.registration_request_id = ((select value ->> 'registration_request_id' from ids where name = 'free'))::uuid),
  1, 'SYSTEM_DERIVES category was assigned at confirmation (Master §39-40)');

-- ---------------------------------------------------------------------------------------------
-- EXTERNAL_WHATSAPP: creates a hold + claim, stays PENDING_CONFIRMATION, snapshots the WhatsApp number.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'wa', public.create_registration_request(
  '50000000-0000-4000-8000-000000400002',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400001',
    'modality_id', '60000000-0000-4000-8000-000000400002')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from ids where name = 'waiver_e2'))));
select is((select value ->> 'status' from ids where name = 'wa'), 'PENDING_CONFIRMATION', 'EXTERNAL_WHATSAPP request stays PENDING');
select is((select value ->> 'whatsapp_phone_e164' from ids where name = 'wa'), '+528110009999',
  'EXTERNAL_WHATSAPP request carries the Edition WhatsApp number while active');
-- Internal tables (registration_hold, registration_participant_claim) carry no client SELECT grant by
-- design (ADR A4, closed grant model): verify their state as the fixture owner, not through the API role.
reset role;
select is((select count(*)::int from app.registration_hold
           where registration_request_id = ((select value ->> 'registration_request_id' from ids where name = 'wa'))::uuid
             and status = 'ACTIVE'), 1, 'EXTERNAL_WHATSAPP request creates an ACTIVE hold');
select is((select count(*)::int from app.registration_participant_claim
           where registration_request_id = ((select value ->> 'registration_request_id' from ids where name = 'wa'))::uuid
             and status = 'ACTIVE'), 1, 'EXTERNAL_WHATSAPP request creates an ACTIVE participant claim');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400001", "role": "authenticated"}';

-- One effective PENDING_CONFIRMATION request per buyer + Edition (Master §179).
select is(pg_temp.err(format(
  $$ select public.create_registration_request('50000000-0000-4000-8000-000000400002',
       jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', %L,
         'modality_id', '60000000-0000-4000-8000-000000400002'))) $$,
  '30000000-0000-4000-8000-000000400001')) ->> 'code', 'CONFLICT',
  'one effective PENDING request per buyer + Edition (Master §179)');

-- One ACTIVE claim per participant per Edition: the per-participant check runs before the buyer-pending
-- check, so re-offering an already-claimed participant is reported as PARTICIPANT_ALREADY_HELD.
select is(pg_temp.err(format(
  $$ select public.create_registration_request('50000000-0000-4000-8000-000000400002',
       jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', %L,
         'modality_id', '60000000-0000-4000-8000-000000400002'))) $$,
  'c0000000-0000-4000-8000-000000400001')) ->> 'code', 'PARTICIPANT_ALREADY_HELD',
  'one ACTIVE claim per participant per Edition (Master §179)');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400002", "role": "authenticated"}';

-- ---------------------------------------------------------------------------------------------
-- Capacity, recomputed inside the transaction (Master §37): a single call asking for more than the
-- binding limit is rejected without leaving partial rows.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(
  $$ select public.create_registration_request('50000000-0000-4000-8000-000000400002',
       jsonb_build_array(
         jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400002',
           'modality_id', '60000000-0000-4000-8000-000000400002'))) $$) ->> 'code', 'CAPACITY_UNAVAILABLE',
  'modality capacity (1) already consumed by the pending WhatsApp hold is enforced (CAP-001 math)');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400001", "role": "authenticated"}';
insert into ids select 'global', public.create_registration_request(
  '50000000-0000-4000-8000-000000400003',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400001',
    'modality_id', '60000000-0000-4000-8000-000000400003')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from ids where name = 'waiver_e3'))));
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400002", "role": "authenticated"}';
select is(pg_temp.err(
  $$ select public.create_registration_request('50000000-0000-4000-8000-000000400003',
       jsonb_build_array(
         jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400002',
           'modality_id', '60000000-0000-4000-8000-000000400004'))) $$) ->> 'code', 'GLOBAL_CAPACITY_UNAVAILABLE',
  'global_capacity (1) binds across different Modalities of the same Edition');

-- ---------------------------------------------------------------------------------------------
-- Buyer cancel (Master §69, §73) and BOLA (SEC-010): a foreign request is NOT_FOUND, never a state leak.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(format($$ select public.get_registration_request(%L) $$,
  (select value ->> 'registration_request_id' from ids where name = 'wa'))) ->> 'code', 'NOT_FOUND',
  'SEC-010 buyer B cannot read buyer A''s request');
select is(pg_temp.err(format($$ select public.cancel_registration_request(%L) $$,
  (select value ->> 'registration_request_id' from ids where name = 'wa'))) ->> 'code', 'NOT_FOUND',
  'SEC-010 buyer B cannot cancel buyer A''s request');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400001", "role": "authenticated"}';
select is(public.cancel_registration_request((select value ->> 'registration_request_id' from ids where name = 'wa')::uuid,
  'ya no puedo asistir') ->> 'status', 'CANCELED_BY_BUYER', 'buyer cancel moves a PENDING request to CANCELED_BY_BUYER');
reset role;
select is((select count(*)::int from app.registration_hold
           where registration_request_id = ((select value ->> 'registration_request_id' from ids where name = 'wa'))::uuid
             and status = 'RELEASED'), 1, 'buyer cancel releases the hold');
select is((select count(*)::int from app.registration_participant_claim
           where registration_request_id = ((select value ->> 'registration_request_id' from ids where name = 'wa'))::uuid
             and status = 'RELEASED'), 1, 'buyer cancel releases the participant claim');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400001", "role": "authenticated"}';
select is(public.cancel_registration_request((select value ->> 'registration_request_id' from ids where name = 'wa')::uuid) ->> 'status',
  'CANCELED_BY_BUYER', 'cancelling an already-canceled request is a no-op (idempotent)');

-- A newly-freed slot can be claimed again (the released hold no longer counts).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400002", "role": "authenticated"}';
select lives_ok(format(
  $$ select public.create_registration_request('50000000-0000-4000-8000-000000400002',
       jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', %L,
         'modality_id', '60000000-0000-4000-8000-000000400002')),
       jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', %L))) $$,
  'c0000000-0000-4000-8000-000000400002', (select value #>> '{}' from ids where name = 'waiver_e2')),
  'a released hold frees the Modality capacity for another buyer');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400001", "role": "authenticated"}';

-- Cancel on an expired (unmaterialised) request: expires_at governs even if the worker has not run.
reset role;
update app.registration_request set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
  where registration_request_id = (select value ->> 'registration_request_id' from ids where name = 'global')::uuid;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400001", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.cancel_registration_request(%L) $$,
  (select value ->> 'registration_request_id' from ids where name = 'global'))) ->> 'code', 'REQUEST_EXPIRED',
  'Master §63/§72: expiry is effective at expires_at, worker-independent');

-- ---------------------------------------------------------------------------------------------
-- Buyer-safe projection (Master §12/§121): a Friend/Guest's DOB, eligibility snapshot and legal
-- acceptance detail never reach the buyer view; only ids/names/status.
-- ---------------------------------------------------------------------------------------------
select is((select value -> 'participants' -> 0 ? 'eligibility_snapshot' from ids where name = 'free'), false,
  'SEC-012 the buyer view never carries the eligibility_snapshot');

-- list_my_registration_requests: status filter uses the effective (expiry-aware) status.
select is((select jsonb_array_length(public.list_my_registration_requests('EXPIRED') -> 'items') >= 1), true,
  'list_my_registration_requests filters by the effective (expiry-derived) status');
select is((select bool_and((i ->> 'status') = 'CONFIRMED') from jsonb_array_elements(
  public.list_my_registration_requests('CONFIRMED') -> 'items') i), true,
  'list_my_registration_requests(status=CONFIRMED) returns only confirmed requests');

-- Unauthenticated calls fail closed (SEC-006).
set local "request.jwt.claims" = '';
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000400001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400001',
    'modality_id', '60000000-0000-4000-8000-000000400001'))) $$) ->> 'code', 'AUTH_REQUIRED',
  'no session: AUTH_REQUIRED (SEC-006 fail closed)');
select is(pg_temp.err($$ select public.list_my_registration_requests() $$) ->> 'code', 'AUTH_REQUIRED',
  'list without a session: AUTH_REQUIRED');

-- Input validation (SEC-016): unknown participant fields and out-of-range counts are rejected.
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000400001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000400001', '[]'::jsonb) $$)
  ->> 'code', 'VALIDATION_ERROR', 'an empty participants array is rejected');
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000400001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400001',
    'modality_id', '60000000-0000-4000-8000-000000400001', 'unknown_field', 1))) $$) ->> 'code', 'VALIDATION_ERROR',
  'an unknown participant field is rejected');
select is(pg_temp.err($$ select public.create_registration_request(null,
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400001',
    'modality_id', '60000000-0000-4000-8000-000000400001'))) $$) ->> 'code', 'VALIDATION_ERROR',
  'a null Edition id is rejected at the input shape check');
select is(pg_temp.err($$ select public.create_registration_request('00000000-0000-4000-8000-0000000000ff',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000400001',
    'modality_id', '60000000-0000-4000-8000-000000400001'))) $$) ->> 'code', 'NOT_FOUND',
  'SEC-010 an unknown Edition id is NOT_FOUND (no existence oracle)');

select * from finish();
rollback;
