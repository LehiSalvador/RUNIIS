-- T33 GuestParticipant (Master §24-25, §152, §158, §205; SEC-005/010/016).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(46);

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

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000333001', 'people-g-owner@example.test'),
  ('00000000-0000-4000-8000-000000333002', 'people-g-other@example.test'),
  ('00000000-0000-4000-8000-000000333003', 'people-g-staff@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-000000333' || s)::uuid, ('00000000-0000-4000-8000-000000333' || s)::uuid, 'READY', 'ACTIVE',
  'Dueño ' || s, '1985-01-01', 'M', '+528110000001', 'Contacto', '+528110000002', 'Madre', now()
from unnest(array['001', '002']) s;
insert into app.staff_member (staff_member_id, auth_user_id) values
  ('20000000-0000-4000-8000-000000333003', '00000000-0000-4000-8000-000000333003');

-- A past Edition (ended 60 days ago) and a future one, each with a current schedule revision.
insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000333001', event_type_id, 'Evento Invitados', 'evento-invitados-t33'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, registration_close_at,
  city, state_region, country_code, execution_state) values
  ('50000000-0000-4000-8000-000000333001', '40000000-0000-4000-8000-000000333001', 'invitados-pasada', 'Pasada', 'FREE',
   'America/Monterrey', now() - interval '61 days', 'Monterrey', 'NL', 'MX', 'FINISHED'),
  ('50000000-0000-4000-8000-000000333002', '40000000-0000-4000-8000-000000333001', 'invitados-futura', 'Futura', 'FREE',
   'America/Monterrey', now() + interval '20 days', 'Monterrey', 'NL', 'MX', 'SCHEDULED');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone,
  created_by_staff_id) values
  ('50000000-0000-4000-8000-000000333001', 1, 'DATE_TIME_CONFIRMED', current_date - 60, '07:00', 'America/Monterrey',
   '20000000-0000-4000-8000-000000333003'),
  ('50000000-0000-4000-8000-000000333002', 1, 'DATE_TIME_CONFIRMED', current_date + 30, '07:00', 'America/Monterrey',
   '20000000-0000-4000-8000-000000333003');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000333001', '50000000-0000-4000-8000-000000333001', '5k', '5K', 5000, true, 1),
  ('60000000-0000-4000-8000-000000333002', '50000000-0000-4000-8000-000000333002', '5k', '5K', 5000, true, 1);

create temp table ids (name text primary key, value uuid) on commit drop;
grant select, insert on ids to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000333001", "role": "authenticated"}';

-- ---------------------------------------------------------------------------------------------
-- Create (§24 fields, E.164, age >= 15)
-- ---------------------------------------------------------------------------------------------
insert into ids select 'past', (public.create_guest('  Invitado   Pasado ', '1990-02-02', 'M', '+528110000010',
  'Contacto  Uno', '+528110000011', 'Hermano') ->> 'guest_participant_id')::uuid;
insert into ids select 'future', (public.create_guest('Invitado Futuro', '1991-03-03', 'F', '+528110000020',
  'Contacto Dos', '+528110000021', 'Amiga') ->> 'guest_participant_id')::uuid;
insert into ids select 'unused', (public.create_guest('Invitado Sin Uso', '1992-04-04', 'X', '+528110000030',
  'Contacto Tres', '+528110000031', 'Primo', 'guest-key-t33-0001') ->> 'guest_participant_id')::uuid;

select is((select full_name from app.guest_participant where guest_participant_id = (select value from ids where name = 'past')),
  'Invitado Pasado', 'names are trimmed and whitespace-collapsed');
select is((select owner_profile_id from app.guest_participant where guest_participant_id = (select value from ids where name = 'past')),
  '10000000-0000-4000-8000-000000333001'::uuid, '§24 owner is always the caller');
select is((select array_agg(k order by k) from jsonb_object_keys(public.list_my_guests() -> 'items' -> 0) k),
  array['archive_after', 'archived_at', 'created_at', 'date_of_birth', 'emergency_contact_name',
    'emergency_contact_phone_e164', 'emergency_contact_relationship', 'full_name', 'guardian_status',
    'guest_participant_id', 'identity_locked', 'is_minor', 'last_event_end_at', 'phone_e164', 'sex_code', 'status',
    'updated_at'], 'guest projection keys (no owner id)');
