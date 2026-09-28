-- T35 communications: dedupe_key uniqueness, generic outbox claim/lease/retry/escalate (Master
-- §147-148), and provider event idempotency/out-of-order (Master §138, §206; SEC-080).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(27);

create function pg_temp.err(p_sql text) returns jsonb language plpgsql as $$
declare v_code text; v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('code', v_code, 'detail', case when v_detail ~ '^\{' then v_detail::jsonb end);
end $$;
create function pg_temp.errcode_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Fixture: one verified runner recipient + a published Edition.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000501001', 'comms-disp-a@example.test', now());
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000501001', '00000000-0000-4000-8000-000000501001', 'READY', 'ACTIVE',
   'Comms Dispatch A', '1990-01-01', 'M', '+528110005201', 'Contacto', '+528110005202', 'Hermano', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000501001', 'c0000000-0000-4000-8000-000000501001', 'ELIGIBLE', true);
insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000501001', event_type_id, 'Test Dispatch', 'test-dispatch-501'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000501001', '40000000-0000-4000-8000-000000501001', 'test-dispatch-501',
   'Test Dispatch 501', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());

create temp table ids (name text primary key, value uuid) on commit drop;

do $$ declare v_recipient uuid; v_contact uuid; begin
  select o_recipient_id, o_contact_point_id into v_recipient, v_contact
  from private.comms_ensure_runner_recipient('10000000-0000-4000-8000-000000501001');
  perform set_config('pgtap.v_recipient', v_recipient::text, false);
  perform set_config('pgtap.v_contact', v_contact::text, false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Dedupe key uniqueness (comms_enqueue_message is idempotent per dedupe_key).
-- ---------------------------------------------------------------------------------------------
insert into ids select 'm1', private.comms_enqueue_message('REGISTRATION_OPENED',
  current_setting('pgtap.v_recipient')::uuid, current_setting('pgtap.v_contact')::uuid, 'TEST:DEDUPE:501:1',
  'EDITION_SCHEDULE_REVISION', gen_random_uuid(),
  private.comms_pick_vars('REGISTRATION_OPENED', private.comms_edition_vars('50000000-0000-4000-8000-000000501001')),
  '50000000-0000-4000-8000-000000501001');
select ok((select value from ids where name = 'm1') is not null, 'first enqueue with a fresh dedupe_key returns a new message id');
select is(private.comms_enqueue_message('REGISTRATION_OPENED', current_setting('pgtap.v_recipient')::uuid,
  current_setting('pgtap.v_contact')::uuid, 'TEST:DEDUPE:501:1', 'EDITION_SCHEDULE_REVISION', gen_random_uuid(),
  private.comms_pick_vars('REGISTRATION_OPENED', private.comms_edition_vars('50000000-0000-4000-8000-000000501001')),
  '50000000-0000-4000-8000-000000501001'), null, 'a repeated call with the same dedupe_key returns NULL (no new effect)');
select is((select count(*) from app.communication_message where dedupe_key = 'TEST:DEDUPE:501:1'), 1::bigint,
  'exactly one message row exists for the dedupe_key regardless of how many times it was enqueued');
select is(pg_temp.errcode_of($$ select private.comms_enqueue_message('REGISTRATION_OPENED', current_setting('pgtap.v_recipient')::uuid,
  current_setting('pgtap.v_contact')::uuid, 'TEST:DEDUPE:501:2', 'EDITION_SCHEDULE_REVISION', gen_random_uuid(),
  jsonb_build_object('unknown_var', 'x'), '50000000-0000-4000-8000-000000501001') $$), '22023',
  'a render context that does not match the template schema is a programming error (22023)');

-- ---------------------------------------------------------------------------------------------
-- Generic outbox: FOR UPDATE SKIP LOCKED claim with a lease, reclaim, retry and escalate.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'ev1', private.enqueue_outbox('RegistrationConfirmed', 'Registration', gen_random_uuid(),
  'TEST:OUTBOX:501:1', jsonb_build_object('registration_id', gen_random_uuid()));

select is(jsonb_array_length(private.claim_outbox_events('worker-a', array['RegistrationConfirmed'], 10, 60)), 1,
  'a due PENDING event is claimed');
select is((select status from infra.outbox_event where outbox_event_id = (select value from ids where name = 'ev1')), 'PROCESSING',
  'the claimed row moves to PROCESSING');
select is(jsonb_array_length(private.claim_outbox_events('worker-b', array['RegistrationConfirmed'], 10, 60)), 0,
  'a second worker cannot claim the same row while the lease is live');
select is((private.complete_outbox_event((select value from ids where name = 'ev1'), 'worker-b', 'PROCESSED', null, null) ->> 'applied')::boolean,
  false, 'the wrong worker cannot complete a claim it does not hold');
select is((private.complete_outbox_event((select value from ids where name = 'ev1'), 'worker-a', 'RETRY', 'PROVIDER_UNREACHABLE', now()) ->> 'applied')::boolean,
  true, 'the holding worker can report a retryable failure');
select is((select status from infra.outbox_event where outbox_event_id = (select value from ids where name = 'ev1')), 'FAILED',
  'a RETRY outcome moves the row back to FAILED with a new available_at');

select is(jsonb_array_length(private.claim_outbox_events('worker-a', array['RegistrationConfirmed'], 10, 60)), 1,
  'the row is claimable again once available_at is due');
select is((select attempt_count from infra.outbox_event where outbox_event_id = (select value from ids where name = 'ev1')), 2,
  'attempt_count incremented on the second claim');
select is((private.complete_outbox_event((select value from ids where name = 'ev1'), 'worker-a', 'ESCALATE', 'PERMANENT_FAILURE', null) ->> 'applied')::boolean,
  true, 'ESCALATE is accepted by the holding worker');
select is((select status from infra.outbox_event where outbox_event_id = (select value from ids where name = 'ev1')), 'ESCALATED',
  'the event is ESCALATED instead of retried forever');
select is((select count(*) from app.admin_task where task_key = 'outbox-escalated:' || (select value from ids where name = 'ev1')), 1::bigint,
  'an AdminTask is opened for the escalated event');
select is(jsonb_array_length(private.claim_outbox_events('worker-a', array['RegistrationConfirmed'], 10, 60)), 0,
  'an ESCALATED event is never claimed again');

-- Lease expiry: a PROCESSING row whose lease already expired is reclaimable by a different worker.
insert into ids select 'ev2', private.enqueue_outbox('RegistrationConfirmed', 'Registration', gen_random_uuid(),
  'TEST:OUTBOX:501:2', '{}'::jsonb);
select private.claim_outbox_events('worker-a', array['RegistrationConfirmed'], 10, 10);
update infra.outbox_event set claim_expires_at = now() - interval '1 second' where outbox_event_id = (select value from ids where name = 'ev2');
select is(jsonb_array_length(private.claim_outbox_events('worker-c', array['RegistrationConfirmed'], 10, 60)), 1,
  'an expired lease is reclaimed by a different worker');
select is((select claimed_by from infra.outbox_event where outbox_event_id = (select value from ids where name = 'ev2')), 'worker-c',
  'the reclaiming worker now holds the lease');
select (private.complete_outbox_event((select value from ids where name = 'ev2'), 'worker-c', 'PROCESSED', null, null));

-- ---------------------------------------------------------------------------------------------
-- Provider events: duplicate delivery is a no-op; out-of-order events never regress message state
-- (Master §138, §206); unauthenticated deliveries are evidence only.
-- ---------------------------------------------------------------------------------------------
update app.communication_message set status = 'SENT', provider = 'brevo', provider_message_id = 'brevo-msg-501-1', sent_at = now()
where communication_message_id = (select value from ids where name = 'm1');
insert into app.communication_delivery_attempt (communication_message_id, provider, status, attempt_number, provider_message_id, resolved_at)
values ((select value from ids where name = 'm1'), 'brevo', 'ACCEPTED', 1, 'brevo-msg-501-1', now());

select is(private.record_email_provider_event('brevo', 'evt-501-1', 'brevo-msg-501-1', 'hard_bounce', '{}'::jsonb, true) ->> 'status',
  'PROCESSED', 'an authenticated hard_bounce event is applied');
select is((select status from app.communication_message where communication_message_id = (select value from ids where name = 'm1')), 'BOUNCED',
  'the message moved to BOUNCED');
select is(private.record_email_provider_event('brevo', 'evt-501-1', 'brevo-msg-501-1', 'hard_bounce', '{}'::jsonb, true) ->> 'status',
  'DUPLICATE', 'the same provider_event_id delivered twice is a no-op (idempotent)');

-- Out-of-order: rank(BOUNCED)=3 > rank(DELIVERED)=2, so a "delivered" notification that arrives late
-- (after the bounce was already applied) must never regress the message back to DELIVERED.
select is(private.record_email_provider_event('brevo', 'evt-501-2', 'brevo-msg-501-1', 'delivered', '{}'::jsonb, true) ->> 'message_status_changed',
  'false', 'an out-of-order delivered after bounced never regresses message status (rank protection)');
select is((select status from app.communication_message where communication_message_id = (select value from ids where name = 'm1')), 'BOUNCED',
  'the message stays BOUNCED, not DELIVERED');
select is((select active from app.communication_suppression where contact_point_id = current_setting('pgtap.v_contact')::uuid and reason = 'HARD_BOUNCE'),
  true, 'the hard_bounce recorded a suppression as evidence');

-- Unauthenticated: recorded as evidence only, never applied (SEC-080).
select is(private.record_email_provider_event('brevo', 'evt-501-3', 'brevo-msg-501-1', 'spam', '{}'::jsonb, false) ->> 'status',
  'UNAUTHENTICATED', 'an unauthenticated event is recorded but flagged UNAUTHENTICATED');
select is((select processing_status from infra.communication_provider_event where provider_event_id = 'evt-501-3'), 'UNAUTHENTICATED',
  'the unauthenticated row is stored as evidence');
select is((select active from app.communication_suppression where contact_point_id = current_setting('pgtap.v_contact')::uuid and reason = 'SPAM_COMPLAINT'),
  null, 'an unauthenticated spam event never applies a suppression');

select * from finish();
rollback;
