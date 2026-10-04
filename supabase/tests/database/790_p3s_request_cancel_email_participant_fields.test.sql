-- P3-S (P3-AC-08, P3-AC-09, P3-AC-13), migration 790.
--   A. UX J2 step 4: the BUYER is emailed when STAFF cancel a pending registration request (single cancel and every request of a bulk
--      cancel): template + rule, exactly one message per request (dedupe), only the closed reason-category label (never the free text),
--      suppression / staging allowlist unchanged, nothing for the buyer's own cancel or the worker's expiry.
--   B. The notification outcome RPCs (queued | suppressed | no_contact + ACTION_REQUIRED follow-up task) and their authority/grants.
--   C. Backwards compatibility: the 144/722 signatures of the cancel commands still work (default category OTHER).
--   D. Participants list: final attendance, sporting eligibility, incidents and credited distance (additive, same RBAC).
-- Ids use a 790 range; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(114);

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
-- Staff: ADMIN global (1), OPERATOR global (2), CHECKIN global (3), OPERATOR scoped to Edition 2 only (4).
-- Buyers (runner profiles 101..109): 101 email, 102 no email, 103 email that gets suppressed, 104 buyer-cancel, 105 expiry,
-- 106 email (2 places), 107 no email, 108 email (CONFIRMED request), 109 email (old 3-argument signature).
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000790001', 'p790-admin@example.test', now()),
  ('00000000-0000-4000-8000-000000790002', 'p790-operator@example.test', now()),
  ('00000000-0000-4000-8000-000000790003', 'p790-checkin@example.test', now()),
  ('00000000-0000-4000-8000-000000790004', 'p790-operator-e2@example.test', now());
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-4000-8000-000000790' || n)::uuid, case when n in ('102', '107') then null else 'p790-buyer-' || n || '@example.test' end,
  case when n in ('102', '107') then null else now() end
from unnest(array['101', '102', '103', '104', '105', '106', '107', '108', '109', '201', '202']) n;
insert into app.staff_member (staff_member_id, auth_user_id, status)
select ('20000000-0000-4000-8000-00000079000' || i)::uuid, ('00000000-0000-4000-8000-00000079000' || i)::uuid, 'ACTIVE' from generate_series(1, 4) i;
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000790001', 'ADMIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000790002', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000790003', 'CHECKIN', 'GLOBAL', null);
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name, date_of_birth,
  sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-000000790' || n)::uuid, ('00000000-0000-4000-8000-000000790' || n)::uuid, 'READY', 'ACTIVE', 'Comprador 790-' || n,
  date '1990-01-01', 'M', '+52811000' || n, 'Contacto', '+52811001' || n, 'Hermano', now()
from unnest(array['101', '102', '103', '104', '105', '106', '107', '108', '109', '201', '202']) n;
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000790106', '10000000-0000-4000-8000-000000790106', 'Invitado 790', '1992-02-02', 'F',
   '+528110007906', 'Contacto', '+528110007907', 'Amigo');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000790001', event_type_id, 'P3S Event', 'p790-p3s-event' from app.event_type where key = 'ROAD_RACE';
-- Edition 1 and 2: open (requests); Edition 3: FINISHED (participants, closure).
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state, registration_state, closure_state,
  registration_close_at, city, state_region, country_code)
select ('50000000-0000-4000-8000-00000079000' || i)::uuid, '40000000-0000-4000-8000-000000790001', 'p790-p3s-' || i, 'P3S ' || i, 'FREE',
  'America/Monterrey', case when i = 3 then 'FINISHED' else 'SCHEDULED' end, case when i = 3 then 'CLOSED' else 'OPEN' end, 'PENDING',
  case when i = 3 then now() - interval '1 day' else now() + interval '30 days' end, 'Monterrey', 'NL', 'MX'
from generate_series(1, 3) i;
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000790004', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000790002');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone, created_by_staff_id)
select ('50000000-0000-4000-8000-00000079000' || i)::uuid, 1, 'DATE_TIME_CONFIRMED', '2026-09-20', '07:00', 'America/Monterrey',
  '20000000-0000-4000-8000-000000790001'
from generate_series(1, 3) i;
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order)
select ('60000000-0000-4000-8000-00000079000' || i)::uuid, ('50000000-0000-4000-8000-00000079000' || i)::uuid, '10k', '10K', 10000, true, 1
from generate_series(1, 3) i;

