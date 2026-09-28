-- T35 communications: favorites, reminders (logged-in), preferences, consent append-only derivation
-- and suppression scopes (Master §127-130, §176; SEC-010/120).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(39);

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
-- Fixture: A (adult, verified email), B (adult, unverified email), C (minor, verified email).
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000500001', 'comms-a@example.test', now()),
  ('00000000-0000-4000-8000-000000500002', 'comms-b@example.test', null),
  ('00000000-0000-4000-8000-000000500003', 'comms-c@example.test', now());
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000500001', '00000000-0000-4000-8000-000000500001', 'READY', 'ACTIVE',
   'Comms A', '1990-01-01', 'M', '+528110005101', 'Contacto', '+528110005102', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000500002', '00000000-0000-4000-8000-000000500002', 'READY', 'ACTIVE',
   'Comms B', '1990-01-01', 'F', '+528110005103', 'Contacto', '+528110005104', 'Hermana', now()),
  ('10000000-0000-4000-8000-000000500003', '00000000-0000-4000-8000-000000500003', 'READY', 'ACTIVE',
   'Comms C Minor', (now() - interval '10 years')::date, 'F', '+528110005105', 'Contacto', '+528110005106', 'Madre', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000500001', 'c0000000-0000-4000-8000-000000500001', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000500002', 'c0000000-0000-4000-8000-000000500002', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000500003', 'c0000000-0000-4000-8000-000000500003', 'ELIGIBLE', true);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000500001', event_type_id, 'Test Comms', 'test-comms-500'
from app.event_type where key = 'ROAD_RACE';
-- E1: registration NOT_OPEN (remindable + favoritable).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000500001', '40000000-0000-4000-8000-000000500001', 'test-comms-500-notopen',
   'Test Comms 500 Not Open', 'PUBLISHED', 'SCHEDULED', 'NOT_OPEN', 'FREE', 'America/Monterrey',
   now() + interval '10 days', now() + interval '40 days', 'Monterrey', 'NL', 'MX', now());
-- E2: registration OPEN (favoritable only; reminder rejected).
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000500002', '40000000-0000-4000-8000-000000500001', 'test-comms-500-open',
   'Test Comms 500 Open', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert on ids to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000500001", "role": "authenticated"}';

-- ---------------------------------------------------------------------------------------------
-- Favorites (Master §127-129: favorite never implies marketing consent)
-- ---------------------------------------------------------------------------------------------
select is(public.add_edition_favorite('50000000-0000-4000-8000-000000500001'),
  jsonb_build_object('edition_id', '50000000-0000-4000-8000-000000500001', 'favorite', true), 'favorite created');
select is(public.add_edition_favorite('50000000-0000-4000-8000-000000500001'),
  jsonb_build_object('edition_id', '50000000-0000-4000-8000-000000500001', 'favorite', true), 'repeated favorite is idempotent (one effect)');
select is((select count(*) from app.edition_interest where runner_profile_id = '10000000-0000-4000-8000-000000500001'), 1::bigint,
  'exactly one edition_interest row after two calls');
select is((select (public.list_my_favorites() -> 0 ->> 'edition_id')), '50000000-0000-4000-8000-000000500001', 'favorite shows in list_my_favorites');
select is((select public.list_my_favorites() -> 0 -> 'reminder'), 'null'::jsonb, 'no reminder yet');
select is(public.remove_edition_favorite('50000000-0000-4000-8000-000000500001'),
  jsonb_build_object('edition_id', '50000000-0000-4000-8000-000000500001', 'favorite', false), 'favorite removed');
select is(public.list_my_favorites(), '[]'::jsonb, 'list is empty after removing the only favorite');
select is(pg_temp.err($$ select public.add_edition_favorite('50000000-0000-4000-8000-00000050ffff') $$) ->> 'code', 'NOT_FOUND',
  'favoriting an unknown Edition is NOT_FOUND');

-- ---------------------------------------------------------------------------------------------
-- Reminders (logged-in): registration state gate, email verification gate, consent side effect.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.create_edition_reminder('50000000-0000-4000-8000-000000500002') $$),
  jsonb_build_object('code', 'BUSINESS_RULE_VIOLATION', 'detail', jsonb_build_object('reason', 'registration_already_open')),
  'reminder rejected once registration is already OPEN');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000500002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_edition_reminder('50000000-0000-4000-8000-000000500001') $$),
  jsonb_build_object('code', 'BUSINESS_RULE_VIOLATION', 'detail', jsonb_build_object('reason', 'email_unverified')),
  'reminder rejected for an unverified auth email');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000500001", "role": "authenticated"}';
