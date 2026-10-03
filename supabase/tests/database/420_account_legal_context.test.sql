-- P2-B OWN-05 account-level legal acceptance + registration context read model
-- (migrations 20261003100000_160 / 20261003100100_161).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(56);

create function pg_temp.err(p_sql text) returns jsonb language plpgsql as $$
declare v_code text; v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('code', v_code, 'sqlstate', sqlstate, 'detail', case when v_detail ~ '^\{' then v_detail::jsonb end);
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture. Documents: archive whatever other suites published so the result is deterministic, then create
-- our own ACTIVE TERMS/PRIVACY (account level) and an ACTIVE SPORT_WAIVER (event level) with one version each.
-- ---------------------------------------------------------------------------------------------
update app.legal_document set status = 'ARCHIVED'
where document_type in ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE', 'SPORT_WAIVER', 'MINOR_TERMS');
insert into app.legal_document (legal_document_id, document_key, document_type, status) values
  ('60000000-0000-4000-8000-000000420001', 'T420_TERMS', 'TERMS_OF_SERVICE', 'ACTIVE'),
  ('60000000-0000-4000-8000-000000420002', 'T420_PRIVACY', 'PRIVACY_NOTICE', 'ACTIVE'),
  ('60000000-0000-4000-8000-000000420003', 'T420_WAIVER', 'SPORT_WAIVER', 'ACTIVE');
insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at) values
  ('69000000-0000-4000-8000-000000420001', '60000000-0000-4000-8000-000000420001', 1, 'terminos v1', 'PUBLISHED', now()),
  ('69000000-0000-4000-8000-000000420002', '60000000-0000-4000-8000-000000420002', 1, 'privacidad v1', 'PUBLISHED', now()),
  ('69000000-0000-4000-8000-000000420003', '60000000-0000-4000-8000-000000420003', 1, 'deslinde v1', 'PUBLISHED', now());

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000420001', 'legal-a@example.test'),
  ('00000000-0000-4000-8000-000000420002', 'legal-b@example.test'),
  ('00000000-0000-4000-8000-000000420003', 'legal-c@example.test'),
  ('00000000-0000-4000-8000-000000420004', 'legal-d@example.test'),
  ('00000000-0000-4000-8000-000000420005', 'legal-banned@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000420001', '00000000-0000-4000-8000-000000420001', 'READY', 'ACTIVE',
   'Legal Buyer A', '1990-01-01', 'M', '+528110042101', 'Contacto', '+528110042102', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000420002', '00000000-0000-4000-8000-000000420002', 'READY', 'ACTIVE',
   'Legal Buyer B', '1991-01-01', 'F', '+528110042103', 'Contacto', '+528110042104', 'Hermana', now()),
  ('10000000-0000-4000-8000-000000420005', '00000000-0000-4000-8000-000000420005', 'READY', 'BANNED',
   'Legal Banned', '1992-01-01', 'F', '+528110042105', 'Contacto', '+528110042106', 'Hermana', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000420001', 'c0000000-0000-4000-8000-000000420001', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000420002', 'c0000000-0000-4000-8000-000000420002', 'ELIGIBLE', true);
-- B already accepted both current versions at account level (as onboarding would have).
insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context) values
  ('10000000-0000-4000-8000-000000420002', '69000000-0000-4000-8000-000000420001', '{"via": "onboarding"}'),
  ('10000000-0000-4000-8000-000000420002', '69000000-0000-4000-8000-000000420002', '{"via": "onboarding"}');
-- A Guest owned by B, so the context lists a GUEST candidate.
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000420001', '10000000-0000-4000-8000-000000420002', 'Legal Guest B', '1996-01-01',
   'M', '+528110042107', 'Contacto', '+528110042108', 'Amigo');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000420001', event_type_id, 'Test Legal 420', 'test-legal-420'
