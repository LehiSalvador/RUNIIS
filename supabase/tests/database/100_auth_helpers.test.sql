begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(109);

-- Synthetic identities only. uuids: users 0..a0xx, profiles 1..a0xx, staff 2..a0xx, editions 5..a00x.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'runner-a@example.test'),
  ('00000000-0000-4000-8000-00000000a002', 'runner-b@example.test'),
  ('00000000-0000-4000-8000-00000000a003', 'incomplete@example.test'),
  ('00000000-0000-4000-8000-00000000a004', 'noprofile@example.test'),
  ('00000000-0000-4000-8000-00000000a005', 'banned-staff@example.test'),
  ('00000000-0000-4000-8000-00000000a006', 'locked@example.test'),
  ('00000000-0000-4000-8000-00000000a007', 'deactivated@example.test'),
  ('00000000-0000-4000-8000-00000000a008', 'admin@example.test'),
  ('00000000-0000-4000-8000-00000000a009', 'operator-a@example.test'),
  ('00000000-0000-4000-8000-00000000a00a', 'checkin-a@example.test'),
  ('00000000-0000-4000-8000-00000000a00b', 'moderator@example.test'),
  ('00000000-0000-4000-8000-00000000a00c', 'revoked-staff@example.test'),
  ('00000000-0000-4000-8000-00000000a00d', 'revoked-assignment@example.test'),
  ('00000000-0000-4000-8000-00000000a00e', 'edition-admin@example.test');
insert into auth.users (id, email, banned_until) values
  ('00000000-0000-4000-8000-00000000a00f', 'gotrue-banned@example.test', now() + interval '1 day');

insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-00000000' || s)::uuid, ('00000000-0000-4000-8000-00000000' || s)::uuid, 'READY', st,
  'Runner ' || s, '1990-01-01', 'F', '+528110000001', 'Contacto', '+528110000002', 'Madre', now()
from (values ('a001', 'ACTIVE'), ('a002', 'ACTIVE'), ('a005', 'BANNED'), ('a006', 'IDENTITY_LOCKED'),
             ('a007', 'DEACTIVATED'), ('a00f', 'ACTIVE')) v(s, st);
insert into app.runner_profile (runner_profile_id, auth_user_id) values
  ('10000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000a003');
insert into app.community_profile (runner_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-00000000a001', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-00000000a002', 'ELIGIBLE', false),
  ('10000000-0000-4000-8000-00000000a005', 'ELIGIBLE', true);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-00000000a001', event_type_id, 'Evento Helpers', 'evento-helpers'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, registration_close_at,
  city, state_region, country_code) values
  ('50000000-0000-4000-8000-00000000a001', '40000000-0000-4000-8000-00000000a001', 'helpers-a', 'Helpers A', 'FREE',
   'America/Monterrey', now() + interval '30 days', 'Monterrey', 'Nuevo León', 'MX'),
  ('50000000-0000-4000-8000-00000000a002', '40000000-0000-4000-8000-00000000a001', 'helpers-b', 'Helpers B', 'FREE',
   'America/Monterrey', now() + interval '30 days', 'Monterrey', 'Nuevo León', 'MX');

insert into app.staff_member (staff_member_id, auth_user_id, status)
select ('20000000-0000-4000-8000-00000000' || s)::uuid, ('00000000-0000-4000-8000-00000000' || s)::uuid, st
from (values ('a005', 'ACTIVE'), ('a008', 'ACTIVE'), ('a009', 'ACTIVE'), ('a00a', 'ACTIVE'), ('a00b', 'ACTIVE'),
             ('a00c', 'REVOKED'), ('a00d', 'ACTIVE'), ('a00e', 'ACTIVE')) v(s, st);
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id, revoked_at) values
  ('20000000-0000-4000-8000-00000000a005', 'OPERATOR', 'GLOBAL', null, null),
  ('20000000-0000-4000-8000-00000000a008', 'ADMIN', 'GLOBAL', null, null),
  ('20000000-0000-4000-8000-00000000a009', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-00000000a001', null),
  ('20000000-0000-4000-8000-00000000a00a', 'CHECKIN', 'EDITION', '50000000-0000-4000-8000-00000000a001', null),
  ('20000000-0000-4000-8000-00000000a00b', 'MODERATOR', 'GLOBAL', null, null),
  ('20000000-0000-4000-8000-00000000a00c', 'ADMIN', 'GLOBAL', null, null),
  ('20000000-0000-4000-8000-00000000a00d', 'OPERATOR', 'GLOBAL', null, now()),
  ('20000000-0000-4000-8000-00000000a00e', 'ADMIN', 'EDITION', '50000000-0000-4000-8000-00000000a001', null);

insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-00000000a001', '10000000-0000-4000-8000-00000000a001', 'Invitado', '2000-01-01', 'M',
   '+528110000003', 'Contacto', '+528110000004', 'Hermano');
