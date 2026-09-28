-- T33 participant inclusion inputs for T34 (Master §19, §24, §65 participant rows, §121; SEC-015/120).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(24);

create function pg_temp.check(p_edition text, p_kind text, p_profile text, p_guest text) returns jsonb language sql as $$
  select private.participant_inclusion_check(p_edition::uuid, p_kind,
    case when p_profile is not null then ('10000000-0000-4000-8000-000000335' || p_profile)::uuid end,
    case when p_guest is not null then ('30000000-0000-4000-8000-000000335' || p_guest)::uuid end,
    '10000000-0000-4000-8000-000000335001')
$$;

-- 001 buyer A, 002 friend F, 003 non-friend N, 004 banned friend, 005 locked friend, 006 minor friend with
-- guardian, 007 minor friend without guardian, 008 minor friend whose guardian is banned, 009 banned adult,
-- 010 friend turning 18 before the event, 011 other buyer, 012 staff.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000335' || s)::uuid, 'people-in-' || s || '@example.test'
from unnest(array['001','002','003','004','005','006','007','008','009','010','011','012']) s;
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-000000335' || s)::uuid, ('00000000-0000-4000-8000-000000335' || s)::uuid, 'READY', st,
  'Persona ' || s, dob, 'F', '+528110000001', 'Contacto', '+528110000002', 'Madre', now()
from (values ('001', 'ACTIVE', date '1980-01-01'), ('002', 'ACTIVE', date '1981-01-01'), ('003', 'ACTIVE', date '1982-01-01'),
             ('004', 'BANNED', date '1983-01-01'), ('005', 'IDENTITY_LOCKED', date '1984-01-01'),
             ('006', 'ACTIVE', (current_date - interval '16 years')::date), ('007', 'ACTIVE', (current_date - interval '16 years')::date),
             ('008', 'ACTIVE', (current_date - interval '16 years')::date), ('009', 'BANNED', date '1985-01-01'),
             ('010', 'ACTIVE', (current_date - interval '18 years' + interval '10 days')::date),
             ('011', 'ACTIVE', date '1986-01-01'), ('012', 'ACTIVE', date '1987-01-01')) v(s, st, dob);
insert into app.friendship (requester_profile_id, addressee_profile_id, status, responded_at)
select '10000000-0000-4000-8000-000000335001', ('10000000-0000-4000-8000-000000335' || s)::uuid, 'ACCEPTED', now()
from unnest(array['002', '004', '005', '006', '007', '008', '010']) s;
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, status, archived_at)
select ('30000000-0000-4000-8000-000000335' || s)::uuid, ('10000000-0000-4000-8000-000000335' || o)::uuid, 'Invitado ' || s, dob,
  'M', '+528110000003', 'Contacto', '+528110000004', 'Padre', st, case when st = 'ARCHIVED' then now() end
from (values ('001', '001', date '1990-01-01', 'ACTIVE'), ('002', '001', (current_date - interval '16 years')::date, 'ACTIVE'),
             ('003', '001', (current_date - interval '16 years')::date, 'ACTIVE'), ('004', '001', date '1991-01-01', 'ARCHIVED'),
             ('005', '011', date '1992-01-01', 'ACTIVE'),
             ('006', '001', (current_date - interval '15 years' + interval '10 days')::date, 'ACTIVE')) v(s, o, dob, st);
insert into app.guardian_assignment (guardian_assignment_id, minor_runner_profile_id, minor_guest_participant_id,
  guardian_profile_id, relationship_type, status, activated_at) values
  ('80000000-0000-4000-8000-000000335001', '10000000-0000-4000-8000-000000335006', null, '10000000-0000-4000-8000-000000335001', 'PARENT', 'ACTIVE', now()),
  ('80000000-0000-4000-8000-000000335002', '10000000-0000-4000-8000-000000335008', null, '10000000-0000-4000-8000-000000335009', 'PARENT', 'ACTIVE', now()),
  ('80000000-0000-4000-8000-000000335003', null, '30000000-0000-4000-8000-000000335002', '10000000-0000-4000-8000-000000335001', 'PARENT', 'ACTIVE', now()),
  ('80000000-0000-4000-8000-000000335004', null, '30000000-0000-4000-8000-000000335006', '10000000-0000-4000-8000-000000335001', 'PARENT', 'ACTIVE', now()),
  ('80000000-0000-4000-8000-000000335005', '10000000-0000-4000-8000-000000335007', null, '10000000-0000-4000-8000-000000335002', 'PARENT', 'PENDING', null);

insert into app.staff_member (staff_member_id, auth_user_id) values
  ('20000000-0000-4000-8000-000000335012', '00000000-0000-4000-8000-000000335012');
insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000335001', event_type_id, 'Evento Inclusion', 'evento-inclusion-t33'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, registration_close_at,
  city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000335001', '40000000-0000-4000-8000-000000335001', 'inclusion-fechada', 'Fechada', 'FREE',
   'America/Monterrey', now() + interval '20 days', 'Monterrey', 'NL', 'MX'),
  ('50000000-0000-4000-8000-000000335002', '40000000-0000-4000-8000-000000335001', 'inclusion-sin-fecha', 'Sin fecha', 'FREE',
   'America/Monterrey', now() + interval '20 days', 'Monterrey', 'NL', 'MX');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, timezone, created_by_staff_id)