from app.event_type where key = 'ROAD_RACE';
-- E1: FREE, one Modality with a price, a SYSTEM_DERIVES category; the old slug redirects.
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000420001', '40000000-0000-4000-8000-000000420001', 'test-legal-420-free',
   'Test Legal 420 FREE', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now()),
  ('50000000-0000-4000-8000-000000420002', '40000000-0000-4000-8000-000000420001', 'test-legal-420-draft',
   'Test Legal 420 DRAFT', 'DRAFT', 'SCHEDULED', 'NOT_OPEN', 'FREE', 'America/Monterrey',
   null, now() + interval '30 days', 'Monterrey', 'NL', 'MX', null);
insert into app.edition_slug_history (edition_id, old_slug, new_slug) values
  ('50000000-0000-4000-8000-000000420001', 'test-legal-420-old', 'test-legal-420-free');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000420001', '50000000-0000-4000-8000-000000420001', '5k', '5K', 5000, true, 1);
insert into app.modality_capacity (modality_id, effective_capacity) values ('60000000-0000-4000-8000-000000420001', 5);
insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency) values
  ('67000000-0000-4000-8000-000000420001', '60000000-0000-4000-8000-000000420001', 'Gratis', 0, 'MXN');
insert into app.category (category_id, edition_id, name, key, assignment_mode, sort_order) values
  ('61000000-0000-4000-8000-000000420001', '50000000-0000-4000-8000-000000420001', 'Libre', 'libre', 'SYSTEM_DERIVES', 1);
insert into app.modality_category (modality_id, category_id, edition_id) values
  ('60000000-0000-4000-8000-000000420001', '61000000-0000-4000-8000-000000420001', '50000000-0000-4000-8000-000000420001');

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Anonymous callers and grants (RLS deny-by-default preserved).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '';
select is(pg_temp.err($$ select public.get_my_legal_status() $$) ->> 'code', 'AUTH_REQUIRED', 'anon: get_my_legal_status is AUTH_REQUIRED');
select is(pg_temp.err($$ select public.accept_account_legal_documents(array['69000000-0000-4000-8000-000000420001']::uuid[]) $$) ->> 'code',
  'AUTH_REQUIRED', 'anon: accept_account_legal_documents is AUTH_REQUIRED');
select is(pg_temp.err($$ select public.get_registration_context('test-legal-420-free') $$) ->> 'code', 'AUTH_REQUIRED',
  'anon: get_registration_context is AUTH_REQUIRED');
reset role;
set local role anon;
select is(pg_temp.err($$ select public.get_my_legal_status() $$) ->> 'sqlstate', '42501', 'anon role has no EXECUTE on get_my_legal_status');
select is(pg_temp.err($$ select public.get_registration_context('test-legal-420-free') $$) ->> 'sqlstate', '42501',
  'anon role has no EXECUTE on get_registration_context');
select is(pg_temp.err($$ select private.account_legal_status('10000000-0000-4000-8000-000000420001') $$) ->> 'sqlstate', '42501',
  'private.account_legal_status is not callable by API roles');
reset role;
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Status of an account that never accepted anything (A).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000420001", "role": "authenticated"}';
select is((public.get_my_legal_status() ->> 'needs_acceptance')::boolean, true, 'A (never accepted): needs_acceptance');
select is((public.get_my_legal_status() ->> 'needs_reacceptance')::boolean, false, 'A (never accepted): not a re-acceptance');
select is(jsonb_array_length(public.get_my_legal_status() -> 'missing_document_version_ids'), 2, 'A: both current documents are missing');
select is((select count(*)::int from jsonb_array_elements(public.get_my_legal_status() -> 'documents') d where d ->> 'status' = 'NEVER_ACCEPTED'),
  2, 'A: both documents are NEVER_ACCEPTED');

-- A registration request is refused until the account-level documents are accepted.
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000420001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000420001',
    'modality_id', '60000000-0000-4000-8000-000000420001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', '69000000-0000-4000-8000-000000420003'))) $$) ->> 'code',
  'LEGAL_ACCEPTANCE_REQUIRED', 'create_registration_request without account acceptance is LEGAL_ACCEPTANCE_REQUIRED');
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000420001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000420001',
    'modality_id', '60000000-0000-4000-8000-000000420001')), '[]'::jsonb) $$) -> 'detail' ->> 'scope', 'ACCOUNT',
  'the account-level refusal carries scope ACCOUNT (not a participant issue)');
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000420001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000420001',
    'modality_id', '60000000-0000-4000-8000-000000420001')), '[]'::jsonb) $$) -> 'detail' ->> 'reason', 'ACCOUNT_DOCUMENTS',
  'the account-level refusal carries reason ACCOUNT_DOCUMENTS');
