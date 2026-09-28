-- Onboarding, profile and staff-role commands (Master §16/§18-19/§144-145; SEC-016/021/022/043/047).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(41);

create function pg_temp.captured_detail(sql text) returns text language plpgsql as $$
declare v_detail text;
begin
  execute sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlerrm || '|' || coalesce(v_detail, '');
end $$;

-- Synthetic identities only. uuids: users b0xx, profiles b1xx, staff b2xx.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000b001', 'onboard-adult@example.test'),
  ('00000000-0000-4000-8000-00000000b002', 'onboard-minor@example.test'),
  ('00000000-0000-4000-8000-00000000b003', 'blocked-signup@example.test'),
  ('00000000-0000-4000-8000-00000000b004', 'grant-target@example.test'),
  ('00000000-0000-4000-8000-00000000b005', 'edition-operator@example.test'),
  ('00000000-0000-4000-8000-00000000b006', 'second-admin@example.test'),
  ('00000000-0000-4000-8000-00000000b007', 'no-such-profile-check@example.test');

insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b001', 'READY', 'ACTIVE',
   'Adulto Listo', '1990-01-01', 'F', '+528110000101', 'Contacto', '+528110000102', 'Madre', now()),
  ('10000000-0000-4000-8000-00000000b006', '00000000-0000-4000-8000-00000000b006', 'READY', 'ACTIVE',
   'Segundo Admin', '1985-01-01', 'M', '+528110000103', 'Contacto', '+528110000104', 'Padre', now());
insert into app.community_profile (runner_profile_id, competition_status) values
  ('10000000-0000-4000-8000-00000000b001', 'ELIGIBLE'),
  ('10000000-0000-4000-8000-00000000b006', 'ELIGIBLE');

insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b001', 'ACTIVE'),
  ('20000000-0000-4000-8000-00000000b005', '00000000-0000-4000-8000-00000000b005', 'ACTIVE'),
  ('20000000-0000-4000-8000-00000000b006', '00000000-0000-4000-8000-00000000b006', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-00000000b001', 'ADMIN', 'GLOBAL', null);
insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-00000000b001', event_type_id, 'Evento Onboarding', 'evento-onboarding'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, registration_close_at,
  city, state_region, country_code) values
  ('50000000-0000-4000-8000-00000000b001', '40000000-0000-4000-8000-00000000b001', 'onboarding-b', 'Onboarding B',
   'FREE', 'America/Monterrey', now() + interval '30 days', 'Monterrey', 'Nuevo León', 'MX');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-00000000b005', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-00000000b001');

-- Blocked identity for the sign-up-time hook; here it also gates onboarding for an existing user.
insert into private.blocked_identity (runner_profile_id, normalized_email) values
  ('10000000-0000-4000-8000-00000000b001', 'blocked-signup@example.test');

-- One PUBLISHED version each, so onboarding can record acceptance (Master §16 step 9b).
insert into app.legal_document (legal_document_id, document_key, document_type, status) values
  ('60000000-0000-4000-8000-00000000b001', 'terms-of-service', 'TERMS_OF_SERVICE', 'ACTIVE'),
  ('60000000-0000-4000-8000-00000000b002', 'privacy-notice', 'PRIVACY_NOTICE', 'ACTIVE');
insert into app.legal_document_version (legal_document_id, version, status, published_at) values
  ('60000000-0000-4000-8000-00000000b001', 1, 'PUBLISHED', now()),
  ('60000000-0000-4000-8000-00000000b002', 1, 'PUBLISHED', now());

-- ---------------------------------------------------------------------------------------------
-- ensure_runner_profile / unauthenticated
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '';
select throws_ok($$ select public.ensure_runner_profile() $$, 'P0001', 'AUTH_REQUIRED', 'anon cannot ensure a profile');
select throws_ok($$ select public.complete_onboarding('X', '2000-01-01', 'F', '+528110000000',
  'C', '+528110000000', 'Madre') $$, 'P0001', 'AUTH_REQUIRED', 'anon cannot complete onboarding');
