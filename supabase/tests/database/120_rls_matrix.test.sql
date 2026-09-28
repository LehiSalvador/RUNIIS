-- Master §205 RLS matrix at table level (anon / runner A / runner B / staff roles / banned) plus
-- SEC-010/011/012/016/020/021 table-level denials. Commands re-check the same rules in their own tests.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(47);

-- users 0..b0xx, profiles 1..b0xx, staff 2..b0xx, guest 3..b001, event 4..b001, editions 5..b00x,
-- modalities 6..b00x, requests 7..b00x, participants 8..b0xx, registrations 9..b0xx, passes a..b0xx.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000' || s)::uuid, 'rls-' || s || '@example.test'
from unnest(array['b001', 'b002', 'b003', 'b004', 'b005', 'b006', 'b007', 'b008']) s;

insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-00000000' || s)::uuid, ('00000000-0000-4000-8000-00000000' || s)::uuid, 'READY', st,
  'Persona ' || s, '1990-01-01', 'M', '+528110000011', 'Contacto', '+528110000012', 'Padre', now()
from (values ('b001', 'ACTIVE'), ('b002', 'ACTIVE'), ('b003', 'ACTIVE'), ('b004', 'BANNED')) v(s, st);
-- Explicit public_profile_id (default is gen_random_uuid()): anon's grant excludes runner_profile_id
-- (an internal id, SEC-120), so assertions below must filter on the public id instead.
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status)
select ('10000000-0000-4000-8000-00000000' || s)::uuid, ('30000000-0000-4000-8000-00000000' || s)::uuid, 'ELIGIBLE'
from unnest(array['b001', 'b002', 'b004']) s;

insert into app.staff_member (staff_member_id, auth_user_id)
select ('20000000-0000-4000-8000-00000000' || s)::uuid, ('00000000-0000-4000-8000-00000000' || s)::uuid
from unnest(array['b005', 'b006', 'b007', 'b008']) s;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-00000000b001', event_type_id, 'Evento RLS', 'evento-rls' from app.event_type where key = 'TRAIL';
insert into app.edition (edition_id, event_id, slug, name, publication_state, published_at, registration_mode, timezone,
  registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-00000000b001', '40000000-0000-4000-8000-00000000b001', 'rls-x', 'RLS X', 'PUBLISHED', now(),
   'FREE', 'America/Monterrey', now() + interval '30 days', 'Monterrey', 'NL', 'MX'),
  ('50000000-0000-4000-8000-00000000b002', '40000000-0000-4000-8000-00000000b001', 'rls-y', 'RLS Y', 'PUBLISHED', now(),
   'FREE', 'America/Monterrey', now() + interval '30 days', 'Monterrey', 'NL', 'MX'),
  ('50000000-0000-4000-8000-00000000b003', '40000000-0000-4000-8000-00000000b001', 'rls-draft', 'RLS Draft', 'DRAFT', null,
   'FREE', 'America/Monterrey', now() + interval '30 days', 'Monterrey', 'NL', 'MX');
insert into app.modality (modality_id, edition_id, key, name, generates_distance_credit, sort_order)
select ('60000000-0000-4000-8000-00000000' || s)::uuid, ('50000000-0000-4000-8000-00000000' || s)::uuid, '10K', '10K', true, 1
from unnest(array['b001', 'b002', 'b003']) s;
insert into app.modality_capacity (modality_id, effective_capacity) values ('60000000-0000-4000-8000-00000000b001', 100);

insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-00000000b005', 'CHECKIN', 'EDITION', '50000000-0000-4000-8000-00000000b001'),
  ('20000000-0000-4000-8000-00000000b006', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-00000000b001'),
  ('20000000-0000-4000-8000-00000000b007', 'MODERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-00000000b008', 'ADMIN', 'GLOBAL', null);

insert into app.friendship (requester_profile_id, addressee_profile_id, status, responded_at) values
  ('10000000-0000-4000-8000-00000000b001', '10000000-0000-4000-8000-00000000b002', 'ACCEPTED', now()),
  ('10000000-0000-4000-8000-00000000b002', '10000000-0000-4000-8000-00000000b003', 'ACCEPTED', now());
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-00000000b001', '10000000-0000-4000-8000-00000000b001', 'Invitado RLS', '1995-01-01', 'X',
   '+528110000013', 'Contacto', '+528110000014', 'Amigo');