select is(jsonb_array_length(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000420001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000420001',
    'modality_id', '60000000-0000-4000-8000-000000420001')), '[]'::jsonb) $$) -> 'detail' -> 'missing_document_version_ids'), 2,
  'the refusal lists the missing current versions');

-- ---------------------------------------------------------------------------------------------
-- Re-acceptance command: only CURRENT versions, naturally idempotent, partial accept allowed.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.accept_account_legal_documents(array['69000000-0000-4000-8000-0000004200ff']::uuid[]) $$) -> 'detail' ->> 'reason',
  'VERSION_NOT_CURRENT', 'accepting an unknown version id is VERSION_NOT_CURRENT');
select is(pg_temp.err($$ select public.accept_account_legal_documents(array['69000000-0000-4000-8000-000000420003']::uuid[]) $$) -> 'detail' ->> 'reason',
  'VERSION_NOT_CURRENT', 'accepting an event document through the account endpoint is VERSION_NOT_CURRENT');
select is(pg_temp.err($$ select public.accept_account_legal_documents('{}'::uuid[]) $$) ->> 'code', 'VALIDATION_ERROR',
  'an empty version list is VALIDATION_ERROR');
select is(pg_temp.err($$ select public.accept_account_legal_documents(array[null]::uuid[]) $$) ->> 'code', 'VALIDATION_ERROR',
  'a NULL version id is VALIDATION_ERROR');
reset role;
select is((select count(*)::int from app.legal_acceptance where runner_profile_id = '10000000-0000-4000-8000-000000420001'), 0,
  'rejected attempts recorded nothing');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000420001", "role": "authenticated"}';
select is((public.accept_account_legal_documents(array['69000000-0000-4000-8000-000000420001']::uuid[]) ->> 'needs_acceptance')::boolean, true,
  'accepting only TERMS leaves PRIVACY pending');
select is((public.accept_account_legal_documents(array['69000000-0000-4000-8000-000000420001', '69000000-0000-4000-8000-000000420002']::uuid[])
  ->> 'needs_acceptance')::boolean, false, 'accepting both current versions clears needs_acceptance (TERMS repeated: idempotent)');
reset role;
select is((select count(*)::int from app.legal_acceptance where runner_profile_id = '10000000-0000-4000-8000-000000420001'), 2,
  'exactly one acceptance row per current version (no duplicates)');
select is((select acceptance_context ->> 'via' from app.legal_acceptance
           where runner_profile_id = '10000000-0000-4000-8000-000000420001' and legal_document_version_id = '69000000-0000-4000-8000-000000420001'),
  'reacceptance', 'the row records the context (via reacceptance)');
select is((select count(*)::int from app.legal_acceptance
           where runner_profile_id = '10000000-0000-4000-8000-000000420001' and edition_id is null
             and registration_request_id is null and participant_runner_profile_id is null and guardian_assignment_id is null), 2,
  'account-level rows carry no edition, request, participant or guardian');
select is((select count(*)::int from audit.audit_log where action = 'ACCOUNT_LEGAL_ACCEPTED'
           and entity_id = '10000000-0000-4000-8000-000000420001'), 2, 'each effective acceptance is audited (two commands recorded rows)');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- A new published TERMS version forces re-acceptance (OWN-05).