select throws_ok($$ select public.get_my_profile() $$, 'P0001', 'AUTH_REQUIRED', 'anon cannot read /me');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b007", "role": "authenticated"}';
select is((public.ensure_runner_profile() ->> 'profile_readiness'), 'PROFILE_INCOMPLETE',
  'first call creates a PROFILE_INCOMPLETE profile');
select is((select count(*)::int from app.runner_profile where auth_user_id = '00000000-0000-4000-8000-00000000b007'), 1,
  'exactly one profile row exists');
select is((public.ensure_runner_profile() ->> 'profile_readiness'), 'PROFILE_INCOMPLETE',
  'second call is idempotent (no duplicate profile)');

-- ---------------------------------------------------------------------------------------------
-- complete_onboarding: validation
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b002", "role": "authenticated"}';
select throws_ok($$ select public.complete_onboarding('Menor Joven', (current_date - interval '14 years')::date, 'F',
  '+528110000201', 'Contacto', '+528110000202', 'Madre') $$, 'P0001', 'VALIDATION_ERROR',
  'age 14 is rejected (under minimum age)');
select matches(pg_temp.captured_detail($$ select public.complete_onboarding('Menor Joven',
  (current_date - interval '14 years')::date, 'F', '+528110000201', 'Contacto', '+528110000202', 'Madre') $$),
  '.*UNDER_MIN_AGE.*', 'the rejection reason is UNDER_MIN_AGE');
select throws_ok($$ select public.complete_onboarding('', '2000-01-01', 'F', '+528110000201',
  'Contacto', '+528110000202', 'Madre') $$, 'P0001', 'VALIDATION_ERROR', 'blank full_name is rejected');
select throws_ok($$ select public.complete_onboarding('Alguien', '2000-01-01', 'Z', '+528110000201',
  'Contacto', '+528110000202', 'Madre') $$, 'P0001', 'VALIDATION_ERROR', 'unknown sex_code is rejected');
select throws_ok($$ select public.complete_onboarding('Alguien', '2000-01-01', 'F', 'not-a-phone',
  'Contacto', '+528110000202', 'Madre') $$, 'P0001', 'VALIDATION_ERROR', 'malformed phone is rejected');

-- ---------------------------------------------------------------------------------------------
-- complete_onboarding: minor happy path (15-17)
-- ---------------------------------------------------------------------------------------------
select is((public.complete_onboarding('Menor Joven', (current_date - interval '16 years')::date, 'F',
  '+528110000201', 'Contacto', '+528110000202', 'Madre') ->> 'profile_readiness'), 'READY', 'a 16-year-old reaches READY');
select is((select competition_status from app.community_profile cp
  join app.runner_profile rp using (runner_profile_id) where rp.auth_user_id = '00000000-0000-4000-8000-00000000b002'),
  'MINOR_NONCOMPETITIVE', 'minor competition_status is MINOR_NONCOMPETITIVE');
select is((select is_searchable from app.community_profile cp
  join app.runner_profile rp using (runner_profile_id) where rp.auth_user_id = '00000000-0000-4000-8000-00000000b002'),
  false, 'minor is not searchable');
select is((select count(*)::int from app.legal_acceptance la
  join app.runner_profile rp using (runner_profile_id) where rp.auth_user_id = '00000000-0000-4000-8000-00000000b002'),
  2, 'both PUBLISHED legal documents were accepted on onboarding');
-- Resumable: calling again (e.g. correcting a typo) does not duplicate acceptances or the profile row.
select is((public.complete_onboarding('Menor Joven R', (current_date - interval '16 years')::date, 'F',
  '+528110000201', 'Contacto', '+528110000202', 'Madre') ->> 'full_name'), 'Menor Joven R', 'onboarding is resumable');