insert into app.friendship (requester_profile_id, addressee_profile_id, status, responded_at) values
  ('10000000-0000-4000-8000-00000000a001', '10000000-0000-4000-8000-00000000a002', 'ACCEPTED', now());

-- ---------------------------------------------------------------------------------------------
-- current_actor contract (lib/server/auth/actor.ts)
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '';
select is(public.current_actor(),
  '{"auth_user_id": null, "runner_profile_id": null, "profile_readiness": null, "account_state": null, "staff_member_id": null, "staff_roles": []}'::jsonb,
  'current_actor without a session is the anonymous actor');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a009", "role": "authenticated"}';
select is(public.current_actor(),
  '{"auth_user_id": "00000000-0000-4000-8000-00000000a009", "runner_profile_id": null, "profile_readiness": null, "account_state": null, "staff_member_id": "20000000-0000-4000-8000-00000000a009", "staff_roles": [{"role": "OPERATOR", "scope_type": "EDITION", "edition_id": "50000000-0000-4000-8000-00000000a001"}]}'::jsonb,
  'current_actor lists live staff roles with scope');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
select is(public.current_actor() - 'auth_user_id',
  '{"runner_profile_id": "10000000-0000-4000-8000-00000000a001", "profile_readiness": "READY", "account_state": "ACTIVE", "staff_member_id": null, "staff_roles": []}'::jsonb,
  'current_actor projects the runner profile state');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a005", "role": "authenticated"}';
select is(public.current_actor() -> 'staff_roles', '[]'::jsonb, 'a BANNED identity exposes no staff roles');
select is(public.current_actor() ->> 'account_state', 'BANNED', 'current_actor reports BANNED from the table');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a00d", "role": "authenticated"}';
select is(public.current_actor() -> 'staff_roles', '[]'::jsonb, 'revoked assignments are not listed');
select is(jsonb_object_keys_count, 6, 'current_actor has exactly the six contract keys')
from (select count(*)::int as jsonb_object_keys_count from jsonb_object_keys(public.current_actor())) k;

-- ---------------------------------------------------------------------------------------------
-- Staff role scope (SEC-020) and RBAC data (SEC-022)
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a009", "role": "authenticated"}';
select ok(private.has_staff_role('OPERATOR', '50000000-0000-4000-8000-00000000a001'), 'EDITION operator matches its Edition');
select ok(not private.has_staff_role('OPERATOR', '50000000-0000-4000-8000-00000000a002'), 'EDITION operator does not match another Edition');
select ok(not private.has_staff_role('OPERATOR', null), 'NULL edition never matches an EDITION-scoped assignment');
select ok(not private.has_staff_role('ADMIN', '50000000-0000-4000-8000-00000000a001'), 'a role the staff does not hold never matches');
select ok(private.is_edition_staff('50000000-0000-4000-8000-00000000a001') and not private.is_edition_staff('50000000-0000-4000-8000-00000000a002'),
  'is_edition_staff follows the assignment scope');
select ok(private.has_permission('PRICE_MANAGE', '50000000-0000-4000-8000-00000000a001'), 'OPERATOR may manage prices of its Edition');
select ok(not private.has_permission('PRICE_MANAGE', '50000000-0000-4000-8000-00000000a002'), 'OPERATOR may not manage prices of another Edition');
select ok(not private.has_permission('PII_EXPORT', '50000000-0000-4000-8000-00000000a001'), 'OPERATOR cannot export PII');
select ok(not private.has_permission('PLATFORM_BAN_MANAGE', null), 'OPERATOR cannot ban');
select ok(not private.has_permission('NO_SUCH_ACTION', '50000000-0000-4000-8000-00000000a001'), 'unknown actions are denied');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a008", "role": "authenticated"}';
select ok(private.has_staff_role('ADMIN', null) and private.has_staff_role('ADMIN', '50000000-0000-4000-8000-00000000a002'),
  'GLOBAL admin matches NULL and any Edition');