-- A request (PENDING_CONFIRMATION unless said otherwise) with its participant row(s). Edition number, buyer suffix.
create function pg_temp.req(p_edition int, p_buyer text, p_status text default 'PENDING_CONFIRMATION') returns void language plpgsql as $$
begin
  insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, status, registration_mode,
    currency, total_snapshot_minor, confirmed_at)
  values (('70000000-0000-4000-8000-000000790' || p_buyer)::uuid, 'R-7' || p_buyer || '-AAAA', ('10000000-0000-4000-8000-000000790' || p_buyer)::uuid,
    ('50000000-0000-4000-8000-00000079000' || p_edition)::uuid, p_status, 'FREE', 'MXN', 0, case when p_status = 'CONFIRMED' then now() end);
  insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, runner_profile_id, modality_id,
    price_snapshot_minor, currency, eligibility_snapshot)
  values (('71000000-0000-4000-8000-000000790' || p_buyer)::uuid, ('70000000-0000-4000-8000-000000790' || p_buyer)::uuid, 'PROFILE',
    ('10000000-0000-4000-8000-000000790' || p_buyer)::uuid, ('60000000-0000-4000-8000-00000079000' || p_edition)::uuid, 0, 'MXN', '{}');
end $$;
select pg_temp.req(1, '101');
select pg_temp.req(1, '102');
select pg_temp.req(1, '103');
select pg_temp.req(1, '104');
select pg_temp.req(1, '105');
select pg_temp.req(1, '106');
select pg_temp.req(1, '107');
select pg_temp.req(1, '109');
select pg_temp.req(2, '201');
select pg_temp.req(1, '108', 'CONFIRMED');
-- Request 106 has a second place (a Guest).
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, guest_participant_id, modality_id,
  price_snapshot_minor, currency, eligibility_snapshot)
values ('71000000-0000-4000-8000-000000790907', '70000000-0000-4000-8000-000000790106', 'GUEST', '30000000-0000-4000-8000-000000790106',
  '60000000-0000-4000-8000-000000790001', 0, 'MXN', '{}');
-- Request 105 is already past its expiry (created earlier): the worker's materialisation will expire it.
update app.registration_request set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days',
  registration_mode = 'EXTERNAL_WHATSAPP', whatsapp_phone_snapshot = '+528110009999'
where registration_request_id = '70000000-0000-4000-8000-000000790105';

-- Isolation: the shared local DB may hold due messages from dev traffic; park them for this rolled-back transaction.
update app.communication_message set scheduled_for = now() + interval '1 day' where status in ('QUEUED', 'WAITING_FOR_QUOTA');
update app.communication_message set claim_expires_at = now() + interval '1 day' where status = 'SENDING';

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;

create function pg_temp.event_id(p_request text) returns uuid language sql as $$
  select outbox_event_id from infra.outbox_event where effect_key = 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790' || p_request $$;
create function pg_temp.msg(p_request text) returns text language sql as $$ select 'REGISTRATION_REQUEST_CANCELED:70000000-0000-4000-8000-000000790' || p_request $$;

-- ===========================================================================================
-- A1. Catalogue: template, version, rule
-- ===========================================================================================
select is((select category || '/' || active_version from app.communication_template where template_key = 'REGISTRATION_REQUEST_CANCELED'),
  'TRANSACTIONAL/1', 'the REGISTRATION_REQUEST_CANCELED template is transactional v1');
select is((select trigger_event || '/' || recipient_policy || '/' || consent_policy || '/' || active::text
  from app.communication_automation_rule where rule_key = 'REGISTRATION_REQUEST_CANCELED'),
  'RegistrationRequestCanceledByStaff/REQUEST_BUYER/NONE_REQUIRED/true', 'the rule consumes the staff-cancel event for the request buyer, no consent needed, active');
select is((select dedupe_policy ->> 'key' from app.communication_automation_rule where rule_key = 'REGISTRATION_REQUEST_CANCELED'),
  'REGISTRATION_REQUEST_CANCELED:{request}', 'the rule dedupes per request');
select ok((select tv.html_template ~* 'liberados' and tv.text_template ~* 'liberados'
  from app.communication_template t join app.communication_template_version tv on tv.template_id = t.communication_template_id
  where t.template_key = 'REGISTRATION_REQUEST_CANCELED'), 'the copy states that the places were released');
select ok((select tv.html_template ~* 'no procesa pagos' and tv.text_template ~* 'no procesa pagos' and tv.html_template !~* 'reembols'
  from app.communication_template t join app.communication_template_version tv on tv.template_id = t.communication_template_id
  where t.template_key = 'REGISTRATION_REQUEST_CANCELED'), 'and that no payment is processed on the platform, with no refund promise');
select ok((select tv.html_template !~ '\{\{\s*(cancel_)?reason\s*\}\}' and tv.text_template !~ '\{\{\s*(cancel_)?reason\s*\}\}'
    and not (tv.variable_schema -> 'variables' ? 'reason' or tv.variable_schema -> 'variables' ? 'cancel_reason')
  from app.communication_template t join app.communication_template_version tv on tv.template_id = t.communication_template_id
  where t.template_key = 'REGISTRATION_REQUEST_CANCELED'), 'there is no free-text reason placeholder nor variable');

