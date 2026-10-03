-- P3-A synthetic closure fixture (local/dev only, no real PII): one FINISHED Edition with closure still PENDING and
-- eight CONFIRMED registrations in a MIXED attendance state, for the attendance/closure admin UI:
--   1 PRESENT from a check-in     2 PRESENT by manual resolution (reason + evidence)    3 NO_SHOW (manual)
--   4 no row yet (the workspace GET initializes it to PENDING)   5 no row yet (PENDING)   6 EXCLUDED
--   7 PRESENT but DISQUALIFIED with a PENDING credit disposition (blocks finalization until decided)
--   8 a GUEST, PRESENT (Guests never earn a DistanceCredit)
-- Runs after 10_auth_users.sql (the seeded admin/operator/checkin staff) and the other seeds (lexical order).
-- Direct inserts: seeds run outside an authenticated session. Finalize/close are deliberately NOT done here so the
-- UI can walk the whole flow: resolve 4, 5 and the 7 disposition, finalize, then close as ADMIN.

insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid, format('seed-closure-runner-%s@example.test', i)
from generate_series(1, 7) i
on conflict (id) do nothing;

insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name, date_of_birth,
  sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid,
  ('00000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid, 'READY', 'ACTIVE',
  (array['Cierre Ana', 'Cierre Beto', 'Cierre Carla', 'Cierre Dani', 'Cierre Eli', 'Cierre Fer', 'Cierre Gus'])[i],
  date '1991-05-05', case when i % 2 = 0 then 'M' else 'F' end, '+52811000700' || i, 'Contacto', '+52811000710' || i, 'Hermano', now()
from generate_series(1, 7) i
on conflict (runner_profile_id) do nothing;

insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
  emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
values ('30000000-0000-4000-8000-000000700008', '10000000-0000-4000-8000-000000700001', 'Cierre Invitado', date '1993-03-03', 'M',
  '+528110007008', 'Contacto', '+528110007018', 'Amigo')
on conflict (guest_participant_id) do nothing;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000700001', event_type_id, 'RUNIIS Demo Cierre', 'runiis-demo-cierre'
from app.event_type where key = 'ROAD_RACE'
on conflict (event_id) do nothing;

insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, closure_state,
  registration_mode, timezone, registration_close_at, city, state_region, country_code, published_at)
values ('50000000-0000-4000-8000-000000700001', '40000000-0000-4000-8000-000000700001', 'demo-cierre-10k', 'RUNIIS Demo Cierre 10K',
  'PUBLISHED', 'FINISHED', 'CLOSED', 'PENDING', 'FREE', 'America/Monterrey', now() - interval '20 days', 'Monterrey', 'NL', 'MX',
  now() - interval '40 days')
on conflict (edition_id) do nothing;
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone, created_by_staff_id)
select '50000000-0000-4000-8000-000000700001', 1, 'DATE_TIME_CONFIRMED', (current_date - 14), time '07:00', 'America/Monterrey',
  '20000000-0000-4000-8000-000000200001'
where not exists (select 1 from app.edition_schedule_revision where edition_id = '50000000-0000-4000-8000-000000700001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order)
values ('60000000-0000-4000-8000-000000700001', '50000000-0000-4000-8000-000000700001', '10k', '10K', 10000, true, 1)
on conflict (modality_id) do nothing;

insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, registration_mode,
  currency, total_snapshot_minor)