values ('50000000-0000-4000-8000-000000335001', 1, 'DATE_CONFIRMED_TIME_PENDING', current_date + 30, 'America/Monterrey',
        '20000000-0000-4000-8000-000000335012');

-- Profiles (§65: READY, ACTIVE, not banned/locked, buyer or ACCEPTED Friend; minors need an ACTIVE guardian)
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '001', null) - 'event_date',
  '{"eligible": true, "reasons": [], "client_reasons": [], "participant_kind": "PROFILE", "is_minor": false, "age_at_event": 46, "age_basis": "EVENT_DATE", "guardian_assignment_id": null}'::jsonb
    || jsonb_build_object('age_at_event', private.people_age_years('1980-01-01', current_date + 30)),
  '§65 the buyer can include themselves');
select ok((pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '002', null) ->> 'eligible')::boolean,
  '§65 an ACCEPTED Friend is eligible');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '003', null) -> 'reasons', '["NOT_SELF_OR_FRIEND"]'::jsonb,
  'SEC-015 a non-Friend is not eligible');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '004', null) -> 'reasons', '["ACCOUNT_BANNED"]'::jsonb,
  '§121 a banned Friend cannot be added by another buyer');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '004', null) -> 'client_reasons', '["PARTICIPANT_UNAVAILABLE"]'::jsonb,
  '§121 the buyer is not told why a Friend is unavailable');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '005', null) -> 'reasons', '["IDENTITY_LOCKED"]'::jsonb,
  'an identity-locked Friend is not eligible');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '006', null) -> 'guardian_assignment_id',
  '"80000000-0000-4000-8000-000000335001"'::jsonb, '§19 a minor Friend with an ACTIVE guardian returns that assignment');
select ok((pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '006', null) ->> 'eligible')::boolean
  and (pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '006', null) ->> 'is_minor')::boolean,
  '§19 ... and is eligible as a minor');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '007', null) -> 'reasons', '["GUARDIAN_REQUIRED"]'::jsonb,
  '§19 a PENDING guardian does not count');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '008', null) -> 'reasons', '["GUARDIAN_REQUIRED"]'::jsonb,
  '§19 a banned guardian does not count');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '010', null) -> 'is_minor', 'false'::jsonb,
  '§19 age is evaluated at the Edition date (18 by then)');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '0ff', null) -> 'client_reasons', '["PARTICIPANT_UNAVAILABLE"]'::jsonb,
  'an unknown profile is unavailable');

-- Guests (§65: owner = buyer, ACTIVE, age allowed, guardian when minor)
select ok((pg_temp.check('50000000-0000-4000-8000-000000335001', 'GUEST', null, '001') ->> 'eligible')::boolean, '§65 an ACTIVE adult guest is eligible');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'GUEST', null, '002') -> 'guardian_assignment_id',
  '"80000000-0000-4000-8000-000000335003"'::jsonb, '§24 a minor guest with an ACTIVE guardian is eligible');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'GUEST', null, '003') -> 'reasons', '["GUARDIAN_REQUIRED"]'::jsonb,
  '§24 a minor guest without guardian is not eligible');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'GUEST', null, '004') -> 'reasons', '["GUEST_ARCHIVED"]'::jsonb,
  '§25 an ARCHIVED guest is not offered for inclusion');
select is(pg_temp.check('50000000-0000-4000-8000-000000335001', 'GUEST', null, '005') -> 'reasons', '["PARTICIPANT_NOT_FOUND"]'::jsonb,
  'SEC-010 another buyer''s guest is NOT_FOUND');
select ok((pg_temp.check('50000000-0000-4000-8000-000000335001', 'GUEST', null, '006') ->> 'eligible')::boolean,
  '§19 a guest who is 15 on the Edition date is eligible with a guardian');
select is(pg_temp.check('50000000-0000-4000-8000-000000335002', 'GUEST', null, '006') -> 'reasons', '["UNDER_MIN_AGE"]'::jsonb,
  'an undated Edition evaluates age today');
select is(pg_temp.check('50000000-0000-4000-8000-000000335002', 'GUEST', null, '006') ->> 'age_basis', 'TODAY', 'age_basis reports TODAY');

-- Misuse and defaults
select is(pg_temp.check('50000000-0000-4000-8000-0000003350ff', 'GUEST', null, '001') -> 'reasons', '["EDITION_NOT_FOUND"]'::jsonb,
  'an unknown Edition is reported');
select throws_ok($$ select pg_temp.check('50000000-0000-4000-8000-000000335001', 'GUEST', '001', '001') $$, 'P0001', 'VALIDATION_ERROR',
  'exactly one participant id matching the kind is required');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000335001", "role": "authenticated"}';
select is(private.participant_inclusion_check('50000000-0000-4000-8000-000000335001', 'PROFILE', '10000000-0000-4000-8000-000000335002', null),
  pg_temp.check('50000000-0000-4000-8000-000000335001', 'PROFILE', '002', null), 'the buyer defaults to the caller');
select ok(not has_function_privilege('authenticated', 'private.participant_inclusion_check(uuid, text, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'private.participant_inclusion_check(uuid, text, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.participant_inclusion_check(uuid, text, uuid, uuid, uuid)', 'execute'),
  'the inclusion check is internal (no API grant)');

select * from finish();
rollback;