select ok(private.is_admin_global(), 'is_admin_global for a GLOBAL admin');
select ok(private.has_permission('STAFF_ROLES_MANAGE') and private.has_permission('PII_EXPORT'), 'GLOBAL admin holds global-only actions');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a00e", "role": "authenticated"}';
select ok(private.has_permission('EDITION_PUBLISH', '50000000-0000-4000-8000-00000000a001'), 'EDITION admin publishes its Edition');
select ok(not private.has_permission('STAFF_ROLES_MANAGE', '50000000-0000-4000-8000-00000000a001')
          and not private.has_permission('STAFF_ROLES_MANAGE'), 'EDITION admin cannot manage staff roles (global only)');
select ok(not private.is_admin_global(), 'EDITION admin is not a GLOBAL admin');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a00a", "role": "authenticated"}';
select ok(private.has_permission('PASS_SCAN', '50000000-0000-4000-8000-00000000a001'), 'CHECKIN may scan in its Edition');
select ok(not private.has_permission('CAPACITY_MANAGE', '50000000-0000-4000-8000-00000000a001')
          and not private.has_permission('PRICE_MANAGE', '50000000-0000-4000-8000-00000000a001'), 'CHECKIN cannot edit capacity or price');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a00b", "role": "authenticated"}';
select ok(private.has_permission('AVATAR_MODERATE'), 'MODERATOR moderates avatars');
select ok(not private.has_permission('PARTICIPANT_LIST_READ', '50000000-0000-4000-8000-00000000a001'), 'MODERATOR has no participant data');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a00c", "role": "authenticated"}';
select ok(private.current_staff_member_id() is null and not private.is_admin_global(), 'a REVOKED staff member holds no role');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a00d", "role": "authenticated"}';
select ok(not private.has_staff_role('OPERATOR', null), 'a revoked assignment grants nothing');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a005", "role": "authenticated"}';
select ok(private.current_staff_member_id() is null and not private.has_staff_role('OPERATOR', null),
  'a BANNED runner who is staff holds no staff privilege');

select is_empty($$ select action from private.staff_permission where role = 'CHECKIN'
  and action in ('CAPACITY_MANAGE', 'PRICE_MANAGE', 'PII_EXPORT', 'PLATFORM_BAN_MANAGE', 'PARTICIPANT_LIST_READ') $$,
  'Master §145: CHECKIN has no capacity/price/export/ban/participant list');
select is_empty($$ select action from private.staff_permission where role = 'OPERATOR'
  and action in ('PLATFORM_BAN_MANAGE', 'STAFF_ROLES_MANAGE', 'PII_EXPORT', 'PLATFORM_SETTINGS_MANAGE', 'LEGAL_DOCUMENTS_PUBLISH') $$,
  'Master §145: OPERATOR has no ban, role grants, PII export, settings or legal publication');
select set_eq($$ select action from private.staff_permission where role = 'MODERATOR' $$,
  array['AVATAR_MODERATE', 'AVATAR_SUSPEND', 'ADMIN_TASK_READ'], 'Master §145: MODERATOR is limited to the avatar queue');
select set_eq($$ select action from private.staff_permission where role = 'ADMIN' $$,
  $$ select action from private.staff_action $$, 'ADMIN holds every action');

-- ---------------------------------------------------------------------------------------------
-- Ownership helpers
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
select is(private.current_profile_id(), '10000000-0000-4000-8000-00000000a001'::uuid, 'current_profile_id resolves the caller profile');
select ok(private.is_profile_ready() and private.is_profile_active(), 'READY and ACTIVE flags for runner A');
select ok(private.owns_guest('30000000-0000-4000-8000-00000000a001'), 'owner owns its guest');
select ok(private.friendship_accepted('10000000-0000-4000-8000-00000000a002'), 'accepted friendship is seen from the requester');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a002", "role": "authenticated"}';
select ok(not private.owns_guest('30000000-0000-4000-8000-00000000a001'), 'another runner does not own the guest');
select ok(private.friendship_accepted('10000000-0000-4000-8000-00000000a001'), 'accepted friendship is seen from the addressee');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a003", "role": "authenticated"}';
select ok(not private.is_profile_ready() and private.is_profile_active(), 'PROFILE_INCOMPLETE is active but not ready');
select ok(private.is_public_profile('10000000-0000-4000-8000-00000000a001'), 'visible READY ACTIVE profile is public');
select ok(not private.is_public_profile('10000000-0000-4000-8000-00000000a002'), 'is_visible=false hides a profile');
select ok(not private.is_public_profile('10000000-0000-4000-8000-00000000a005'), 'a BANNED profile is never public');