-- ===========================================================================================
-- A2. Single staff cancel (OPERATOR) with a category: R101. The free text must never travel.
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790101', 'SECRETO-INTERNO llamó por teléfono',
  'p790-cancel-key-0000', 'NO_SUCH_CATEGORY') $$) -> 'detail' ->> 'field', 'reason_category', 'an unknown category is a validation error on reason_category');
select is(pg_temp.sv($q$ select status from app.registration_request where registration_request_id = '70000000-0000-4000-8000-000000790101' $q$),
  'PENDING_CONFIRMATION', 'and nothing was canceled');
select is(public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790101', 'SECRETO-INTERNO llamó por teléfono',
  'p790-cancel-key-0001', 'DUPLICATE_REGISTRATION') ->> 'status', 'CANCELED_BY_STAFF', 'OPERATOR cancels R101 with a category');
select is(public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790101', 'SECRETO-INTERNO llamó por teléfono',
  'p790-cancel-key-0001', 'DUPLICATE_REGISTRATION') ->> 'status', 'CANCELED_BY_STAFF', 'the same key replays the stored response');
select is(pg_temp.err($$ select public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790101', 'SECRETO-INTERNO llamó por teléfono',
  'p790-cancel-key-0001', 'ADMINISTRATIVE') $$) ->> 'code', 'IDEMPOTENCY_CONFLICT', 'the same key with another category is an idempotency conflict');
reset role;

