-- T30 kernel (Master §29-31, §35-38, §100): price resolution + tie-breakers, schedule/effective_start,
-- availability (holds vs SOLD_OUT, global vs modality caps, LOW threshold, expired holds ignored) and
-- publication/registration readiness. Synthetic ids: events/editions 6..2000x, modalities 61..2000x.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(33);

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000002001', event_type_id, 'Kernel Test Event', 'kernel-test-event'
from app.event_type where key = 'ROAD_RACE';

-- Edition A: FREE, used for price + schedule + readiness (kept DRAFT / incomplete on purpose).
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, registration_close_at,
  city, state_region, country_code, global_capacity) values
  ('50000000-0000-4000-8000-000000002001', '40000000-0000-4000-8000-000000002001', 'kernel-free', 'Kernel Free',
   'FREE', 'America/Monterrey', now() + interval '30 days', 'Monterrey', 'Nuevo León', 'MX', null);
-- Edition B: EXTERNAL_WHATSAPP, price tie-breakers + availability caps.
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, registration_close_at,
  city, state_region, country_code, global_capacity, whatsapp_phone_e164) values
  ('50000000-0000-4000-8000-000000002002', '40000000-0000-4000-8000-000000002001', 'kernel-paid', 'Kernel Paid',
   'EXTERNAL_WHATSAPP', 'America/Monterrey', now() + interval '30 days', 'Monterrey', 'Nuevo León', 'MX', 10,
   '+528110000099');

insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit,
  local_start_time, status, sort_order) values
  ('60000000-0000-4000-8000-000000002001', '50000000-0000-4000-8000-000000002001', 'free-5k', '5K Libre', 5000, true,
   '07:00:00', 'ACTIVE', 1),
  ('60000000-0000-4000-8000-000000002002', '50000000-0000-4000-8000-000000002002', 'paid-10k', '10K Pago', 10000, true,
   null, 'ACTIVE', 1),
  ('60000000-0000-4000-8000-000000002003', '50000000-0000-4000-8000-000000002002', 'paid-21k', '21K Pago', 21000, true,
   null, 'ACTIVE', 2),
  ('60000000-0000-4000-8000-000000002004', '50000000-0000-4000-8000-000000002002', 'unpriced', 'Sin precio', 3000,
   true, null, 'ACTIVE', 3);
insert into app.modality_capacity (modality_id, effective_capacity) values
  ('60000000-0000-4000-8000-000000002002', 4);

-- ---------------------------------------------------------------------------------------------
-- Price resolution (§38): FREE never priced from offers; tie-breakers among ACTIVE offers.
-- ---------------------------------------------------------------------------------------------
select is(private.resolve_modality_price('60000000-0000-4000-8000-000000002001', now()),
  jsonb_build_object('source', 'FREE', 'price_offer_id', null, 'modality_id', '60000000-0000-4000-8000-000000002001',
    'amount_minor', 0, 'currency', 'MXN'), '§38 FREE Edition is never priced from offers');
select is(private.resolve_modality_price('60000000-0000-4000-8000-000000002004', now()), null,
  '§38 EXTERNAL_WHATSAPP modality with no ACTIVE offer resolves to NULL (not priceable)');

insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency, starts_at, ends_at, status, priority)
values
  -- Same priority, one starts later (wins over the earlier one).
  ('70000000-0000-4000-8000-000000002001', '60000000-0000-4000-8000-000000002002', 'Early bird', 30000, 'MXN', now() - interval '10 days', null, 'ACTIVE', 0),
  ('70000000-0000-4000-8000-000000002002', '60000000-0000-4000-8000-000000002002', 'Regular', 40000, 'MXN', now() - interval '1 day', null, 'ACTIVE', 0),
  -- Higher priority wins even though it started earlier.
  ('70000000-0000-4000-8000-000000002003', '60000000-0000-4000-8000-000000002002', 'VIP override', 20000, 'MXN', now() - interval '20 days', null, 'ACTIVE', 5),
  -- Inactive / outside window / future must never be selected.
  ('70000000-0000-4000-8000-000000002004', '60000000-0000-4000-8000-000000002002', 'Inactive', 1, 'MXN', null, null, 'INACTIVE', 9),
  ('70000000-0000-4000-8000-000000002005', '60000000-0000-4000-8000-000000002002', 'Future', 1, 'MXN', now() + interval '1 day', null, 'ACTIVE', 9),
  ('70000000-0000-4000-8000-000000002006', '60000000-0000-4000-8000-000000002002', 'Expired', 1, 'MXN', null, now() - interval '1 day', 'ACTIVE', 9);

select is((private.resolve_price_offer('60000000-0000-4000-8000-000000002002', now()) ->> 'price_offer_id')::uuid,
  '70000000-0000-4000-8000-000000002003', '§38 highest priority wins regardless of starts_at');
