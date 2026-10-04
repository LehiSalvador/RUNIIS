-- P3-R part 2 (P3SECA-04, -05, -06): closure/reopen are GLOBAL ADMIN only and the ranking-epoch freeze is audited; the attendance workspace read takes
-- the Edition lock only when it has something to reconcile; the OWN-04 cancel notification outcome (queued | suppressed | no_contact) and its
-- staff follow-up task. Ids use a 781 range.
begin;
create extension if not exists pgtap with schema extensions;
-- pgrowlocks shows the row-lock MODE: a FOR UPDATE on the Edition is told apart from the FOR KEY SHARE every foreign key insert takes.
create extension if not exists pgrowlocks with schema extensions;
set local search_path = extensions, public;

select plan(64);

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
-- Does THIS transaction hold a FOR UPDATE row lock on the Edition? (1/0)
create function pg_temp.edition_for_update(p_edition uuid) returns text language plpgsql security definer as $$
declare v text;
begin
  select count(*)::text into v from app.edition e join extensions.pgrowlocks('app.edition') l on l.locked_row = e.ctid
  where e.edition_id = p_edition and 'For Update' = any (l.modes);
  return v;
end $$;
grant execute on function pg_temp.edition_for_update(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Staff: ADMIN global (1), OPERATOR global (2), ADMIN scoped to Edition C only (3), CHECKIN global (4).
-- Editions (all FINISHED, FREE, closure PENDING): C closes (one PRESENT adult), W cancels, L reads the workspace.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000781001', 'p781-admin@example.test'),
  ('00000000-0000-4000-8000-000000781002', 'p781-operator@example.test'),
  ('00000000-0000-4000-8000-000000781003', 'p781-edition-admin@example.test'),
  ('00000000-0000-4000-8000-000000781004', 'p781-checkin@example.test');
-- Runners 101 (closes on C), 111..113 (W: with email, without email, suppressed), 121/122 (L).
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000781' || n)::uuid, case when n = '112' then null else 'p781-runner-' || n || '@example.test' end
from unnest(array['101', '111', '112', '113', '121', '122']) n;
insert into app.staff_member (staff_member_id, auth_user_id, status)
select ('20000000-0000-4000-8000-00000078100' || i)::uuid, ('00000000-0000-4000-8000-00000078100' || i)::uuid, 'ACTIVE' from generate_series(1, 4) i;
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000781001', 'ADMIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000781002', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000781004', 'CHECKIN', 'GLOBAL', null);
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name, date_of_birth)
select ('10000000-0000-4000-8000-000000781' || n)::uuid, ('00000000-0000-4000-8000-000000781' || n)::uuid, 'Runner 781-' || n, date '1990-01-01'
from unnest(array['101', '111', '112', '113', '121', '122']) n;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000781001', event_type_id, 'P3R Closure Event', 'p781-closure-event' from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state, registration_state, closure_state,
  registration_close_at, city, state_region, country_code)
select ('50000000-0000-4000-8000-00000078100' || i)::uuid, '40000000-0000-4000-8000-000000781001', 'p781-closure-' || i, 'P3R Closure ' || i,
  'FREE', 'America/Monterrey', 'FINISHED', 'CLOSED', 'PENDING', now() - interval '1 day', 'Monterrey', 'NL', 'MX'
from generate_series(1, 3) i;
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000781003', 'ADMIN', 'EDITION', '50000000-0000-4000-8000-000000781001');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone, created_by_staff_id)
select ('50000000-0000-4000-8000-00000078100' || i)::uuid, 1, 'DATE_TIME_CONFIRMED', '2026-09-20', '07:00', 'America/Monterrey',
  '20000000-0000-4000-8000-000000781001'
from generate_series(1, 3) i;
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order)
select ('60000000-0000-4000-8000-00000078100' || i)::uuid, ('50000000-0000-4000-8000-00000078100' || i)::uuid, '10k', '10K', 10000, true, 1
from generate_series(1, 3) i;

