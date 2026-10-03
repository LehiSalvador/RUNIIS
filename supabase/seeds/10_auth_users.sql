-- T20 synthetic dev identities (local/test-only, no real PII): usable end-to-end with OTP via
-- Mailpit (POST /api/v1/auth/otp with the email below, read the code at http://127.0.0.1:54624).
-- Runs before 30_people.sql/40_registrations.sql (lexical order), so nothing here depends on their
-- fixtures; other seeds may build on these accounts.
--
-- admin/operator/checkin/moderator are GLOBAL-scoped: no Edition exists yet at this point in seed
-- order (Editions are seeded later by other tasks), so an Edition-scoped assignment isn't available
-- here. A real deployment scopes OPERATOR/CHECKIN per Edition; GLOBAL keeps these accounts directly
-- useful for manual QA without an ordering dependency on another task's seed file.

-- GoTrue only finds an account whose instance_id is its own zero UUID (and whose aud/role are
-- 'authenticated'). A bare (id, email) row has them NULL, so Auth cannot see it: admin generateLink /
-- signInWithOtp then tries to CREATE the same email and fails with "Database error saving new user"
-- (unique violation users_email_partial_key); a NULL created_at breaks its user scan the same way. The
-- rows below carry the columns Auth itself writes, so they can sign in through OTP; the upsert also
-- heals a database seeded before this fix.
insert into auth.users (id, email, instance_id, aud, role, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
select v.id, v.email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('sub', v.id, 'email', v.email, 'email_verified', true, 'phone_verified', false),
  now(), now(), '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000200001'::uuid, 'admin@runiis.test'),
  ('00000000-0000-4000-8000-000000200002'::uuid, 'operator@runiis.test'),
  ('00000000-0000-4000-8000-000000200003'::uuid, 'checkin@runiis.test'),
  ('00000000-0000-4000-8000-000000200004'::uuid, 'moderator@runiis.test'),
  ('00000000-0000-4000-8000-000000200005'::uuid, 'runner.a@runiis.test'),
  ('00000000-0000-4000-8000-000000200006'::uuid, 'runner.b@runiis.test'),
  ('00000000-0000-4000-8000-000000200007'::uuid, 'minor@runiis.test')) v(id, email)
on conflict (id) do update set
  instance_id = coalesce(auth.users.instance_id, excluded.instance_id),
  aud = coalesce(auth.users.aud, excluded.aud),
  role = coalesce(auth.users.role, excluded.role),
  email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
  raw_app_meta_data = coalesce(auth.users.raw_app_meta_data, excluded.raw_app_meta_data),
  raw_user_meta_data = coalesce(auth.users.raw_user_meta_data, excluded.raw_user_meta_data),
  created_at = coalesce(auth.users.created_at, excluded.created_at),
  updated_at = coalesce(auth.users.updated_at, excluded.updated_at),
  confirmation_token = coalesce(auth.users.confirmation_token, excluded.confirmation_token),
  recovery_token = coalesce(auth.users.recovery_token, excluded.recovery_token),
  email_change = coalesce(auth.users.email_change, excluded.email_change),
  email_change_token_new = coalesce(auth.users.email_change_token_new, excluded.email_change_token_new);