-- R1: A buys for A, Friend B and Guest G in X. R2: B's own request in X. R3: C's request in Y.
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, status,
  registration_mode, currency, total_snapshot_minor, confirmed_at) values
  ('70000000-0000-4000-8000-00000000b001', 'R-RLSX-0001', '10000000-0000-4000-8000-00000000b001',
   '50000000-0000-4000-8000-00000000b001', 'CONFIRMED', 'FREE', 'MXN', 0, now()),
  ('70000000-0000-4000-8000-00000000b002', 'R-RLSX-0002', '10000000-0000-4000-8000-00000000b002',
   '50000000-0000-4000-8000-00000000b001', 'PENDING_CONFIRMATION', 'FREE', 'MXN', 0, null),
  ('70000000-0000-4000-8000-00000000b003', 'R-RLSX-0003', '10000000-0000-4000-8000-00000000b003',
   '50000000-0000-4000-8000-00000000b002', 'PENDING_CONFIRMATION', 'FREE', 'MXN', 0, null);
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('80000000-0000-4000-8000-00000000b001', '70000000-0000-4000-8000-00000000b001', 'PROFILE',
   '10000000-0000-4000-8000-00000000b001', null, '60000000-0000-4000-8000-00000000b001', 0, 'MXN', '{"age": 36}'),
  ('80000000-0000-4000-8000-00000000b002', '70000000-0000-4000-8000-00000000b001', 'PROFILE',
   '10000000-0000-4000-8000-00000000b002', null, '60000000-0000-4000-8000-00000000b001', 0, 'MXN', '{"age": 36}'),
  ('80000000-0000-4000-8000-00000000b003', '70000000-0000-4000-8000-00000000b001', 'GUEST',
   null, '30000000-0000-4000-8000-00000000b001', '60000000-0000-4000-8000-00000000b001', 0, 'MXN', '{"age": 31}');
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, guest_participant_id, buyer_profile_id, registration_number) values
  ('90000000-0000-4000-8000-00000000b001', '70000000-0000-4000-8000-00000000b001', '80000000-0000-4000-8000-00000000b001',
   '50000000-0000-4000-8000-00000000b001', '60000000-0000-4000-8000-00000000b001', '10000000-0000-4000-8000-00000000b001',
   null, '10000000-0000-4000-8000-00000000b001', 'I-RLSX-0001'),
  ('90000000-0000-4000-8000-00000000b002', '70000000-0000-4000-8000-00000000b001', '80000000-0000-4000-8000-00000000b002',
   '50000000-0000-4000-8000-00000000b001', '60000000-0000-4000-8000-00000000b001', '10000000-0000-4000-8000-00000000b002',
   null, '10000000-0000-4000-8000-00000000b001', 'I-RLSX-0002'),
  ('90000000-0000-4000-8000-00000000b003', '70000000-0000-4000-8000-00000000b001', '80000000-0000-4000-8000-00000000b003',
   '50000000-0000-4000-8000-00000000b001', '60000000-0000-4000-8000-00000000b001', null,
   '30000000-0000-4000-8000-00000000b001', '10000000-0000-4000-8000-00000000b001', 'I-RLSX-0003');
insert into app.participant_pass (participant_pass_id, registration_id, public_code)
select ('a0000000-0000-4000-8000-00000000' || s)::uuid, ('90000000-0000-4000-8000-00000000' || s)::uuid, 'P-RLSX-' || upper(s)
from unnest(array['b001', 'b002', 'b003']) s;
insert into app.participant_pass_credential (participant_pass_id, version, token_hash, token_ciphertext, encryption_key_version)
values ('a0000000-0000-4000-8000-00000000b002', 1, repeat('b', 64), decode(repeat('ab', 40), 'hex'), 1);

-- ---------------------------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------------------------
set local role anon;
set local "request.jwt.claims" = '{"role": "anon"}';
-- Scoped to this test's own rows throughout (RLS-01..): other domains' local dev seeds also
-- populate these tables, so an unscoped global count/set is not stable across parallel work.
select set_eq($$ select slug from app.edition where edition_id in ('50000000-0000-4000-8000-00000000b001',
  '50000000-0000-4000-8000-00000000b002', '50000000-0000-4000-8000-00000000b003') $$, array['rls-x', 'rls-y'],
  'anon sees published Editions, not the draft');
