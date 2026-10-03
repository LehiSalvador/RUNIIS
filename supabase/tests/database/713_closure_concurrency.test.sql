-- P3-A real concurrency (Master §97, §220 "closure retry safe"; ADR-001 §3 lock order). Three separate
-- sessions (dblink) run the commands at the same time against COMMITTED rows, with the Edition row lock held
-- by a fourth session so that both contenders are provably blocked on it before it is released:
--   A. two ADMINs closing the same Edition with different Idempotency-Keys -> one closure, one set of credits,
--      the loser gets CONFLICT;
--   B. the same ADMIN retrying the same key concurrently (client timeout + retry) -> both calls return the
--      same stored response, one effect;
--   C. two OPERATORs cancelling the same registration -> one cancellation, one event, the loser gets
--      CONFLICT (invalid transition).
-- The rest of the closure suite is transactional (711, 712); this file is the only one that commits, so it
-- purges every row it created (pre-clean at the start as well, in case a previous run was interrupted) and
-- restores the ranking epoch. Local Supabase only: dblink connects with the local stack's default database
-- credentials, which is also why the file lives under supabase/tests (never run against a remote project).
create extension if not exists pgtap with schema extensions;
create temp table p713_dblink as select exists (select 1 from pg_extension where extname = 'dblink') as had_it;
create extension if not exists dblink with schema extensions;
set search_path = extensions, public;

select plan(23);

create function pg_temp.u(p_prefix text, p_tail text) returns uuid language sql immutable as $$
  select (p_prefix || '-0000-4000-8000-' || lpad(p_tail, 12, '0'))::uuid $$;

-- Removes everything this file creates. Immutable-history triggers are bypassed with the replica role, which is
-- why this only ever runs against the local test database.
create function pg_temp.purge() returns void language plpgsql as $$
declare
  v_editions uuid[] := array[pg_temp.u('50000000', '71301'), pg_temp.u('50000000', '71302'), pg_temp.u('50000000', '71303')];
  v_registrations uuid[];
  v_users uuid[];
begin
  set local session_replication_role = replica;
  select coalesce(array_agg(r.registration_id), '{}') into v_registrations from app.registration r where r.edition_id = any (v_editions);
  select coalesce(array_agg(id), '{}') into v_users from auth.users where email like 'p713-%@example.test';

  delete from audit.audit_log where edition_id = any (v_editions) or entity_id = any (v_registrations);
  delete from infra.outbox_event where payload ->> 'edition_id' = any (select e::text from unnest(v_editions) e);
  delete from infra.idempotency_record where actor_auth_user_id = any (v_users);
  delete from app.distance_credit where edition_id = any (v_editions);
  delete from app.administrative_closure where edition_id = any (v_editions);
  delete from app.attendance_finalization where edition_id = any (v_editions);
  delete from app.attendance_resolution where edition_id = any (v_editions);
  delete from app.sporting_eligibility_resolution where registration_id = any (v_registrations);
  delete from app.participant_pass where registration_id = any (v_registrations);
  delete from app.registration_revision where registration_id = any (v_registrations);
  delete from app.registration where edition_id = any (v_editions);
  delete from app.registration_request_participant where registration_request_id in (
    select registration_request_id from app.registration_request where edition_id = any (v_editions));
  delete from app.registration_request where edition_id = any (v_editions);
  delete from app.modality where edition_id = any (v_editions);
  delete from app.edition_schedule_revision where edition_id = any (v_editions);
  delete from app.edition where edition_id = any (v_editions);
  delete from app.event where event_id = pg_temp.u('40000000', '71301');
  delete from app.staff_role_assignment where staff_member_id in (select staff_member_id from app.staff_member where auth_user_id = any (v_users));
  delete from app.staff_member where auth_user_id = any (v_users);
  delete from app.runner_profile where auth_user_id = any (v_users);
  delete from auth.users where id = any (v_users);
  -- The only global side effect of a closure: the ranking epoch this file's credits bootstrapped.
  update app.competition_settings set ranking_epoch = null, ranking_epoch_frozen_at = null
  where settings_id = 1 and ranking_epoch = date '2031-03-15';