select is((private.resolve_price_offer('60000000-0000-4000-8000-000000002002', now()) ->> 'amount_minor')::int, 20000,
  '§38 resolved price carries the winning offer amount');

delete from app.price_offer where price_offer_id = '70000000-0000-4000-8000-000000002003';
select is((private.resolve_price_offer('60000000-0000-4000-8000-000000002002', now()) ->> 'price_offer_id')::uuid,
  '70000000-0000-4000-8000-000000002002', '§38 among equal priority, the later starts_at wins');

select is((private.resolve_modality_price('60000000-0000-4000-8000-000000002002', now()) ->> 'source'), 'PRICE_OFFER',
  '§38 EXTERNAL_WHATSAPP resolved price is tagged PRICE_OFFER');

-- ---------------------------------------------------------------------------------------------
-- Schedule / effective_start (§29, §100).
-- ---------------------------------------------------------------------------------------------
select is(private.current_schedule('50000000-0000-4000-8000-000000002001'), null,
  'no schedule revision yet: current_schedule is NULL');
select is(private.effective_start('50000000-0000-4000-8000-000000002001'), null,
  'no schedule revision yet: effective_start is NULL');

-- created_by_staff_id needs a real staff row backed by a real auth user.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000002099', 'kernel-staff@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000002099', '00000000-0000-4000-8000-000000002099', 'ACTIVE');

select private.insert_schedule_revision('50000000-0000-4000-8000-000000002002',
  jsonb_build_object('local_date', (current_date + 10), 'local_start_time', '06:30:00', 'local_end_time', null),
  'seed', '20000000-0000-4000-8000-000000002099');
select is((private.effective_start('50000000-0000-4000-8000-000000002002') ->> 'time_source'), 'EDITION',
  'effective_start uses the Edition time when the modality has none');
select is((private.effective_start('50000000-0000-4000-8000-000000002002', '60000000-0000-4000-8000-000000002001') ->> 'time_source'),
  null, 'effective_start is NULL for a modality of a different Edition');

-- ---------------------------------------------------------------------------------------------
-- Availability (§35-37): global vs modality caps, holds vs confirmed, LOW threshold, expired holds ignored.
-- ---------------------------------------------------------------------------------------------
select is(private.edition_availability('50000000-0000-4000-8000-000000002099'), null,
  'edition_availability of an unknown Edition is NULL');

select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'global' ->> 'available')::int, 10,
  'global available equals global_capacity with no occupation');
select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'global' ->> 'state'), 'AVAILABLE',
  'global state AVAILABLE with no occupation and no threshold');

-- Buyer + a FREE-style request/participant/hold fixture to occupy modality capacity (4) with holds.
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
values ('10000000-0000-4000-8000-000000002001', (select id from auth.users where email = 'kernel-staff@example.test'),
  'READY', 'ACTIVE', 'Buyer Kernel', '1990-01-01', 'F', '+528110000001', 'Contacto', '+528110000002', 'Madre', now())
on conflict do nothing;

insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  status, registration_mode, currency, total_snapshot_minor, whatsapp_phone_snapshot, expires_at)
values ('80000000-0000-4000-8000-000000002001', 'R-KRNL-0001', '10000000-0000-4000-8000-000000002001',
  '50000000-0000-4000-8000-000000002002', 'PENDING_CONFIRMATION', 'EXTERNAL_WHATSAPP', 'MXN', 40000,
  '+528110000099', now() + interval '1 day');
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
values ('81000000-0000-4000-8000-000000002001', '80000000-0000-4000-8000-000000002001', 'PROFILE',
  '10000000-0000-4000-8000-000000002001', '60000000-0000-4000-8000-000000002002', 40000, 'MXN', '{}');

-- A hold that fills the whole modality capacity (4): available 0, but holds-only (no CONFIRMED) is
-- TEMPORARILY_UNAVAILABLE, not SOLD_OUT.
insert into app.registration_hold (registration_hold_id, registration_request_id, modality_id, quantity, status, expires_at)
values ('82000000-0000-4000-8000-000000002001', '80000000-0000-4000-8000-000000002001',
  '60000000-0000-4000-8000-000000002002', 4, 'ACTIVE', now() + interval '1 day');

select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0 ->> 'available')::int, 0,
  'modality available = capacity(4) - active holds(4) = 0');
select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0 ->> 'state'), 'TEMPORARILY_UNAVAILABLE',
  'holds-only occupation (no CONFIRMED yet) is TEMPORARILY_UNAVAILABLE, not SOLD_OUT');

