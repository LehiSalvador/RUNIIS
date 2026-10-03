-- P3-A administrative closure and DistanceCredit (Master §94-101): readiness blockers, CloseEdition with
-- exactly-once credits (Guest never, official distance snapshot, sport_date in the Edition timezone, ranking
-- epoch bootstrap), retry/timeout/second-close behaviour, ReopenEdition reversal and the correction chain
-- (REVERSED + supersedes, never delete). Real two-session concurrency is 713_closure_concurrency. Ids use a 711 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(61);

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
-- Reads a single value as the table owner: authenticated has no direct grants on the closure tables.
create function pg_temp.sv(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin execute p_sql into v; return v; end $$;
grant execute on function pg_temp.sv(text) to authenticated;
-- One readiness check ('true' / 'false' / null when the check does not exist) from a readiness object.
create function pg_temp.chk(p_readiness jsonb, p_code text) returns text language sql as $$
  select c ->> 'ok' from jsonb_array_elements(p_readiness -> 'checks') c where c ->> 'code' = p_code $$;
grant execute on function pg_temp.chk(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture: a FINISHED Edition (20 Sep 2026 07:00 Monterrey), a 10K that credits and a 3K that does not,
-- seven CONFIRMED registrations:
--   1 adult PROFILE (credited)              2 GUEST (never credited)        3 adult PROFILE, DQ + DENY
--   4 adult PROFILE, NO_SHOW                5 minor PROFILE, PRESENT, guardian PENDING (blocker, then credited)
--   6 adult PROFILE in the 3K (no credit)   7 minor PROFILE, NO_SHOW, guardian PENDING (must NOT block)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000711001', 'p711-admin@example.test'),
  ('00000000-0000-4000-8000-000000711002', 'p711-operator@example.test');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid, format('p711-runner-%s@example.test', i)
from generate_series(1, 7) i where i <> 2;
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000711001', '00000000-0000-4000-8000-000000711001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000711002', '00000000-0000-4000-8000-000000711002', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000711001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000711002', 'OPERATOR', 'GLOBAL');
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name, date_of_birth)
select ('10000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid,
  ('00000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid, 'Runner 711-' || i,
  case when i in (5, 7) then date '2012-01-01' else date '1990-01-01' end
from generate_series(1, 7) i where i <> 2;
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000711102', '10000000-0000-4000-8000-000000711101', 'Invitado 711', '1990-01-01',
   'M', '+528110007111', 'Contacto', '+528110007112', 'Amigo');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000711001', event_type_id, 'Credit Event', 'p711-credit-event'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state,
  registration_state, closure_state, registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000711001', '40000000-0000-4000-8000-000000711001', 'p711-credit-event-2026',
   'Credit Event 2026', 'FREE', 'America/Monterrey', 'FINISHED', 'CLOSED', 'PENDING', now() - interval '1 day',
   'Monterrey', 'NL', 'MX');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone,
  created_by_staff_id) values
  ('50000000-0000-4000-8000-000000711001', 1, 'DATE_TIME_CONFIRMED', '2026-09-20', '07:00', 'America/Monterrey',
   '20000000-0000-4000-8000-000000711001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000711001', '50000000-0000-4000-8000-000000711001', '10k', '10K', 10000, true, 1),
  ('60000000-0000-4000-8000-000000711002', '50000000-0000-4000-8000-000000711001', '3k', '3K familiar', 3000, false, 2);

insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor)
select ('70000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid, 'R-711' || i || '-AAAA',
  ('10000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000711001', 'FREE', 'MXN', 0
from generate_series(1, 7) i where i <> 2;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
select ('71000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000007111' || lpad((case when i = 2 then 1 else i end)::text, 2, '0'))::uuid,
  case when i = 2 then 'GUEST' else 'PROFILE' end,
  case when i = 2 then null else ('10000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid end,
  case when i = 2 then '30000000-0000-4000-8000-000000711102'::uuid end,
  case when i = 6 then '60000000-0000-4000-8000-000000711002'::uuid else '60000000-0000-4000-8000-000000711001'::uuid end,
  0, 'MXN', '{}'
from generate_series(1, 7) i;
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, guest_participant_id, buyer_profile_id, registration_number)
select ('72000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000007111' || lpad((case when i = 2 then 1 else i end)::text, 2, '0'))::uuid,
  ('71000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000711001',
  case when i = 6 then '60000000-0000-4000-8000-000000711002'::uuid else '60000000-0000-4000-8000-000000711001'::uuid end,
  case when i = 2 then null else ('10000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid end,
  case when i = 2 then '30000000-0000-4000-8000-000000711102'::uuid end,
  ('10000000-0000-4000-8000-0000007111' || lpad((case when i = 2 then 1 else i end)::text, 2, '0'))::uuid,
  'I-711' || i || '-AAAA'
from generate_series(1, 7) i;

-- Guardian verifications of the two minors, both PENDING.
insert into app.guardian_assignment (guardian_assignment_id, minor_runner_profile_id, guardian_profile_id, relationship_type,
  status, activated_at) values
  ('a0000000-0000-4000-8000-000000711005', '10000000-0000-4000-8000-000000711105', '10000000-0000-4000-8000-000000711101',
   'PARENT', 'ACTIVE', now()),
  ('a0000000-0000-4000-8000-000000711007', '10000000-0000-4000-8000-000000711107', '10000000-0000-4000-8000-000000711101',
   'PARENT', 'ACTIVE', now());
insert into app.guardian_event_verification (registration_id, guardian_assignment_id) values
  ('72000000-0000-4000-8000-000000711105', 'a0000000-0000-4000-8000-000000711005'),
  ('72000000-0000-4000-8000-000000711107', 'a0000000-0000-4000-8000-000000711007');

-- The competition epoch starts unset in this transaction regardless of what the dev seed did.
update app.competition_settings set ranking_epoch = null, ranking_epoch_frozen_at = null where settings_id = 1;

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Nothing can be closed before attendance is finalized.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000711001') $$) -> 'detail' ->> 'reason',
  'not_ready', 'close is refused before any finalization');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where edition_id = '50000000-0000-4000-8000-000000711001' $q$),
  '0', 'a refused close creates no credit');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711002", "role": "authenticated"}';
select public.resolve_attendance(('72000000-0000-4000-8000-0000007111' || lpad(i::text, 2, '0'))::uuid,
  case when i in (4, 7) then 'NO_SHOW' else 'PRESENT' end, 'Resolución 711',
  case when i in (4, 7) then null else '{"kind": "judge_note"}'::jsonb end)
from generate_series(1, 7) i;
select public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000711103', 'DISQUALIFIED', 'DENY',
  'CUT_COURSE', 'Corte de ruta');

-- 2. A PENDING sporting disposition blocks finalization.
select public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000711101', 'PENDING_REVIEW', 'PENDING', null, 'Revisión de tiempos');
select is(pg_temp.chk(pg_temp.err($$ select public.finalize_attendance('50000000-0000-4000-8000-000000711001') $$)
  -> 'detail' -> 'readiness', 'NO_PENDING_ELIGIBILITY'), 'false', 'a PENDING disposition blocks finalization');
select public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000711101', 'ELIGIBLE', 'ALLOW');

insert into ids select 'fin1', public.finalize_attendance('50000000-0000-4000-8000-000000711001');
select is((select (value ->> 'expected_count') || '/' || (value ->> 'present_count') || '/' || (value ->> 'no_show_count')
           from ids where name = 'fin1'), '7/5/2', 'finalization counts match the universe (7 = 5 PRESENT + 2 NO_SHOW)');

-- ---------------------------------------------------------------------------------------------
-- 3. Closure readiness blockers: guardian (PRESENT minor only), integrity case, then ready.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'ws1', public.attendance_workspace('50000000-0000-4000-8000-000000711001');
select is(pg_temp.chk((select value -> 'close_readiness' from ids where name = 'ws1'), 'FINALIZATION_CURRENT'), 'true',
  'closure readiness sees the current finalization');