select is((select count(*) from infra.outbox_event where effect_key = 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790101'),
  1::bigint, 'exactly one RegistrationRequestCanceledByStaff event exists for R101 (not two after the replay)');
select is((select payload ->> 'reason_category' from infra.outbox_event where outbox_event_id = pg_temp.event_id('101')), 'DUPLICATE_REGISTRATION',
  'it carries the closed category');
select ok((select payload::text !~* 'secreto' and not payload ? 'reason' from infra.outbox_event where outbox_event_id = pg_temp.event_id('101')),
  'and never the free-text reason');
select is((select count(*) from infra.outbox_event where effect_key = 'RegistrationRequestCanceled:70000000-0000-4000-8000-000000790101'),
  1::bigint, 'the existing RegistrationRequestCanceled event (cache, capacity) is still written');

select is(private.enqueue_registration_request_canceled_messages(pg_temp.event_id('101')), '{"enqueued": 1}'::jsonb, 'the consumer enqueues one message for R101');
select is(private.enqueue_registration_request_canceled_messages(pg_temp.event_id('101')), '{"enqueued": 0}'::jsonb, 'running it again (outbox retry) enqueues nothing');
select is((select count(*) from app.communication_message where dedupe_key = pg_temp.msg('101')), 1::bigint, 'exactly one message exists for the cancellation');
select is((select cp.value_normalized from app.communication_message m
  join app.communication_contact_point cp on cp.communication_contact_point_id = m.contact_point_id where m.dedupe_key = pg_temp.msg('101')),
  'p790-buyer-101@example.test', 'it is addressed to the buyer at their verified email');
select is((select m.category || '/' || m.priority || '/' || m.status || '/' || m.template_key || '/' || m.template_version || '/' || m.source_type
  from app.communication_message m where m.dedupe_key = pg_temp.msg('101')),
  'TRANSACTIONAL/1/QUEUED/REGISTRATION_REQUEST_CANCELED/1/REGISTRATION_REQUEST', 'a queued priority-1 transactional message about the request');
select is((select m.render_context_snapshot ->> 'reason_label' from app.communication_message m where m.dedupe_key = pg_temp.msg('101')),
  'Inscripción duplicada', 'the buyer sees the label of the closed reason category');
select ok((select m.render_context_snapshot::text !~* 'secreto' and m.rendered_subject_snapshot !~* 'secreto'
  from app.communication_message m where m.dedupe_key = pg_temp.msg('101')), 'the free-text reason never reaches the message (variables or subject)');
select is((select (render_context_snapshot ->> 'buyer_name') || '/' || (render_context_snapshot ->> 'request_reference') || '/' || (render_context_snapshot ->> 'places_count')
  from app.communication_message where dedupe_key = pg_temp.msg('101')), 'Comprador 790-101/R-7101-AAAA/1', 'the snapshot names the buyer, the request reference and the places');
select is((select rendered_subject_snapshot from app.communication_message where dedupe_key = pg_temp.msg('101')),
  'Tu solicitud de inscripción a P3S 1 fue cancelada', 'the subject names the Edition');
select is(private.comms_send_block_reason((select communication_message_id from app.communication_message where dedupe_key = pg_temp.msg('101'))), null,
  'the notice is not blocked at send time');
select throws_ok($$ select private.enqueue_registration_request_canceled_messages(
  (select outbox_event_id from infra.outbox_event where event_type = 'RegistrationRequestCanceled' limit 1)) $$, '22023', null,
  'only RegistrationRequestCanceledByStaff events are consumed (the buyer-cancel event type is refused)');
select throws_ok($$ select private.enqueue_registration_request_canceled_messages('99999999-9999-4999-8999-999999999999') $$, '22023', null,
  'an unknown event id is rejected');

-- ===========================================================================================
-- C. 144/722 signatures still work (no category): R109 by ADMIN -> label "Otro motivo".
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790001", "role": "authenticated"}';
select is(public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790109', 'Sin categoría', 'p790-cancel-key-0109') ->> 'status',
  'CANCELED_BY_STAFF', 'the 3-argument signature of migration 144 still cancels');
reset role;
select is(private.enqueue_registration_request_canceled_messages(pg_temp.event_id('109')), '{"enqueued": 1}'::jsonb, 'and the buyer is emailed');
select is((select m.render_context_snapshot ->> 'reason_label' from app.communication_message m where m.dedupe_key = pg_temp.msg('109')),
  'Otro motivo', 'with the default category label');
select is((select count(*) from pg_proc where proname in ('staff_bulk_cancel_registration_requests', 'staff_cancel_registration_request') and pronamespace = 'public'::regnamespace), 2::bigint,
  'each cancel command has exactly one public signature (791); the category is an optional last parameter');

-- ===========================================================================================
-- A3. No email for the buyer's own cancel, the worker's expiry or a request that staff cannot cancel
-- ===========================================================================================
select private.registration_materialise_expired('50000000-0000-4000-8000-000000790001', '70000000-0000-4000-8000-000000790105');
select is(pg_temp.sv($q$ select status from app.registration_request where registration_request_id = '70000000-0000-4000-8000-000000790105' $q$), 'EXPIRED',
  'R105 expired by the worker path');
select is((select count(*) from infra.outbox_event where effect_key like 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790105'), 0::bigint,
  'expiry writes no staff-cancel event');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790104", "role": "authenticated"}';
select is(public.cancel_registration_request('70000000-0000-4000-8000-000000790104', 'ya no puedo') ->> 'status', 'CANCELED_BY_BUYER', 'the buyer of R104 cancels it');
reset role;
select is((select count(*) from infra.outbox_event where effect_key like 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790104'), 0::bigint,
  'the buyer''s own cancel writes no staff-cancel event');
select is((select count(*) from infra.outbox_event where event_type = 'RegistrationRequestCanceledByStaff'
  and effect_key like 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-0000007901%'), 2::bigint, 'only the two staff cancels so far (R101, R109)');

-- Staff cancel of an EXPIRED request is allowed and notifies (J2: PENDING or EXPIRED).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
select is(public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790105', 'Venció', 'p790-cancel-key-0105', 'ADMINISTRATIVE') ->> 'status',
  'CANCELED_BY_STAFF', 'staff cancel the EXPIRED R105');
reset role;
select is((select count(*) from infra.outbox_event where effect_key = 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790105'), 1::bigint,
  'and that does notify the buyer');

-- ===========================================================================================
-- B. Notification outcome (single): queued / no_contact / suppressed + follow-up task
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790106') $$) -> 'detail' ->> 'reason',
  'not_canceled_by_staff', 'there is no outcome for a request that is still pending');
select is(public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790102', 'Solicitud del comprador', 'p790-cancel-key-0102', 'PARTICIPANT_REQUEST') ->> 'status',
  'CANCELED_BY_STAFF', 'staff cancel R102 (buyer with no email)');
select is(public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790103', 'Solicitud del comprador', 'p790-cancel-key-0103', 'PARTICIPANT_REQUEST') ->> 'status',
  'CANCELED_BY_STAFF', 'and R103');
reset role;
-- The suppression of 103's contact point (the consumer creates the contact point; do it the same way).
select o_contact_point_id is not null from private.comms_ensure_runner_recipient('10000000-0000-4000-8000-000000790103');
insert into app.communication_suppression (contact_point_id, reason, scope, source)
select cp.communication_contact_point_id, 'HARD_BOUNCE', 'ALL_EMAIL', 'p790-test'
from app.communication_contact_point cp join app.communication_recipient r on r.communication_recipient_id = cp.communication_recipient_id
where r.runner_profile_id = '10000000-0000-4000-8000-000000790103' and cp.status = 'ACTIVE';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
insert into ids select 'n101', public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790101');
insert into ids select 'n102', public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790102');
insert into ids select 'n103', public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790103');
select is((select value ->> 'status' from ids where name = 'n101'), 'queued', 'a buyer with a deliverable email: queued');
select is((select value ->> 'follow_up_task_id' from ids where name = 'n101'), null, 'and no follow-up task');
select is((select value ->> 'status' from ids where name = 'n102'), 'no_contact', 'a buyer with no email: no_contact');
select is((select value ->> 'status' from ids where name = 'n103'), 'suppressed', 'a buyer whose contact is suppressed: suppressed');
select ok((select (value ->> 'follow_up_task_id') is not null from ids where name = 'n102') and (select (value ->> 'follow_up_task_id') is not null from ids where name = 'n103'),
  'no_contact and suppressed both open a follow-up task');
select is(pg_temp.sv($q$ select status || '/' || blocking_level || '/' || category || '/' || source_rule || '/' || assigned_role from app.admin_task
  where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790102' $q$),
  'OPEN/ACTION_REQUIRED/COMMUNICATIONS/registration-request-cancel-notice/OPERATOR', 'an ACTION_REQUIRED COMMUNICATIONS task for staff');
select is(pg_temp.sv($q$ select edition_id::text || '/' || related_entity_type || '/' || related_entity_id::text from app.admin_task
  where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790102' $q$),
  '50000000-0000-4000-8000-000000790001/registration_request/70000000-0000-4000-8000-000000790102', 'scoped to the Edition and pointing at the request');
select is(pg_temp.sv($q$ select (metadata ->> 'notification_outcome') || '/' || (metadata ->> 'public_reference') from app.admin_task
  where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790103' $q$), 'suppressed/R-7103-AAAA', 'whose metadata states the outcome');
select is(pg_temp.sv($q$ select ((metadata::text || description || title) ~* '(example\.test|Comprador 790|Solicitud del|SECRETO)')::text from app.admin_task
  where source_rule = 'registration-request-cancel-notice' limit 1 $q$), 'false', 'and carries no email, name or free-text reason');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where source_rule = 'registration-request-cancel-notice' $q$), '2', 'the queued buyer has no task');
select is((public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790102') ->> 'follow_up_task_id'), (select value ->> 'follow_up_task_id' from ids where name = 'n102'),
  'asking again is idempotent: the same task');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where source_rule = 'registration-request-cancel-notice' $q$), '2', 'no duplicate task');

-- The outbox consumer is the backstop: it opens the same task when the email cannot go out.
reset role;
select is(private.enqueue_registration_request_canceled_messages(pg_temp.event_id('102')), '{"enqueued": 0, "skipped_no_contact": 1}'::jsonb,
  'the consumer reports no contact for R102');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790102' $q$), '1',
  'and it converges on the same task');
select is(private.enqueue_registration_request_canceled_messages(pg_temp.event_id('103')), '{"enqueued": 1}'::jsonb,
  'a suppressed contact is still enqueued (the dispatcher cancels it as SUPPRESSED); the consumer also opens the follow-up');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790103' $q$), '1', 'one task for R103');

-- A task staff resolved is not re-raised by asking again.
update app.admin_task set status = 'RESOLVED', resolved_at = now(), resolution_type = 'MANUAL', resolution_reason = 'Avisado por WhatsApp'
where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790102';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
select is((public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790102') ->> 'status'), 'no_contact', 'the outcome is still reported');
select is(pg_temp.sv($q$ select status from app.admin_task where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790102' $q$), 'RESOLVED',
  'but a resolved follow-up stays resolved');

-- Authority.
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790102') $$) ->> 'code', 'FORBIDDEN', 'a CHECKIN cannot read the outcome');
select is(pg_temp.err($$ select public.staff_cancel_registration_request('70000000-0000-4000-8000-000000790106', 'x', 'p790-cancel-key-0106', 'OTHER') $$) ->> 'code', 'FORBIDDEN',
  'nor cancel a request');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790102') $$) ->> 'code', 'FORBIDDEN',
  'an OPERATOR scoped to another Edition cannot read it (SEC-020)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_request_cancel_notification('70000000-0000-4000-8000-000000790999') $$) ->> 'code', 'NOT_FOUND', 'an unknown request is NOT_FOUND');
reset role;

-- ===========================================================================================
-- A4. Bulk cancel: one email per canceled request, one category for the batch, outcome per request
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000790001',
  array['70000000-0000-4000-8000-000000790106']::uuid[], 'x', 'p790-bulk-key-0000', 'NOPE') $$) -> 'detail' ->> 'field', 'reason_category', 'a bulk call validates the category');
insert into ids select 'bulk', public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000790001',
  array['70000000-0000-4000-8000-000000790106', '70000000-0000-4000-8000-000000790107', '70000000-0000-4000-8000-000000790108',
        '70000000-0000-4000-8000-000000790104', '70000000-0000-4000-8000-000000790201']::uuid[],
  'SECRETO-LOTE motivo interno', 'p790-bulk-key-0001', 'EVENT_CHANGE');
reset role;
select is((select (value ->> 'canceled_count') || '/' || (value ->> 'rejected_count') from ids where name = 'bulk'), '2/3',
  'the batch cancels the two pending requests and rejects the CONFIRMED, the buyer-canceled and the other Edition''s');
select is((select count(*) from infra.outbox_event where event_type = 'RegistrationRequestCanceledByStaff'
  and effect_key in ('RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790106', 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790107')),
  2::bigint, 'one event per canceled request');
select is((select count(*) from infra.outbox_event where event_type = 'RegistrationRequestCanceledByStaff'
  and effect_key in ('RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790108', 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790104',
                     'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790201')),
  0::bigint, 'none for the rejected ones (CONFIRMED, buyer-canceled, other Edition)');
select ok((select bool_and(payload ->> 'reason_category' = 'EVENT_CHANGE' and payload::text !~* 'secreto') from infra.outbox_event
  where effect_key in ('RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790106', 'RegistrationRequestCanceledByStaff:70000000-0000-4000-8000-000000790107')),
  'every event carries the batch category and no free text');
select is(private.enqueue_registration_request_canceled_messages(pg_temp.event_id('106')), '{"enqueued": 1}'::jsonb, 'the buyer of R106 is emailed');
select is((select (render_context_snapshot ->> 'places_count') || '/' || (render_context_snapshot ->> 'reason_label') from app.communication_message where dedupe_key = pg_temp.msg('106')),
  '2/Cambio en el evento', 'with both places counted and the batch category label');
select is(private.enqueue_registration_request_canceled_messages(pg_temp.event_id('107')), '{"enqueued": 0, "skipped_no_contact": 1}'::jsonb, 'the buyer of R107 has no email');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790107' $q$), '1',
  'and the consumer opens the follow-up task');
select is((select count(*) from app.communication_message where dedupe_key in (pg_temp.msg('108'), pg_temp.msg('104'), pg_temp.msg('201'))), 0::bigint,
  'no message exists for the rejected requests');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
insert into ids select 'bn', public.registration_request_cancel_notifications('50000000-0000-4000-8000-000000790001',
  array['70000000-0000-4000-8000-000000790106', '70000000-0000-4000-8000-000000790107', '70000000-0000-4000-8000-000000790108',
        '70000000-0000-4000-8000-000000790104', '70000000-0000-4000-8000-000000790201']::uuid[]);
select is(jsonb_array_length((select value from ids where name = 'bn')), 2, 'the batch outcome lists only the requests canceled by staff in that Edition');
select is((select e ->> 'status' from ids, jsonb_array_elements(value) e where name = 'bn' and e ->> 'registration_request_id' = '70000000-0000-4000-8000-000000790106'),
  'queued', 'R106: queued');
select is((select e ->> 'status' from ids, jsonb_array_elements(value) e where name = 'bn' and e ->> 'registration_request_id' = '70000000-0000-4000-8000-000000790107'),
  'no_contact', 'R107: no_contact');
select is((select e ->> 'follow_up_task_id' from ids, jsonb_array_elements(value) e where name = 'bn' and e ->> 'registration_request_id' = '70000000-0000-4000-8000-000000790107'),
  pg_temp.sv($q$ select admin_task_id::text from app.admin_task where task_key = 'registration-request-cancel-notice:70000000-0000-4000-8000-000000790107' $q$),
  'with the same follow-up task the consumer opened');
select is(pg_temp.err($$ select public.registration_request_cancel_notifications('50000000-0000-4000-8000-000000790001',
  array(select gen_random_uuid() from generate_series(1, 101))) $$) ->> 'code', 'VALIDATION_ERROR', 'a batch of more than 100 ids is refused');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_request_cancel_notifications('50000000-0000-4000-8000-000000790001', array[]::uuid[]) $$) ->> 'code', 'FORBIDDEN',
  'an OPERATOR scoped to another Edition cannot read the batch outcome');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000790001',
  array['70000000-0000-4000-8000-000000790201']::uuid[], 'x', 'p790-bulk-key-0002', 'OTHER') $$) ->> 'code', 'FORBIDDEN', 'a CHECKIN cannot bulk cancel with a category either');