select is((public.create_guest('Invitado Sin Uso', '1992-04-04', 'X', '+528110000030', 'Contacto Tres', '+528110000031',
  'Primo', 'guest-key-t33-0001') ->> 'guest_participant_id')::uuid, (select value from ids where name = 'unused'),
  'Idempotency-Key replay returns the original guest');
select is(pg_temp.err($$ select public.create_guest('invitado  pasado', '1990-02-02', 'M', '+528110000010', 'Co', '+528110000011', 'H') $$) -> 'detail',
  jsonb_build_object('reason', 'DUPLICATE_GUEST', 'guest_participant_id', (select value from ids where name = 'past')),
  'a second live guest with the same identity is a CONFLICT naming the owner''s own guest');
select is(pg_temp.err(format('select public.create_guest(%L, %L, %L, %L, %L, %L, %L)', 'Menor Catorce',
  (current_date - interval '15 years' + interval '1 day')::date, 'M', '+528110000040', 'Contacto', '+528110000041', 'Padre')),
  '{"code": "VALIDATION_ERROR", "detail": {"field": "date_of_birth", "reason": "UNDER_MIN_AGE"}}'::jsonb, '§24 a guest under 15 is rejected');
-- Anchor to private.people_today()'s definition (America/Monterrey calendar date), not the
-- session's current_date: near UTC midnight the two dates disagree and the boundary case flips.
select ok((public.create_guest('Menor Quince',
  ((pg_catalog.now() at time zone 'America/Monterrey')::date - interval '15 years')::date, 'F', '+528110000050',
  'Contacto', '+528110000051', 'Madre') ->> 'is_minor')::boolean, '§19 a guest turning 15 today is accepted as a minor');
select is(pg_temp.err(format('select public.create_guest(%L, %L, %L, %L, %L, %L, %L)', 'Futuro Nacido',
  current_date + 1, 'M', '+528110000060', 'Contacto', '+528110000061', 'Padre')) -> 'detail' ->> 'field',
  'date_of_birth', 'a future date of birth is rejected');
select is(pg_temp.err($$ select public.create_guest('Tel Malo', '1990-01-01', 'M', '81 1234 5678', 'C', '+528110000071', 'P') $$) -> 'detail' ->> 'field',
  'phone_e164', 'phones must be E.164');
select is(pg_temp.err($$ select public.create_guest('Sexo Malo', '1990-01-01', 'Z', '+528110000080', 'C', '+528110000081', 'P') $$) -> 'detail' ->> 'field',
  'sex_code', 'sex_code is limited to F/M/X');
select is(pg_temp.err($$ select public.create_guest('Contacto Malo', '1990-01-01', 'M', '+528110000090', 'Co', '+528110000091', repeat('x', 61)) $$) -> 'detail' ->> 'field',
  'emergency_contact_relationship', 'the emergency relationship is at most 60 characters');

-- ---------------------------------------------------------------------------------------------
-- PATCH strict allowlist (SEC-016) and ownership (SEC-010, §205)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'),
  '{"owner_profile_id": "10000000-0000-4000-8000-000000333002"}')),
  '{"code": "VALIDATION_ERROR", "detail": {"field": "owner_profile_id", "reason": "not_allowed"}}'::jsonb, 'SEC-016 owner cannot be changed');
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'), '{"status": "ARCHIVED"}')) -> 'detail' ->> 'field',
  'status', 'SEC-016 status is not writable');
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'),
  '{"phone_e164": "+528110000099", "archive_after": null}')) -> 'detail' ->> 'field', 'archive_after',
  'SEC-016 a forbidden key rejects the whole patch');
select is((select phone_e164 from app.guest_participant where guest_participant_id = (select value from ids where name = 'past')),
  '+528110000010', 'SEC-016 rejected patches leave the row unchanged');
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'), '{"phone_e164": 5281}')) -> 'detail' ->> 'reason',
  'invalid', 'non-string values are rejected');
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'), '{}')) ->> 'code',
  'VALIDATION_ERROR', 'an empty patch is rejected');
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'), '{"date_of_birth": "02/02/1990"}')) -> 'detail' ->> 'field',
  'date_of_birth', 'dates must be ISO YYYY-MM-DD');
