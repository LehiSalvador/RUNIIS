-- P2-G3: list_my_pending_actions(p_edition_id) returns an ACTIVE guardian's wards (PROFILE minors and Guests owned
-- by anyone) for a registrable Edition before any request exists (migration 20261003110000_162).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(24);

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

-- Items of one kind for the Edition from the caller's pending actions.
create function pg_temp.items(p_edition_id uuid, p_kind text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb)
  from jsonb_array_elements(public.list_my_pending_actions(p_edition_id) -> 'items') x
  where x -> 'subject' ->> 'kind' = p_kind
$$;
grant execute on function pg_temp.items(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture: deterministic documents (account level archived so only the event documents matter).
-- ---------------------------------------------------------------------------------------------
update app.legal_document set status = 'ARCHIVED'
where document_type in ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE', 'SPORT_WAIVER', 'MINOR_TERMS', 'EVENT_RULES');
insert into app.legal_document (legal_document_id, document_key, document_type, status) values
  ('60000000-0000-4000-8000-000000430003', 'T430_WAIVER', 'SPORT_WAIVER', 'ACTIVE'),
  ('60000000-0000-4000-8000-000000430004', 'T430_MINOR', 'MINOR_TERMS', 'ACTIVE');
insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at) values
  ('69000000-0000-4000-8000-000000430003', '60000000-0000-4000-8000-000000430003', 1, 'deslinde v1', 'PUBLISHED', now()),
  ('69000000-0000-4000-8000-000000430004', '60000000-0000-4000-8000-000000430004', 1, 'menores v1', 'PUBLISHED', now());

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000430001', 'g3-guardian@example.test'),
  ('00000000-0000-4000-8000-000000430002', 'g3-owner@example.test'),
  ('00000000-0000-4000-8000-000000430003', 'g3-stranger@example.test'),
  ('00000000-0000-4000-8000-000000430004', 'g3-minor@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000430001', '00000000-0000-4000-8000-000000430001', 'READY', 'ACTIVE',
   'G3 Guardian', '1985-01-01', 'F', '+528110043101', 'Contacto', '+528110043102', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000430002', '00000000-0000-4000-8000-000000430002', 'READY', 'ACTIVE',
   'G3 Owner', '1988-01-01', 'M', '+528110043103', 'Contacto', '+528110043104', 'Hermana', now()),
  ('10000000-0000-4000-8000-000000430003', '00000000-0000-4000-8000-000000430003', 'READY', 'ACTIVE',
   'G3 Stranger', '1990-01-01', 'M', '+528110043105', 'Contacto', '+528110043106', 'Hermana', now()),
  ('10000000-0000-4000-8000-000000430004', '00000000-0000-4000-8000-000000430004', 'READY', 'ACTIVE',
   'G3 Minor Profile', (current_date - interval '16 years' - interval '30 days')::date, 'F', '+528110043107', 'Contacto',
   '+528110043108', 'Madre', now());
insert into app.community_profile (runner_profile_id, public_profile_id, display_name, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000430001', 'c0000000-0000-4000-8000-000000430001', 'G3 Guardian', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000430002', 'c0000000-0000-4000-8000-000000430002', 'G3 Owner', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000430003', 'c0000000-0000-4000-8000-000000430003', 'G3 Stranger', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000430004', 'c0000000-0000-4000-8000-000000430004', 'G3 Minor Profile', 'MINOR_NONCOMPETITIVE', true);

-- Guests owned by Owner: GM (16, ACTIVE guardian = Guardian), GR (16, REVOKED), GP (16, PENDING), GA (adult, ACTIVE
-- assignment), GY (14, ACTIVE assignment), GX (16, no assignment), GZ (16, ACTIVE assignment, ARCHIVED guest).
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, status, archived_at) values
  ('30000000-0000-4000-8000-000000430001', '10000000-0000-4000-8000-000000430002', 'G3 Guest Menor', (current_date - interval '16 years' - interval '30 days')::date, 'F', '+528110043111', 'Contacto', '+528110043199', 'Madre', 'ACTIVE', null),
  ('30000000-0000-4000-8000-000000430002', '10000000-0000-4000-8000-000000430002', 'G3 Guest Revocado', (current_date - interval '16 years' - interval '30 days')::date, 'F', '+528110043112', 'Contacto', '+528110043199', 'Madre', 'ACTIVE', null),
  ('30000000-0000-4000-8000-000000430003', '10000000-0000-4000-8000-000000430002', 'G3 Guest Pendiente', (current_date - interval '16 years' - interval '30 days')::date, 'F', '+528110043113', 'Contacto', '+528110043199', 'Madre', 'ACTIVE', null),
  ('30000000-0000-4000-8000-000000430004', '10000000-0000-4000-8000-000000430002', 'G3 Guest Adulto', '1995-01-01', 'F', '+528110043114', 'Contacto', '+528110043199', 'Madre', 'ACTIVE', null),
  ('30000000-0000-4000-8000-000000430005', '10000000-0000-4000-8000-000000430002', 'G3 Guest Catorce', (current_date - interval '14 years' - interval '30 days')::date, 'F', '+528110043115', 'Contacto', '+528110043199', 'Madre', 'ACTIVE', null),
  ('30000000-0000-4000-8000-000000430006', '10000000-0000-4000-8000-000000430002', 'G3 Guest Sin Tutor', (current_date - interval '16 years' - interval '30 days')::date, 'F', '+528110043116', 'Contacto', '+528110043199', 'Madre', 'ACTIVE', null),
  ('30000000-0000-4000-8000-000000430007', '10000000-0000-4000-8000-000000430002', 'G3 Guest Archivado', (current_date - interval '16 years' - interval '30 days')::date, 'F', '+528110043117', 'Contacto', '+528110043199', 'Madre', 'ARCHIVED', now());