reset role;

-- The 722 four-argument bulk signature still works and defaults the category.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790001", "role": "authenticated"}';
select is(public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000790001', array['70000000-0000-4000-8000-000000790201']::uuid[], 'x', 'p790-bulk-key-0003') ->> 'rejected_count',
  '1', 'the 4-argument bulk signature of migration 722 still answers (the other Edition''s request is rejected)');
reset role;

-- ===========================================================================================
-- A5. Staging allowlist (migration 164): only the allowlisted address is transported, the other is CANCELED / NOT_ALLOWLISTED
-- ===========================================================================================
select is(jsonb_array_length(private.claim_communication_messages('communication-dispatch', 'capture', 10, 60,
  array['P790-Buyer-101@example.test'])), 1, 'only the allowlisted buyer message is claimed');
select is((select status from app.communication_message where dedupe_key = pg_temp.msg('101')), 'SENDING', 'the allowlisted notice proceeds to SENDING');
select is((select status || '/' || last_error from app.communication_message where dedupe_key = pg_temp.msg('106')), 'CANCELED/NOT_ALLOWLISTED',
  'a non-allowlisted buyer is CANCELED / NOT_ALLOWLISTED');
select is((select count(*) from app.communication_delivery_attempt a join app.communication_message m
  on m.communication_message_id = a.communication_message_id where m.dedupe_key = pg_temp.msg('106')), 0::bigint, 'with no delivery attempt: nothing was transported');

