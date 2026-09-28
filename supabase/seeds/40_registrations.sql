-- T34 synthetic registration fixtures (local/dev only): a published EXTERNAL_WHATSAPP Edition with three
-- registration requests exercising the three states manual QA needs most: PENDING near expiry,
-- EXPIRED-but-unmaterialised (status still PENDING_CONFIRMATION; expires_at in the past, so the worker or
-- a revalidate call would materialise it), and CONFIRMED with a Friend and a Guest sharing the buyer's
-- request but owning separate passes/credentials (Master §80-84).

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000340001', 'seed-reg-buyer@example.test'),
  ('00000000-0000-4000-8000-000000340002', 'seed-reg-friend@example.test'),
  ('00000000-0000-4000-8000-000000340003', 'seed-reg-staff@example.test')
on conflict (id) do nothing;

insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000340001', '00000000-0000-4000-8000-000000340001', 'READY', 'ACTIVE',
   'Seed Comprador', '1988-04-12', 'M', '+528110004001', 'Contacto Uno', '+528110004002', 'Hermano', now()),
  ('10000000-0000-4000-8000-000000340002', '00000000-0000-4000-8000-000000340002', 'READY', 'ACTIVE',
   'Seed Amiga', '1992-07-03', 'F', '+528110004003', 'Contacto Dos', '+528110004004', 'Pareja', now())
on conflict (runner_profile_id) do nothing;

insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000340001', 'c0000000-0000-4000-8000-000000340001', 'ELIGIBLE', true),
  ('10000000-0000-4000-8000-000000340002', 'c0000000-0000-4000-8000-000000340002', 'ELIGIBLE', true)
on conflict (runner_profile_id) do nothing;

insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000340001', '00000000-0000-4000-8000-000000340003', 'ACTIVE')
on conflict (staff_member_id) do nothing;
insert into app.staff_role_assignment (staff_member_id, role, scope_type)
select '20000000-0000-4000-8000-000000340001', 'OPERATOR', 'GLOBAL'
where not exists (
  select 1 from app.staff_role_assignment
  where staff_member_id = '20000000-0000-4000-8000-000000340001' and role = 'OPERATOR' and revoked_at is null);

insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000340001', '10000000-0000-4000-8000-000000340001', 'Seed Invitado', '1995-02-20',
   'M', '+528110004005', 'Contacto Tres', '+528110004006', 'Amigo')
on conflict (guest_participant_id) do nothing;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000340001', event_type_id, 'Seed Carrera Registro', 'seed-carrera-registro'
from app.event_type where key = 'ROAD_RACE'
on conflict (event_id) do nothing;

insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code,
  whatsapp_phone_e164, published_at) values
  ('50000000-0000-4000-8000-000000340001', '40000000-0000-4000-8000-000000340001', 'seed-carrera-registro-2026',
   'Seed Carrera Registro 2026', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'EXTERNAL_WHATSAPP', 'America/Monterrey',
   now() - interval '5 days', now() + interval '30 days', 'Monterrey', 'NL', 'MX', '+528110000099', now())
on conflict (edition_id) do nothing;

insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000340001', '50000000-0000-4000-8000-000000340001', '10k', '10K', 10000, true, 1)
on conflict (modality_id) do nothing;
insert into app.modality_capacity (modality_id, effective_capacity) values
  ('60000000-0000-4000-8000-000000340001', 500)
on conflict (modality_id) do nothing;
insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency) values
  ('67000000-0000-4000-8000-000000340001', '60000000-0000-4000-8000-000000340001', 'General', 35000, 'MXN')
on conflict (price_offer_id) do nothing;

-- Request 1: PENDING_CONFIRMATION, hold about to expire (manual QA of the countdown/expiry UI).
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor, whatsapp_phone_snapshot, expires_at, created_at) values
  ('70000000-0000-4000-8000-000000340001', 'R-SEED-0001', '10000000-0000-4000-8000-000000340001',
   '50000000-0000-4000-8000-000000340001', 'EXTERNAL_WHATSAPP', 'MXN', 35000, '+528110000099',
   now() + interval '10 minutes', now() - interval '23 hours 50 minutes')
on conflict (registration_request_id) do nothing;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot, created_at) values
  ('71000000-0000-4000-8000-000000340001', '70000000-0000-4000-8000-000000340001', 'PROFILE',
   '10000000-0000-4000-8000-000000340001', '60000000-0000-4000-8000-000000340001', 35000, 'MXN',
   jsonb_build_object('is_minor', false), now() - interval '23 hours 50 minutes')
on conflict (request_participant_id) do nothing;
insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at) values
  ('70000000-0000-4000-8000-000000340001', '60000000-0000-4000-8000-000000340001', 1, now() + interval '10 minutes')
on conflict do nothing;
insert into app.registration_participant_claim (edition_id, registration_request_id, request_participant_id,
  runner_profile_id, expires_at) values
  ('50000000-0000-4000-8000-000000340001', '70000000-0000-4000-8000-000000340001',
   '71000000-0000-4000-8000-000000340001', '10000000-0000-4000-8000-000000340001', now() + interval '10 minutes')
on conflict do nothing;

-- Request 2: EXPIRED-but-unmaterialised (status still PENDING_CONFIRMATION; effective_status is derived from
-- expires_at, Master §63/§72) so revalidate-and-confirm and the worker both have a real row to act on.
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor, whatsapp_phone_snapshot, expires_at, created_at) values
  ('70000000-0000-4000-8000-000000340002', 'R-SEED-0002', '10000000-0000-4000-8000-000000340002',
   '50000000-0000-4000-8000-000000340001', 'EXTERNAL_WHATSAPP', 'MXN', 35000, '+528110000099',
   now() - interval '2 hours', now() - interval '26 hours')