-- One CONFIRMED registration: request -> request participant -> registration. Edition number, runner suffix, registration suffix.
create function pg_temp.reg(p_edition int, p_runner text, p_reg text) returns void language plpgsql as $$
begin
  insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, registration_mode, currency, total_snapshot_minor)
  values (('70000000-0000-4000-8000-000000781' || p_reg)::uuid, 'R-7' || p_reg || '-AAAA', ('10000000-0000-4000-8000-000000781' || p_runner)::uuid,
    ('50000000-0000-4000-8000-00000078100' || p_edition)::uuid, 'FREE', 'MXN', 0);
  insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, runner_profile_id, modality_id,
    price_snapshot_minor, currency, eligibility_snapshot)
  values (('71000000-0000-4000-8000-000000781' || p_reg)::uuid, ('70000000-0000-4000-8000-000000781' || p_reg)::uuid, 'PROFILE',
    ('10000000-0000-4000-8000-000000781' || p_runner)::uuid, ('60000000-0000-4000-8000-00000078100' || p_edition)::uuid, 0, 'MXN', '{}');
  insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id, runner_profile_id,
    buyer_profile_id, registration_number)
  values (('72000000-0000-4000-8000-000000781' || p_reg)::uuid, ('70000000-0000-4000-8000-000000781' || p_reg)::uuid,
    ('71000000-0000-4000-8000-000000781' || p_reg)::uuid, ('50000000-0000-4000-8000-00000078100' || p_edition)::uuid,
    ('60000000-0000-4000-8000-00000078100' || p_edition)::uuid, ('10000000-0000-4000-8000-000000781' || p_runner)::uuid,
    ('10000000-0000-4000-8000-000000781' || p_runner)::uuid, 'I-7' || p_reg || '-AAAA');
end $$;
select pg_temp.reg(1, '101', '101');
select pg_temp.reg(2, '111', '111');
select pg_temp.reg(2, '112', '112');
select pg_temp.reg(2, '113', '113');
select pg_temp.reg(3, '121', '121');

-- The competition epoch starts unset in this transaction regardless of what the dev seed did.
update app.competition_settings set ranking_epoch = null, ranking_epoch_frozen_at = null where settings_id = 1;

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;

-- ===========================================================================================
-- A. P3SECA-05: closure authority is GLOBAL ADMIN
-- ===========================================================================================
select is(pg_temp.sv($q$ select global_only::text from private.staff_action where action = 'EDITION_CLOSURE_MANAGE' $q$), 'true', 'EDITION_CLOSURE_MANAGE is a global-only action (Master §145)');
select is(pg_temp.sv($q$ select string_agg(role, ',' order by role) from private.staff_permission where action = 'EDITION_CLOSURE_MANAGE' $q$), 'ADMIN',
  'only the ADMIN role holds it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
select public.resolve_attendance('72000000-0000-4000-8000-000000781101', 'PRESENT', 'Presente', '{"kind": "judge_note"}'::jsonb);
insert into ids select 'fin', public.finalize_attendance('50000000-0000-4000-8000-000000781001');
select is((select value ->> 'present_count' from ids where name = 'fin'), '1', 'Edition C is finalized with one PRESENT adult');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000781001') $$) ->> 'code', 'FORBIDDEN',
  'an ADMIN scoped to the Edition cannot close it');
select is(pg_temp.sv($q$ select closure_state from app.edition where edition_id = '50000000-0000-4000-8000-000000781001' $q$), 'PENDING', 'and nothing changed');
select is(pg_temp.sv($q$ select count(*) from app.competition_settings where ranking_epoch is not null $q$), '0', 'the ranking epoch is still unset');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000781001') $$) ->> 'code', 'FORBIDDEN', 'an OPERATOR still cannot close');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000781001') $$) ->> 'code', 'FORBIDDEN', 'nor a CHECKIN');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781001", "role": "authenticated"}';
insert into ids select 'close1', public.close_edition('50000000-0000-4000-8000-000000781001', 'p781-close-key-0001');
select is((select value ->> 'credits_created' from ids where name = 'close1'), '1', 'the global ADMIN closes Edition C: one credit');
select is(pg_temp.sv($q$ select ranking_epoch::text from app.competition_settings where settings_id = 1 $q$), '2026-09-20', 'and the platform ranking epoch is frozen at its sport date');

-- P3SECA-05: the freeze has its own audit row.
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'RANKING_EPOCH_FROZEN' $q$), '1', 'the freeze writes one RANKING_EPOCH_FROZEN audit row');
select is(pg_temp.sv($q$ select entity_type || '/' || (after_snapshot ->> 'ranking_epoch') || '/' || coalesce(before_snapshot ->> 'ranking_epoch', 'null')
  from audit.audit_log where action = 'RANKING_EPOCH_FROZEN' $q$), 'competition_settings/2026-09-20/null', 'with before (unset) and after (the epoch date)');
select is(pg_temp.sv($q$ select (after_snapshot ->> 'edition_id') || '/' || (after_snapshot ->> 'administrative_closure_id') = '50000000-0000-4000-8000-000000781001/'
  || (select administrative_closure_id::text from app.administrative_closure where edition_id = '50000000-0000-4000-8000-000000781001' and superseded_at is null)
  from audit.audit_log where action = 'RANKING_EPOCH_FROZEN' $q$), 'true', 'naming the Edition and the closure that froze it');
