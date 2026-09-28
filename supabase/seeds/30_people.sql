-- T33 synthetic people fixtures (local/dev only): an accepted friendship, a pending friendship
-- request, an adult Guest, a minor Guest with a PENDING GuardianAssignment and a minor
-- RunnerProfile with an ACTIVE GuardianAssignment (Master §19-25, ADR-001 A10).

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000330001', 'seed-people-a@example.test'),
  ('00000000-0000-4000-8000-000000330002', 'seed-people-b@example.test'),
  ('00000000-0000-4000-8000-000000330003', 'seed-people-c@example.test'),
  ('00000000-0000-4000-8000-000000330004', 'seed-people-minor@example.test')
on conflict (id) do nothing;

-- A, B, C are adults; the minor RunnerProfile stays comfortably under 18 across dev sessions.
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000330001', '00000000-0000-4000-8000-000000330001', 'READY', 'ACTIVE',
   'Seed Persona A', '1988-04-12', 'F', '+528110003001', 'Contacto Uno', '+528110003002', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000330002', '00000000-0000-4000-8000-000000330002', 'READY', 'ACTIVE',
   'Seed Persona B', '1990-06-20', 'M', '+528110003003', 'Contacto Dos', '+528110003004', 'Pareja', now()),
  ('10000000-0000-4000-8000-000000330003', '00000000-0000-4000-8000-000000330003', 'READY', 'ACTIVE',
   'Seed Persona C', '1995-11-02', 'X', '+528110003005', 'Contacto Tres', '+528110003006', 'Amigo', now())
on conflict (runner_profile_id) do nothing;
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select '10000000-0000-4000-8000-000000330004', '00000000-0000-4000-8000-000000330004', 'READY', 'ACTIVE',
  'Seed Persona Menor', (current_date - interval '16 years' - interval '30 days')::date, 'F', '+528110003007',
  'Seed Persona A', '+528110003001', 'Madre', now()
where not exists (select 1 from app.runner_profile where runner_profile_id = '10000000-0000-4000-8000-000000330004');

insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible, is_searchable) values
  ('10000000-0000-4000-8000-000000330001', 'c0000000-0000-4000-8000-000000330001', 'ELIGIBLE', true, true),
  ('10000000-0000-4000-8000-000000330002', 'c0000000-0000-4000-8000-000000330002', 'ELIGIBLE', true, true),
  ('10000000-0000-4000-8000-000000330003', 'c0000000-0000-4000-8000-000000330003', 'ELIGIBLE', true, true),
  -- A10: minors are never searchable, regardless of the visible/searchable flags.
  ('10000000-0000-4000-8000-000000330004', 'c0000000-0000-4000-8000-000000330004', 'MINOR_NONCOMPETITIVE', true, false)
on conflict (runner_profile_id) do nothing;

-- A <-> B: accepted friendship. A -> C: still pending.
insert into app.friendship (requester_profile_id, addressee_profile_id, status, responded_at)
select '10000000-0000-4000-8000-000000330001', '10000000-0000-4000-8000-000000330002', 'ACCEPTED', now()
where not exists (
  select 1 from app.friendship
  where least(requester_profile_id, addressee_profile_id) = least('10000000-0000-4000-8000-000000330001'::uuid, '10000000-0000-4000-8000-000000330002'::uuid)
    and greatest(requester_profile_id, addressee_profile_id) = greatest('10000000-0000-4000-8000-000000330001'::uuid, '10000000-0000-4000-8000-000000330002'::uuid));
insert into app.friendship (requester_profile_id, addressee_profile_id, status)
select '10000000-0000-4000-8000-000000330001', '10000000-0000-4000-8000-000000330003', 'PENDING'
where not exists (
  select 1 from app.friendship
  where least(requester_profile_id, addressee_profile_id) = least('10000000-0000-4000-8000-000000330001'::uuid, '10000000-0000-4000-8000-000000330003'::uuid)
    and greatest(requester_profile_id, addressee_profile_id) = greatest('10000000-0000-4000-8000-000000330001'::uuid, '10000000-0000-4000-8000-000000330003'::uuid));

-- A's Guests: one adult, one minor (guardian assignment below).
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000330001', '10000000-0000-4000-8000-000000330001', 'Seed Invitado Adulto',
   '1985-09-15', 'M', '+528110003008', 'Contacto Cuatro', '+528110003009', 'Primo')
on conflict (guest_participant_id) do nothing;
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
select '30000000-0000-4000-8000-000000330002', '10000000-0000-4000-8000-000000330001', 'Seed Invitado Menor',
  (current_date - interval '15 years' - interval '30 days')::date, 'F', '+528110003010', 'Seed Persona A',
  '+528110003001', 'Madre'
where not exists (select 1 from app.guest_participant where guest_participant_id = '30000000-0000-4000-8000-000000330002');

-- Minor RunnerProfile D, guardian A: requested by the minor, already confirmed (ACTIVE).
insert into app.guardian_assignment (minor_runner_profile_id, guardian_profile_id, relationship_type, status,
  requested_by_profile_id, activated_at)
select '10000000-0000-4000-8000-000000330004', '10000000-0000-4000-8000-000000330001', 'PARENT', 'ACTIVE',
  '10000000-0000-4000-8000-000000330004', now()
where not exists (
  select 1 from app.guardian_assignment
  where minor_runner_profile_id = '10000000-0000-4000-8000-000000330004'
    and guardian_profile_id = '10000000-0000-4000-8000-000000330001' and status <> 'REVOKED');

-- Minor Guest, guardian B: opened by the owner (A), awaiting B's in-app confirmation (PENDING).
insert into app.guardian_assignment (minor_guest_participant_id, guardian_profile_id, relationship_type, status,
  requested_by_profile_id)
select '30000000-0000-4000-8000-000000330002', '10000000-0000-4000-8000-000000330002', 'LEGAL_GUARDIAN', 'PENDING',
  '10000000-0000-4000-8000-000000330001'
where not exists (
  select 1 from app.guardian_assignment
  where minor_guest_participant_id = '30000000-0000-4000-8000-000000330002'
    and guardian_profile_id = '10000000-0000-4000-8000-000000330002' and status <> 'REVOKED');