insert into ids select 'reminder', public.create_edition_reminder('50000000-0000-4000-8000-000000500001');
select is((select value ->> 'status' from ids where name = 'reminder'), 'ACTIVE', 'verified user reminder activates immediately');
select is((select count(*) from app.communication_consent c
           join app.communication_recipient r on r.communication_recipient_id = c.communication_recipient_id
           where r.runner_profile_id = '10000000-0000-4000-8000-000000500001' and c.purpose = 'EVENT_REMINDER' and c.action = 'GRANTED'),
  1::bigint, 'creating a reminder appends an EVENT_REMINDER GRANTED consent fact');
select is((select public.create_edition_reminder('50000000-0000-4000-8000-000000500001') ->> 'reminder_id'),
  (select value ->> 'reminder_id' from ids where name = 'reminder'),
  'a repeated reminder for an already-ACTIVE subscription is idempotent (same subscription, no duplicate)');

-- Append-only: consent facts are never updated or deleted, and no duplicate fact is written for an
-- unchanged derived state (comms_record_consent only appends when the state actually changes). Tested
-- as postgres (bypassing RLS/grants) since the trigger itself is the invariant under test here — API
-- roles having no UPDATE/DELETE privilege at all on app.communication_consent is 110's job to prove.
reset role;
select throws_ok($$ update app.communication_consent set action = 'WITHDRAWN' where communication_recipient_id in
  (select communication_recipient_id from app.communication_recipient where runner_profile_id = '10000000-0000-4000-8000-000000500001') $$,
  '23001', null, 'communication_consent rows cannot be updated (append-only trigger)');
select throws_ok($$ delete from app.communication_consent $$, '23001', null,
  'communication_consent rows cannot be deleted (append-only trigger)');
set local role authenticated;

-- Cancel: ownership enforced, foreign reminder id is NOT_FOUND (SEC-020, no existence oracle).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000500002", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.cancel_reminder(%L::uuid) $$, (select value ->> 'reminder_id' from ids where name = 'reminder'))) ->> 'code',
  'NOT_FOUND', 'a reminder cannot be canceled by a non-owner');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000500001", "role": "authenticated"}';
select is((select public.cancel_reminder(((select value ->> 'reminder_id' from ids where name = 'reminder'))::uuid) ->> 'status'), 'CANCELED',
  'the owner can cancel their own reminder');
select is(pg_temp.err($$ select public.cancel_reminder('00000000-0000-4000-8000-0000005fffff') $$) ->> 'code', 'NOT_FOUND',
  'canceling an unknown reminder id is NOT_FOUND');

-- ---------------------------------------------------------------------------------------------
-- Preferences: adults-only marketing (SEC-120), auto-cancel of reminders on withdrawal.
-- ---------------------------------------------------------------------------------------------
select is((public.get_my_communication_preferences() -> 'purposes' -> 'GENERAL_MARKETING' ->> 'granted')::boolean, false,
  'marketing defaults to not granted');
select is(public.update_my_communication_preferences(true, null, null) -> 'purposes' -> 'GENERAL_MARKETING' ->> 'granted', 'true',
  'an adult can opt into marketing');
select is(pg_temp.err($$ select public.update_my_communication_preferences(null, null, null) $$) ->> 'code', 'VALIDATION_ERROR',
  'updating with every field null is rejected (no-op guard)');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000500003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.update_my_communication_preferences(true, null, null) $$),
  jsonb_build_object('code', 'BUSINESS_RULE_VIOLATION', 'detail', jsonb_build_object('reason', 'marketing_adults_only')),
  'SEC-120: a minor cannot opt into marketing');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000500001", "role": "authenticated"}';
insert into ids select 'reminder2', public.create_edition_reminder('50000000-0000-4000-8000-000000500001');
select is((select value ->> 'status' from ids where name = 'reminder2'), 'ACTIVE', 'a fresh reminder can be created again after cancellation');
select is(jsonb_array_length(public.get_my_communication_preferences() -> 'reminders'), 1, 'preferences lists the active reminder');
select is(public.update_my_communication_preferences(null, false, null) -> 'purposes' -> 'EVENT_REMINDER' ->> 'granted', 'false',
  'withdrawing EVENT_REMINDER consent updates the derived state');
select is(jsonb_array_length(public.get_my_communication_preferences() -> 'reminders'), 0,
  'withdrawing EVENT_REMINDER consent auto-cancels the live reminder subscription');
select is((select status from app.event_reminder_subscription
           where event_reminder_subscription_id = (select value ->> 'reminder_id' from ids where name = 'reminder2')::uuid),
  'CANCELED', 'the subscription row itself moved to CANCELED');