-- ---------------------------------------------------------------------------------------------
-- Preconditions raise Master §178 codes from live state
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '';
select throws_ok($$ select private.require_actor() $$, 'P0001', 'AUTH_REQUIRED', 'require_actor without a session');
set local "request.jwt.claims" = '{"role": "service_role"}';
select throws_ok($$ select private.require_actor() $$, 'P0001', 'AUTH_REQUIRED', 'the SYSTEM key is not a user actor');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-0000000000ff", "role": "authenticated"}';
select throws_ok($$ select private.require_actor() $$, 'P0001', 'AUTH_REQUIRED', 'a JWT for a missing auth user is rejected');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated", "is_anonymous": true}';
select throws_ok($$ select private.require_actor() $$, 'P0001', 'AUTH_REQUIRED', 'anonymous sign-ins are not actors');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a00f", "role": "authenticated"}';
select throws_ok($$ select private.require_actor() $$, 'P0001', 'ACCOUNT_BANNED', 'a GoTrue ban is enforced with a live JWT');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a004", "role": "authenticated"}';
select throws_ok($$ select private.require_ready_profile() $$, 'P0001', 'PROFILE_INCOMPLETE', 'no profile yet');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a003", "role": "authenticated"}';
select throws_ok($$ select private.require_ready_profile() $$, 'P0001', 'PROFILE_INCOMPLETE', 'profile not READY');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a005", "role": "authenticated"}';
select throws_ok($$ select private.require_ready_profile() $$, 'P0001', 'ACCOUNT_BANNED', 'BANNED from account_state');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a006", "role": "authenticated"}';
select throws_ok($$ select private.require_ready_profile() $$, 'P0001', 'IDENTITY_LOCKED', 'IDENTITY_LOCKED from account_state');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a007", "role": "authenticated"}';
select throws_ok($$ select private.require_ready_profile() $$, 'P0001', 'FORBIDDEN', 'DEACTIVATED is forbidden');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
select is(private.require_ready_profile(), '10000000-0000-4000-8000-00000000a001'::uuid, 'READY ACTIVE returns the profile id');
select throws_ok($$ select private.require_staff(array['ADMIN', 'OPERATOR'], null) $$, 'P0001', 'FORBIDDEN', 'a runner is not staff');
select throws_ok($$ select private.require_permission('PASS_SCAN', '50000000-0000-4000-8000-00000000a001') $$, 'P0001', 'FORBIDDEN',
  'a runner has no permission');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a009", "role": "authenticated"}';
select is(private.require_staff(array['ADMIN', 'OPERATOR'], '50000000-0000-4000-8000-00000000a001'),
  '20000000-0000-4000-8000-00000000a009'::uuid, 'require_staff returns the staff id for a matching role');
select throws_ok($$ select private.require_staff(array['OPERATOR'], '50000000-0000-4000-8000-00000000a002') $$, 'P0001', 'FORBIDDEN',
  'require_staff rejects another Edition');
select throws_ok($$ select private.require_permission('PII_EXPORT', '50000000-0000-4000-8000-00000000a001') $$, 'P0001', 'FORBIDDEN',
  'require_permission rejects an action outside the role');

-- ---------------------------------------------------------------------------------------------
-- Errors (SEC-005)
-- ---------------------------------------------------------------------------------------------
select throws_ok($$ select private.raise_domain_error('CAPACITY_UNAVAILABLE', '{"modality_id": "x"}') $$, 'P0001',
  'CAPACITY_UNAVAILABLE', 'raise_domain_error uses the code as message');
select throws_ok($$ select private.raise_domain_error('bad code with data') $$, 'P0001', 'INTERNAL_ERROR',
  'a malformed code never leaves as a message');

create function pg_temp.captured_detail(sql text) returns text language plpgsql as $$
declare v_detail text;
begin
  execute sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlerrm || '|' || coalesce(v_detail, '');
end $$;

