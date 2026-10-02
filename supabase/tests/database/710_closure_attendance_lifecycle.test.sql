-- T41 attendance/eligibility lifecycle (Master §90-96, §175): universe init, ResolveAttendance,
-- ResolveSportingEligibility, FinalizeAttendance (incl. bulk MarkRemainingNoShow), readiness
-- blockers and ReopenAttendanceFinalization. Synthetic ids in an 81xxxxxx range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(24);

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
-- Fixture: a FINISHED Edition, one Modality, two PROFILE + one GUEST CONFIRMED registration, and a
-- GLOBAL ADMIN + GLOBAL OPERATOR staff pair.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000710001', 'closure-admin@example.test'),
  ('00000000-0000-4000-8000-000000710002', 'closure-operator@example.test'),
  ('00000000-0000-4000-8000-000000710003', 'closure-runner-a@example.test'),
  ('00000000-0000-4000-8000-000000710004', 'closure-runner-b@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000710001', '00000000-0000-4000-8000-000000710001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000710002', '00000000-0000-4000-8000-000000710002', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000710001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000710002', 'OPERATOR', 'GLOBAL');
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name, date_of_birth) values
  ('10000000-0000-4000-8000-000000710001', '00000000-0000-4000-8000-000000710003', 'Runner Closure A', '1990-01-01'),
  ('10000000-0000-4000-8000-000000710002', '00000000-0000-4000-8000-000000710004', 'Runner Closure B', '1990-01-01');
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000710001', '10000000-0000-4000-8000-000000710001', 'Invitado Closure', '1990-01-01',
   'M', '+528110007101', 'Contacto', '+528110007102', 'Amigo');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000710001', event_type_id, 'Closure Event', 'closure-event'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state,
  registration_state, closure_state, registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000710001', '40000000-0000-4000-8000-000000710001', 'closure-event-2026',
   'Closure Event 2026', 'FREE', 'America/Monterrey', 'FINISHED', 'CLOSED', 'PENDING', now() - interval '1 day',
   'Monterrey', 'NL', 'MX');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone,
  created_by_staff_id) values
  ('50000000-0000-4000-8000-000000710001', 1, 'DATE_TIME_CONFIRMED', '2026-09-20', '07:00', 'America/Monterrey',
   '20000000-0000-4000-8000-000000710001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000710001', '50000000-0000-4000-8000-000000710001', '10k', '10K', 10000, true, 1);

insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor) values
  ('70000000-0000-4000-8000-000000710001', 'R-7101-AAAA', '10000000-0000-4000-8000-000000710001',
   '50000000-0000-4000-8000-000000710001', 'FREE', 'MXN', 0),
  ('70000000-0000-4000-8000-000000710002', 'R-7102-AAAA', '10000000-0000-4000-8000-000000710002',
   '50000000-0000-4000-8000-000000710001', 'FREE', 'MXN', 0);
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('71000000-0000-4000-8000-000000710001', '70000000-0000-4000-8000-000000710001', 'PROFILE',
   '10000000-0000-4000-8000-000000710001', null, '60000000-0000-4000-8000-000000710001', 0, 'MXN', '{}'),
  ('71000000-0000-4000-8000-000000710002', '70000000-0000-4000-8000-000000710001', 'GUEST',
   null, '30000000-0000-4000-8000-000000710001', '60000000-0000-4000-8000-000000710001', 0, 'MXN', '{}'),
  ('71000000-0000-4000-8000-000000710003', '70000000-0000-4000-8000-000000710002', 'PROFILE',
   '10000000-0000-4000-8000-000000710002', null, '60000000-0000-4000-8000-000000710001', 0, 'MXN', '{}');
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, guest_participant_id, buyer_profile_id, registration_number) values
  ('72000000-0000-4000-8000-000000710001', '70000000-0000-4000-8000-000000710001', '71000000-0000-4000-8000-000000710001',
   '50000000-0000-4000-8000-000000710001', '60000000-0000-4000-8000-000000710001',
   '10000000-0000-4000-8000-000000710001', null, '10000000-0000-4000-8000-000000710001', 'I-7101-AAAA'),
  ('72000000-0000-4000-8000-000000710002', '70000000-0000-4000-8000-000000710001', '71000000-0000-4000-8000-000000710002',
   '50000000-0000-4000-8000-000000710001', '60000000-0000-4000-8000-000000710001',
   null, '30000000-0000-4000-8000-000000710001', '10000000-0000-4000-8000-000000710001', 'I-7102-AAAA'),
  ('72000000-0000-4000-8000-000000710003', '70000000-0000-4000-8000-000000710002', '71000000-0000-4000-8000-000000710003',
   '50000000-0000-4000-8000-000000710001', '60000000-0000-4000-8000-000000710001',
   '10000000-0000-4000-8000-000000710002', null, '10000000-0000-4000-8000-000000710002', 'I-7103-AAAA');

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000710001", "role": "authenticated"}';