select is(pg_temp.chk((select value -> 'close_readiness' from ids where name = 'ws1'), 'UNIVERSE_STABLE'), 'true',
  'the finalized universe still matches the live universe');
select is(pg_temp.chk((select value -> 'close_readiness' from ids where name = 'ws1'), 'GUARDIAN_RESOLVED'), 'false',
  'a PRESENT minor with a PENDING guardian verification blocks closure');
select is((select value -> 'close_readiness' -> 'checks' -> 6 -> 'detail' ->> 'pending_count' from ids where name = 'ws1'), '1',
  'the NO_SHOW minor with a PENDING verification does not count (only the PRESENT one)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000711001') $$) -> 'detail' ->> 'reason',
  'not_ready', 'close is refused while the guardian blocker stands');

reset role;
update app.guardian_event_verification set status = 'VERIFIED', verified_by_staff_id = '20000000-0000-4000-8000-000000711002',
  verified_at = now(), verification_method = 'IN_PERSON' where registration_id = '72000000-0000-4000-8000-000000711105';
insert into app.community_integrity_case (case_type, edition_id, status, severity, blocking_level)
values ('DISTANCE_MISMATCH', '50000000-0000-4000-8000-000000711001', 'OPEN', 'HIGH', 'BLOCKS_CLOSURE');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711001", "role": "authenticated"}';
select is(pg_temp.chk(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000711001') $$)
  -> 'detail' -> 'readiness', 'NO_OPEN_INTEGRITY_CASE'), 'false', 'an OPEN BLOCKS_CLOSURE integrity case blocks closure');
reset role;
update app.community_integrity_case set status = 'RESOLVED', resolved_at = now(), resolution = 'Verificado'
where edition_id = '50000000-0000-4000-8000-000000711001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711001", "role": "authenticated"}';
insert into ids select 'ws2', public.attendance_workspace('50000000-0000-4000-8000-000000711001');
select ok((select (value -> 'close_readiness' ->> 'ready')::boolean from ids where name = 'ws2'), 'all blockers resolved: closure is ready');

-- ---------------------------------------------------------------------------------------------
-- 4. CloseEdition: ADMIN only; one closure revision and one credit per eligible PROFILE registration.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000711001') $$) ->> 'code', 'FORBIDDEN',
  'an OPERATOR cannot close an Edition (EDITION_CLOSURE_MANAGE is ADMIN only)');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711001", "role": "authenticated"}';
insert into ids select 'close1', public.close_edition('50000000-0000-4000-8000-000000711001', 'p711-close-key-0001');
select is((select value ->> 'credits_created' from ids where name = 'close1'), '2',
  'two credits: the adult and the minor who were PRESENT with disposition ALLOW in a crediting modality');
select is((select value ->> 'revision' from ids where name = 'close1'), '1', 'the closure is revision 1');
select is(pg_temp.sv($q$ select closure_state from app.edition where edition_id = '50000000-0000-4000-8000-000000711001' $q$),
  'CLOSED', 'closure_state is CLOSED once the credits exist');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where edition_id = '50000000-0000-4000-8000-000000711001'
  and status = 'ACTIVE' and registration_id in ('72000000-0000-4000-8000-000000711101', '72000000-0000-4000-8000-000000711105') $q$),
  '2', 'credits belong to registrations 1 and 5');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where registration_id in (
    '72000000-0000-4000-8000-000000711102', '72000000-0000-4000-8000-000000711103', '72000000-0000-4000-8000-000000711104',
    '72000000-0000-4000-8000-000000711106', '72000000-0000-4000-8000-000000711107') $q$),
  '0', 'no credit for the Guest, the DQ with DENY, the NO_SHOW, the non-crediting modality or the NO_SHOW minor');
select is(pg_temp.sv($q$ select official_distance_snapshot_m || '/' || credited_distance_m || '/' || sport_date || '/' || sport_timezone
  from app.distance_credit where registration_id = '72000000-0000-4000-8000-000000711101' $q$),
  '10000/10000/2026-09-20/America/Monterrey',
  'official modality distance snapshot and the sport date in the Edition timezone (never created_at)');