select is(public.update_guest((select value from ids where name = 'past'), '{"phone_e164": "+528110000012"}') ->> 'phone_e164',
  '+528110000012', 'an allowed field is updated');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000333002", "role": "authenticated"}';
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'), '{"phone_e164": "+528110000013"}')) ->> 'code',
  'NOT_FOUND', 'SEC-010 another user cannot update the guest');
select is(pg_temp.err(format('select public.archive_guest(%L)', (select value from ids where name = 'past'))) ->> 'code',
  'NOT_FOUND', 'SEC-010 another user cannot archive the guest');
select is(pg_temp.err(format('select public.reactivate_guest(%L)', (select value from ids where name = 'past'))) ->> 'code',
  'NOT_FOUND', 'SEC-010 another user cannot reactivate the guest');
select is(jsonb_array_length(public.list_my_guests() -> 'items'), 0, 'another user lists none of the owner''s guests');
select is_empty($$ select 1 from app.guest_participant where owner_profile_id = '10000000-0000-4000-8000-000000333001' $$,
  '§205 another user cannot read the owner''s guest rows (RLS)');

-- ---------------------------------------------------------------------------------------------
-- Registrations drive identity lock and archive (§25)
-- ---------------------------------------------------------------------------------------------
reset role;
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor, status, confirmed_at) values
  ('70000000-0000-4000-8000-000000333001', 'R-T331-0001', '10000000-0000-4000-8000-000000333001',
   '50000000-0000-4000-8000-000000333001', 'FREE', 'MXN', 0, 'CONFIRMED', now()),
  ('70000000-0000-4000-8000-000000333002', 'R-T331-0002', '10000000-0000-4000-8000-000000333001',
   '50000000-0000-4000-8000-000000333002', 'FREE', 'MXN', 0, 'CONFIRMED', now());
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
select ('71000000-0000-4000-8000-00000033300' || n)::uuid, ('70000000-0000-4000-8000-00000033300' || n)::uuid, 'GUEST',
  (select value from ids where name = g), ('60000000-0000-4000-8000-00000033300' || n)::uuid, 0, 'MXN', '{}'
from (values ('1', 'past'), ('2', 'future')) v(n, g);
insert into app.registration (registration_request_id, request_participant_id, edition_id, modality_id,
  guest_participant_id, buyer_profile_id, registration_number)
select ('70000000-0000-4000-8000-00000033300' || n)::uuid, ('71000000-0000-4000-8000-00000033300' || n)::uuid,
  ('50000000-0000-4000-8000-00000033300' || n)::uuid, ('60000000-0000-4000-8000-00000033300' || n)::uuid,
  (select value from ids where name = g), '10000000-0000-4000-8000-000000333001', 'I-T331-000' || n
from (values ('1', 'past'), ('2', 'future')) v(n, g);

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000333001", "role": "authenticated"}';
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'), '{"full_name": "Otro Nombre"}')),
  '{"code": "BUSINESS_RULE_VIOLATION", "detail": {"reason": "GUEST_IDENTITY_LOCKED", "fields": ["full_name"]}}'::jsonb,
  'name/DOB/sex are frozen once the guest was in a registration request');
select is(public.update_guest((select value from ids where name = 'past'), '{"emergency_contact_name": "Contacto Nuevo"}') ->> 'emergency_contact_name',
  'Contacto Nuevo', 'contact fields stay editable');
select is(pg_temp.err(format('select public.archive_guest(%L)', (select value from ids where name = 'future'))),
  '{"code": "CONFLICT", "detail": {"reason": "GUEST_HAS_FUTURE_PARTICIPATION"}}'::jsonb, '§25 a guest with a future registration is never archived');

reset role;
set local "request.jwt.claims" = '';
select is(private.recompute_guest_archive_after((select value from ids where name = 'past')) ->> 'archive_after',
  to_jsonb(((current_date - 59)::timestamp at time zone 'America/Monterrey') + interval '30 days') #>> '{}',
  '§25 archive_after = 30 days after the effective end of the last related Edition');
select is((private.recompute_guest_archive_after((select value from ids where name = 'future')) -> 'archive_after'), 'null'::jsonb,
  '§25 future participation keeps archive_after NULL');
select is((select jsonb_build_object('processed', (w ->> 'processed')::int >= 2, 'archived', (w ->> 'archived')::int >= 1, 'errors', w -> 'errors')
           from (select private.worker_archive_guests() w) x),
  '{"processed": true, "archived": true, "errors": 0}'::jsonb, '§152 archive-guests worker runs without errors');