select is_empty($$ select 1 from app.modality where edition_id = '50000000-0000-4000-8000-00000000b003' $$,
  'anon sees nothing of a draft Edition');
select is((select count(*)::int from app.community_profile where public_profile_id in
  ('30000000-0000-4000-8000-00000000b001', '30000000-0000-4000-8000-00000000b002', '30000000-0000-4000-8000-00000000b004')),
  2, 'anon sees visible community profiles only (banned hidden)');
select throws_ok($$ select phone_e164, date_of_birth from app.runner_profile $$, '42501', null, 'anon cannot read phone/DOB');
select throws_ok($$ select competition_status from app.community_profile $$, '42501', null,
  'anon cannot read competition status (would reveal minors)');
select throws_ok($$ select 1 from app.registration $$, '42501', null, 'anon has no access to registrations');
select throws_ok($$ select 1 from app.modality_capacity $$, '42501', null, 'anon has no raw capacity');
select throws_ok($$ insert into app.event_type (key, name, default_generates_distance_credit) values ('X', 'X', false) $$,
  '42501', null, 'anon cannot write');

-- ---------------------------------------------------------------------------------------------
-- authenticated A (buyer of R1)
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
select set_eq($$ select runner_profile_id from app.runner_profile $$, array['10000000-0000-4000-8000-00000000b001'::uuid],
  'A sees only its own RunnerProfile');
select is_empty($$ select 1 from app.runner_profile where runner_profile_id = '10000000-0000-4000-8000-00000000b002' $$,
  'A does not see private RunnerProfile B');
select is((select count(*)::int from app.friendship), 1, 'A sees its own Friendship, not B-C');
select is((select count(*)::int from app.guest_participant), 1, 'A sees its own Guest');
select set_eq($$ select public_reference from app.registration_request $$, array['R-RLSX-0001'], 'A sees its own Request only');
select set_eq($$ select registration_number from app.registration $$, array['I-RLSX-0001', 'I-RLSX-0002', 'I-RLSX-0003'],
  'A sees its Registration and the context of Registrations from its own Request');
select set_eq($$ select public_code from app.participant_pass $$, array['P-RLSX-B001', 'P-RLSX-B003'],
  'buyer sees its own and the Guest pass, never the Friend pass');
select throws_ok($$ select token_hash from app.participant_pass_credential $$, '42501', null, 'no credential material for anyone');
select throws_ok($$ select eligibility_snapshot from app.registration_request_participant $$, '42501', null,
  'SEC-012: buyer cannot read eligibility snapshots');
select is((select count(*)::int from app.registration_request_participant), 3, 'buyer sees the request summary rows');
select is_empty($$ select 1 from app.modality_capacity $$, 'a runner sees no raw capacity');
select throws_ok($$ update app.runner_profile set account_state = 'ACTIVE', profile_readiness = 'READY' $$, '42501', null,
  'SEC-016: no direct profile update (mass assignment impossible at table level)');
select throws_ok($$ insert into app.registration_request (public_reference, buyer_profile_id, edition_id, registration_mode,
  currency, total_snapshot_minor) values ('X', '10000000-0000-4000-8000-00000000b001', '50000000-0000-4000-8000-00000000b001',
  'FREE', 'MXN', 0) $$, '42501', null, 'no direct request creation');
select throws_ok($$ insert into app.staff_role_assignment (staff_member_id, role, scope_type)
  values ('20000000-0000-4000-8000-00000000b006', 'ADMIN', 'GLOBAL') $$, '42501', null, 'no direct staff role self-grant');
select is_empty($$ select 1 from app.staff_role_assignment $$, 'a runner sees no staff assignments');

-- ---------------------------------------------------------------------------------------------
-- authenticated B (Friend included in R1, buyer of R2)
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b002", "role": "authenticated"}';
select set_eq($$ select public_reference from app.registration_request $$, array['R-RLSX-0002'],
  'B sees its own Request, not A''s');
select set_eq($$ select request_participant_id from app.registration_request_participant $$,
  array['80000000-0000-4000-8000-00000000b002'::uuid], 'a Friend sees only its own inclusion in another buyer''s Request');