select is(pg_temp.sv($q$ select (dc.administrative_closure_id = c.administrative_closure_id)::text
  from app.distance_credit dc join app.administrative_closure c on c.edition_id = dc.edition_id and c.status = 'CLOSED'
  where dc.registration_id = '72000000-0000-4000-8000-000000711101' $q$), 'true', 'the credit points at the current closure');
select is(pg_temp.sv($q$ select ranking_epoch::text from app.competition_settings where settings_id = 1 $q$), '2026-09-20',
  'the first competitive credit bootstraps the ranking epoch with its sport date');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event where effect_key like 'DistanceCreditGranted:%'
  and payload ->> 'edition_id' = '50000000-0000-4000-8000-000000711001' $q$), '2', 'one DistanceCreditGranted event per credit');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event where effect_key like 'EditionAdministrativelyClosed:50000000-0000-4000-8000-000000711001:%' $q$),
  '1', 'one EditionAdministrativelyClosed event');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'EDITION_ADMINISTRATIVELY_CLOSED'
  and edition_id = '50000000-0000-4000-8000-000000711001' $q$), '1', 'the closure is audited');

-- ---------------------------------------------------------------------------------------------
-- 5. Exactly once under retry: same key replays; no key or another key is a conflict. Zero extra effects.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'close1b', public.close_edition('50000000-0000-4000-8000-000000711001', 'p711-close-key-0001');
select is((select value from ids where name = 'close1b'), (select value from ids where name = 'close1'),
  'a retry with the same Idempotency-Key replays the stored response verbatim (timeout-safe)');
select is(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000711001') $$) -> 'detail' ->> 'reason',
  'invalid_transition', 'a retry without a key is an invalid transition, not a second close');
select is(pg_temp.err($$ select public.close_edition('50000000-0000-4000-8000-000000711001', 'p711-close-key-0002') $$) ->> 'code',
  'CONFLICT', 'a second close with another key (the loser of a race, re-read under the Edition lock) is a CONFLICT');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where edition_id = '50000000-0000-4000-8000-000000711001' $q$),
  '2', 'after all the retries there are still exactly two credits');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event where effect_key like 'DistanceCreditGranted:%'
  and payload ->> 'edition_id' = '50000000-0000-4000-8000-000000711001' $q$), '2', 'and still two DistanceCreditGranted events');
select is(pg_temp.sv($q$ select count(*) from app.administrative_closure where edition_id = '50000000-0000-4000-8000-000000711001' $q$),
  '1', 'and one closure revision');

-- ---------------------------------------------------------------------------------------------
-- 6. Structural guarantees that hold even if the command were bypassed (service-level writers, future code).
-- ---------------------------------------------------------------------------------------------
reset role;
select throws_ok($$ insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
    attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
    official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone)
  select runner_profile_id, registration_id, edition_id, modality_id, attendance_resolution_id, attendance_finalization_id,
    administrative_closure_id, sporting_eligibility_resolution_id, official_distance_snapshot_m, credited_distance_m,
    sport_date, sport_timezone from app.distance_credit where registration_id = '72000000-0000-4000-8000-000000711101' $$,
  '23505', null, 'a second ACTIVE credit for the same registration is impossible (one effect per registration)');
select throws_ok($$ insert into app.administrative_closure (edition_id, revision, attendance_finalization_id, closed_by_staff_id)
  select edition_id, 9, attendance_finalization_id, closed_by_staff_id from app.administrative_closure
  where edition_id = '50000000-0000-4000-8000-000000711001' $$,
  '23505', null, 'a second current CLOSED closure for the Edition is impossible');
select throws_ok($$ insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
    attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
    official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone)
  select '10000000-0000-4000-8000-000000711101', '72000000-0000-4000-8000-000000711102', edition_id, modality_id,
    attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
    official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone from app.distance_credit
  where registration_id = '72000000-0000-4000-8000-000000711101' $$,
  '23503', null, 'a Guest registration cannot hold a credit (FK pins the credit to a PROFILE registration)');
