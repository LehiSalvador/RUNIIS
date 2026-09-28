-- T35 communications: campaign lifecycle, permission gating and recipient revalidation — consent
-- withdrawn after the candidate snapshot must never send (Master §134-135, §206, §176, §197).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(22);

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
-- Fixture: ADMIN (GLOBAL), OPERATOR (GLOBAL, no CAMPAIGN_MANAGE), CHECKIN (GLOBAL, no comms
-- permission at all); two marketing-opted-in runners P1/P2; one published Edition.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000502001', 'comms-c-admin@example.test'),
  ('00000000-0000-4000-8000-000000502002', 'comms-c-operator@example.test'),
  ('00000000-0000-4000-8000-000000502003', 'comms-c-checkin@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000502001', '00000000-0000-4000-8000-000000502001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000502002', '00000000-0000-4000-8000-000000502002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000502003', '00000000-0000-4000-8000-000000502003', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000502001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000502002', 'OPERATOR', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000502003', 'CHECKIN', 'GLOBAL');

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000502011', 'comms-c-p1@example.test', now()),
  ('00000000-0000-4000-8000-000000502012', 'comms-c-p2@example.test', now());
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000502011', '00000000-0000-4000-8000-000000502011', 'READY', 'ACTIVE',
   'Comms Campaign P1', '1990-01-01', 'M', '+528110005301', 'Contacto', '+528110005302', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000502012', '00000000-0000-4000-8000-000000502012', 'READY', 'ACTIVE',
   'Comms Campaign P2', '1990-01-01', 'F', '+528110005303', 'Contacto', '+528110005304', 'Hermana', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000502011', 'c0000000-0000-4000-8000-000000502011', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000502012', 'c0000000-0000-4000-8000-000000502012', 'ELIGIBLE', true);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000502001', event_type_id, 'Test Campaign', 'test-campaign-502'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000502001', '40000000-0000-4000-8000-000000502001', 'test-campaign-502',
   'Test Campaign 502', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert on ids to authenticated;

-- P1 and P2 both opt into GENERAL_MARKETING with a verified contact.
do $$ declare v_r1 uuid; v_r2 uuid; begin
  select o_recipient_id into v_r1 from private.comms_ensure_runner_recipient('10000000-0000-4000-8000-000000502011');
  select o_recipient_id into v_r2 from private.comms_ensure_runner_recipient('10000000-0000-4000-8000-000000502012');
  perform private.comms_record_consent(v_r1, 'GENERAL_MARKETING', 'GRANTED', 'TEST');
  perform private.comms_record_consent(v_r2, 'GENERAL_MARKETING', 'GRANTED', 'TEST');
  perform set_config('pgtap.v_r2', v_r2::text, false);
end $$;

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Permission gating (Master §145: CAMPAIGN_MANAGE for MARKETING, ADMIN only).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000502002", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.create_communication_campaign('MARKETING', 'NEW_EDITION', %L, '{"segment":"MARKETING_OPT_IN"}'::jsonb, '{}'::jsonb) $$,
  '50000000-0000-4000-8000-000000502001')) ->> 'code', 'FORBIDDEN', 'OPERATOR cannot create a MARKETING campaign (CAMPAIGN_MANAGE is ADMIN-only)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000502003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.list_communication_campaigns(null, null, null, null, 20) $$) ->> 'code', 'FORBIDDEN',
  'CHECKIN has no communications console access at all');

-- ---------------------------------------------------------------------------------------------
-- Campaign lifecycle: create -> preview (candidate count) -> send (materialize + enqueue).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000502001", "role": "authenticated"}';
insert into ids select 'campaign', public.create_communication_campaign('MARKETING', 'NEW_EDITION',
  '50000000-0000-4000-8000-000000502001', '{"segment":"MARKETING_OPT_IN"}'::jsonb, '{}'::jsonb);
select is((select value ->> 'status' from ids where name = 'campaign'), 'DRAFT', 'a new campaign starts DRAFT');
select is(pg_temp.err($$ select public.create_communication_campaign('MARKETING', 'NEW_EDITION',
  '50000000-0000-4000-8000-000000502001', '{"segment":"BAD_SEGMENT"}'::jsonb, '{}'::jsonb) $$) ->> 'code', 'VALIDATION_ERROR',
  'an unknown audience segment is rejected');

insert into ids select 'preview', public.preview_communication_campaign((select value ->> 'campaign_id' from ids where name = 'campaign')::uuid);
select is((select value -> 'campaign' ->> 'status' from ids where name = 'preview'), 'READY', 'preview moves DRAFT to READY');
select is((select value -> 'campaign' ->> 'estimated_recipient_count' from ids where name = 'preview'), '2',
  'both marketing-opted-in recipients are counted as candidates');

insert into ids select 'sent', public.send_communication_campaign((select value ->> 'campaign_id' from ids where name = 'campaign')::uuid);
select is((select value ->> 'status' from ids where name = 'sent'), 'SENDING', 'sending materializes the campaign (SENDING)');
select is((select value -> 'snapshot' ->> 'candidates' from ids where name = 'sent'), '2', 'both candidates were snapshotted at send time');
reset role;
select is((select count(*) from app.communication_campaign_recipient
           where campaign_id = (select value ->> 'campaign_id' from ids where name = 'campaign')::uuid and snapshot_status = 'CANDIDATE'),
  2::bigint, 'two CANDIDATE snapshot rows were recorded');