select is((select status from app.guest_participant where guest_participant_id = (select value from ids where name = 'past')), 'ARCHIVED',
  '§25 the due guest is ARCHIVED');
select is((select status from app.guest_participant where guest_participant_id = (select value from ids where name = 'future')), 'ACTIVE',
  '§25 the guest with future participation stays ACTIVE');
select is((select status from app.guest_participant where guest_participant_id = (select value from ids where name = 'unused')), 'ACTIVE',
  'a never-used guest is not auto-archived');
select is((select w.status from infra.worker_run w where w.worker_key = 'archive-guests' order by w.started_at desc limit 1), 'SUCCEEDED',
  'the worker run is recorded in infra.worker_run');
select is((select array_agg(k order by k) from infra.outbox_event o, jsonb_object_keys(o.payload) k
           where o.event_type = 'GuestArchived' and o.aggregate_id = (select value from ids where name = 'past')),
  array['archived_at', 'guest_participant_id', 'owner_profile_id'], '§151 GuestArchived carries ids only');
select is((select actor_role from audit.audit_log where action = 'GUEST_ARCHIVED' and entity_id = (select value from ids where name = 'past')),
  'SYSTEM', 'worker archives are audited as SYSTEM');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000333001", "role": "authenticated"}';
select is((select array_agg(i ->> 'guest_participant_id') from jsonb_array_elements(public.list_my_guests('ARCHIVED') -> 'items') i),
  array[(select value from ids where name = 'past')::text], 'archived guests are listed separately');
select ok(not exists (select 1 from jsonb_array_elements(public.list_my_guests() -> 'items') i
  where (i ->> 'guest_participant_id')::uuid = (select value from ids where name = 'past')), 'archived guests are not in the ACTIVE list');
select is(pg_temp.err(format('select public.update_guest(%L, %L)', (select value from ids where name = 'past'), '{"phone_e164": "+528110000014"}')) -> 'detail' ->> 'reason',
  'GUEST_ARCHIVED', 'an archived guest cannot be edited');
select ok((public.reactivate_guest((select value from ids where name = 'past')) ->> 'archive_after')::timestamptz > now() + interval '29 days',
  'reactivation restarts archive_after no earlier than 30 days from now');
select is(public.archive_guest((select value from ids where name = 'unused')) ->> 'status', 'ARCHIVED', 'the owner archives an unused guest');
select is(pg_temp.err($$ select public.create_guest('Invitado Sin Uso', '1992-04-04', 'X', '+528110000030', 'Co', '+528110000031', 'P') $$) -> 'detail' ->> 'reason',
  'DUPLICATE_ARCHIVED_GUEST', 'creating an archived identity again points to the archived guest');
reset role;
insert into app.guest_participant (owner_profile_id, full_name, date_of_birth, sex_code, phone_e164, emergency_contact_name,
  emergency_contact_phone_e164, emergency_contact_relationship)
values ('10000000-0000-4000-8000-000000333001', 'invitado sin uso', '1992-04-04', 'X', '+528110000030', 'C', '+528110000031', 'P');
set local role authenticated;
select is(pg_temp.err(format('select public.reactivate_guest(%L)', (select value from ids where name = 'unused'))),
  '{"code": "CONFLICT", "detail": {"reason": "DUPLICATE_GUEST"}}'::jsonb, 'reactivation conflicts with a live guest of the same identity');

-- ---------------------------------------------------------------------------------------------
-- Scheduling and grants
-- ---------------------------------------------------------------------------------------------
reset role;
select is((select command from cron.job where jobname = 'archive-guests'), 'select private.worker_archive_guests()',
  '§152 archive-guests is scheduled daily with pg_cron');
select ok(not has_function_privilege('authenticated', 'private.worker_archive_guests(integer)', 'execute')
  and not has_function_privilege('service_role', 'private.worker_archive_guests(integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.recompute_guest_archive_after(uuid)', 'execute'),
  'the worker and the recomputation are not callable through the API');
select ok(not has_function_privilege('anon', 'public.create_guest(text, date, text, text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.update_guest(uuid, jsonb)', 'execute'), 'anon cannot execute guest commands');

select * from finish();
rollback;