select ('70000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid, 'R-7000-A00' || i,
  ('10000000-0000-4000-8000-0000007000' || lpad((case when i = 8 then 1 else i end)::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000700001', 'FREE', 'MXN', 0
from generate_series(1, 7) i
on conflict (registration_request_id) do nothing;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, runner_profile_id,
  guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
select ('71000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000007000' || lpad((case when i = 8 then 1 else i end)::text, 2, '0'))::uuid,
  case when i = 8 then 'GUEST' else 'PROFILE' end,
  case when i = 8 then null else ('10000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid end,
  case when i = 8 then '30000000-0000-4000-8000-000000700008'::uuid end,
  '60000000-0000-4000-8000-000000700001', 0, 'MXN', '{}'
from generate_series(1, 8) i
on conflict (request_participant_id) do nothing;
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, guest_participant_id, buyer_profile_id, registration_number)
select ('72000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000007000' || lpad((case when i = 8 then 1 else i end)::text, 2, '0'))::uuid,
  ('71000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000700001', '60000000-0000-4000-8000-000000700001',
  case when i = 8 then null else ('10000000-0000-4000-8000-0000007000' || lpad(i::text, 2, '0'))::uuid end,
  case when i = 8 then '30000000-0000-4000-8000-000000700008'::uuid end,
  ('10000000-0000-4000-8000-0000007000' || lpad((case when i = 8 then 1 else i end)::text, 2, '0'))::uuid,
  'I-7000-A00' || i
from generate_series(1, 8) i
on conflict (registration_id) do nothing;

-- Registration 1 was scanned at the start line (evidence), registration 2 is resolved by hand with evidence.
insert into app.attendance_checkin (attendance_checkin_id, edition_id, registration_id, verification_method, checked_in_by_staff_id)
values ('90000000-0000-4000-8000-000000700001', '50000000-0000-4000-8000-000000700001', '72000000-0000-4000-8000-000000700001',
  'QR_SCAN', '20000000-0000-4000-8000-000000200003')
on conflict (attendance_checkin_id) do nothing;
insert into app.attendance_resolution (edition_id, registration_id, revision, status, source, checkin_id, reason, evidence_metadata,
  resolved_by_staff_id)
select '50000000-0000-4000-8000-000000700001', ('72000000-0000-4000-8000-0000007000' || lpad(v.n::text, 2, '0'))::uuid, 1,
  v.status, v.source, v.checkin_id, v.reason, v.evidence::jsonb, v.staff
from (values
  (1, 'PRESENT', 'CHECKIN', '90000000-0000-4000-8000-000000700001'::uuid, null::text, '{}', null::uuid),
  (2, 'PRESENT', 'MANUAL', null::uuid, 'Vista en meta por juez de ruta', '{"kind": "judge_note", "station": "meta"}',
    '20000000-0000-4000-8000-000000200002'::uuid),
  (3, 'NO_SHOW', 'MANUAL', null::uuid, 'No se presentó a la salida', '{}', '20000000-0000-4000-8000-000000200002'::uuid),
  (6, 'EXCLUDED', 'MANUAL', null::uuid, 'Inscripción duplicada detectada en mesa', '{}', '20000000-0000-4000-8000-000000200002'::uuid),
  (7, 'PRESENT', 'MANUAL', null::uuid, 'Presente según juez', '{"kind": "judge_note"}', '20000000-0000-4000-8000-000000200002'::uuid),
  (8, 'PRESENT', 'MANUAL', null::uuid, 'Presente (invitado)', '{"kind": "judge_note"}', '20000000-0000-4000-8000-000000200002'::uuid)
) v(n, status, source, checkin_id, reason, evidence, staff)
where not exists (select 1 from app.attendance_resolution x
                  where x.registration_id = ('72000000-0000-4000-8000-0000007000' || lpad(v.n::text, 2, '0'))::uuid);

-- Registration 7: disqualified, kilometres still undecided (PENDING blocks finalization until staff choose ALLOW/DENY).
insert into app.sporting_eligibility_resolution (registration_id, revision, status, distance_credit_disposition, reason_code, reason,
  resolved_by_staff_id)
select '72000000-0000-4000-8000-000000700007', 1, 'DISQUALIFIED', 'PENDING', 'CUT_COURSE', 'Atajo en el kilómetro 7 reportado por juez',
  '20000000-0000-4000-8000-000000200002'
where not exists (select 1 from app.sporting_eligibility_resolution where registration_id = '72000000-0000-4000-8000-000000700007');