on conflict (registration_request_id) do nothing;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot, created_at) values
  ('71000000-0000-4000-8000-000000340002', '70000000-0000-4000-8000-000000340002', 'PROFILE',
   '10000000-0000-4000-8000-000000340002', '60000000-0000-4000-8000-000000340001', 35000, 'MXN',
   jsonb_build_object('is_minor', false), now() - interval '26 hours')
on conflict (request_participant_id) do nothing;
insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at, created_at) values
  ('70000000-0000-4000-8000-000000340002', '60000000-0000-4000-8000-000000340001', 1, now() - interval '2 hours',
   now() - interval '26 hours')
on conflict do nothing;
insert into app.registration_participant_claim (edition_id, registration_request_id, request_participant_id,
  runner_profile_id, expires_at) values
  ('50000000-0000-4000-8000-000000340001', '70000000-0000-4000-8000-000000340002',
   '71000000-0000-4000-8000-000000340002', '10000000-0000-4000-8000-000000340002', now() - interval '2 hours')
on conflict do nothing;

-- Request 3: CONFIRMED, buyer + Friend, each with their own Registration/ParticipantPass/credential
-- (separate QR ownership, Master §80-84). Guest is added to exercise the buyer-owns-the-GUEST-pass rule.
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  status, registration_mode, currency, total_snapshot_minor, whatsapp_phone_snapshot, expires_at, confirmed_at, created_at) values
  ('70000000-0000-4000-8000-000000340003', 'R-SEED-0003', '10000000-0000-4000-8000-000000340001',
   '50000000-0000-4000-8000-000000340001', 'CONFIRMED', 'EXTERNAL_WHATSAPP', 'MXN', 105000, '+528110000099',
   now() - interval '4 hours', now() - interval '3 hours', now() - interval '5 hours')
on conflict (registration_request_id) do nothing;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot, created_at) values
  ('71000000-0000-4000-8000-000000340003', '70000000-0000-4000-8000-000000340003', 'PROFILE',
   '10000000-0000-4000-8000-000000340001', null, '60000000-0000-4000-8000-000000340001', 35000, 'MXN',
   jsonb_build_object('is_minor', false), now() - interval '5 hours'),
  ('71000000-0000-4000-8000-000000340004', '70000000-0000-4000-8000-000000340003', 'PROFILE',
   '10000000-0000-4000-8000-000000340002', null, '60000000-0000-4000-8000-000000340001', 35000, 'MXN',
   jsonb_build_object('is_minor', false), now() - interval '5 hours' + interval '1 millisecond'),
  ('71000000-0000-4000-8000-000000340005', '70000000-0000-4000-8000-000000340003', 'GUEST',
   null, '30000000-0000-4000-8000-000000340001', '60000000-0000-4000-8000-000000340001', 35000, 'MXN',
   jsonb_build_object('is_minor', false), now() - interval '5 hours' + interval '2 milliseconds')
on conflict (request_participant_id) do nothing;

insert into app.registration_confirmation (registration_request_id, confirmation_method, confirmed_by_staff_id) values
  ('70000000-0000-4000-8000-000000340003', 'EXTERNAL_WHATSAPP', '20000000-0000-4000-8000-000000340001')
on conflict (registration_request_id) do nothing;

insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, guest_participant_id, buyer_profile_id, registration_number, confirmed_at) values
  ('72000000-0000-4000-8000-000000340001', '70000000-0000-4000-8000-000000340003', '71000000-0000-4000-8000-000000340003',
   '50000000-0000-4000-8000-000000340001', '60000000-0000-4000-8000-000000340001',
   '10000000-0000-4000-8000-000000340001', null, '10000000-0000-4000-8000-000000340001', 'I-SEED-0001', now() - interval '3 hours'),
  ('72000000-0000-4000-8000-000000340002', '70000000-0000-4000-8000-000000340003', '71000000-0000-4000-8000-000000340004',
   '50000000-0000-4000-8000-000000340001', '60000000-0000-4000-8000-000000340001',
   '10000000-0000-4000-8000-000000340002', null, '10000000-0000-4000-8000-000000340001', 'I-SEED-0002', now() - interval '3 hours'),
  ('72000000-0000-4000-8000-000000340003', '70000000-0000-4000-8000-000000340003', '71000000-0000-4000-8000-000000340005',
   '50000000-0000-4000-8000-000000340001', '60000000-0000-4000-8000-000000340001',
   null, '30000000-0000-4000-8000-000000340001', '10000000-0000-4000-8000-000000340001', 'I-SEED-0003', now() - interval '3 hours')
on conflict (registration_id) do nothing;

insert into app.participant_pass (participant_pass_id, registration_id, public_code) values
  ('73000000-0000-4000-8000-000000340001', '72000000-0000-4000-8000-000000340001', 'P-SEED-0001'),
  ('73000000-0000-4000-8000-000000340002', '72000000-0000-4000-8000-000000340002', 'P-SEED-0002'),
  ('73000000-0000-4000-8000-000000340003', '72000000-0000-4000-8000-000000340003', 'P-SEED-0003')
on conflict (participant_pass_id) do nothing;

-- Credentials are issued by the SYSTEM (A1), never inline: call POST /api/internal/workers/issue-pending-credentials
-- locally (or render one of the passes above), which populates current_credential_id for these fixtures.