-- READY + ACTIVE profiles for everyone except the minor (handled separately below): staff accounts
-- also get a runner_profile so they can exercise the self-service flows, not just admin ones.
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000200001', '00000000-0000-4000-8000-000000200001', 'READY', 'ACTIVE',
   'Seed Admin', '1985-01-15', 'X', '+528110002001', 'Contacto Admin', '+528110002002', 'Amigo', now()),
  ('10000000-0000-4000-8000-000000200002', '00000000-0000-4000-8000-000000200002', 'READY', 'ACTIVE',
   'Seed Operador', '1988-03-22', 'M', '+528110002003', 'Contacto Operador', '+528110002004', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000200003', '00000000-0000-4000-8000-000000200003', 'READY', 'ACTIVE',
   'Seed Check-in', '1991-07-09', 'F', '+528110002005', 'Contacto Checkin', '+528110002006', 'Madre', now()),
  ('10000000-0000-4000-8000-000000200004', '00000000-0000-4000-8000-000000200004', 'READY', 'ACTIVE',
   'Seed Moderador', '1983-11-30', 'M', '+528110002007', 'Contacto Moderador', '+528110002008', 'Padre', now()),
  ('10000000-0000-4000-8000-000000200005', '00000000-0000-4000-8000-000000200005', 'READY', 'ACTIVE',
   'Seed Runner A', '1994-05-18', 'F', '+528110002009', 'Contacto A', '+528110002010', 'Pareja', now()),
  ('10000000-0000-4000-8000-000000200006', '00000000-0000-4000-8000-000000200006', 'READY', 'ACTIVE',
   'Seed Runner B', '1996-09-02', 'M', '+528110002011', 'Contacto B', '+528110002012', 'Hermana', now())
on conflict (runner_profile_id) do nothing;

-- The minor stays 15-17 across dev sessions (Master §16: 15-17 -> MINOR_NONCOMPETITIVE, never searchable).
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select '10000000-0000-4000-8000-000000200007', '00000000-0000-4000-8000-000000200007', 'READY', 'ACTIVE',
  'Seed Runner Menor', (current_date - interval '16 years' - interval '30 days')::date, 'X', '+528110002013',
  'Seed Runner A', '+528110002009', 'Madre', now()
where not exists (select 1 from app.runner_profile where runner_profile_id = '10000000-0000-4000-8000-000000200007');

insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible, is_searchable) values
  ('10000000-0000-4000-8000-000000200001', 'c0000000-0000-4000-8000-000000200001', 'ELIGIBLE', true, true),
  ('10000000-0000-4000-8000-000000200002', 'c0000000-0000-4000-8000-000000200002', 'ELIGIBLE', true, true),
  ('10000000-0000-4000-8000-000000200003', 'c0000000-0000-4000-8000-000000200003', 'ELIGIBLE', true, true),
  ('10000000-0000-4000-8000-000000200004', 'c0000000-0000-4000-8000-000000200004', 'ELIGIBLE', true, true),
  ('10000000-0000-4000-8000-000000200005', 'c0000000-0000-4000-8000-000000200005', 'ELIGIBLE', true, true),
  ('10000000-0000-4000-8000-000000200006', 'c0000000-0000-4000-8000-000000200006', 'ELIGIBLE', true, true),
  -- A10: minors are never searchable, regardless of the visible/searchable flags.
  ('10000000-0000-4000-8000-000000200007', 'c0000000-0000-4000-8000-000000200007', 'MINOR_NONCOMPETITIVE', true, false)
on conflict (runner_profile_id) do nothing;

insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000200001', '00000000-0000-4000-8000-000000200001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000200002', '00000000-0000-4000-8000-000000200002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000200003', '00000000-0000-4000-8000-000000200003', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000200004', '00000000-0000-4000-8000-000000200004', 'ACTIVE')
on conflict (staff_member_id) do nothing;

insert into app.staff_role_assignment (staff_member_id, role, scope_type)
select v.staff_member_id, v.role, 'GLOBAL'
from (values
  ('20000000-0000-4000-8000-000000200001'::uuid, 'ADMIN'),
  ('20000000-0000-4000-8000-000000200002'::uuid, 'OPERATOR'),
  ('20000000-0000-4000-8000-000000200003'::uuid, 'CHECKIN'),
  ('20000000-0000-4000-8000-000000200004'::uuid, 'MODERATOR')) v(staff_member_id, role)
where not exists (
  select 1 from app.staff_role_assignment sra
  where sra.staff_member_id = v.staff_member_id and sra.role = v.role and sra.revoked_at is null);