-- An expired hold (expires_at in the past, still > created_at) must never count against availability,
-- even before the expiry worker materialises its status.
delete from app.registration_hold where registration_hold_id = '82000000-0000-4000-8000-000000002001';
insert into app.registration_hold (registration_hold_id, registration_request_id, modality_id, quantity, status, created_at, expires_at)
values ('82000000-0000-4000-8000-000000002002', '80000000-0000-4000-8000-000000002001',
  '60000000-0000-4000-8000-000000002002', 4, 'ACTIVE', now() - interval '2 hours', now() - interval '1 hour');
select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0 ->> 'available')::int, 4,
  'an expired hold (past expires_at) is ignored even before the expiry worker runs');
delete from app.registration_hold where registration_hold_id = '82000000-0000-4000-8000-000000002002';

-- Confirm actual registrations to fill capacity by CONFIRMED count alone: SOLD_OUT.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000020' || s)::uuid, 'kernel-p' || s || '@example.test'
from unnest(array['10','11','12','13']) s;
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-0000000020' || s)::uuid, ('00000000-0000-4000-8000-0000000020' || s)::uuid,
  'READY', 'ACTIVE', 'Runner ' || s, '1990-01-01', 'F', '+528110000001', 'Contacto', '+528110000002', 'Madre', now()
from unnest(array['10','11','12','13']) s;
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  status, registration_mode, currency, total_snapshot_minor, whatsapp_phone_snapshot, expires_at, confirmed_at)
select gen_random_uuid(), 'R-KFIL-00' || s, ('10000000-0000-4000-8000-0000000020' || s)::uuid,
  '50000000-0000-4000-8000-000000002002', 'CONFIRMED', 'EXTERNAL_WHATSAPP', 'MXN', 40000, '+528110000099',
  now() + interval '1 day', now()
from unnest(array['10','11','12','13']) s;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
select gen_random_uuid(), r.registration_request_id, 'PROFILE', r.buyer_profile_id,
  '60000000-0000-4000-8000-000000002002', 40000, 'MXN', '{}'
from app.registration_request r where r.public_reference like 'R-KFIL-%';
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, buyer_profile_id, registration_number, status)
select gen_random_uuid(), p.registration_request_id, p.request_participant_id, '50000000-0000-4000-8000-000000002002',
  '60000000-0000-4000-8000-000000002002', p.runner_profile_id, p.runner_profile_id,
  'I-KRNL-000' || row_number() over (), 'CONFIRMED'
from app.registration_request_participant p
join app.registration_request r on r.registration_request_id = p.registration_request_id
where r.public_reference like 'R-KFIL-%';

select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0 ->> 'available')::int, 0,
  '4 CONFIRMED registrations fill the modality capacity of 4');
select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0 ->> 'state'), 'SOLD_OUT',
  'CONFIRMED registrations alone reaching capacity is SOLD_OUT');
select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'global' ->> 'available')::int, 6,
  'global available reflects the 4 confirmed registrations against global_capacity 10');

-- LOW threshold.
update app.platform_settings set availability_low_threshold_percent = 50 where settings_id = 1;
update app.modality_capacity set effective_capacity = 8 where modality_id = '60000000-0000-4000-8000-000000002002';
select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0 ->> 'available')::int, 4,
  'available recomputed after raising capacity to 8 (8 - 4 confirmed)');
select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0 ->> 'state'), 'LOW',
  '4 of 8 available (<=50%) crosses the LOW threshold');
update app.platform_settings set availability_low_threshold_percent = null where settings_id = 1;
select is((private.edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0 ->> 'state'), 'AVAILABLE',
  'NULL threshold never yields LOW');

-- Public facade: only PUBLISHED editions, no counts, CANCELED modalities omitted.
select is(private.get_edition_availability('50000000-0000-4000-8000-000000002002'), null,
  'public availability facade is NULL for a non-PUBLISHED Edition');