-- ===========================================================================================
-- Grants
-- ===========================================================================================
select ok(has_function_privilege('service_role', 'public.enqueue_registration_request_canceled_messages(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_registration_request_canceled_messages(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.enqueue_registration_request_canceled_messages(uuid)', 'execute'),
  'the consumer is executable by service_role only');
select ok(has_function_privilege('authenticated', 'public.registration_request_cancel_notification(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.registration_request_cancel_notifications(uuid, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.staff_cancel_registration_request(uuid, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.registration_request_cancel_notification(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.registration_request_cancel_notifications(uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.staff_cancel_registration_request(uuid, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text)', 'execute'),
  'the outcome RPCs and the category overloads are for staff sessions only');
select ok(not has_function_privilege('authenticated', 'private.registration_request_cancel_notice_task(uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'private.registration_request_cancel_notice_task(uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.registration_request_cancel_outcome(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.registration_request_cancel_core(uuid, uuid, text, uuid, text)', 'execute'),
  'the task writer, the unauthenticated outcome and the cancel core are internal');

-- ===========================================================================================
-- D. Participants: eligibility, final attendance, incidents, credited distance (Edition 3, FINISHED)
-- ===========================================================================================
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-000000790301', 'p790-runner-301@example.test', now());
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name, date_of_birth)
values ('10000000-0000-4000-8000-000000790301', '00000000-0000-4000-8000-000000790301', 'Corredor 790-301', date '1990-01-01');
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, registration_mode, currency, total_snapshot_minor,
  status, confirmed_at)
values ('70000000-0000-4000-8000-000000790301', 'R-7301-AAAA', '10000000-0000-4000-8000-000000790301', '50000000-0000-4000-8000-000000790003', 'FREE', 'MXN', 0,
  'CONFIRMED', now());
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, runner_profile_id, modality_id,
  price_snapshot_minor, currency, eligibility_snapshot)
