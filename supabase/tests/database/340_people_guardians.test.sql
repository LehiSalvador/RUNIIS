-- T33 GuardianAssignment (Master §19-20, §158, §205; ADR-001 A10; SEC-010/014/120).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(40);

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
create function pg_temp.as_user(p_suffix text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000334' || p_suffix, 'role', 'authenticated')::text, true)
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- 001 A adult, 002 B adult, 003 M minor 16, 004 N minor 17, 005 U unrelated adult, 006 O guest owner,
-- 007 F friend of O, 008 Z not a friend of O, 009 X banned adult, 010 S admin, 011 P operator.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000334' || s)::uuid, 'people-gd-' || s || '@example.test'
from unnest(array['001','002','003','004','005','006','007','008','009','010','011']) s;
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-000000334' || s)::uuid, ('00000000-0000-4000-8000-000000334' || s)::uuid, 'READY', st,
  'Persona ' || s, dob, 'F', '+528110000001', 'Contacto', '+528110000002', 'Madre', now()
from (values ('001', 'ACTIVE', date '1980-01-01'), ('002', 'ACTIVE', date '1981-01-01'),
             ('003', 'ACTIVE', (current_date - interval '16 years')::date), ('004', 'ACTIVE', (current_date - interval '17 years')::date),
             ('005', 'ACTIVE', date '1982-01-01'), ('006', 'ACTIVE', date '1983-01-01'), ('007', 'ACTIVE', date '1984-01-01'),
             ('008', 'ACTIVE', date '1985-01-01'), ('009', 'BANNED', date '1986-01-01'), ('010', 'ACTIVE', date '1987-01-01'),
             ('011', 'ACTIVE', date '1988-01-01')) v(s, st, dob);
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_searchable)
select ('10000000-0000-4000-8000-000000334' || s)::uuid, ('c0000000-0000-4000-8000-000000334' || s)::uuid,
  case when s in ('003', '004') then 'MINOR_NONCOMPETITIVE' else 'ELIGIBLE' end, s not in ('003', '004')
from unnest(array['001','002','003','004','005','006','007','008','009','010','011']) s;
insert into app.friendship (requester_profile_id, addressee_profile_id, status, responded_at) values
  ('10000000-0000-4000-8000-000000334006', '10000000-0000-4000-8000-000000334007', 'ACCEPTED', now());
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000334001', '10000000-0000-4000-8000-000000334006', 'Invitado Menor',
   (current_date - interval '16 years')::date, 'M', '+528110000003', 'Contacto', '+528110000004', 'Padre'),
  ('30000000-0000-4000-8000-000000334002', '10000000-0000-4000-8000-000000334006', 'Invitado Adulto',
   '1990-01-01', 'F', '+528110000005', 'Contacto', '+528110000006', 'Madre');
insert into app.staff_member (staff_member_id, auth_user_id) values
  ('20000000-0000-4000-8000-000000334010', '00000000-0000-4000-8000-000000334010'),
  ('20000000-0000-4000-8000-000000334011', '00000000-0000-4000-8000-000000334011');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000334010', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000334011', 'OPERATOR', 'GLOBAL');

create temp table ids (name text primary key, value uuid) on commit drop;
grant select, insert on ids to authenticated;
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Minor RunnerProfile opened by the minor: the guardian confirms (A10)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user('003');
insert into ids select 'ma', (public.request_runner_guardianship('c0000000-0000-4000-8000-000000334001', 'PARENT') ->> 'guardian_assignment_id')::uuid;
select is((select status from app.guardian_assignment where guardian_assignment_id = (select value from ids where name = 'ma')), 'PENDING',
  '§20 a new assignment starts PENDING');
select is(pg_temp.err(format('select public.confirm_guardian_assignment(%L)', (select value from ids where name = 'ma'))),
  '{"code": "FORBIDDEN", "detail": {"reason": "AWAITING_COUNTERPART"}}'::jsonb, 'A10 the opener cannot confirm their own request');
select is(pg_temp.err($$ select public.request_runner_guardianship('c0000000-0000-4000-8000-000000334004', 'PARENT') $$) -> 'detail' ->> 'reason',
  'GUARDIAN_NOT_ADULT', '§19 the guardian must be an adult');
select is(pg_temp.err($$ select public.request_runner_guardianship('c0000000-0000-4000-8000-000000334009', 'PARENT') $$) ->> 'code',
  'NOT_FOUND', '§121 a banned adult cannot be a guardian (no oracle)');
select is(pg_temp.err($$ select public.request_runner_guardianship('c0000000-0000-4000-8000-000000334003', 'PARENT') $$) -> 'detail' ->> 'reason',
  'SELF_GUARDIAN', 'a minor cannot be their own guardian');