select throws_ok($$ delete from app.distance_credit $$, null, null, 'a credit can never be deleted');
select hasnt_column('app', 'distance_credit', 'total_km', 'no mutable total_km: the credit ledger is the source of truth');
select is((select count(*)::int from information_schema.columns where table_schema = 'app' and column_name ~ 'total_(km|distance)'),
  0, 'no app table carries a mutable kilometre total');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. ReopenEdition: ADMIN + reason; credits REVERSED (never deleted); closure SUPERSEDED; back to PENDING.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.reopen_edition('50000000-0000-4000-8000-000000711001', 'x') $$) ->> 'code', 'FORBIDDEN',
  'an OPERATOR cannot reopen an Edition');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.reopen_edition('50000000-0000-4000-8000-000000711001', '  ') $$) ->> 'code',
  'VALIDATION_ERROR', 'reopen requires a reason');
insert into ids select 'reopen1', public.reopen_edition('50000000-0000-4000-8000-000000711001', 'Error en la lista de PRESENT',
  'p711-reopen-key-0001');
select is((select value ->> 'reversed_credit_count' from ids where name = 'reopen1'), '2', 'both derived credits were identified and reversed');
select is(pg_temp.sv($q$ select string_agg(status, ',' order by registration_id) from app.distance_credit
  where edition_id = '50000000-0000-4000-8000-000000711001' $q$), 'REVERSED,REVERSED', 'credits are REVERSED, none deleted');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where edition_id = '50000000-0000-4000-8000-000000711001'
  and reversed_by_staff_id = '20000000-0000-4000-8000-000000711001' and reversal_reason = 'Error en la lista de PRESENT' $q$),
  '2', 'each reversal records the actor and the reason');
select is(pg_temp.sv($q$ select status || '/' || reopen_reason from app.administrative_closure
  where edition_id = '50000000-0000-4000-8000-000000711001' $q$), 'SUPERSEDED/Error en la lista de PRESENT',
  'the closure is superseded (not deleted) with the reason');
select is(pg_temp.sv($q$ select closure_state from app.edition where edition_id = '50000000-0000-4000-8000-000000711001' $q$), 'PENDING',
  'closure_state returns to PENDING');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event where effect_key like 'DistanceCreditReversed:%'
  and payload ->> 'edition_id' = '50000000-0000-4000-8000-000000711001' $q$), '2', 'one DistanceCreditReversed event per credit');
select is(pg_temp.sv($q$ select jsonb_array_length(after_snapshot -> 'reversed_distance_credit_ids') from audit.audit_log
  where action = 'EDITION_ADMINISTRATIVE_CLOSURE_REOPENED' and edition_id = '50000000-0000-4000-8000-000000711001' $q$), '2',
  'the audit lists the derived credits it reversed');
insert into ids select 'reopen1b', public.reopen_edition('50000000-0000-4000-8000-000000711001', 'Error en la lista de PRESENT',
  'p711-reopen-key-0001');
select is((select value from ids where name = 'reopen1b'), (select value from ids where name = 'reopen1'), 'a reopen retry replays');
select is(pg_temp.err($$ select public.reopen_edition('50000000-0000-4000-8000-000000711001', 'otra vez') $$) -> 'detail' ->> 'reason',
  'not_closed', 'reopening an Edition that is not closed is refused');

-- ---------------------------------------------------------------------------------------------
-- 8. Correction: reopen attendance, fix registration 1 to NO_SHOW, finalize revision 2, close revision 2.
--    Only registration 5 is credited again; its credit supersedes the reversed one.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.resolve_attendance('72000000-0000-4000-8000-000000711101', 'NO_SHOW', 'x') $$) ->> 'code',
  'CLOSURE_BLOCKED', 'attendance stays locked after ReopenEdition until its finalization is reopened too');