end $$;

-- Staff, runners and one Edition: n = 1, 2 are FINISHED with two runners attended and finalized (ready to close);
-- n = 3 is SCHEDULED with one CONFIRMED registration (to cancel).
create function pg_temp.mk_people() returns void language plpgsql as $$
begin
  insert into auth.users (id, email) select pg_temp.u('00000000', t), 'p713-' || t || '@example.test'
  from unnest(array['713901', '713902', '713903', '713904', '713111', '713112', '713113']) t;
  insert into app.staff_member (staff_member_id, auth_user_id, status)
  select pg_temp.u('20000000', t), pg_temp.u('00000000', t), 'ACTIVE' from unnest(array['713901', '713902', '713903', '713904']) t;
  insert into app.staff_role_assignment (staff_member_id, role, scope_type)
  select pg_temp.u('20000000', t), r, 'GLOBAL' from (values ('713901', 'ADMIN'), ('713902', 'ADMIN'), ('713903', 'OPERATOR'), ('713904', 'OPERATOR')) v(t, r);
  insert into app.runner_profile (runner_profile_id, auth_user_id, full_name, date_of_birth)
  select pg_temp.u('10000000', t), pg_temp.u('00000000', t), 'Runner ' || t, date '1990-01-01' from unnest(array['713111', '713112', '713113']) t;
  insert into app.event (event_id, event_type_id, name, canonical_key)
  select pg_temp.u('40000000', '71301'), event_type_id, 'Concurrency Event', 'p713-concurrency-event' from app.event_type where key = 'ROAD_RACE';
end $$;

create function pg_temp.mk_edition(p_n int, p_runners text[]) returns void language plpgsql as $$
declare
  v_ed uuid := pg_temp.u('50000000', '7130' || p_n);
  v_mod uuid := pg_temp.u('60000000', '7130' || p_n);
  v_runner text;
  v_i int := 0;
begin
  insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state,
    registration_state, closure_state, registration_close_at, city, state_region, country_code)
  values (v_ed, pg_temp.u('40000000', '71301'), 'p713-concurrency-' || p_n, 'Concurrency ' || p_n, 'FREE', 'America/Monterrey',
    case when p_n < 3 then 'FINISHED' else 'SCHEDULED' end, case when p_n < 3 then 'CLOSED' else 'OPEN' end,
    case when p_n < 3 then 'PENDING' else 'OPEN' end, now() + interval '30 days', 'Monterrey', 'NL', 'MX');
  insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone, created_by_staff_id)
  values (v_ed, 1, 'DATE_TIME_CONFIRMED', date '2031-03-15', time '07:00', 'America/Monterrey', pg_temp.u('20000000', '713901'));
  insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order)
  values (v_mod, v_ed, '10k', '10K', 10000, true, 1);
  foreach v_runner in array p_runners loop
    v_i := v_i + 1;
    insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, registration_mode, currency, total_snapshot_minor)
    values (pg_temp.u('70000000', '7130' || p_n || v_i), 'R-713' || p_n || '-AAA' || v_i, pg_temp.u('10000000', v_runner), v_ed, 'FREE', 'MXN', 0);
    insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, runner_profile_id,
      modality_id, price_snapshot_minor, currency, eligibility_snapshot)
    values (pg_temp.u('71000000', '7130' || p_n || v_i), pg_temp.u('70000000', '7130' || p_n || v_i), 'PROFILE',
      pg_temp.u('10000000', v_runner), v_mod, 0, 'MXN', '{}');
    insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
      runner_profile_id, buyer_profile_id, registration_number)
    values (pg_temp.u('72000000', '7130' || p_n || v_i), pg_temp.u('70000000', '7130' || p_n || v_i),
      pg_temp.u('71000000', '7130' || p_n || v_i), v_ed, v_mod, pg_temp.u('10000000', v_runner), pg_temp.u('10000000', v_runner),
      'I-713' || p_n || '-AAA' || v_i);
  end loop;