select is((select count(*) from app.communication_message
           where campaign_id = (select value ->> 'campaign_id' from ids where name = 'campaign')::uuid and status = 'QUEUED'),
  2::bigint, 'two messages were enqueued, one per candidate');

-- ---------------------------------------------------------------------------------------------
-- Revalidation (Master §206): P2 withdraws consent AFTER the snapshot/enqueue. Their already-queued
-- message must be blocked at send time, never actually delivered — the snapshot never overrides a
-- later withdrawal.
-- ---------------------------------------------------------------------------------------------
reset role;
select private.comms_record_consent(current_setting('pgtap.v_r2')::uuid, 'GENERAL_MARKETING', 'WITHDRAWN', 'TEST');

do $$ declare v_msg_p2 uuid; v_msg_p1 uuid; v_campaign uuid; begin
  select value ->> 'campaign_id' into v_campaign from ids where name = 'campaign';
  select m.communication_message_id into v_msg_p2 from app.communication_message m
  join app.communication_recipient r on r.communication_recipient_id = m.recipient_id
  where m.campaign_id = v_campaign::uuid and r.communication_recipient_id = current_setting('pgtap.v_r2')::uuid;
  select m.communication_message_id into v_msg_p1 from app.communication_message m
  where m.campaign_id = v_campaign::uuid and m.communication_message_id <> v_msg_p2;
  perform set_config('pgtap.v_msg_p2', v_msg_p2::text, false);
  perform set_config('pgtap.v_msg_p1', v_msg_p1::text, false);
end $$;

select is(private.comms_send_block_reason(current_setting('pgtap.v_msg_p2')::uuid), 'CONSENT_WITHDRAWN',
  'the post-snapshot withdrawal blocks P2''s already-queued message at send-time revalidation');
select is(private.comms_send_block_reason(current_setting('pgtap.v_msg_p1')::uuid), null,
  'P1''s message (consent never withdrawn) is still sendable');

select is(jsonb_array_length(private.claim_communication_messages('test-worker', 'capture', 10, 60)), 1,
  'the dispatcher claims only the one message that is still eligible to send');
select is((select status from app.communication_message where communication_message_id = current_setting('pgtap.v_msg_p2')::uuid), 'CANCELED',
  'P2''s message is CANCELED by send-time revalidation, never sent, despite being snapshotted as a candidate');
select is((select last_error from app.communication_message where communication_message_id = current_setting('pgtap.v_msg_p2')::uuid), 'CONSENT_WITHDRAWN',
  'the cancellation reason is recorded');
select is((select status from app.communication_message where communication_message_id = current_setting('pgtap.v_msg_p1')::uuid), 'SENDING',
  'P1''s message proceeds to SENDING');

-- ---------------------------------------------------------------------------------------------
-- Cancel: a second, small campaign canceled before send leaves no message queued.
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000502001", "role": "authenticated"}';
insert into ids select 'campaign2', public.create_communication_campaign('MARKETING', 'NEW_EDITION',
  '50000000-0000-4000-8000-000000502001', '{"segment":"MARKETING_OPT_IN"}'::jsonb, '{}'::jsonb);
select public.preview_communication_campaign((select value ->> 'campaign_id' from ids where name = 'campaign2')::uuid);
insert into ids select 'canceled', public.cancel_communication_campaign((select value ->> 'campaign_id' from ids where name = 'campaign2')::uuid, 'test cancel');
select is((select value ->> 'status' from ids where name = 'canceled'), 'CANCELED', 'a READY campaign can be canceled before it ever sends');
reset role;
select is((select count(*) from app.communication_message where campaign_id = (select value ->> 'campaign_id' from ids where name = 'campaign2')::uuid),
  0::bigint, 'a canceled-before-send campaign never materialized any message');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000502001", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.schedule_communication_campaign(%L, now() + interval '1 day') $$,
  (select value ->> 'campaign_id' from ids where name = 'campaign2'))) ->> 'code', 'CONFLICT',
  'a CANCELED campaign cannot be scheduled');

-- ---------------------------------------------------------------------------------------------
-- Admin messages/metrics reads and grants (SEC-002/006).
-- ---------------------------------------------------------------------------------------------
select is((public.list_communication_messages(null, (select value ->> 'campaign_id' from ids where name = 'campaign')::uuid,
  null, null, null, null, 20) -> 'items') is not null, true, 'list_communication_messages returns a page');
select ok((public.get_communication_metrics() ? 'provider_quota'), 'get_communication_metrics exposes provider_quota');
reset role;
select is(not has_function_privilege('anon', 'public.create_communication_campaign(text, text, uuid, jsonb, jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.reconcile_communications()', 'execute'),
  true, 'anon cannot create campaigns and authenticated cannot run SYSTEM reconcile workers');

select * from finish();
rollback;