select is(pg_temp.captured_detail($$ select private.raise_domain_error('RATE_LIMITED', '{"retry_after_seconds": 5}') $$),
  'RATE_LIMITED|{"retry_after_seconds": 5}', 'detail carries the client-safe JSON');
select is(pg_temp.captured_detail($$ select private.raise_domain_error('NOT_FOUND') $$), 'NOT_FOUND|{}', 'detail defaults to {}');
select is(pg_temp.captured_detail($$ select private.raise_constraint_error('23505', 'registration_request_buyer_pending_uidx',
  '{"registration_request_buyer_pending_uidx": "PARTICIPANT_ALREADY_HELD"}') $$), 'PARTICIPANT_ALREADY_HELD|{}',
  'a mapped constraint wins');
select is(pg_temp.captured_detail($$ select private.raise_constraint_error('23505', 'other_uidx') $$), 'CONFLICT|{}', '23505 → CONFLICT');
select is(pg_temp.captured_detail($$ select private.raise_constraint_error('23503') $$), 'NOT_FOUND|{}', '23503 → NOT_FOUND');
select is(pg_temp.captured_detail($$ select private.raise_constraint_error('23001') $$), 'BUSINESS_RULE_VIOLATION|{}',
  '23001 history protection → BUSINESS_RULE_VIOLATION');
select is(pg_temp.captured_detail($$ select private.raise_constraint_error('23514') $$), 'VALIDATION_ERROR|{}', '23514 → VALIDATION_ERROR');
select is(pg_temp.captured_detail($$ select private.raise_constraint_error('22P02') $$), 'VALIDATION_ERROR|{}', '22xxx → VALIDATION_ERROR');
select is(pg_temp.captured_detail($$ select private.raise_constraint_error('XX000') $$), 'INTERNAL_ERROR|{}', 'unknown → INTERNAL_ERROR');

create function pg_temp.duplicate_friendship() returns void language plpgsql as $$
declare v_constraint text;
begin
  insert into app.friendship (requester_profile_id, addressee_profile_id)
  values ('10000000-0000-4000-8000-00000000a002', '10000000-0000-4000-8000-00000000a001');
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint, '{"friendship_live_pair_uidx": "CONFLICT"}',
    '{"reason": "FRIENDSHIP_EXISTS"}');
end $$;
select is(pg_temp.captured_detail('select pg_temp.duplicate_friendship()'), 'CONFLICT|{"reason": "FRIENDSHIP_EXISTS"}',
  'the command pattern re-raises a unique violation without constraint names or values');

-- ---------------------------------------------------------------------------------------------
-- Audit and outbox
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a009", "role": "authenticated"}';
set local "request.headers" = '{"x-request-id": "0b0f9a8e-7c55-4d7a-9a7e-4f8f8a4a0001"}';
create temp table audit_ids (label text primary key, id uuid) on commit drop;
insert into audit_ids values ('operator', private.audit('PRICE_CHANGED', 'price_offer', gen_random_uuid(),
  '50000000-0000-4000-8000-00000000a001', '{"amount_minor": 100}', '{"amount_minor": 200}', 'ajuste'));
select results_eq($$
  select actor_auth_user_id, actor_staff_member_id, actor_role, request_id from audit.audit_log
  where audit_log_id = (select id from audit_ids where label = 'operator') $$,
  $$ values ('00000000-0000-4000-8000-00000000a009'::uuid, '20000000-0000-4000-8000-00000000a009'::uuid, 'OPERATOR',
             '0b0f9a8e-7c55-4d7a-9a7e-4f8f8a4a0001'::uuid) $$,
  'audit resolves actor, staff, applicable role and request id');
set local "request.headers" = '{"x-request-id": "not-a-uuid"}';
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
insert into audit_ids values ('runner', private.audit('PROFILE_UPDATED', 'runner_profile', '10000000-0000-4000-8000-00000000a001', null));
select results_eq($$
  select actor_staff_member_id, actor_role, request_id from audit.audit_log
  where audit_log_id = (select id from audit_ids where label = 'runner') $$,
  $$ values (null::uuid, 'RUNNER', null::uuid) $$, 'audit for a runner; malformed request ids are dropped');
set local "request.jwt.claims" = '';
insert into audit_ids values ('system', private.audit('WORKER_DONE', 'worker_run', null, null));
select is((select actor_role from audit.audit_log where audit_log_id = (select id from audit_ids where label = 'system')),
  'SYSTEM', 'audit without a user is SYSTEM');