update app.edition set publication_state = 'PUBLISHED', published_at = now() where edition_id = '50000000-0000-4000-8000-000000002002';
select is((private.get_edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities' -> 0) ? 'confirmed', false,
  'the public availability facade never leaks raw counts');
select is(jsonb_array_length(private.get_edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities'), 3,
  'public facade lists every non-CANCELED modality');
update app.modality set status = 'CANCELED' where modality_id = '60000000-0000-4000-8000-000000002004';
select is(jsonb_array_length(private.get_edition_availability('50000000-0000-4000-8000-000000002002') -> 'modalities'), 2,
  'a CANCELED modality is omitted from the public facade');

-- ---------------------------------------------------------------------------------------------
-- Readiness (§30-31).
-- ---------------------------------------------------------------------------------------------
select ok(not (private.publication_readiness('50000000-0000-4000-8000-000000002001') ->> 'ready')::boolean,
  'a DRAFT Edition with no schedule/description is not publication-ready');
select ok((select bool_or(not (c ->> 'ok')::boolean) from jsonb_array_elements(
    private.publication_readiness('50000000-0000-4000-8000-000000002001') -> 'checks') c where c ->> 'code' = 'DATE_KNOWN'),
  'DATE_KNOWN fails with no schedule revision');

select private.insert_schedule_revision('50000000-0000-4000-8000-000000002001',
  jsonb_build_object('local_date', (current_date + 20), 'local_start_time', '07:00:00', 'local_end_time', null),
  'seed', '20000000-0000-4000-8000-000000002099');
insert into app.modality_capacity (modality_id, effective_capacity) values ('60000000-0000-4000-8000-000000002001', 100);
insert into app.event_content_block (event_content_block_id, edition_id, block_type, position, status, payload)
values ('90000000-0000-4000-8000-000000002001', '50000000-0000-4000-8000-000000002001', 'RICH_TEXT', 1, 'PUBLISHED',
  jsonb_build_object('markdown', repeat('Texto de prueba local suficientemente largo. ', 2)));
insert into app.registration_form (registration_form_id, edition_id, modality_id, version, status, published_at)
values ('91000000-0000-4000-8000-000000002001', '50000000-0000-4000-8000-000000002001', null, 1, 'PUBLISHED', now());

select ok((private.publication_readiness('50000000-0000-4000-8000-000000002001') ->> 'ready')::boolean,
  'once schedule, capacity, description and STATES_COHERENT hold, publication_readiness is ready');

update app.edition set registration_open_at = now() - interval '1 day' where edition_id = '50000000-0000-4000-8000-000000002001';
select ok(not (private.registration_readiness('50000000-0000-4000-8000-000000002001') ->> 'ready')::boolean,
  'registration_readiness still fails while the Edition is DRAFT (EDITION_PUBLISHED)');

-- Platform-wide legal documents: TERMS_OF_SERVICE/PRIVACY_NOTICE/SPORT_WAIVER are required
-- unconditionally, MINOR_TERMS because the default eligibility (min_age unset => 15) admits minors
-- (coalesce(min_age, 15) < 18). document_key is a shared-namespace unique value across the whole
-- (multi-agent) local DB; a T30-scoped key avoids colliding with another domain's own fixture.
-- LEGAL_DOCUMENTS_PUBLISHED also requires *every* other ACTIVE document of these types anywhere to
-- carry a published version (Master §123: a draft waiver blocks all Editions); ARCHIVE any such
-- foreign fixture for the rest of this rolled-back transaction so this Edition's own readiness is
-- deterministic regardless of what other domains seeded concurrently.
insert into app.legal_document (legal_document_id, document_key, document_type, status) values
  ('92000000-0000-4000-8000-000000002001', 'T30_TEST_TERMS_OF_SERVICE', 'TERMS_OF_SERVICE', 'ACTIVE'),
  ('92000000-0000-4000-8000-000000002002', 'T30_TEST_PRIVACY_NOTICE', 'PRIVACY_NOTICE', 'ACTIVE'),
  ('92000000-0000-4000-8000-000000002003', 'T30_TEST_SPORT_WAIVER', 'SPORT_WAIVER', 'ACTIVE'),
  ('92000000-0000-4000-8000-000000002004', 'T30_TEST_MINOR_TERMS', 'MINOR_TERMS', 'ACTIVE');
insert into app.legal_document_version (legal_document_id, version, content_markdown, status, published_at)
select legal_document_id, 1, '[DOCUMENTO DE PRUEBA LOCAL — no es texto legal]', 'PUBLISHED', now()
from app.legal_document where legal_document_id in
  ('92000000-0000-4000-8000-000000002001', '92000000-0000-4000-8000-000000002002',
   '92000000-0000-4000-8000-000000002003', '92000000-0000-4000-8000-000000002004');
update app.legal_document set status = 'ARCHIVED'
where document_type in ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE', 'SPORT_WAIVER', 'MINOR_TERMS')
  and legal_document_id not in ('92000000-0000-4000-8000-000000002001', '92000000-0000-4000-8000-000000002002',
    '92000000-0000-4000-8000-000000002003', '92000000-0000-4000-8000-000000002004');
update app.edition set publication_state = 'PUBLISHED', published_at = now() where edition_id = '50000000-0000-4000-8000-000000002001';
select ok((private.registration_readiness('50000000-0000-4000-8000-000000002001') ->> 'ready')::boolean,
  'a published, scheduled, capacitated, priced (FREE), formed, all-legal-documents-published Edition is registration-ready');

select is(private.registration_readiness('50000000-0000-4000-8000-000000002099'), null,
  'registration_readiness of an unknown Edition is NULL');
select is(private.publication_readiness('50000000-0000-4000-8000-000000002099'), null,
  'publication_readiness of an unknown Edition is NULL');

select * from finish();
rollback;