select is(pg_temp.sv($q$ select actor_staff_member_id::text || '/' || edition_id::text from audit.audit_log where action = 'RANKING_EPOCH_FROZEN' $q$),
  '20000000-0000-4000-8000-000000781001/50000000-0000-4000-8000-000000781001', 'attributed to the global ADMIN on that Edition');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.reopen_edition('50000000-0000-4000-8000-000000781001', 'Corrección') $$) ->> 'code', 'FORBIDDEN', 'an ADMIN scoped to the Edition cannot reopen it either');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.reopen_edition('50000000-0000-4000-8000-000000781001', 'Corrección') $$) ->> 'code', 'FORBIDDEN', 'nor an OPERATOR');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781001", "role": "authenticated"}';
select is(public.reopen_edition('50000000-0000-4000-8000-000000781001', 'Corrección') ->> 'reopened', 'true', 'the global ADMIN reopens');
insert into ids select 'close2', public.close_edition('50000000-0000-4000-8000-000000781001', 'p781-close-key-0002');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'RANKING_EPOCH_FROZEN' $q$), '1',
  'closing again does not freeze (or audit) the epoch a second time: it is frozen once');
select is(pg_temp.sv($q$ select ranking_epoch::text from app.competition_settings where settings_id = 1 $q$), '2026-09-20', 'and it did not move');
-- The idempotent replay of a completed close returns the stored response and writes nothing.
select is(public.close_edition('50000000-0000-4000-8000-000000781001', 'p781-close-key-0002') ->> 'credits_created', (select value ->> 'credits_created' from ids where name = 'close2'),
  'an Idempotency-Key replay returns the stored response');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'RANKING_EPOCH_FROZEN' $q$), '1', 'and still one freeze row');

-- ===========================================================================================
-- B. P3SECA-04: the attendance workspace locks the Edition only when it has universe rows to reconcile
-- ===========================================================================================
reset role;
-- Edition L (3): the registration already has its starting attendance and eligibility rows, so there is nothing to reconcile.
insert into app.attendance_resolution (edition_id, registration_id, revision, status, source, resolved_at)
values ('50000000-0000-4000-8000-000000781003', '72000000-0000-4000-8000-000000781121', 1, 'PENDING', 'INITIAL', now());
insert into app.sporting_eligibility_resolution (registration_id, revision, status, distance_credit_disposition, resolved_at)
values ('72000000-0000-4000-8000-000000781121', 1, 'ELIGIBLE', 'ALLOW', now());
select is(private.attendance_universe_needs_sync('50000000-0000-4000-8000-000000781003'), false, 'a reconciled Edition needs no sync');
select is(pg_temp.edition_for_update('50000000-0000-4000-8000-000000781003'), '0', 'and nothing holds a FOR UPDATE lock on it yet');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
insert into ids select 'ws_read', public.attendance_workspace('50000000-0000-4000-8000-000000781003');
select is((select value ->> 'universe_count' from ids where name = 'ws_read'), '1', 'the workspace answers with the universe');
select is(pg_temp.edition_for_update('50000000-0000-4000-8000-000000781003'), '0',
  'and the read took NO Edition FOR UPDATE lock');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.attendance_workspace('50000000-0000-4000-8000-000000781003') $$) ->> 'code', 'FORBIDDEN',
  'authorization is unchanged: an ADMIN of ANOTHER Edition still cannot read it');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.attendance_workspace('50000000-0000-4000-8000-000000781999') $$) ->> 'code', 'NOT_FOUND', 'an unknown Edition is still NOT_FOUND');

reset role;
-- A second CONFIRMED registration with no attendance row yet: now there is something to reconcile.
select pg_temp.reg(3, '122', '122');
select is(private.attendance_universe_needs_sync('50000000-0000-4000-8000-000000781003'), true, 'a CONFIRMED registration without rows needs a sync');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
insert into ids select 'ws_sync', public.attendance_workspace('50000000-0000-4000-8000-000000781003');
select is((select value ->> 'universe_count' from ids where name = 'ws_sync'), '2', 'the workspace reconciles and shows both registrations');
select is(pg_temp.sv($q$ select count(*) from app.attendance_resolution where edition_id = '50000000-0000-4000-8000-000000781003' and superseded_at is null $q$), '2',
  'the missing starting row was created (self-healing is preserved)');
select is(pg_temp.edition_for_update('50000000-0000-4000-8000-000000781003'), '1',
  'and only that read took the Edition FOR UPDATE lock (inside the sync)');