select throws_ok($$ select private.audit('lowercase', 'x', null, null) $$, '22023', null, 'audit validates its arguments');

select is(private.enqueue_outbox('ProfileReady', 'RunnerProfile', '10000000-0000-4000-8000-00000000a001',
            'ProfileReady:test', '{"runner_profile_id": "10000000-0000-4000-8000-00000000a001"}'),
          private.enqueue_outbox('ProfileReady', 'RunnerProfile', '10000000-0000-4000-8000-00000000a001',
            'ProfileReady:test', '{"runner_profile_id": "10000000-0000-4000-8000-00000000a001"}'),
          'enqueue_outbox is idempotent on effect_key');
select is((select count(*)::int from infra.outbox_event where effect_key = 'ProfileReady:test'), 1, 'one outbox row per effect');
select throws_ok($$ select private.enqueue_outbox('X1Event', 'RunnerProfile', gen_random_uuid(), 'k:pii',
  '{"runner_profile_id": "a", "nested": {"email": "x@example.test"}}') $$, '22023', null, 'outbox rejects PII keys at any depth');
select throws_ok($$ select private.enqueue_outbox('X1Event', 'RunnerProfile', gen_random_uuid(), 'k:qr',
  '{"items": ["RN1.abcdef"]}') $$, '22023', null, 'outbox rejects QR credential material');

-- ---------------------------------------------------------------------------------------------
-- Rate limits (SEC-141)
-- ---------------------------------------------------------------------------------------------
select ok(private.consume_rate_limit('test.scope', 'subject-1', 2, interval '1 hour')
          and private.consume_rate_limit('test.scope', 'subject-1', 2, interval '1 hour'), 'hits within the limit are allowed');
select ok(not private.consume_rate_limit('test.scope', 'subject-1', 2, interval '1 hour', false), 'over the limit returns false when not raising');
select matches(pg_temp.captured_detail($$ select private.consume_rate_limit('test.scope', 'subject-1', 2, interval '1 hour') $$),
  '^RATE_LIMITED\|\{"retry_after_seconds": [0-9]+\}$', 'over the limit raises RATE_LIMITED with retry_after_seconds');
select ok(private.consume_rate_limit('test.scope', 'subject-2', 2, interval '1 hour'), 'subjects are counted independently');
select is_empty($$ select 1 from infra.rate_limit_counter where subject like '%subject-%' $$, 'subjects are stored hashed');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
select is(public.consume_actor_rate_limit('people.search'), '{"allowed": true}'::jsonb, 'authenticated pre-check on an ACTOR scope');
select throws_ok($$ select public.consume_actor_rate_limit('auth.otp.email') $$, 'P0001', 'VALIDATION_ERROR',
  'a user cannot consume a server-supplied subject scope');
select throws_ok($$ select public.consume_subject_rate_limit('auth.otp.email', 'victim@example.test') $$, '42501', null,
  'authenticated cannot consume budgets of arbitrary subjects');
reset role;
set local role service_role;
select is(public.consume_subject_rate_limit('auth.otp.email', 'victim@example.test'), '{"allowed": true}'::jsonb,
  'SYSTEM consumes a SUPPLIED scope');
select throws_ok($$ select public.consume_subject_rate_limit('auth.otp.email', 'victim@example.test') $$, 'P0001', 'RATE_LIMITED',
  'OTP cooldown: a second request per email within 60 s is limited');
reset role;
select ok(not has_function_privilege('anon', 'public.consume_actor_rate_limit(text)', 'EXECUTE'), 'anon cannot run the actor pre-check');

-- ---------------------------------------------------------------------------------------------
-- Idempotency (SEC-140)
-- ---------------------------------------------------------------------------------------------
create temp table idem (label text primary key, result jsonb) on commit drop;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
insert into idem values ('a1', private.idempotency_begin('test.op', 'scope-1', 'key-000001', '{"x": 1}'));
select is(idem.result -> 'replay', 'false'::jsonb, 'first begin executes') from idem where label = 'a1';
select lives_ok($$ select private.idempotency_complete((select (result ->> 'record_id')::uuid from idem where label = 'a1'), 201,
  '{"ok": true}') $$, 'complete stores the response');