-- ---------------------------------------------------------------------------------------------
-- Suppression scopes (private.comms_is_suppressed / comms_recipient_block_reason) and consent
-- derivation ("latest fact wins", Master §127).
-- ---------------------------------------------------------------------------------------------
reset role;
select is((select private.comms_consent_granted(r.communication_recipient_id, 'GENERAL_MARKETING')
           from app.communication_recipient r where r.runner_profile_id = '10000000-0000-4000-8000-000000500001'), true,
  'latest fact wins: GENERAL_MARKETING is still GRANTED (only EVENT_REMINDER was withdrawn)');

do $$ declare v_recipient uuid; v_contact uuid; begin
  select r.communication_recipient_id, cp.communication_contact_point_id into v_recipient, v_contact
  from app.communication_recipient r
  join app.communication_contact_point cp on cp.communication_recipient_id = r.communication_recipient_id
  where r.runner_profile_id = '10000000-0000-4000-8000-000000500001' and cp.status = 'ACTIVE';
  insert into app.communication_suppression (contact_point_id, reason, scope, source) values
    (v_contact, 'HARD_BOUNCE', 'ALL_EMAIL', 'TEST');
  perform set_config('pgtap.v_recipient', v_recipient::text, false);
  perform set_config('pgtap.v_contact', v_contact::text, false);
end $$;

select ok(private.comms_is_suppressed(current_setting('pgtap.v_contact')::uuid, 'MARKETING'),
  'ALL_EMAIL suppression blocks the MARKETING category');
select ok(private.comms_is_suppressed(current_setting('pgtap.v_contact')::uuid, 'REMINDER'),
  'ALL_EMAIL suppression blocks the REMINDER category too (scope is channel-wide)');
select is(private.comms_recipient_block_reason(current_setting('pgtap.v_recipient')::uuid, current_setting('pgtap.v_contact')::uuid,
  'MARKETING', true), 'SUPPRESSED', 'block reason reports SUPPRESSED ahead of consent/account checks');

update app.communication_suppression set active = false, resolved_at = now() where contact_point_id = current_setting('pgtap.v_contact')::uuid;
-- User B's earlier create_edition_reminder call was rejected (email_unverified) before ever committing,
-- so no recipient/contact point exists for them yet; materialize one directly (unverified, matching
-- their auth email state) instead of assuming the failed call left anything behind.
do $$ declare v_contact uuid; begin
  select o_contact_point_id into v_contact from private.comms_ensure_runner_recipient('10000000-0000-4000-8000-000000500002');
  insert into app.communication_suppression (contact_point_id, reason, scope, source) values (v_contact, 'SPAM_COMPLAINT', 'OPTIONAL_ONLY', 'TEST');
  perform set_config('pgtap.v_contact_b', v_contact::text, false);
end $$;
select ok(private.comms_is_suppressed(current_setting('pgtap.v_contact_b')::uuid, 'MARKETING'),
  'OPTIONAL_ONLY suppression blocks MARKETING');
select ok(not private.comms_is_suppressed(current_setting('pgtap.v_contact_b')::uuid, 'TRANSACTIONAL'),
  'OPTIONAL_ONLY suppression never blocks TRANSACTIONAL (critical mail keeps flowing, Master §141)');

-- ---------------------------------------------------------------------------------------------
-- Anonymous reminders: SYSTEM only, response is identical regardless of the email's real state.
-- ---------------------------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.request_anonymous_reminder(uuid, text)', 'execute'), false,
  'authenticated cannot call request_anonymous_reminder directly (SYSTEM only)');
select is(has_function_privilege('service_role', 'public.request_anonymous_reminder(uuid, text)', 'execute'), true,
  'service_role can call request_anonymous_reminder');
set local role service_role;
select is(public.request_anonymous_reminder('50000000-0000-4000-8000-000000500001', 'anon-new@example.test'),
  jsonb_build_object('accepted', true), 'a brand-new anonymous email is accepted');
select is(public.request_anonymous_reminder('50000000-0000-4000-8000-000000500001', 'anon-new@example.test'),
  jsonb_build_object('accepted', true), 'a repeated request for the same email/edition within the hour is still {accepted:true} (rate-limited no-op)');
reset role;
select is((select count(*) from app.event_reminder_subscription s
           join app.communication_recipient r on r.communication_recipient_id = s.communication_recipient_id
           where r.recipient_type = 'ANONYMOUS'), 1::bigint,
  'exactly one subscription row was created despite two requests');
select is((select count(*) from app.communication_message where template_key = 'ANONYMOUS_REMINDER_CONFIRMATION'), 1::bigint,
  'exactly one confirmation message was enqueued (dedupe_key collapsed the second attempt)');

reset role;
select * from finish();
rollback;