insert into app.guardian_assignment (guardian_assignment_id, minor_runner_profile_id, minor_guest_participant_id,
  guardian_profile_id, relationship_type, status, activated_at, revoked_at) values
  ('80000000-0000-4000-8000-000000430001', null, '30000000-0000-4000-8000-000000430001', '10000000-0000-4000-8000-000000430001', 'PARENT', 'ACTIVE', now(), null),
  ('80000000-0000-4000-8000-000000430002', null, '30000000-0000-4000-8000-000000430002', '10000000-0000-4000-8000-000000430001', 'PARENT', 'REVOKED', now(), now()),
  ('80000000-0000-4000-8000-000000430003', null, '30000000-0000-4000-8000-000000430003', '10000000-0000-4000-8000-000000430001', 'PARENT', 'PENDING', null, null),
  ('80000000-0000-4000-8000-000000430004', null, '30000000-0000-4000-8000-000000430004', '10000000-0000-4000-8000-000000430001', 'PARENT', 'ACTIVE', now(), null),
  ('80000000-0000-4000-8000-000000430005', null, '30000000-0000-4000-8000-000000430005', '10000000-0000-4000-8000-000000430001', 'PARENT', 'ACTIVE', now(), null),
  ('80000000-0000-4000-8000-000000430007', null, '30000000-0000-4000-8000-000000430007', '10000000-0000-4000-8000-000000430001', 'PARENT', 'ACTIVE', now(), null),
  ('80000000-0000-4000-8000-000000430008', '10000000-0000-4000-8000-000000430004', null, '10000000-0000-4000-8000-000000430001', 'PARENT', 'ACTIVE', now(), null);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000430001', event_type_id, 'Test Guardian 430', 'test-guardian-430'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000430001', '40000000-0000-4000-8000-000000430001', 'test-guardian-430-free',
   'Test Guardian 430 FREE', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now()),
  ('50000000-0000-4000-8000-000000430002', '40000000-0000-4000-8000-000000430001', 'test-guardian-430-closed',
   'Test Guardian 430 CLOSED', 'PUBLISHED', 'SCHEDULED', 'CLOSED', 'FREE', 'America/Monterrey',
   now() - interval '2 days', now() - interval '1 day', 'Monterrey', 'NL', 'MX', now());
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000430001', '50000000-0000-4000-8000-000000430001', '5k', '5K', 5000, true, 1);
insert into app.modality_capacity (modality_id, effective_capacity) values ('60000000-0000-4000-8000-000000430001', 5);
insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency) values
  ('67000000-0000-4000-8000-000000430001', '60000000-0000-4000-8000-000000430001', 'Gratis', 0, 'MXN');

select is((select count(*)::int from app.registration_request where edition_id = '50000000-0000-4000-8000-000000430001'), 0,
  'precondition: no registration request exists for the Edition');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Guardian: wards for the Edition appear before any request exists.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000430001", "role": "authenticated"}';
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_GUEST')), 1,
  'guardian: exactly one minor Guest ward is listed (owned by another account)');
select is(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_GUEST') -> 0 -> 'subject' ->> 'guest_participant_id',
  '30000000-0000-4000-8000-000000430001', 'guardian: the listed Guest is the one with the ACTIVE assignment');
select is(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_GUEST') -> 0 -> 'subject' ->> 'display_name',
  'G3 Guest Menor', 'guardian: the Guest item carries the display name the projection already exposes');
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_GUEST') -> 0 -> 'documents'), 2,
  'guardian: the minor Guest item lists SPORT_WAIVER and MINOR_TERMS');
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_PROFILE')), 1,
  'guardian: the PROFILE minor ward is listed too');