-- ---------------------------------------------------------------------------------------------
reset role;
update app.legal_document_version set status = 'SUPERSEDED' where legal_document_version_id = '69000000-0000-4000-8000-000000420001';
insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at) values
  ('69000000-0000-4000-8000-000000420011', '60000000-0000-4000-8000-000000420001', 2, 'terminos v2', 'PUBLISHED', now());
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000420001", "role": "authenticated"}';
select is((public.get_my_legal_status() ->> 'needs_reacceptance')::boolean, true, 'A: a newer TERMS version => needs_reacceptance');
select is((select d ->> 'status' from jsonb_array_elements(public.get_my_legal_status() -> 'documents') d where d ->> 'document_type' = 'TERMS_OF_SERVICE'),
  'NEW_VERSION', 'TERMS is NEW_VERSION');
select is((select (d ->> 'accepted_version')::int from jsonb_array_elements(public.get_my_legal_status() -> 'documents') d where d ->> 'document_type' = 'TERMS_OF_SERVICE'),
  1, 'the accepted (older) version is reported');
select is((select d ->> 'status' from jsonb_array_elements(public.get_my_legal_status() -> 'documents') d where d ->> 'document_type' = 'PRIVACY_NOTICE'),
  'ACCEPTED', 'PRIVACY (unchanged) stays ACCEPTED');
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000420001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000420001',
    'modality_id', '60000000-0000-4000-8000-000000420001')), '[]'::jsonb) $$) -> 'detail' ->> 'needs_reacceptance', 'true',
  'create_registration_request refuses and says it is a re-acceptance');
select is(pg_temp.err($$ select public.accept_account_legal_documents(array['69000000-0000-4000-8000-000000420001']::uuid[]) $$) -> 'detail' ->> 'reason',
  'VERSION_NOT_CURRENT', 'the superseded TERMS v1 can no longer be accepted');
select is(jsonb_array_length(pg_temp.err($$ select public.accept_account_legal_documents(array['69000000-0000-4000-8000-000000420001']::uuid[]) $$)
  -> 'detail' -> 'required_legal_document_version_ids'), 2, 'the refusal lists the current versions');
select is((public.accept_account_legal_documents(array['69000000-0000-4000-8000-000000420011']::uuid[]) ->> 'needs_acceptance')::boolean, false,
  'accepting TERMS v2 clears the re-acceptance');

-- The same buyer can now register (FREE confirms inline; the event waiver is still per participant).
select is(public.create_registration_request('50000000-0000-4000-8000-000000420001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000420001',
    'modality_id', '60000000-0000-4000-8000-000000420001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', '69000000-0000-4000-8000-000000420003'))) ->> 'status',
  'CONFIRMED', 'after re-acceptance the FREE registration confirms (event waiver accepted per participant)');

-- ---------------------------------------------------------------------------------------------
-- Banned accounts do not get legal commands.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000420005", "role": "authenticated"}';
select is(pg_temp.err($$ select public.get_my_legal_status() $$) ->> 'code', 'ACCOUNT_BANNED', 'banned account: get_my_legal_status is ACCOUNT_BANNED');

-- ---------------------------------------------------------------------------------------------
-- complete_onboarding: client-confirmed version ids (OWN-05); required since 163 (H2P2-05).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000420003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.complete_onboarding('Persona Tres', '1990-01-01', 'F', '+528110042301',
  'Contacto', '+528110042302', 'Madre', null, array['69000000-0000-4000-8000-000000420001', '69000000-0000-4000-8000-000000420002']::uuid[]) $$)
  -> 'detail' ->> 'reason', 'VERSION_NOT_CURRENT', 'onboarding with a superseded TERMS id is VERSION_NOT_CURRENT');
select is(pg_temp.err($$ select public.complete_onboarding('Persona Tres', '1990-01-01', 'F', '+528110042301',
  'Contacto', '+528110042302', 'Madre', null, array['69000000-0000-4000-8000-000000420011']::uuid[]) $$)
  -> 'detail' ->> 'reason', 'MISSING_DOCUMENTS', 'onboarding that omits a current document is MISSING_DOCUMENTS');
reset role;
select is((select count(*)::int from app.runner_profile rp join app.legal_acceptance la on la.runner_profile_id = rp.runner_profile_id
           where rp.auth_user_id = '00000000-0000-4000-8000-000000420003'), 0,
  'a refused onboarding records nothing (the whole command rolled back)');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000420003", "role": "authenticated"}';