end $$;

-- Runs one statement as an authenticated staff member in THIS session (the setup phase; the race uses dblink).
create function pg_temp.as_staff(p_sub text, p_sql text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u('00000000', p_sub), 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql;
  reset role;
end $$;

-- Two statements started at the same time in two sessions, with the Edition row lock held by a third session until
-- BOTH are blocked behind it (so the overlap is proven, not hoped for). Returns each session's outcome.
create function pg_temp.race(p_edition uuid, p_sub_a text, p_sql_a text, p_sub_b text, p_sql_b text) returns jsonb language plpgsql as $$
declare
  v_conn text := format('host=%s port=%s dbname=%s user=postgres password=postgres',
    coalesce(host(inet_server_addr()), '127.0.0.1'), current_setting('port'), current_database());
  v_pid_a int; v_pid_b int; v_waiting int := 0; v_tries int := 0;
  v_a jsonb; v_b jsonb; v_blocked boolean := false;
begin
  perform extensions.dblink_connect('p713_hold', v_conn);
  perform extensions.dblink_connect('p713_a', v_conn);
  perform extensions.dblink_connect('p713_b', v_conn);
  perform extensions.dblink_exec('p713_hold', 'begin');
  perform 1 from extensions.dblink('p713_hold', format('select 1 from app.edition where edition_id = %L for update', p_edition)) as t(x int);

  perform extensions.dblink_exec('p713_a', 'set role authenticated');
  perform extensions.dblink_exec('p713_a', format('set "request.jwt.claims" = %L',
    jsonb_build_object('sub', pg_temp.u('00000000', p_sub_a), 'role', 'authenticated')::text));
  perform extensions.dblink_exec('p713_b', 'set role authenticated');
  perform extensions.dblink_exec('p713_b', format('set "request.jwt.claims" = %L',
    jsonb_build_object('sub', pg_temp.u('00000000', p_sub_b), 'role', 'authenticated')::text));
  select p into v_pid_a from extensions.dblink('p713_a', 'select pg_backend_pid()') as t(p int);
  select p into v_pid_b from extensions.dblink('p713_b', 'select pg_backend_pid()') as t(p int);

  perform extensions.dblink_send_query('p713_a', p_sql_a);
  perform extensions.dblink_send_query('p713_b', p_sql_b);

  while v_tries < 150 loop
    perform pg_stat_clear_snapshot();
    select count(*) into v_waiting from pg_stat_activity where pid in (v_pid_a, v_pid_b) and wait_event_type = 'Lock';
    exit when v_waiting = 2;
    perform pg_sleep(0.1);
    v_tries := v_tries + 1;
  end loop;
  v_blocked := v_waiting = 2;

  perform extensions.dblink_exec('p713_hold', 'commit');

  begin
    select r into v_a from extensions.dblink_get_result('p713_a', false) as t(r jsonb);
    v_a := case when v_a is not null then jsonb_build_object('ok', true, 'body', v_a)
      else jsonb_build_object('ok', false, 'error', extensions.dblink_error_message('p713_a')) end;
    perform 1 from extensions.dblink_get_result('p713_a', false) as t(r jsonb);
    select r into v_b from extensions.dblink_get_result('p713_b', false) as t(r jsonb);
    v_b := case when v_b is not null then jsonb_build_object('ok', true, 'body', v_b)
      else jsonb_build_object('ok', false, 'error', extensions.dblink_error_message('p713_b')) end;
    perform 1 from extensions.dblink_get_result('p713_b', false) as t(r jsonb);
  exception when others then
    perform extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c where c like 'p713_%';
    raise;
  end;
  perform extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c where c like 'p713_%';
  return jsonb_build_object('a', v_a, 'b', v_b, 'both_blocked_on_the_lock', v_blocked);
exception when others then
  begin
    perform extensions.dblink_exec('p713_hold', 'rollback');
  exception when others then null;
  end;
  perform extensions.dblink_disconnect(c) from unnest(coalesce(extensions.dblink_get_connections(), '{}')) c where c like 'p713_%';
  raise;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Setup (committed). A leftover from an interrupted run is purged first.
-- ---------------------------------------------------------------------------------------------
select pg_temp.purge();
create temp table p713_epoch as select ranking_epoch, ranking_epoch_frozen_at from app.competition_settings where settings_id = 1;
update app.competition_settings set ranking_epoch = null, ranking_epoch_frozen_at = null where settings_id = 1;
select pg_temp.mk_people();
select pg_temp.mk_edition(1, array['713111', '713112']);
select pg_temp.mk_edition(2, array['713111', '713112']);
select pg_temp.mk_edition(3, array['713113']);
-- Attendance resolved and finalized for the two FINISHED Editions through the real commands.
do $$
declare n int; i int;
begin
  for n in 1..2 loop
    for i in 1..2 loop
      perform pg_temp.as_staff('713903', format($f$ select public.resolve_attendance(%L, 'PRESENT', 'Presente', '{"kind": "judge_note"}') $f$,
        pg_temp.u('72000000', '7130' || n || i)));
    end loop;
    perform pg_temp.as_staff('713903', format($f$ select public.finalize_attendance(%L) $f$, pg_temp.u('50000000', '7130' || n)));
  end loop;
end $$;
select is((select count(*)::int from app.attendance_finalization where edition_id in
  (pg_temp.u('50000000', '71301'), pg_temp.u('50000000', '71302')) and status = 'FINALIZED'), 2, 'setup: both Editions are finalized and ready to close');

-- ---------------------------------------------------------------------------------------------
-- A. Two ADMINs close the same Edition at the same time with different keys.
-- ---------------------------------------------------------------------------------------------
create temp table race_result (name text primary key, value jsonb);
insert into race_result select 'A', pg_temp.race(pg_temp.u('50000000', '71301'),
  '713901', format($f$ select public.close_edition(%L, 'p713-race-key-A1') $f$, pg_temp.u('50000000', '71301')),
  '713902', format($f$ select public.close_edition(%L, 'p713-race-key-B1') $f$, pg_temp.u('50000000', '71301')));
select ok((select (value ->> 'both_blocked_on_the_lock')::boolean from race_result where name = 'A'),
  'A: both closers were blocked behind the Edition lock before it was released (a real overlap)');
select is((select ((value -> 'a' ->> 'ok')::boolean)::int + ((value -> 'b' ->> 'ok')::boolean)::int from race_result where name = 'A'), 1,
  'A: exactly one of the two concurrent closes succeeded');
select ok((select coalesce(value -> 'a' ->> 'error', value -> 'b' ->> 'error') like '%CONFLICT%' from race_result where name = 'A'),
  'A: the loser re-read the Edition under the lock and got CONFLICT');
select is((select count(*)::int from app.distance_credit where edition_id = pg_temp.u('50000000', '71301')), 2,
  'A: two credits in total (one per eligible registration), not four');
select is((select count(*)::int from app.distance_credit where edition_id = pg_temp.u('50000000', '71301') and status = 'ACTIVE'), 2,
  'A: both credits are ACTIVE');
select is((select count(*)::int from app.administrative_closure where edition_id = pg_temp.u('50000000', '71301')), 1,
  'A: one closure revision');
select is((select closure_state from app.edition where edition_id = pg_temp.u('50000000', '71301')), 'CLOSED', 'A: the Edition is CLOSED');
select is((select count(*)::int from infra.outbox_event where effect_key like 'DistanceCreditGranted:%'
  and payload ->> 'edition_id' = pg_temp.u('50000000', '71301')::text), 2, 'A: one DistanceCreditGranted event per credit');
select is((select count(*)::int from infra.outbox_event where effect_key like 'EditionAdministrativelyClosed:' || pg_temp.u('50000000', '71301')::text || ':%'), 1,
  'A: one EditionAdministrativelyClosed event');
select is((select count(*)::int from audit.audit_log where action = 'EDITION_ADMINISTRATIVELY_CLOSED' and edition_id = pg_temp.u('50000000', '71301')), 1,
  'A: one audit entry');

-- ---------------------------------------------------------------------------------------------
-- B. The same ADMIN, the same Idempotency-Key, twice at once (a timeout and its retry).
-- ---------------------------------------------------------------------------------------------
insert into race_result select 'B', pg_temp.race(pg_temp.u('50000000', '71302'),
  '713901', format($f$ select public.close_edition(%L, 'p713-race-key-SAME') $f$, pg_temp.u('50000000', '71302')),
  '713901', format($f$ select public.close_edition(%L, 'p713-race-key-SAME') $f$, pg_temp.u('50000000', '71302')));
select ok((select (value ->> 'both_blocked_on_the_lock')::boolean from race_result where name = 'B'), 'B: both attempts were blocked at the same time');
select ok((select (value -> 'a' ->> 'ok')::boolean and (value -> 'b' ->> 'ok')::boolean from race_result where name = 'B'),
  'B: both attempts return success (the retry replays instead of failing)');
select is((select value -> 'a' -> 'body' from race_result where name = 'B'), (select value -> 'b' -> 'body' from race_result where name = 'B'),
  'B: both attempts return the identical stored response');
select is((select count(*)::int from app.distance_credit where edition_id = pg_temp.u('50000000', '71302')), 2, 'B: still exactly two credits');
select is((select count(*)::int from app.administrative_closure where edition_id = pg_temp.u('50000000', '71302')), 1, 'B: one closure revision');
select is((select count(*)::int from infra.outbox_event where effect_key like 'DistanceCreditGranted:%'
  and payload ->> 'edition_id' = pg_temp.u('50000000', '71302')::text), 2, 'B: two DistanceCreditGranted events, not four');

-- ---------------------------------------------------------------------------------------------
-- C. Two OPERATORs cancel the same registration at the same time.
-- ---------------------------------------------------------------------------------------------
insert into race_result select 'C', pg_temp.race(pg_temp.u('50000000', '71303'),
  '713903', format($f$ select public.cancel_registration(%L, 'Cancelación A', 'ADMINISTRATIVE', 'p713-cancel-key-A1') $f$, pg_temp.u('72000000', '713031')),
  '713904', format($f$ select public.cancel_registration(%L, 'Cancelación B', 'ADMINISTRATIVE', 'p713-cancel-key-B1') $f$, pg_temp.u('72000000', '713031')));
select ok((select (value ->> 'both_blocked_on_the_lock')::boolean from race_result where name = 'C'), 'C: both cancellations were blocked at the same time');
select is((select ((value -> 'a' ->> 'ok')::boolean)::int + ((value -> 'b' ->> 'ok')::boolean)::int from race_result where name = 'C'), 1,
  'C: exactly one cancellation succeeded');
select ok((select coalesce(value -> 'a' ->> 'error', value -> 'b' ->> 'error') like '%CONFLICT%' from race_result where name = 'C'),
  'C: the loser got CONFLICT (invalid transition)');
select is((select count(*)::int from infra.outbox_event where effect_key like 'RegistrationCanceled:' || pg_temp.u('72000000', '713031')::text || '%'), 1,
  'C: one RegistrationCanceled event');
select is((select count(*)::int from audit.audit_log where action = 'REGISTRATION_CANCELED' and entity_id = pg_temp.u('72000000', '713031')), 1,
  'C: one audit entry');

-- ---------------------------------------------------------------------------------------------
-- Cleanup: every row created above, and the ranking epoch back to what it was.
-- ---------------------------------------------------------------------------------------------
select pg_temp.purge();
update app.competition_settings s set ranking_epoch = e.ranking_epoch, ranking_epoch_frozen_at = e.ranking_epoch_frozen_at
from p713_epoch e where s.settings_id = 1;
select is((select count(*)::int from app.edition where slug like 'p713-concurrency-%'), 0, 'cleanup: no fixture Edition is left behind');
-- dblink is only a tool of this file: leave the database the way it was found.
do $$ begin
  if not (select had_it from p713_dblink) then drop extension dblink; end if;
end $$;

select * from finish();