-- ---------------------------------------------------------------------------------------------
-- GET workspace: self-healing init classifies PENDING (no check-ins in this fixture).
-- ---------------------------------------------------------------------------------------------
insert into ids select 'ws1', public.attendance_workspace('50000000-0000-4000-8000-000000710001');
select is((select value ->> 'universe_count' from ids where name = 'ws1'), '3', 'universe = 3 CONFIRMED registrations');
select is((select value -> 'attendance_counts' ->> 'PENDING' from ids where name = 'ws1'), '3', 'all three start PENDING');
select ok(not (select value -> 'finalize_readiness' ->> 'ready' from ids where name = 'ws1')::boolean,
  'finalize is not ready while attendance is PENDING');

-- ---------------------------------------------------------------------------------------------
-- ResolveAttendance: manual PRESENT requires a reason; OPERATOR is allowed (ATTENDANCE_MANAGE).
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.resolve_attendance('72000000-0000-4000-8000-000000710001', 'PRESENT') $$)
  ->> 'code', 'VALIDATION_ERROR', 'manual PRESENT without a reason is rejected');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000710002", "role": "authenticated"}';
insert into ids select 'ar1', public.resolve_attendance('72000000-0000-4000-8000-000000710001', 'PRESENT', 'Vi al corredor cruzar meta');
select is((select value ->> 'status' from ids where name = 'ar1'), 'PRESENT', 'OPERATOR resolves attendance PRESENT');
select is((select value ->> 'source' from ids where name = 'ar1'), 'MANUAL', 'first resolution from PENDING is source MANUAL');

insert into ids select 'ar2', public.resolve_attendance('72000000-0000-4000-8000-000000710002', 'PRESENT', 'Presente en salida');
insert into ids select 'ar1b', public.resolve_attendance('72000000-0000-4000-8000-000000710001', 'NO_SHOW', 'Corrección: no cruzó meta');
select is((select value ->> 'source' from ids where name = 'ar1b'), 'CORRECTION',
  're-resolving an already-settled row is source CORRECTION');
insert into ids select 'ar1c', public.resolve_attendance('72000000-0000-4000-8000-000000710001', 'PRESENT', 'Confirmado con evidencia de video');

-- ---------------------------------------------------------------------------------------------
-- ResolveSportingEligibility: DQ requires a reason; default disposition is ALLOW (Master §92).
-- ---------------------------------------------------------------------------------------------
insert into ids select 'ws2', public.attendance_workspace('50000000-0000-4000-8000-000000710001');
select is((select value -> 'eligibility_counts' ->> 'ELIGIBLE' from ids where name = 'ws2'), '3',
  'sporting eligibility auto-initializes to ELIGIBLE/ALLOW for the whole universe');

select is(pg_temp.err($$ select public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000710002',
  'DISQUALIFIED', 'DENY') $$) ->> 'code', 'VALIDATION_ERROR', 'DQ without a reason is rejected');
insert into ids select 'se1', public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000710002',
  'DISQUALIFIED', 'DENY', 'CUT_COURSE', 'Corte de ruta reportado por juez');
select is((select value ->> 'distance_credit_disposition' from ids where name = 'se1'), 'DENY',
  'DQ with explicit DENY disposition is accepted');