values ('71000000-0000-4000-8000-000000790301', '70000000-0000-4000-8000-000000790301', 'PROFILE', '10000000-0000-4000-8000-000000790301',
  '60000000-0000-4000-8000-000000790003', 0, 'MXN', '{}');
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id, runner_profile_id, buyer_profile_id,
  registration_number)
values ('72000000-0000-4000-8000-000000790301', '70000000-0000-4000-8000-000000790301', '71000000-0000-4000-8000-000000790301',
  '50000000-0000-4000-8000-000000790003', '60000000-0000-4000-8000-000000790003', '10000000-0000-4000-8000-000000790301',
  '10000000-0000-4000-8000-000000790301', 'I-7301-AAAA');
update app.competition_settings set ranking_epoch = null, ranking_epoch_frozen_at = null where settings_id = 1;

create function pg_temp.row_as_staff() returns jsonb language sql as $$
  select e from jsonb_array_elements(public.admin_list_participants('50000000-0000-4000-8000-000000790003') -> 'items') e
  where e ->> 'registration_id' = '72000000-0000-4000-8000-000000790301' $$;
grant execute on function pg_temp.row_as_staff() to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
-- Before any resolution row exists (the workspace creates them): everything is present, empty and backwards compatible.
select is((pg_temp.row_as_staff() -> 'attendance') - 'checked_in', '{"finalized": false, "final_status": null, "resolution_status": null}'::jsonb,
  'before the closure workspace: not finalized, no resolution');
select is(pg_temp.row_as_staff() -> 'sporting_eligibility', 'null'::jsonb, 'no sporting eligibility resolution yet');
select is(pg_temp.row_as_staff() -> 'incidents', '{"count": 0, "highest_severity": null, "total_count": 0}'::jsonb, 'no incidents');
select is(pg_temp.row_as_staff() -> 'credited_distance_m', 'null'::jsonb, 'no credited distance');
select is(pg_temp.row_as_staff() ->> 'registration_number', 'I-7301-AAAA', 'the earlier keys are unchanged');