select is(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_PROFILE') -> 0 -> 'subject' ->> 'public_profile_id',
  'c0000000-0000-4000-8000-000000430004', 'guardian: the PROFILE ward is identified by its public profile id');
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'SELF')), 1, 'guardian: own SELF item is unchanged');
select is((public.list_my_pending_actions('50000000-0000-4000-8000-000000430001')::text ~
  '(3000000[0-9]-0000-4000-8000-00000043000[2-7]|date_of_birth|phone|emergency|1995-01-01)'), false,
  'guardian: revoked, pending, adult, under-15, unassigned and archived Guests and any DOB/phone/emergency data are absent');
select is(jsonb_array_length(public.list_my_pending_actions() -> 'items'), 0,
  'guardian: without an edition (no request exists) nothing is listed (existing behaviour)');
select is(jsonb_array_length(public.list_my_pending_actions('50000000-0000-4000-8000-000000430002') -> 'items'), 0,
  'guardian: a closed Edition lists nothing (same registrable gate as SELF)');

-- ---------------------------------------------------------------------------------------------
-- Non-guardians see nothing about the wards.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000430002", "role": "authenticated"}';
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_GUEST')), 0,
  'owner (not the guardian): no minor Guest item');
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_PROFILE')), 0, 'owner: no minor profile item');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000430003", "role": "authenticated"}';
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_GUEST'))
  + jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_PROFILE')), 0,
  'stranger: no ward items of any kind');

-- ---------------------------------------------------------------------------------------------
-- The owner's FREE request including the minor Guest is blocked until the guardian accepts, then succeeds.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000430002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000430001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000430001',
    'modality_id', '60000000-0000-4000-8000-000000430001')), '[]'::jsonb) $$) ->> 'code',
  'LEGAL_ACCEPTANCE_REQUIRED', 'owner: FREE request with the minor Guest is blocked before the guardian accepts');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000430001", "role": "authenticated"}';
select is(public.accept_edition_documents('50000000-0000-4000-8000-000000430001',
  array['69000000-0000-4000-8000-000000430003', '69000000-0000-4000-8000-000000430004']::uuid[], null,
  '30000000-0000-4000-8000-000000430001') -> 'missing_document_version_ids', '[]'::jsonb,
  'guardian: accept_edition_documents for the Guest ward leaves nothing missing');
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_GUEST')), 0,
  'guardian: the accepted Guest ward is no longer listed');
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_PROFILE')), 1,
  'guardian: the other ward is still listed');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000430002", "role": "authenticated"}';
select is(public.create_registration_request('50000000-0000-4000-8000-000000430001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000430001',
    'modality_id', '60000000-0000-4000-8000-000000430001')), '[]'::jsonb) ->> 'status',
  'CONFIRMED', 'owner: after the guardian accepted, the FREE request with the minor Guest confirms');

-- ---------------------------------------------------------------------------------------------
-- Stranger and owner still cannot accept for the ward (only the ACTIVE guardian).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000430003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.accept_edition_documents('50000000-0000-4000-8000-000000430001',
  array['69000000-0000-4000-8000-000000430003']::uuid[], 'c0000000-0000-4000-8000-000000430004', null) $$) ->> 'code',
  'NOT_FOUND', 'stranger cannot accept for the PROFILE ward');

-- ---------------------------------------------------------------------------------------------
-- A revoked assignment stops listing the ward.
-- ---------------------------------------------------------------------------------------------
reset role;
update app.guardian_assignment set status = 'REVOKED', revoked_at = now()
where guardian_assignment_id = '80000000-0000-4000-8000-000000430008';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000430001", "role": "authenticated"}';
select is(jsonb_array_length(pg_temp.items('50000000-0000-4000-8000-000000430001', 'MINOR_PROFILE')), 0,
  'guardian: a REVOKED assignment no longer lists the PROFILE ward');
select is(pg_temp.err($$ select public.accept_edition_documents('50000000-0000-4000-8000-000000430001',
  array['69000000-0000-4000-8000-000000430003']::uuid[], 'c0000000-0000-4000-8000-000000430004', null) $$) ->> 'code',
  'NOT_FOUND', 'guardian with a REVOKED assignment cannot accept for the PROFILE ward');

-- ---------------------------------------------------------------------------------------------
-- Anonymous callers keep no access.
-- ---------------------------------------------------------------------------------------------
reset role;
set local role anon;
select is(pg_temp.err($$ select public.list_my_pending_actions('50000000-0000-4000-8000-000000430001') $$) ->> 'sqlstate', '42501',
  'anon role has no EXECUTE on list_my_pending_actions');
select is(pg_temp.err($$ select private.list_my_pending_actions('50000000-0000-4000-8000-000000430001') $$) ->> 'sqlstate', '42501',
  'private.list_my_pending_actions is not callable by API roles');
reset role;

select * from finish();
rollback;