select public.reopen_attendance_finalization('50000000-0000-4000-8000-000000711001', 'Corrección de lista');
insert into ids select 'corr1', public.resolve_attendance('72000000-0000-4000-8000-000000711101', 'NO_SHOW', 'No cruzó meta (video)');
select is((select value ->> 'source' from ids where name = 'corr1'), 'CORRECTION', 'the fix is a CORRECTION revision');
insert into ids select 'fin2', public.finalize_attendance('50000000-0000-4000-8000-000000711001');
select is((select value ->> 'revision' from ids where name = 'fin2'), '2', 'finalization revision 2');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711001", "role": "authenticated"}';
insert into ids select 'close2', public.close_edition('50000000-0000-4000-8000-000000711001', 'p711-close-key-0003');
select is((select value ->> 'credits_created' from ids where name = 'close2'), '1', 'the corrected closure credits only registration 5');
select is((select value ->> 'revision' from ids where name = 'close2'), '2', 'the closure is revision 2');
select is(pg_temp.sv($q$ select string_agg(revision || ':' || status, ',' order by revision) from app.administrative_closure
  where edition_id = '50000000-0000-4000-8000-000000711001' $q$), '1:SUPERSEDED,2:CLOSED', 'closure history is kept');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where registration_id = '72000000-0000-4000-8000-000000711101'
  and status = 'ACTIVE' $q$), '0', 'registration 1 (corrected to NO_SHOW) holds no ACTIVE credit');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where registration_id = '72000000-0000-4000-8000-000000711101'
  and status = 'REVERSED' $q$), '1', 'and keeps its reversed credit as history');
select is(pg_temp.sv($q$ select (n.supersedes_distance_credit_id = o.distance_credit_id)::text || '/' || o.status || '/' || n.status
  from app.distance_credit n join app.distance_credit o on o.registration_id = n.registration_id and o.distance_credit_id <> n.distance_credit_id
  where n.registration_id = '72000000-0000-4000-8000-000000711105' and n.status = 'ACTIVE' $q$), 'true/REVERSED/ACTIVE',
  'the new credit of registration 5 supersedes its reversed predecessor (REVERSED + supersedes chain)');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where edition_id = '50000000-0000-4000-8000-000000711001' $q$),
  '3', 'three credit rows in total: two reversed, one active');
select is(pg_temp.sv($q$ select ranking_epoch::text from app.competition_settings where settings_id = 1 $q$), '2026-09-20',
  'the ranking epoch is never moved silently by a correction');
select is(pg_temp.sv($q$ select (dc.attendance_finalization_id = f.attendance_finalization_id)::text from app.distance_credit dc
  join app.attendance_finalization f on f.edition_id = dc.edition_id and f.status = 'FINALIZED'
  where dc.registration_id = '72000000-0000-4000-8000-000000711105' and dc.status = 'ACTIVE' $q$), 'true',
  'the new credit is based on the new finalization');

reset role;
select throws_ok($$ insert into app.distance_credit (runner_profile_id, registration_id, edition_id, modality_id,
    attendance_resolution_id, attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
    official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone, status, reversed_at, supersedes_distance_credit_id)
  select n.runner_profile_id, n.registration_id, n.edition_id, n.modality_id, n.attendance_resolution_id,
    n.attendance_finalization_id, n.administrative_closure_id, n.sporting_eligibility_resolution_id,
    n.official_distance_snapshot_m, n.credited_distance_m, n.sport_date, n.sport_timezone, 'REVERSED', now(),
    n.supersedes_distance_credit_id from app.distance_credit n
  where n.registration_id = '72000000-0000-4000-8000-000000711105' and n.status = 'ACTIVE' $$,
  '23505', null, 'a reversed credit has at most one successor: the supersedes chain stays linear');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000711001", "role": "authenticated"}';
insert into ids select 'ws3', public.attendance_workspace('50000000-0000-4000-8000-000000711001');
select is((select string_agg(distinct (p ->> 'has_active_credit'), ',') from ids, jsonb_array_elements(value -> 'participants') p
           where name = 'ws3' and p ->> 'registration_id' = '72000000-0000-4000-8000-000000711105'), 'true',
  'the workspace shows the active credit of registration 5');
select is((select value -> 'current_closure' ->> 'revision' from ids where name = 'ws3'), '2', 'the workspace exposes the current closure revision');

select * from finish();
rollback;