select is((select count(*)::int from app.legal_acceptance la
  join app.runner_profile rp using (runner_profile_id) where rp.auth_user_id = '00000000-0000-4000-8000-00000000b002'),
  2, 'resuming onboarding does not duplicate legal acceptances');
select is((select count(*)::int from app.runner_profile where auth_user_id = '00000000-0000-4000-8000-00000000b002'), 1,
  'resuming onboarding does not create a second profile');

-- ---------------------------------------------------------------------------------------------
-- complete_onboarding: adult happy path + blocked identity + banned/locked states
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b003", "role": "authenticated"}';
select throws_ok($$ select public.complete_onboarding('Bloqueado', '1995-01-01', 'M', '+528110000301',
  'Contacto', '+528110000302', 'Padre') $$, 'P0001', 'IDENTITY_LOCKED', 'a blocked identity cannot onboard');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
select is((public.get_my_profile() ->> 'profile_readiness'), 'READY', 'an already-READY profile reads fine');
update app.runner_profile set account_state = 'BANNED' where auth_user_id = '00000000-0000-4000-8000-00000000b001';
select throws_ok($$ select public.complete_onboarding('Adulto Listo', '1990-01-01', 'F', '+528110000101',
  'Contacto', '+528110000102', 'Madre') $$, 'P0001', 'ACCOUNT_BANNED', 'a banned account cannot re-onboard');
update app.runner_profile set account_state = 'ACTIVE' where auth_user_id = '00000000-0000-4000-8000-00000000b001';

-- ---------------------------------------------------------------------------------------------
-- update_my_profile: allowlist (SEC-016) and PROFILE_INCOMPLETE gate
-- ---------------------------------------------------------------------------------------------
select is((public.update_my_profile('{"phone_e164": "+528110009999"}'::jsonb) ->> 'phone_e164'), '+528110009999',
  'phone is patchable');
select throws_ok($$ select public.update_my_profile('{"full_name": "Otro Nombre"}'::jsonb) $$, 'P0001', 'VALIDATION_ERROR',
  'full_name is not in the PATCH allowlist');
select is((select full_name from app.runner_profile where auth_user_id = '00000000-0000-4000-8000-00000000b001'),
  'Adulto Listo', 'a rejected mass-assignment attempt leaves full_name unchanged');
select throws_ok($$ select public.update_my_profile('{"account_state": "BANNED"}'::jsonb) $$, 'P0001', 'VALIDATION_ERROR',
  'account_state is not in the PATCH allowlist');
select throws_ok($$ select public.update_my_profile('{}'::jsonb) $$, 'P0001', 'VALIDATION_ERROR', 'an empty patch is rejected');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b007", "role": "authenticated"}';
select throws_ok($$ select public.update_my_profile('{"phone_e164": "+528110000000"}'::jsonb) $$, 'P0001', 'PROFILE_INCOMPLETE',
  'a not-yet-READY profile cannot PATCH');

-- ---------------------------------------------------------------------------------------------
-- Staff role management (ADMIN GLOBAL only, SEC-021/022)
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b005", "role": "authenticated"}';
set local role authenticated;
select throws_ok($$ select public.list_staff_roles() $$, 'P0001', 'FORBIDDEN', 'EDITION-scoped OPERATOR cannot list staff roles');
select throws_ok($$ select public.grant_staff_role('grant-target@example.test', 'OPERATOR', 'GLOBAL') $$, 'P0001', 'FORBIDDEN',
  'EDITION-scoped OPERATOR cannot grant roles (STAFF_ROLES_MANAGE is global_only)');
reset role;

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
set local role authenticated;
select throws_ok($$ select public.grant_staff_role('onboard-adult@example.test', 'OPERATOR', 'GLOBAL') $$, 'P0001', 'FORBIDDEN',
  'ADMIN cannot self-grant');