select is(pg_temp.err($$ select public.request_runner_guardianship('c0000000-0000-4000-8000-000000334002', 'COACH') $$),
  '{"code": "VALIDATION_ERROR", "detail": {"field": "relationship_type", "reason": "invalid"}}'::jsonb, 'relationship_type is limited to the value set');

select pg_temp.as_user('005');
select is(pg_temp.err(format('select public.confirm_guardian_assignment(%L)', (select value from ids where name = 'ma'))) ->> 'code',
  'NOT_FOUND', 'SEC-010 an unrelated adult cannot confirm');
select is(public.list_my_guardian_assignments(), '[]'::jsonb, 'SEC-014 an unrelated adult sees nothing');

select pg_temp.as_user('001');
select is(public.list_my_guardian_assignments() -> 0 ->> 'awaiting_confirmation_by', 'ME', 'the guardian sees the pending request as theirs to confirm');
select is((select array_agg(k order by k) from jsonb_object_keys(public.list_my_guardian_assignments() -> 0 -> 'minor') k),
  array['avatar_object_key', 'display_name', 'public_profile_id'], 'SEC-014 the guardian sees only the minor''s public card');
select is(public.confirm_guardian_assignment((select value from ids where name = 'ma')) ->> 'status', 'ACTIVE',
  'A10 ACTIVE after the other party confirms in-app');
select is(public.confirm_guardian_assignment((select value from ids where name = 'ma')) ->> 'status', 'ACTIVE', 'confirming twice is a no-op');
select pg_temp.as_user('003');
select is(pg_temp.err($$ select public.request_runner_guardianship('c0000000-0000-4000-8000-000000334001', 'PARENT') $$),
  jsonb_build_object('code', 'CONFLICT', 'detail', jsonb_build_object('reason', 'ASSIGNMENT_EXISTS',
    'guardian_assignment_id', (select value from ids where name = 'ma'))), 'one live assignment per minor and guardian');

-- ---------------------------------------------------------------------------------------------
-- Minor RunnerProfile opened by the adult: the minor confirms (A10, SEC-014)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user('002');
insert into ids select 'bn', (public.request_runner_guardianship('c0000000-0000-4000-8000-000000334004', 'LEGAL_GUARDIAN') ->> 'guardian_assignment_id')::uuid;
select is(pg_temp.err(format('select public.confirm_guardian_assignment(%L)', (select value from ids where name = 'bn'))) -> 'detail' ->> 'reason',
  'AWAITING_COUNTERPART', 'SEC-014 an adult-opened assignment is not ACTIVE until the minor accepts');
select is(pg_temp.err($$ select public.request_runner_guardianship('c0000000-0000-4000-8000-000000334001', 'PARENT') $$) -> 'detail' ->> 'reason',
  'COUNTERPART_NOT_MINOR', 'an adult can only open an assignment for a minor');
select pg_temp.as_user('004');
select is(public.confirm_guardian_assignment((select value from ids where name = 'bn')) ->> 'status', 'ACTIVE', 'A10 the minor accepts');

select pg_temp.as_user('005');
insert into ids select 'um', (public.request_runner_guardianship('c0000000-0000-4000-8000-000000334003', 'PARENT') ->> 'guardian_assignment_id')::uuid;
select ok(public.list_my_guardian_assignments()::text !~ '(date_of_birth|phone|emergency|\+52811)',
  'SEC-014 an unrelated adult with a PENDING offer gets no minor PII');
select pg_temp.as_user('003');
select is(public.revoke_guardian_assignment((select value from ids where name = 'um')) ->> 'status', 'REVOKED', 'the minor declines by revoking');
select pg_temp.as_user('005');
select is(pg_temp.err(format('select public.confirm_guardian_assignment(%L)', (select value from ids where name = 'um'))) -> 'detail' ->> 'reason',
  'ASSIGNMENT_REVOKED', 'a revoked assignment cannot be confirmed');
select is(pg_temp.err(format('select public.revoke_guardian_assignment(%L)', (select value from ids where name = 'bn'))) ->> 'code',
  'NOT_FOUND', 'SEC-010 a third party cannot revoke');
select is_empty($$ select 1 from app.guardian_assignment where guardian_profile_id <> '10000000-0000-4000-8000-000000334005' $$,
  '§205 a user reads only assignments they are party to (RLS)');

-- ---------------------------------------------------------------------------------------------
-- Minor Guest: owner guardian ACTIVE at once; Friend guardian confirms (§24)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user('006');
select is(public.assign_guest_guardian('30000000-0000-4000-8000-000000334001', 'PARENT') ->> 'status', 'ACTIVE',
  '§24 the owner as guardian is ACTIVE at once');