select is(private.idempotency_begin('test.op', 'scope-1', 'key-000001', '{"x": 1}') - 'record_id',
  '{"replay": true, "response_status": 201, "response_body": {"ok": true}}'::jsonb, 'same key + same args replays the response');
select throws_ok($$ select private.idempotency_begin('test.op', 'scope-1', 'key-000001', '{"x": 2}') $$, 'P0001', 'IDEMPOTENCY_CONFLICT',
  'same key + different args conflicts');
select throws_ok($$ select private.idempotency_begin('test.op', 'scope-1', 'bad key', '{"x": 1}') $$, 'P0001', 'VALIDATION_ERROR',
  'malformed keys are rejected');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-00000000a002", "role": "authenticated"}';
select is(private.idempotency_begin('test.op', 'scope-1', 'key-000001', '{"x": 1}') -> 'replay', 'false'::jsonb,
  'user B reusing user A key executes independently (never A''s response)');
set local "request.jwt.claims" = '';
insert into idem values ('s1', private.idempotency_begin('test.op', 'scope-1', 'key-000001', '{"x": 1}'));
select lives_ok($$ select private.idempotency_complete((select (result ->> 'record_id')::uuid from idem where label = 's1'), 200,
  '{"system": true}') $$, 'SYSTEM namespace completes');
select is(private.idempotency_begin('test.op', 'scope-1', 'key-000001', '{"x": 1}') -> 'response_body', '{"system": true}'::jsonb,
  'SYSTEM duplicates replay (NULL actor is one namespace)');
insert into idem values ('s2', private.idempotency_begin('test.op', 'scope-2', 'key-000002', '{}'));
select throws_ok($$ select private.idempotency_complete((select (result ->> 'record_id')::uuid from idem where label = 's2'), 200,
  '{"qr": "RN1.secret"}') $$, '22023', null, 'responses carrying QR credentials are never stored');

-- ---------------------------------------------------------------------------------------------
-- Blocked identities (SEC-047) and pure helpers (T10 F1)
-- ---------------------------------------------------------------------------------------------
select is(private.email_match_key('  J.Doe+Race@GoogleMail.com '), 'jdoe@gmail.com', 'gmail aliases fold to one key');
select is(private.email_match_key('Ana.Perez+x@Example.test'), 'ana.perez@example.test', 'plus tags fold for every domain');
insert into private.blocked_identity (runner_profile_id, normalized_email, oauth_provider, oauth_subject) values
  ('10000000-0000-4000-8000-00000000a005', 'banned.person@gmail.com', 'google', 'google-sub-banned');
select ok(private.is_identity_blocked('BannedPerson+new@gmail.com'), 'alias of a blocked email is blocked');
select ok(private.is_identity_blocked(null, 'google', 'google-sub-banned'), 'blocked Google subject is blocked');
select ok(not private.is_identity_blocked('someone.else@gmail.com', 'google', 'other-sub'), 'other identities pass');
update private.blocked_identity set active = false, revoked_at = now() where oauth_subject = 'google-sub-banned';
select ok(not private.is_identity_blocked('banned.person@gmail.com'), 'revoked blocks no longer apply');

set local role authenticated;
select is(private.normalize_search_text('ÁLVARO  Núñez'), 'alvaro nunez', 'authenticated can evaluate normalize_search_text');
reset role;
-- Positive write test: a non-owner role with table privileges can write rows whose CHECK/index
-- expressions call private.is_iana_timezone / private.normalize_search_text.
grant usage on schema app to service_role;
grant insert on app.edition to service_role;
grant update (display_name) on app.community_profile to service_role;
grant select on app.community_profile to service_role;
set local role service_role;
select lives_ok($$ insert into app.edition (event_id, slug, name, registration_mode, timezone, registration_close_at,
  city, state_region, country_code) values ('40000000-0000-4000-8000-00000000a001', 'helpers-f1', 'F1', 'FREE',
  'America/Monterrey', now() + interval '1 day', 'Monterrey', 'NL', 'MX') $$, 'DML through is_iana_timezone CHECK works for a non-owner role');
select lives_ok($$ update app.community_profile set display_name = 'Nombre Nuevo'
  where runner_profile_id = '10000000-0000-4000-8000-00000000a001' $$, 'DML through the normalize_search_text index works for a non-owner role');
reset role;

select * from finish();
rollback;