select throws_ok($$ select public.grant_staff_role('no-such-account@example.test', 'OPERATOR', 'GLOBAL') $$, 'P0001', 'NOT_FOUND',
  'granting to an unknown email is NOT_FOUND (no enumeration of who exists beyond this)');
select throws_ok($$ select public.grant_staff_role('grant-target@example.test', 'OPERATOR', 'EDITION', null) $$, 'P0001', 'VALIDATION_ERROR',
  'EDITION scope requires an edition_id');
select ok((public.grant_staff_role('grant-target@example.test', 'OPERATOR', 'GLOBAL') ? 'staff_role_assignment_id'),
  'ADMIN grants a GLOBAL OPERATOR role');
select throws_ok($$ select public.grant_staff_role('grant-target@example.test', 'OPERATOR', 'GLOBAL') $$, 'P0001', 'CONFLICT',
  'granting the same live role twice conflicts');
-- Exact headcount is not asserted: other domains' seed fixtures also create staff members.
select ok(exists (
  select 1 from jsonb_array_elements(public.list_staff_roles()) sm
  where sm ->> 'auth_user_id' = '00000000-0000-4000-8000-00000000b004'
    and exists (select 1 from jsonb_array_elements(sm -> 'roles') r where r ->> 'role' = 'OPERATOR' and r ->> 'revoked_at' is null)),
  'the roster lists the newly granted OPERATOR');

-- Neutralise every other live GLOBAL ADMIN (other domains' local dev seeds also grant one, e.g.
-- admin@runiis.test) so "the last GLOBAL ADMIN" below is provably about this test's own fixture,
-- not an unscoped global count. Safe: the whole file rolls back. authenticated has no direct table
-- write (writes only go through SECURITY DEFINER commands), so this needs the superuser role back.
reset role;
update app.staff_role_assignment set revoked_at = now()
where role = 'ADMIN' and scope_type = 'GLOBAL' and revoked_at is null
  and staff_member_id <> '20000000-0000-4000-8000-00000000b001';
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
set local role authenticated;

-- Cannot revoke the last GLOBAL ADMIN.
select throws_ok($$ select public.revoke_staff_role(
  (select staff_role_assignment_id from app.staff_role_assignment
   where staff_member_id = '20000000-0000-4000-8000-00000000b001' and role = 'ADMIN' and revoked_at is null)) $$,
  'P0001', 'BUSINESS_RULE_VIOLATION', 'revoking the sole GLOBAL ADMIN is blocked');
-- With a second admin, revoking the first now succeeds.
select ok((public.grant_staff_role('second-admin@example.test', 'ADMIN', 'GLOBAL') ? 'staff_role_assignment_id'),
  'a second GLOBAL ADMIN can be granted');
select is((public.revoke_staff_role(
  (select staff_role_assignment_id from app.staff_role_assignment
   where staff_member_id = '20000000-0000-4000-8000-00000000b001' and role = 'ADMIN' and revoked_at is null)) ->> 'status'),
  'REVOKED', 'revoking one of two GLOBAL ADMINs succeeds');
reset role;

-- The now-revoked admin's live JWT no longer passes require_permission (SEC-021 revocation is live).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
select throws_ok($$ select public.list_staff_roles() $$, 'P0001', 'FORBIDDEN',
  'a revoked admin is denied on the very next call, even with a still-valid session');

-- ---------------------------------------------------------------------------------------------
-- bootstrap_first_admin: SYSTEM-only, blocked once any ACTIVE GLOBAL ADMIN exists
-- ---------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.bootstrap_first_admin(text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.bootstrap_first_admin(text)', 'EXECUTE')
       and has_function_privilege('service_role', 'public.bootstrap_first_admin(text)', 'EXECUTE'),
  'bootstrap_first_admin is service_role only');
select throws_ok($$ select public.bootstrap_first_admin('second-admin@example.test') $$, 'P0001', 'CONFLICT',
  'bootstrap refuses once a GLOBAL ADMIN already exists (second-admin holds it after the section above)');

select * from finish();
rollback;
