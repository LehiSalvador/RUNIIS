-- P2-G9: staging allowlist suppression. claim_communication_messages(p_allowlist) terminally CANCELS a message whose
-- contact point is not on the allowlist (last_error NOT_ALLOWLISTED) BEFORE the provider quota is reserved: it is never
-- handed to a transport, never retried, and never counted in app.communication_provider_usage. A NULL allowlist keeps
-- the previous behaviour exactly; the claim stays service_role only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(24);

create temp table ids (name text primary key, value uuid) on commit drop;

-- One verified runner recipient per address (distinct ids/phones per n).
create function pg_temp.mk_runner(p_n integer, p_email text) returns void language plpgsql as $$
declare
  v_suffix text := lpad(p_n::text, 12, '0');
  v_recipient uuid;
  v_contact uuid;
begin
  insert into auth.users (id, email, email_confirmed_at)
  values (('00000000-0000-4000-8000-' || v_suffix)::uuid, p_email, now());
  insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
    date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
    emergency_contact_relationship, ready_at)
  values (('10000000-0000-4000-8000-' || v_suffix)::uuid, ('00000000-0000-4000-8000-' || v_suffix)::uuid, 'READY', 'ACTIVE',
    'Comms Allowlist ' || p_n, '1990-01-01', 'M', '+52811000' || lpad(p_n::text, 4, '0'), 'Contacto',
    '+52811001' || lpad(p_n::text, 4, '0'), 'Hermano', now());
  insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible)
  values (('10000000-0000-4000-8000-' || v_suffix)::uuid, ('c0000000-0000-4000-8000-' || v_suffix)::uuid, 'ELIGIBLE', true);
  select o_recipient_id, o_contact_point_id into v_recipient, v_contact
  from private.comms_ensure_runner_recipient(('10000000-0000-4000-8000-' || v_suffix)::uuid);
  perform set_config('pgtap.r' || p_n, v_recipient::text, false);
  perform set_config('pgtap.c' || p_n, v_contact::text, false);
end $$;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000504001', event_type_id, 'Test Allowlist', 'test-allowlist-504'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000504001', '40000000-0000-4000-8000-000000504001', 'test-allowlist-504',
   'Test Allowlist 504', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());

select pg_temp.mk_runner(1, 'allow-owner-504@example.test');
select pg_temp.mk_runner(2, 'allow-qa-a-504@example.test');
select pg_temp.mk_runner(3, 'allow-qa-b-504@example.test');
select pg_temp.mk_runner(4, 'allow-qa-c-504@example.test');
select pg_temp.mk_runner(5, 'allow-qa-d-504@example.test');

create function pg_temp.enqueue(p_n integer) returns uuid language sql as $$
  select private.comms_enqueue_message('REGISTRATION_CONFIRMED',
    current_setting('pgtap.r' || p_n)::uuid, current_setting('pgtap.c' || p_n)::uuid,
    'TEST:ALLOW:504:' || p_n, 'REGISTRATION', gen_random_uuid(),
    private.comms_pick_vars('REGISTRATION_CONFIRMED', private.comms_edition_vars('50000000-0000-4000-8000-000000504001'))
      || jsonb_build_object('participant_name', 'Test', 'modality_name', '5K', 'registration_number', n::text, 'is_guest_pass', false),
    '50000000-0000-4000-8000-000000504001')
  from (select p_n as n) s $$;

-- Isolation: the shared local DB may hold due messages from dev traffic; park them for this rolled-back transaction.
update app.communication_message set scheduled_for = now() + interval '1 day'
  where status in ('QUEUED', 'WAITING_FOR_QUOTA') and dedupe_key not like 'TEST:ALLOW:504:%';
update app.communication_message set claim_expires_at = now() + interval '1 day'
  where status = 'SENDING' and dedupe_key not like 'TEST:ALLOW:504:%';

insert into ids select 'owner', pg_temp.enqueue(1);
insert into ids select 'qa_a', pg_temp.enqueue(2);
insert into ids select 'qa_b', pg_temp.enqueue(3);
select ok((select count(*) from ids) = 3, 'three messages (one allowlisted owner, two non-allowlisted QA) were enqueued');

create function pg_temp.brevo_sent() returns integer language sql as $$
  select coalesce((select sent_total from app.communication_provider_usage
                   where provider = 'brevo' and usage_date = (now() at time zone 'UTC')::date), 0) $$;
create temp table usage_marks (name text primary key, value integer) on commit drop;
insert into usage_marks values ('before', pg_temp.brevo_sent());

-- ---------------------------------------------------------------------------------------------
-- Allowlist given: only the allowlisted owner is claimed; the rest are suppressed terminally.
-- The allowlist is normalized in SQL (case + surrounding whitespace), blanks are ignored.
-- ---------------------------------------------------------------------------------------------
select is(jsonb_array_length(private.claim_communication_messages('test-worker', 'brevo', 10, 60,
  array['  ALLOW-OWNER-504@Example.test ', ''])), 1, 'only the allowlisted recipient is claimed');