insert into ids select 'gf', (public.assign_guest_guardian('30000000-0000-4000-8000-000000334001', 'LEGAL_GUARDIAN',
  'c0000000-0000-4000-8000-000000334007') ->> 'guardian_assignment_id')::uuid;
select is((select status from app.guardian_assignment where guardian_assignment_id = (select value from ids where name = 'gf')), 'PENDING',
  '§24 an adult Friend as guardian starts PENDING');
select is(pg_temp.err(format('select public.confirm_guardian_assignment(%L)', (select value from ids where name = 'gf'))) -> 'detail' ->> 'reason',
  'AWAITING_COUNTERPART', 'the owner cannot confirm on the Friend''s behalf');
select is(pg_temp.err($$ select public.assign_guest_guardian('30000000-0000-4000-8000-000000334001', 'PARENT', 'c0000000-0000-4000-8000-000000334008') $$) -> 'detail' ->> 'reason',
  'GUARDIAN_NOT_FRIEND', 'a non-Friend cannot be designated');
select is(pg_temp.err($$ select public.assign_guest_guardian('30000000-0000-4000-8000-000000334002', 'PARENT') $$) -> 'detail' ->> 'reason',
  'GUEST_NOT_MINOR', 'adult guests need no guardian');
select is((public.list_my_guests() -> 'items' -> 1 ->> 'guardian_status'), 'ACTIVE', 'the guest projection reports the ACTIVE guardian');
select pg_temp.as_user('007');
select is((select jsonb_build_object('minor', a -> 'minor', 'has_owner', a -> 'guest_owner' ? 'public_profile_id')
           from jsonb_array_elements(public.list_my_guardian_assignments()) a),
  '{"minor": {"full_name": "Invitado Menor", "guest_participant_id": null}, "has_owner": true}'::jsonb,
  'the Friend guardian sees the guest name and the owner card only');
select is(public.confirm_guardian_assignment((select value from ids where name = 'gf')) ->> 'status', 'ACTIVE', '§24 the Friend confirms');
select pg_temp.as_user('002');
select is(pg_temp.err($$ select public.assign_guest_guardian('30000000-0000-4000-8000-000000334001', 'PARENT') $$) ->> 'code',
  'NOT_FOUND', 'SEC-010 another user cannot assign a guardian to someone else''s guest');

-- ---------------------------------------------------------------------------------------------
-- Revocation: either party or staff (§20)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user('001');
select is(public.revoke_guardian_assignment((select value from ids where name = 'ma')) ->> 'status', 'REVOKED', 'the guardian revokes');
select is(public.revoke_guardian_assignment((select value from ids where name = 'ma')) ->> 'status', 'REVOKED', 'revoking twice is a no-op');
select pg_temp.as_user('011');
select is(pg_temp.err(format('select public.staff_revoke_guardian_assignment(%L, %L)', (select value from ids where name = 'bn'), 'Revisión')) ->> 'code',
  'FORBIDDEN', 'OPERATOR cannot revoke guardian assignments');
select pg_temp.as_user('010');
select is(pg_temp.err(format('select public.staff_revoke_guardian_assignment(%L, %L)', (select value from ids where name = 'bn'), ' ')) -> 'detail' ->> 'field',
  'reason', 'staff revocation requires a reason');
select is(public.staff_revoke_guardian_assignment((select value from ids where name = 'bn'), 'Documento inválido') ->> 'status', 'REVOKED',
  'ADMIN revokes with a reason');
reset role;
select is((select reason from audit.audit_log where action = 'GUARDIAN_ASSIGNMENT_REVOKED' and entity_id = (select value from ids where name = 'bn')),
  'Documento inválido', 'the staff reason is audited');
select is((select actor_role from audit.audit_log where action = 'GUARDIAN_ASSIGNMENT_REVOKED' and entity_id = (select value from ids where name = 'bn')),
  'ADMIN', 'the staff revocation is attributed to the ADMIN role');
select is((select array_agg(action order by action) from audit.audit_log where entity_id = (select value from ids where name = 'ma')),
  array['GUARDIAN_ASSIGNMENT_ACTIVATED', 'GUARDIAN_ASSIGNMENT_REQUESTED', 'GUARDIAN_ASSIGNMENT_REVOKED'], 'each transition is audited once');
select is((select requested_by_profile_id from app.guardian_assignment where guardian_assignment_id = (select value from ids where name = 'bn')),
  '10000000-0000-4000-8000-000000334002'::uuid, 'the opener is recorded');
select ok(not has_function_privilege('anon', 'public.request_runner_guardianship(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.list_my_guardian_assignments(boolean)', 'execute'), 'anon cannot execute guardian functions');

select * from finish();
rollback;