select is(public.resolve_attendance('72000000-0000-4000-8000-000000790301', 'PRESENT', 'Presente', '{"kind": "judge_note"}'::jsonb) ->> 'status', 'PRESENT', 'attendance resolved PRESENT');
select is((pg_temp.row_as_staff() -> 'attendance') ->> 'resolution_status', 'PRESENT', 'the current resolution status shows in the list');
select is((pg_temp.row_as_staff() -> 'attendance') ->> 'final_status', null, 'but it is not final until the finalization');
select is(pg_temp.row_as_staff() -> 'sporting_eligibility', '{"status": "ELIGIBLE", "distance_credit_disposition": "ALLOW", "reason_code": null}'::jsonb,
  'the eligibility starts ELIGIBLE / ALLOW');
select is(public.finalize_attendance('50000000-0000-4000-8000-000000790003') ->> 'present_count', '1', 'attendance is finalized');
select is((pg_temp.row_as_staff() -> 'attendance') - 'checked_in', '{"finalized": true, "final_status": "PRESENT", "resolution_status": "PRESENT"}'::jsonb,
  'final attendance status after the finalization');
select is(pg_temp.row_as_staff() -> 'credited_distance_m', 'null'::jsonb, 'still no credit before the closure');
select is(public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000790301', 'ELIGIBLE', 'ALLOW', 'JUDGE_OK', 'Revisado') ->> 'status', 'ELIGIBLE', 'eligibility resolved with a code');
select is(pg_temp.row_as_staff() #>> '{sporting_eligibility,reason_code}', 'JUDGE_OK', 'the reason code shows (the free-text reason does not)');
select ok(pg_temp.row_as_staff()::text !~* 'Revisado', 'no free text from the eligibility resolution reaches the row');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790001", "role": "authenticated"}';
select is(public.close_edition('50000000-0000-4000-8000-000000790003', 'p790-close-key-0001') ->> 'credits_created', '1', 'the global ADMIN closes the Edition: one credit');
select is(pg_temp.row_as_staff() ->> 'credited_distance_m', '10000', 'the credited distance of the ACTIVE credit shows after the closure');
reset role;

-- Incidents: one OPEN HIGH, one OPEN LOW, one RESOLVED CRITICAL (not counted as open, but in the total).
insert into app.community_integrity_case (case_type, runner_profile_id, edition_id, registration_id, status, severity, blocking_level, resolved_at, resolution)
values ('CREDIT_WITHOUT_FINAL_ATTENDANCE', '10000000-0000-4000-8000-000000790301', '50000000-0000-4000-8000-000000790003', '72000000-0000-4000-8000-000000790301', 'OPEN', 'HIGH', 'NONE', null, null),
  ('DISTANCE_MISMATCH', '10000000-0000-4000-8000-000000790301', '50000000-0000-4000-8000-000000790003', '72000000-0000-4000-8000-000000790301', 'OPEN', 'LOW', 'NONE', null, null),
  ('INVALID_SPORT_DATE', '10000000-0000-4000-8000-000000790301', '50000000-0000-4000-8000-000000790003', '72000000-0000-4000-8000-000000790301', 'RESOLVED', 'CRITICAL', 'NONE', now(), 'Corregido');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790002", "role": "authenticated"}';
select is(pg_temp.row_as_staff() -> 'incidents', '{"count": 2, "highest_severity": "HIGH", "total_count": 3}'::jsonb,
  'incidents: two open, highest open severity HIGH, three in total');
select ok(pg_temp.row_as_staff()::text !~* '(Corregido|DISTANCE_MISMATCH|CREDIT_WITHOUT)', 'and no case type, resolution text or id is exposed');
select is(pg_temp.row_as_staff() -> 'contact', 'null'::jsonb, 'an OPERATOR still sees no contact data (same RBAC as before)');
select is(public.admin_list_participants('50000000-0000-4000-8000-000000790003') ->> 'contact_visible', 'false', 'contact_visible stays false for the OPERATOR');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790001", "role": "authenticated"}';
select is(public.admin_list_participants('50000000-0000-4000-8000-000000790003') -> 'items' -> 0 #>> '{incidents,highest_severity}', 'HIGH', 'the ADMIN sees the same summary');
select is(jsonb_typeof(public.admin_list_participants('50000000-0000-4000-8000-000000790003') -> 'items' -> 0 -> 'contact'), 'object', 'plus the contact block (PII_EXPORT)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_participants('50000000-0000-4000-8000-000000790003') $$) ->> 'code', 'FORBIDDEN', 'a CHECKIN cannot list participants (same RBAC)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000790004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_participants('50000000-0000-4000-8000-000000790003') $$) ->> 'code', 'FORBIDDEN', 'nor an OPERATOR scoped to another Edition');
reset role;

-- A registration canceled after the fact keeps the same shape.
select is(private.registration_participant_row('72000000-0000-4000-8000-000000790301', false) ->> 'credited_distance_m', '10000',
  'the row builder (used by the CSV export) carries the same fields');

select * from finish();
rollback;