select is((select status from app.communication_message where communication_message_id = (select value from ids where name = 'owner')),
  'SENDING', 'the allowlisted message proceeds to SENDING');
select is((select status from app.communication_message where communication_message_id = (select value from ids where name = 'qa_a')),
  'CANCELED', 'a non-allowlisted message is CANCELED, not FAILED or QUEUED');
select is((select last_error from app.communication_message where communication_message_id = (select value from ids where name = 'qa_a')),
  'NOT_ALLOWLISTED', 'the stable suppression reason is recorded');
select is((select status from app.communication_message where communication_message_id = (select value from ids where name = 'qa_b')),
  'CANCELED', 'every other non-allowlisted message is suppressed too');
select is((select attempt_count from app.communication_message where communication_message_id = (select value from ids where name = 'qa_a')),
  0, 'a suppressed message never had an attempt');
select is((select count(*) from app.communication_delivery_attempt
           where communication_message_id in (select value from ids where name in ('qa_a', 'qa_b'))),
  0::bigint, 'no delivery attempt row (so no transport, no retry history) exists for suppressed messages');
select is((select claimed_by from app.communication_message where communication_message_id = (select value from ids where name = 'qa_a')),
  null, 'a suppressed message holds no claim');
select is(pg_temp.brevo_sent() - (select value from usage_marks where name = 'before'), 1,
  'only the message actually claimed for Brevo counts against the daily usage');

select is(jsonb_array_length(private.claim_communication_messages('test-worker', 'brevo', 10, 60,
  array['allow-owner-504@example.test'])), 0, 'a second claim finds nothing: suppressed messages are terminal, never retried');
select is((select status from app.communication_message where communication_message_id = (select value from ids where name = 'qa_a')),
  'CANCELED', 'the suppressed message stays CANCELED');
select is(pg_temp.brevo_sent() - (select value from usage_marks where name = 'before'), 1,
  'repeating the claim does not change the usage');

-- The allowlisted owner completes normally: ACCEPTED -> SENT, counted once.
select is((private.complete_communication_attempt((select value from ids where name = 'owner'), 'test-worker', 1, 'ACCEPTED', 'brevo',
  '<owner-504@brevo>', null, null) ->> 'status'), 'SENT', 'the allowlisted message completes as SENT');
select is((select count(*) from app.communication_message m
           where m.dedupe_key like 'TEST:ALLOW:504:%' and m.status = 'FAILED'), 0::bigint, 'nothing ended FAILED');

-- Admin read (existing list_communication_messages shape): suppressed rows read as CANCELED with last_error.
select is((select m.status || '/' || m.last_error from app.communication_message m
           where m.communication_message_id = (select value from ids where name = 'qa_b')),
  'CANCELED/NOT_ALLOWLISTED', 'the suppressed outcome reads as CANCELED / NOT_ALLOWLISTED, not as an error');

-- ---------------------------------------------------------------------------------------------
-- Empty allowlist suppresses everyone; still nothing is counted.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'qa_c', pg_temp.enqueue(4);
select is(jsonb_array_length(private.claim_communication_messages('test-worker', 'brevo', 10, 60, '{}'::text[])), 0,
  'an empty allowlist claims nothing');
select is((select status || '/' || last_error from app.communication_message where communication_message_id = (select value from ids where name = 'qa_c')),
  'CANCELED/NOT_ALLOWLISTED', 'an empty allowlist suppresses the message');
select is(pg_temp.brevo_sent() - (select value from usage_marks where name = 'before'), 1, 'still only the one real Brevo message is counted');

-- ---------------------------------------------------------------------------------------------
-- No allowlist (NULL / omitted): previous behaviour, any recipient is claimed and counted.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'qa_d', pg_temp.enqueue(5);
select is(jsonb_array_length(private.claim_communication_messages('test-worker', 'brevo', 10, 60)), 1,
  'without an allowlist the 4-argument call claims any recipient as before');
select is((select status from app.communication_message where communication_message_id = (select value from ids where name = 'qa_d')),
  'SENDING', 'the message reaches SENDING');
select is(pg_temp.brevo_sent() - (select value from usage_marks where name = 'before'), 2, 'and it is counted against the usage');

-- ---------------------------------------------------------------------------------------------
-- Signature and grants: only the 5-argument functions exist, service_role only.
-- ---------------------------------------------------------------------------------------------
select is(to_regprocedure('public.claim_communication_messages(text, text, integer, integer)') is null
  and to_regprocedure('private.claim_communication_messages(text, text, integer, integer)') is null, true,
  'the old 4-argument functions were replaced');
select is(has_function_privilege('service_role', 'public.claim_communication_messages(text, text, integer, integer, text[])', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_communication_messages(text, text, integer, integer, text[])', 'execute')
  and not has_function_privilege('anon', 'public.claim_communication_messages(text, text, integer, integer, text[])', 'execute'),
  true, 'the claim stays service_role only');

select * from finish();
rollback;