reset role;
select is(private.attendance_universe_needs_sync('50000000-0000-4000-8000-000000781003'), false, 'afterwards the Edition is reconciled again');

-- Evidence that arrives later is promoted by the next read (PENDING/INITIAL + verified check-in), then no sync is needed again.
insert into app.attendance_checkin (edition_id, registration_id, status, verification_method, checked_in_by_staff_id)
values ('50000000-0000-4000-8000-000000781003', '72000000-0000-4000-8000-000000781121', 'VERIFIED_PRESENT', 'QR_SCAN', '20000000-0000-4000-8000-000000781002');
select is(private.attendance_universe_needs_sync('50000000-0000-4000-8000-000000781003'), true, 'a verified check-in on a PENDING/INITIAL row needs a sync (promotion)');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
select is(public.attendance_workspace('50000000-0000-4000-8000-000000781003') -> 'attendance_counts' ->> 'PRESENT', '1', 'the read promotes it to PRESENT');
reset role;
select is(private.attendance_universe_needs_sync('50000000-0000-4000-8000-000000781003'), false, 'and the Edition is reconciled again');
update app.attendance_checkin set status = 'REVERSED', reversed_at = now(), reversed_by_staff_id = '20000000-0000-4000-8000-000000781002', reversal_reason = 'Error'
where registration_id = '72000000-0000-4000-8000-000000781121';
select is(private.attendance_universe_needs_sync('50000000-0000-4000-8000-000000781003'), true, 'a reversed check-in under a PRESENT/CHECKIN row needs a sync (demotion)');
select ok(not has_function_privilege('authenticated', 'private.attendance_universe_needs_sync(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.attendance_universe_needs_sync(uuid)', 'execute'), 'the helper is not callable by API roles');

-- ===========================================================================================
-- C. P3SECA-06 / OWN-04: cancel notification outcome and the staff follow-up task
-- ===========================================================================================
-- 111 has an email (queued), 112 has none (no_contact), 113 has an email on the suppression list (suppressed).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_cancel_notification('72000000-0000-4000-8000-000000781111') $$) -> 'detail' ->> 'reason', 'not_canceled',
  'there is no outcome for a registration that is still CONFIRMED');
select is(public.cancel_registration('72000000-0000-4000-8000-000000781111', 'Solicitud del participante', 'PARTICIPANT_REQUEST') ->> 'status', 'CANCELED', 'staff cancel the registration of 111');
select is(public.cancel_registration('72000000-0000-4000-8000-000000781112', 'Solicitud del participante', 'PARTICIPANT_REQUEST') ->> 'status', 'CANCELED', 'and of 112 (no email)');
select is(public.cancel_registration('72000000-0000-4000-8000-000000781113', 'Solicitud del participante', 'PARTICIPANT_REQUEST') ->> 'status', 'CANCELED', 'and of 113');
reset role;
-- The suppression of 113's contact point (the consumer creates the contact point; do it the same way).
select o_contact_point_id is not null from private.comms_ensure_runner_recipient('10000000-0000-4000-8000-000000781113');
insert into app.communication_suppression (contact_point_id, reason, scope, source)
select cp.communication_contact_point_id, 'HARD_BOUNCE', 'ALL_EMAIL', 'p781-test'
from app.communication_contact_point cp join app.communication_recipient r on r.communication_recipient_id = cp.communication_recipient_id
where r.runner_profile_id = '10000000-0000-4000-8000-000000781113' and cp.status = 'ACTIVE';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
insert into ids select 'n111', public.registration_cancel_notification('72000000-0000-4000-8000-000000781111');
insert into ids select 'n112', public.registration_cancel_notification('72000000-0000-4000-8000-000000781112');
insert into ids select 'n113', public.registration_cancel_notification('72000000-0000-4000-8000-000000781113');
select is((select value ->> 'status' from ids where name = 'n111'), 'queued', 'a participant with a deliverable email: queued');
select is((select value ->> 'follow_up_task_id' from ids where name = 'n111'), null, 'and no follow-up task');
select is((select value ->> 'status' from ids where name = 'n112'), 'no_contact', 'a participant with no email: no_contact');
select is((select value ->> 'status' from ids where name = 'n113'), 'suppressed', 'a participant whose contact is suppressed: suppressed');
select ok((select (value ->> 'follow_up_task_id') is not null from ids where name = 'n112') and (select (value ->> 'follow_up_task_id') is not null from ids where name = 'n113'),
  'no_contact and suppressed both open a follow-up task');
