-- ADR-001 A7 / SEC-040 / SEC-047: before-user-created hook and auth.users / auth.identities guards.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000c001', 'banned-owner@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id) values
  ('10000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c001');
insert into private.blocked_identity (runner_profile_id, normalized_email, oauth_provider, oauth_subject) values
  ('10000000-0000-4000-8000-00000000c001', 'blocked.person@gmail.com', 'google', '109876543210');

select is(private.hook_before_user_created(
  '{"metadata": {"name": "before-user-created"}, "user": {"email": "new.runner@example.test", "app_metadata": {"provider": "email"}, "identities": []}}'),
  '{}'::jsonb, 'hook allows an unknown email');
select is(private.hook_before_user_created(
  '{"user": {"email": "BlockedPerson+again@GoogleMail.com", "app_metadata": {"provider": "email"}}}') -> 'error' ->> 'http_code',
  '403', 'hook rejects an alias of a blocked email');
select is(private.hook_before_user_created(
  '{"user": {"email": "fresh@example.test", "app_metadata": {"provider": "google"}, "identities": [{"provider": "google", "identity_data": {"sub": "109876543210"}}]}}') -> 'error' ->> 'http_code',
  '403', 'hook rejects a blocked Google subject in identities');
select is(private.hook_before_user_created(
  '{"user": {"email": "fresh@example.test", "app_metadata": {"provider": "google"}, "user_metadata": {"sub": "109876543210"}}}') -> 'error' ->> 'http_code',
  '403', 'hook rejects a blocked Google subject in user_metadata');
select is(private.hook_before_user_created('{"user": "not-an-object"}') -> 'error' ->> 'http_code', '403',
  'hook fails closed on a malformed event');
select is(private.hook_before_user_created('{"user": {"email": "x@example.test", "identities": "broken"}}') -> 'error' ->> 'http_code', '403',
  'hook fails closed on errors');
select matches(private.hook_before_user_created('{"user": {"email": "blocked.person@gmail.com"}}') -> 'error' ->> 'message',
  '^Sign-up is not allowed\.$', 'rejection message is generic (no reason disclosed)');

select ok(has_function_privilege('supabase_auth_admin', 'private.hook_before_user_created(jsonb)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.hook_before_user_created(jsonb)', 'EXECUTE')
          and not has_function_privilege('anon', 'private.hook_before_user_created(jsonb)', 'EXECUTE')
          and not has_function_privilege('service_role', 'private.hook_before_user_created(jsonb)', 'EXECUTE'),
  'only GoTrue executes the hook');

-- Triggers fire for every writer, GoTrue's supabase_auth_admin included.
insert into auth.users (id, email, encrypted_password) values
  ('00000000-0000-4000-8000-00000000c002', 'pw-signup@example.test', '$2a$10$abcdefghijklmnopqrstuuJ4Vz8bYw0Z5o8p3QxK6N5aY7rW1mDi');
select is((select encrypted_password from auth.users where id = '00000000-0000-4000-8000-00000000c002'), '',
  'SEC-040: a password hash supplied at sign-up is never stored');
select throws_ok($$ update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuuJ4Vz8bYw0Z5o8p3QxK6N5aY7rW1mDi'
  where id = '00000000-0000-4000-8000-00000000c002' $$, '42501', 'password credentials are disabled',
  'SEC-040: a password cannot be set later');
select lives_ok($$ update auth.users set last_sign_in_at = now(), encrypted_password = ''
  where id = '00000000-0000-4000-8000-00000000c002' $$, 'unrelated updates still work');
select throws_ok($$ insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000c003', 'blocked.person+2@gmail.com') $$,
  '42501', 'identity is not allowed', 'SEC-047: a blocked email cannot be created');
select throws_ok($$ update auth.users set email = 'blocked.person@gmail.com' where id = '00000000-0000-4000-8000-00000000c002' $$,
  '42501', 'identity is not allowed', 'SEC-047: a blocked email cannot be adopted by an email change');
select lives_ok($$ update auth.users set email = 'renamed@example.test' where id = '00000000-0000-4000-8000-00000000c002' $$,
  'ordinary email changes still work');
select throws_ok($$ insert into auth.identities (provider_id, user_id, identity_data, provider)
  values ('109876543210', '00000000-0000-4000-8000-00000000c002', '{"sub": "109876543210"}', 'google') $$,
  '42501', 'identity is not allowed', 'SEC-047: a blocked Google subject cannot be linked');
select lives_ok($$ insert into auth.identities (provider_id, user_id, identity_data, provider)
  values ('100000000001', '00000000-0000-4000-8000-00000000c002', '{"sub": "100000000001"}', 'google') $$,
  'other Google subjects link normally');

update private.blocked_identity set active = false, revoked_at = now();
select is(private.hook_before_user_created('{"user": {"email": "blocked.person@gmail.com"}}'), '{}'::jsonb,
  'a revoked block no longer rejects');

select * from finish();
rollback;