select set_eq($$ select public_code from app.participant_pass $$, array['P-RLSX-B002'], 'the titular Friend sees its own pass');
select is_empty($$ select 1 from app.guest_participant $$, 'B does not see A''s Guest');
select is((select count(*)::int from app.friendship), 2, 'B sees both of its own Friendships');

-- ---------------------------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b005", "role": "authenticated"}';
select ok(private.has_permission('PASS_SCAN', '50000000-0000-4000-8000-00000000b001'), 'CHECKIN: check-in allowed');
select ok(not private.has_permission('CAPACITY_MANAGE', '50000000-0000-4000-8000-00000000b001')
          and not private.has_permission('PII_EXPORT', '50000000-0000-4000-8000-00000000b001')
          and not private.has_permission('PLATFORM_BAN_MANAGE'), 'CHECKIN: no capacity edit, no export, no ban');
select is_empty($$ select 1 from app.registration $$, 'CHECKIN: no participant list through RLS');
select is((select count(*)::int from app.runner_profile), 0, 'CHECKIN: no runner PII');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b007", "role": "authenticated"}';
select ok(private.has_permission('AVATAR_MODERATE'), 'MODERATOR: avatar queue');
select ok((select count(*) from app.registration) = 0 and (select count(*) from app.runner_profile) = 0,
  'MODERATOR: no participant or runner data');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b006", "role": "authenticated"}';
select set_eq($$ select public_reference from app.registration_request $$, array['R-RLSX-0001', 'R-RLSX-0002'],
  'OPERATOR: requests of its Edition only');
select set_eq($$ select slug from app.edition where edition_id in ('50000000-0000-4000-8000-00000000b001',
  '50000000-0000-4000-8000-00000000b002', '50000000-0000-4000-8000-00000000b003') $$, array['rls-x', 'rls-y'],
  'OPERATOR: no drafts of other Editions');
select is((select count(*)::int from app.registration), 3, 'OPERATOR: participant list of its Edition');
select is((select count(*)::int from app.modality_capacity), 1, 'OPERATOR: capacity of its Edition');
select ok(not private.has_permission('PLATFORM_BAN_MANAGE'), 'OPERATOR: no platform ban');

reset role;
update app.staff_role_assignment set revoked_at = now(), revoked_by_staff_id = '20000000-0000-4000-8000-00000000b008'
where staff_member_id = '20000000-0000-4000-8000-00000000b006';
set local role authenticated;
select is_empty($$ select 1 from app.registration_request $$,
  'SEC-021: a revoked OPERATOR with a still-valid JWT loses access on the next query');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b008", "role": "authenticated"}';
select ok(private.has_permission('PLATFORM_BAN_MANAGE'), 'ADMIN: ban/unban');
select set_eq($$ select slug from app.edition where edition_id in ('50000000-0000-4000-8000-00000000b001',
  '50000000-0000-4000-8000-00000000b002', '50000000-0000-4000-8000-00000000b003') $$,
  array['rls-x', 'rls-y', 'rls-draft'], 'ADMIN GLOBAL sees drafts');
select is((select count(*)::int from app.registration_request where registration_request_id in
  ('70000000-0000-4000-8000-00000000b001', '70000000-0000-4000-8000-00000000b002', '70000000-0000-4000-8000-00000000b003')),
  3, 'ADMIN GLOBAL sees every request');
select is((select count(*)::int from app.staff_role_assignment where staff_member_id in
  ('20000000-0000-4000-8000-00000000b005', '20000000-0000-4000-8000-00000000b006',
   '20000000-0000-4000-8000-00000000b007', '20000000-0000-4000-8000-00000000b008')),
  4, 'ADMIN GLOBAL sees staff assignments');

-- ---------------------------------------------------------------------------------------------
-- BANNED
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b004", "role": "authenticated"}';
reset role;
select throws_ok($$ select private.require_ready_profile() $$, 'P0001', 'ACCOUNT_BANNED',
  'BANNED: commands reject the live session (no new request)');
select ok(not private.is_public_profile('10000000-0000-4000-8000-00000000b004'), 'BANNED: not public');
set local role authenticated;
select set_eq($$ select runner_profile_id from app.runner_profile $$, array['10000000-0000-4000-8000-00000000b004'::uuid],
  'BANNED still reads only its own profile (UX restriction screen)');

select * from finish();
rollback;