select is(pg_temp.sv($q$ select status || '/' || blocking_level || '/' || category || '/' || source_rule || '/' || assigned_role from app.admin_task
  where task_key = 'registration-cancel-notice:72000000-0000-4000-8000-000000781112' $q$), 'OPEN/ACTION_REQUIRED/COMMUNICATIONS/registration-cancel-notice/OPERATOR',
  'an ACTION_REQUIRED COMMUNICATIONS task for staff');
select is(pg_temp.sv($q$ select edition_id::text || '/' || related_entity_type || '/' || related_entity_id::text from app.admin_task
  where task_key = 'registration-cancel-notice:72000000-0000-4000-8000-000000781112' $q$),
  '50000000-0000-4000-8000-000000781002/registration/72000000-0000-4000-8000-000000781112', 'scoped to the Edition and pointing at the registration');
select is(pg_temp.sv($q$ select (metadata ->> 'notification_outcome') || '/' || (metadata ->> 'registration_number') from app.admin_task
  where task_key = 'registration-cancel-notice:72000000-0000-4000-8000-000000781113' $q$), 'suppressed/I-7113-AAAA', 'whose metadata states the outcome');
select is(pg_temp.sv($q$ select (metadata::text ~* '(example\.test|Runner 781|Solicitud)')::text from app.admin_task where source_rule = 'registration-cancel-notice' limit 1 $q$), 'false',
  'and carries no email, name or free-text reason');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where source_rule = 'registration-cancel-notice' $q$), '2', 'the queued participant has no task');
select is((select (public.registration_cancel_notification('72000000-0000-4000-8000-000000781112') ->> 'follow_up_task_id')), (select value ->> 'follow_up_task_id' from ids where name = 'n112'),
  'asking again is idempotent: the same task');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where source_rule = 'registration-cancel-notice' $q$), '2', 'no duplicate task');

-- The outbox consumer is the backstop: it opens the same task when the email cannot go out.
reset role;
select is(private.enqueue_registration_canceled_messages((select outbox_event_id from infra.outbox_event
  where event_type = 'RegistrationCanceled' and aggregate_id = '72000000-0000-4000-8000-000000781112')),
  '{"enqueued": 0, "skipped_no_contact": 1}'::jsonb, 'the consumer result keys are unchanged (no contact)');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'registration-cancel-notice:72000000-0000-4000-8000-000000781112' $q$), '1', 'and it converges on the same task');
select is(private.enqueue_registration_canceled_messages((select outbox_event_id from infra.outbox_event
  where event_type = 'RegistrationCanceled' and aggregate_id = '72000000-0000-4000-8000-000000781111')), '{"enqueued": 1}'::jsonb,
  'the deliverable participant is still emailed exactly as before (OWN-04 unchanged)');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'registration-cancel-notice:72000000-0000-4000-8000-000000781111' $q$), '0', 'with no follow-up task');
select is(private.enqueue_registration_canceled_messages((select outbox_event_id from infra.outbox_event
  where event_type = 'RegistrationCanceled' and aggregate_id = '72000000-0000-4000-8000-000000781113')), '{"enqueued": 1}'::jsonb,
  'a suppressed contact is still enqueued (the dispatcher cancels it as SUPPRESSED); the consumer also opens the follow-up');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'registration-cancel-notice:72000000-0000-4000-8000-000000781113' $q$), '1', 'one task for 113');

-- A task staff resolved is not re-raised by asking again.
update app.admin_task set status = 'RESOLVED', resolved_at = now(), resolution_type = 'MANUAL', resolution_reason = 'Avisado por WhatsApp'
where task_key = 'registration-cancel-notice:72000000-0000-4000-8000-000000781112';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
select is((public.registration_cancel_notification('72000000-0000-4000-8000-000000781112') ->> 'status'), 'no_contact', 'the outcome is still reported');
select is(pg_temp.sv($q$ select status from app.admin_task where task_key = 'registration-cancel-notice:72000000-0000-4000-8000-000000781112' $q$), 'RESOLVED',
  'but a resolved follow-up stays resolved');

-- Authorization and grants.
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_cancel_notification('72000000-0000-4000-8000-000000781112') $$) ->> 'code', 'FORBIDDEN', 'a CHECKIN cannot read the outcome');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000781002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.registration_cancel_notification('72000000-0000-4000-8000-000000781999') $$) ->> 'code', 'NOT_FOUND', 'an unknown registration is NOT_FOUND');
reset role;
select ok(has_function_privilege('authenticated', 'public.registration_cancel_notification(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.registration_cancel_notification(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.registration_cancel_notice_task(uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'private.registration_cancel_notice_task(uuid, uuid, text, text)', 'execute'),
  'the outcome RPC is for staff sessions only; the task writer is internal');

select * from finish();
rollback;