-- ---------------------------------------------------------------------------------------------
-- FinalizeAttendance: blocked while any PENDING remains; bulk MarkRemainingNoShow clears the rest.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(format($$ select public.finalize_attendance(%L) $$,
  '50000000-0000-4000-8000-000000710001')) ->> 'detail' ->> 'reason', 'not_ready',
  'finalize is refused while registration 72...003 is still PENDING');

select is(pg_temp.err(format($$ select public.finalize_attendance(%L, true) $$,
  '50000000-0000-4000-8000-000000710001')) ->> 'code', 'VALIDATION_ERROR',
  'bulk mark-remaining-no-show requires an explicit reason (scope confirmation)');

insert into ids select 'fin1', public.finalize_attendance('50000000-0000-4000-8000-000000710001', true,
  'Cierre de operación: sin más check-ins esperados');
select is((select value ->> 'present_count' from ids where name = 'fin1'), '2', 'finalize counts the two PRESENT rows');
select is((select value ->> 'no_show_count' from ids where name = 'fin1'), '1',
  'bulk no-show only touched the still-PENDING registration');
select is((select ar.status from app.attendance_resolution ar
           where ar.registration_id = '72000000-0000-4000-8000-000000710001' and ar.superseded_at is null), 'PRESENT',
  'bulk no-show never touches an already-PRESENT registration');

-- ---------------------------------------------------------------------------------------------
-- Once finalized, ResolveAttendance is blocked until an explicit reopen.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.resolve_attendance('72000000-0000-4000-8000-000000710001', 'NO_SHOW', 'x') $$)
  ->> 'code', 'CLOSURE_BLOCKED', 'attendance is locked once finalized');
select is(pg_temp.err(format($$ select public.finalize_attendance(%L) $$,
  '50000000-0000-4000-8000-000000710001')) ->> 'code', 'BUSINESS_RULE_VIOLATION',
  're-finalizing without reopening first is refused');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000710002", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.reopen_attendance_finalization(%L, %L) $$,
  '50000000-0000-4000-8000-000000710001', '')) ->> 'code', 'VALIDATION_ERROR', 'reopen requires a non-blank reason');
insert into ids select 'reopen1', public.reopen_attendance_finalization('50000000-0000-4000-8000-000000710001',
  'Corrección solicitada por juez de ruta');
select ok((select value ->> 'reopened' from ids where name = 'reopen1')::boolean, 'ReopenAttendanceFinalization succeeds');
select is((select count(*)::int from app.attendance_finalization
           where edition_id = '50000000-0000-4000-8000-000000710001' and superseded_at is null and status = 'FINALIZED'),
  0, 'no current finalization remains after reopen');

-- attendance can be corrected again now that the finalization was reopened.
insert into ids select 'ar1d', public.resolve_attendance('72000000-0000-4000-8000-000000710001', 'PRESENT', 'Reconfirmado');
insert into ids select 'fin2', public.finalize_attendance('50000000-0000-4000-8000-000000710001');
select is((select value ->> 'revision' from ids where name = 'fin2'), '2', 'the fresh finalization is revision 2');

-- ---------------------------------------------------------------------------------------------
-- RBAC: a caller with no staff role at all is FORBIDDEN outright.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000710003", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.attendance_workspace(%L) $$,
  '50000000-0000-4000-8000-000000710001')) ->> 'code', 'FORBIDDEN', 'a runner (non-staff) cannot read the attendance workspace');

-- ---------------------------------------------------------------------------------------------
-- Idempotency: replaying the same key returns the same response without a second effect.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000710002", "role": "authenticated"}';
insert into ids select 'se2a', public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000710001', 'ELIGIBLE',
  'ALLOW', null, null, 'idem-attendance-closure-1');
insert into ids select 'se2b', public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000710001', 'DISQUALIFIED',
  'DENY', 'X', 'ignored: replay wins', 'idem-attendance-closure-1');
select is((select value from ids where name = 'se2a'), (select value from ids where name = 'se2b'),
  'a replayed Idempotency-Key returns the stored response verbatim');
select is((select count(*)::int from app.sporting_eligibility_resolution
           where registration_id = '72000000-0000-4000-8000-000000710001'), 2,
  'the replay did not append a second revision');

select * from finish();
rollback;