select is(public.complete_onboarding('Persona Tres', '1990-01-01', 'F', '+528110042301', 'Contacto', '+528110042302', 'Madre', null,
  array['69000000-0000-4000-8000-000000420011', '69000000-0000-4000-8000-000000420002']::uuid[]) ->> 'profile_readiness', 'READY',
  'onboarding with exactly the current ids completes');
select is((public.get_my_legal_status() ->> 'needs_acceptance')::boolean, false, 'onboarding recorded the acceptance of the current versions');
reset role;
select is((select acceptance_context ->> 'client_confirmed' from app.legal_acceptance
           where runner_profile_id = (select runner_profile_id from app.runner_profile where auth_user_id = '00000000-0000-4000-8000-000000420003')
             and legal_document_version_id = '69000000-0000-4000-8000-000000420011'), 'true',
  'onboarding records that the client confirmed the displayed versions');
set local role authenticated;
-- H2P2-05 (migration 163): the ids are required; the former 8-argument "record whatever is current" form is refused.
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000420004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.complete_onboarding('Persona Cuatro', '1990-01-01', 'F', '+528110042401', 'Contacto', '+528110042402', 'Madre') $$)
  ->> 'code', 'VALIDATION_ERROR', 'onboarding without version ids is VALIDATION_ERROR (acceptance is never implied)');
select is(pg_temp.err($$ select public.complete_onboarding('Persona Cuatro', '1990-01-01', 'F', '+528110042401', 'Contacto', '+528110042402', 'Madre') $$)
  -> 'detail' ->> 'field', 'legal_document_version_ids', 'the validation error names the missing field');
select is(public.complete_onboarding('Persona Cuatro', '1990-01-01', 'F', '+528110042401', 'Contacto', '+528110042402', 'Madre', null,
  array['69000000-0000-4000-8000-000000420011', '69000000-0000-4000-8000-000000420002']::uuid[]) ->> 'profile_readiness',
  'READY', 'onboarding with the displayed current ids completes');
select is((public.get_my_legal_status() ->> 'needs_acceptance')::boolean, false, 'onboarding recorded the current versions');

-- ---------------------------------------------------------------------------------------------
-- Registration context: shape, privacy and resolution rules.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000420002", "role": "authenticated"}';
select is(public.get_registration_context('test-legal-420-draft'), null, 'context: a DRAFT edition resolves to null (no existence oracle)');
select is(public.get_registration_context('no-such-slug-420'), null, 'context: an unknown slug resolves to null');
select is(public.get_registration_context('test-legal-420-old') ->> 'slug', 'test-legal-420-free', 'context: a historical slug returns the current one');
select is(public.get_registration_context('test-legal-420-old') ->> 'redirect', 'true', 'context: a historical slug is flagged as redirect');
select is(public.get_registration_context('test-legal-420-free') -> 'registration' ->> 'can_register', 'true', 'context: OPEN FREE edition can register');
select is(public.get_registration_context('test-legal-420-free') -> 'hold' ->> 'kind', null, 'context: FREE has no hold');
select is(jsonb_array_length(public.get_registration_context('test-legal-420-free') -> 'candidates'), 2,
  'context: candidates are self + the owned active Guest');
select is(public.get_registration_context('test-legal-420-free') -> 'candidates' -> 0 ->> 'relation', 'SELF', 'context: self is first');
select is(public.get_registration_context('test-legal-420-free') -> 'candidates' -> 0 -> 'modalities' -> 0 ->> 'eligible', 'true',
  'context: self is eligible for the Modality');
select is(public.get_registration_context('test-legal-420-free') -> 'modalities' -> 0 -> 'price' ->> 'amount_minor', '0',
  'context: FREE price is an explicit 0');
select is((public.get_registration_context('test-legal-420-free')::text ~ '(date_of_birth|phone_e164|emergency|\+5281100421)'), false,
  'context: no date of birth, phone or emergency contact leaks');

select * from finish();
rollback;
