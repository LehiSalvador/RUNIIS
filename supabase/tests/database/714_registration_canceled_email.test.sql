-- P3-C OWN-04: the participant is always emailed when staff cancel a confirmed registration (migration 714).
-- Covers the template + automation rule, the outbox consumer (exactly one message per cancellation, the buyer for a Guest,
-- only the closed reason label, never the free text, not self-cancelled by the send-time revalidation), the staging
-- allowlist contract of migration 164 (non-allowlisted -> CANCELED / NOT_ALLOWLISTED, no attempt, no transport), the grants
-- and registration_edition_for_staff. Ids use a 714 range; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(31);

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
create function pg_temp.sv(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin execute p_sql into v; return v; end $$;
grant execute on function pg_temp.sv(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture. One Edition, one modality. Runners 1-3 have a verified email. R1 = runner 1, R2 = a GUEST of runner 2 (the
-- buyer), R3 = runner 3.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid, format('p714-runner-%s@example.test', i), now()
from generate_series(1, 3) i;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000714090', 'p714-operator@example.test'),
  ('00000000-0000-4000-8000-000000714091', 'p714-checkin@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000714090', '00000000-0000-4000-8000-000000714090', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000714091', '00000000-0000-4000-8000-000000714091', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000714090', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000714091', 'CHECKIN', 'GLOBAL', null);
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name, date_of_birth,
  sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid,
  ('00000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid, 'READY', 'ACTIVE', 'Runner 714-' || i, date '1990-01-01',
  'M', '+52811000714' || i, 'Contacto', '+52811001714' || i, 'Hermano', now()
from generate_series(1, 3) i;
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000714102', '10000000-0000-4000-8000-000000714002', 'Invitado 714', '1990-01-01',
   'M', '+528110007140', 'Contacto', '+528110007141', 'Amigo');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000714001', event_type_id, 'Cancel Email Event', 'p714-cancel-email-event'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state,
  registration_state, closure_state, registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000714001', '40000000-0000-4000-8000-000000714001', 'p714-cancel-email-2026',
   'Cancel Email 2026', 'FREE', 'America/Monterrey', 'SCHEDULED', 'OPEN', 'OPEN', now() + interval '30 days',
   'Monterrey', 'NL', 'MX');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000714001', '50000000-0000-4000-8000-000000714001', '5k', '5K', 5000, true, 'ACTIVE', 1);

insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor)
select ('70000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid, 'R-714' || i || '-AAAA',
  ('10000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid, '50000000-0000-4000-8000-000000714001', 'FREE', 'MXN', 0
from generate_series(1, 3) i;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
select ('71000000-0000-4000-8000-0000007141' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid,
  case when i = 2 then 'GUEST' else 'PROFILE' end,
  case when i = 2 then null else ('10000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid end,
  case when i = 2 then '30000000-0000-4000-8000-000000714102'::uuid end,
  '60000000-0000-4000-8000-000000714001', 0, 'MXN', '{}'
from generate_series(1, 3) i;
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, guest_participant_id, buyer_profile_id, registration_number)
select ('72000000-0000-4000-8000-0000007141' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid,
  ('71000000-0000-4000-8000-0000007141' || lpad(i::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000714001', '60000000-0000-4000-8000-000000714001',
  case when i = 2 then null else ('10000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid end,
  case when i = 2 then '30000000-0000-4000-8000-000000714102'::uuid end,
  ('10000000-0000-4000-8000-0000007140' || lpad(i::text, 2, '0'))::uuid,
  'I-714' || i || '-AAAA'
from generate_series(1, 3) i;

-- Isolation: the shared local DB may hold due messages from dev traffic; park them for this rolled-back transaction.
update app.communication_message set scheduled_for = now() + interval '1 day' where status in ('QUEUED', 'WAITING_FOR_QUOTA');
update app.communication_message set claim_expires_at = now() + interval '1 day' where status = 'SENDING';

-- ---------------------------------------------------------------------------------------------
-- Catalogue: template, version, rule.
-- ---------------------------------------------------------------------------------------------
select is((select category || '/' || active_version from app.communication_template where template_key = 'REGISTRATION_CANCELED'),
  'TRANSACTIONAL/1', 'the REGISTRATION_CANCELED template is transactional v1');
select is((select trigger_event || '/' || recipient_policy || '/' || consent_policy || '/' || active::text
  from app.communication_automation_rule where rule_key = 'REGISTRATION_CANCELED'),
  'RegistrationCanceled/PARTICIPANT_OR_GUEST_BUYER/NONE_REQUIRED/true',
  'the rule consumes RegistrationCanceled for the participant or the Guest buyer, no consent needed, active');
select is((select dedupe_policy ->> 'key' from app.communication_automation_rule where rule_key = 'REGISTRATION_CANCELED'),
  'REGISTRATION_CANCELED:{registration}', 'the rule dedupes per registration');
select ok((select tv.html_template !~ 'reembols' and tv.text_template !~ 'reembols' and tv.html_template !~ '\{\{\s*reason\s*\}\}'
  from app.communication_template t join app.communication_template_version tv on tv.template_id = t.communication_template_id
  where t.template_key = 'REGISTRATION_CANCELED'),
  'the copy promises no refund and has no free-text reason placeholder');
select ok(not (select variable_schema -> 'variables' ? 'reason' or variable_schema -> 'variables' ? 'cancel_reason'
  from app.communication_template t join app.communication_template_version tv on tv.template_id = t.communication_template_id
  where t.template_key = 'REGISTRATION_CANCELED'), 'the variable schema has no free-text reason variable');

-- ---------------------------------------------------------------------------------------------
-- Cancel R1 (a runner) and R2 (a Guest) as staff; the P3-A command writes the RegistrationCanceled events.
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000714090", "role": "authenticated"}';
select is(public.cancel_registration('72000000-0000-4000-8000-000000714101', 'SECRETO-INTERNO llamó por teléfono',
  'DUPLICATE_REGISTRATION', 'p714-cancel-key-0001') ->> 'status', 'CANCELED', 'OPERATOR cancels the runner registration');
select is(public.cancel_registration('72000000-0000-4000-8000-000000714102', 'SECRETO-INTERNO invitado', 'ADMINISTRATIVE',
  'p714-cancel-key-0002') ->> 'status', 'CANCELED', 'OPERATOR cancels the Guest registration');
reset role;

create function pg_temp.event_id(p_registration uuid) returns uuid language sql as $$
  select outbox_event_id from infra.outbox_event where effect_key = 'RegistrationCanceled:' || p_registration $$;

select is(private.enqueue_registration_canceled_messages(pg_temp.event_id('72000000-0000-4000-8000-000000714101')), '{"enqueued": 1}'::jsonb,
  'the consumer enqueues one message for the runner cancellation');
select is(private.enqueue_registration_canceled_messages(pg_temp.event_id('72000000-0000-4000-8000-000000714101')), '{"enqueued": 0}'::jsonb,
  'running the consumer again (outbox retry) enqueues nothing');
select is((select count(*) from app.communication_message where dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101'),
  1::bigint, 'exactly one message exists for the cancellation');

select is((select cp.value_normalized from app.communication_message m
  join app.communication_contact_point cp on cp.communication_contact_point_id = m.contact_point_id
  where m.dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101'),
  'p714-runner-1@example.test', 'a runner is addressed at their own verified email');
select is((select m.category || '/' || m.priority || '/' || m.status || '/' || m.template_key || '/' || m.template_version
  from app.communication_message m where m.dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101'),
  'TRANSACTIONAL/1/QUEUED/REGISTRATION_CANCELED/1', 'it is a queued priority-1 transactional message');
select is((select m.render_context_snapshot ->> 'reason_label' from app.communication_message m
  where m.dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101'),
  'Inscripción duplicada', 'the participant sees the label of the closed reason category');
select ok((select m.render_context_snapshot::text !~* 'secreto' and m.rendered_subject_snapshot !~* 'secreto'
  from app.communication_message m where m.dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101'),
  'the free-text reason never reaches the message (variables or subject)');
select is((select (render_context_snapshot ->> 'participant_name') || '/' || (render_context_snapshot ->> 'is_guest_pass')
  || '/' || (render_context_snapshot ->> 'registration_number')
  from app.communication_message where dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101'),
  'Runner 714-1/false/I-7141-AAAA', 'the snapshot carries the participant, not-a-guest and the registration number');
select is((select rendered_subject_snapshot from app.communication_message
  where dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101'),
  'Tu inscripción a Cancel Email 2026 fue cancelada', 'the subject names the Edition');

-- Guest: addressed to the buyer (runner 2), named after the Guest.
select is(private.enqueue_registration_canceled_messages(pg_temp.event_id('72000000-0000-4000-8000-000000714102')), '{"enqueued": 1}'::jsonb,
  'the consumer enqueues one message for the Guest cancellation');
select is((select cp.value_normalized || '/' || (m.render_context_snapshot ->> 'participant_name') || '/' || (m.render_context_snapshot ->> 'is_guest_pass')
  || '/' || (m.render_context_snapshot ->> 'reason_label')
  from app.communication_message m join app.communication_contact_point cp on cp.communication_contact_point_id = m.contact_point_id
  where m.dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714102'),
  'p714-runner-2@example.test/Invitado 714/true/Motivo administrativo',
  'a Guest cancellation goes to the buyer and names the Guest');

-- The send-time revalidation cancels messages of registrations that are no longer CONFIRMED; this notice must survive it.
select is(private.comms_send_block_reason((select communication_message_id from app.communication_message
  where dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101')), null,
  'the cancellation notice is not blocked by the REGISTRATION_CANCELED send-time check');

-- A wrong event type is a programming error, not a silent no-op.
select throws_ok($$ select private.enqueue_registration_canceled_messages(
  (select outbox_event_id from infra.outbox_event where event_type = 'AttendanceResolved' limit 1)) $$, null, null,
  'only RegistrationCanceled events are consumed');
select throws_ok($$ select private.enqueue_registration_canceled_messages('99999999-9999-4999-8999-999999999999') $$, '22023', null,
  'an unknown event id is rejected');

-- ---------------------------------------------------------------------------------------------
-- Staging allowlist (migration 164): only the allowlisted address is transported, the other is CANCELED / NOT_ALLOWLISTED.
-- ---------------------------------------------------------------------------------------------
select is(jsonb_array_length(private.claim_communication_messages('communication-dispatch', 'capture', 10, 60,
  array['P714-Runner-1@example.test'])), 1, 'only the allowlisted participant message is claimed');
select is((select status from app.communication_message where dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714101'),
  'SENDING', 'the allowlisted cancellation notice proceeds to SENDING');
select is((select status || '/' || last_error from app.communication_message where dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714102'),
  'CANCELED/NOT_ALLOWLISTED', 'a non-allowlisted recipient is CANCELED / NOT_ALLOWLISTED');
select is((select count(*) from app.communication_delivery_attempt a join app.communication_message m
  on m.communication_message_id = a.communication_message_id
  where m.dedupe_key = 'REGISTRATION_CANCELED:72000000-0000-4000-8000-000000714102'), 0::bigint,
  'the suppressed notice has no delivery attempt: nothing was transported or retried');

-- ---------------------------------------------------------------------------------------------
-- Grants: the consumer is service_role only; the Edition lookup is for authenticated staff with REGISTRATION_MANAGE.
-- ---------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.enqueue_registration_canceled_messages(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_registration_canceled_messages(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.enqueue_registration_canceled_messages(uuid)', 'execute'),
  'the consumer is executable by service_role only');
select ok(has_function_privilege('authenticated', 'public.registration_edition_for_staff(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.registration_edition_for_staff(uuid)', 'execute'),
  'the Edition lookup is for authenticated callers, never anon');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000714090", "role": "authenticated"}';
select is(public.registration_edition_for_staff('72000000-0000-4000-8000-000000714103'), '50000000-0000-4000-8000-000000714001'::uuid,
  'staff with REGISTRATION_MANAGE resolve the Edition of a registration');
select is(pg_temp.err($$ select public.registration_edition_for_staff('72000000-0000-4000-8000-000000714999') $$) ->> 'code', 'NOT_FOUND',
  'an unknown registration is NOT_FOUND');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000714091", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_edition_for_staff('72000000-0000-4000-8000-000000714103') $$) ->> 'code', 'FORBIDDEN',
  'CHECKIN staff cannot resolve it');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000714003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_edition_for_staff('72000000-0000-4000-8000-000000714103') $$) ->> 'code', 'FORBIDDEN',
  'a runner cannot resolve it');
reset role;

select * from finish();
rollback;
