-- P3-D staff bulk cancellation of PENDING registration requests (owner decision OD-P2-01, measure 3): staff-only with Edition scope
-- (SEC-020), bounded and validated input, per-id partial results, the same transition as the single cancel (holds and claims
-- RELEASED, capacity by status, CONFIRMED registrations never touched), audit per request plus one batch record, idempotency per
-- (actor, key), the hoarding alert refreshed. Synthetic ids in a 722 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(53);

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
create function pg_temp.sv(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin execute p_sql into v; return v; end $$;
grant execute on function pg_temp.sv(text) to authenticated;
-- Live availability of the EB modality: 'confirmed' / 'active_holds'.
create function pg_temp.avail(p_key text) returns text language sql security definer as $$
  select m ->> p_key from jsonb_array_elements(private.edition_availability('50000000-0000-4000-8000-000000722001') -> 'modalities') m
  where (m ->> 'modality_id')::uuid = '60000000-0000-4000-8000-000000722001' $$;
grant execute on function pg_temp.avail(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture. Buyers b1..b5 (created_at NULL = established accounts), staff: ADMIN, OPERATOR (global), CHECKIN, OPERATOR scoped to EC.
-- EB (the Edition under test) and EC (another Edition) are EXTERNAL_WHATSAPP.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000722001', 'p722-b1@example.test'), ('00000000-0000-4000-8000-000000722002', 'p722-b2@example.test'),
  ('00000000-0000-4000-8000-000000722003', 'p722-b3@example.test'), ('00000000-0000-4000-8000-000000722004', 'p722-b4@example.test'),
  ('00000000-0000-4000-8000-000000722005', 'p722-b5@example.test'),
  ('00000000-0000-4000-8000-000000722011', 'p722-admin@example.test'), ('00000000-0000-4000-8000-000000722012', 'p722-operator@example.test'),
  ('00000000-0000-4000-8000-000000722013', 'p722-checkin@example.test'), ('00000000-0000-4000-8000-000000722014', 'p722-operator-ec@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000722011', '00000000-0000-4000-8000-000000722011', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000722012', '00000000-0000-4000-8000-000000722012', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000722013', '00000000-0000-4000-8000-000000722013', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000722014', '00000000-0000-4000-8000-000000722014', 'ACTIVE');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-00000072200' || i)::uuid, ('00000000-0000-4000-8000-00000072200' || i)::uuid, 'READY', 'ACTIVE',
  'Buyer 722-' || i, date '1990-01-01', 'M', '+52811007220' || i, 'Contacto', '+52811007221' || i, 'Hermano', now()
from generate_series(1, 5) i;
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible)
select ('10000000-0000-4000-8000-00000072200' || i)::uuid, ('c0000000-0000-4000-8000-00000072200' || i)::uuid, 'ELIGIBLE', true
from generate_series(1, 5) i;
insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context)
select rp.runner_profile_id, c.legal_document_version_id, '{"via": "test-fixture"}'::jsonb
from app.runner_profile rp cross join private.account_legal_current_versions() c
where rp.auth_user_id::text like '00000000-0000-4000-8000-00000072200_';
-- Guests: g1 of b1, g2..g10 of b5.
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
select ('30000000-0000-4000-8000-0000007222' || lpad(g::text, 2, '0'))::uuid,
  case when g = 1 then '10000000-0000-4000-8000-000000722001' else '10000000-0000-4000-8000-000000722005' end::uuid,
  'Invitado 722-' || g, date '1992-02-02', 'F', '+5281100722' || lpad(g::text, 2, '0'), 'Contacto', '+5281100723' || lpad(g::text, 2, '0'), 'Amigo'
from generate_series(1, 10) g;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000722001', event_type_id, 'Bulk Event', 'p722-bulk-event' from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, registration_mode,
  timezone, registration_open_at, registration_close_at, city, state_region, country_code, whatsapp_phone_e164, published_at)
select ('50000000-0000-4000-8000-00000072200' || i)::uuid, '40000000-0000-4000-8000-000000722001', 'p722-bulk-' || i, 'Bulk ' || i,
  'PUBLISHED', 'SCHEDULED', 'OPEN', 'EXTERNAL_WHATSAPP', 'America/Monterrey', now() - interval '1 hour', now() + interval '30 days',
  'Monterrey', 'NL', 'MX', '+528110009999', now()
from generate_series(1, 2) i;
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000722011', 'ADMIN', 'GLOBAL', null), ('20000000-0000-4000-8000-000000722012', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000722013', 'CHECKIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000722014', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000722002');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order)
select ('60000000-0000-4000-8000-00000072200' || i)::uuid, ('50000000-0000-4000-8000-00000072200' || i)::uuid, '5k', '5K', 5000, true, 1
from generate_series(1, 2) i;
insert into app.modality_capacity (modality_id, effective_capacity)
select ('60000000-0000-4000-8000-00000072200' || i)::uuid, 30 from generate_series(1, 2) i;
insert into app.price_offer (modality_id, name, amount_minor, currency)
select ('60000000-0000-4000-8000-00000072200' || i)::uuid, 'General', 20000, 'MXN' from generate_series(1, 2) i;

insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at)
select '69000000-0000-4000-8000-000000722099', legal_document_id, 1, 'Acepto el deslinde.', 'PUBLISHED', now()
from app.legal_document where document_key = 'SPORT_WAIVER'
on conflict (legal_document_id, version) do nothing;

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
insert into ids select 'waiver', to_jsonb((select legal_document_version_id
  from private.registration_required_documents('50000000-0000-4000-8000-000000722001', false) where document_type = 'SPORT_WAIVER'));

create function pg_temp.parts(p_edition int, p_buyer int, p_guest_from int, p_guests int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-00000072200' || p_buyer,
    'modality_id', '60000000-0000-4000-8000-00000072200' || p_edition))
  || coalesce((select jsonb_agg(jsonb_build_object('kind', 'GUEST', 'guest_participant_id',
       '30000000-0000-4000-8000-0000007222' || lpad(g::text, 2, '0'), 'modality_id', '60000000-0000-4000-8000-00000072200' || p_edition) order by g)
     from generate_series(p_guest_from, p_guest_from + p_guests - 1) g), '[]'::jsonb) $$;
create function pg_temp.accs(p_count int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('participant_index', i, 'legal_document_version_id', (select value from ids where name = 'waiver')) order by i), '[]'::jsonb)
  from generate_series(0, p_count - 1) i $$;
grant execute on function pg_temp.parts(int, int, int, int), pg_temp.accs(int) to authenticated;
create function pg_temp.rid(p_name text) returns uuid language sql as $$ select (value ->> 'registration_request_id')::uuid from ids where name = p_name $$;
grant execute on function pg_temp.rid(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Requests: R1 (b1, 2 places), R2 (b2), R3 (b3, then CONFIRMED by staff), R4 (b4, canceled by the buyer), R6 (b5, 10 places: the
-- hoarding alert), R5 on the OTHER Edition (b1).
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722001", "role": "authenticated"}';
insert into ids select 'r1', public.create_registration_request('50000000-0000-4000-8000-000000722001', pg_temp.parts(1, 1, 1, 1), pg_temp.accs(2));
insert into ids select 'r5', public.create_registration_request('50000000-0000-4000-8000-000000722002', pg_temp.parts(2, 1, 1, 1), pg_temp.accs(2));
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722002", "role": "authenticated"}';
insert into ids select 'r2', public.create_registration_request('50000000-0000-4000-8000-000000722001', pg_temp.parts(1, 2, 2, 0), pg_temp.accs(1));
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722003", "role": "authenticated"}';
insert into ids select 'r3', public.create_registration_request('50000000-0000-4000-8000-000000722001', pg_temp.parts(1, 3, 2, 0), pg_temp.accs(1));
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722004", "role": "authenticated"}';
insert into ids select 'r4', public.create_registration_request('50000000-0000-4000-8000-000000722001', pg_temp.parts(1, 4, 2, 0), pg_temp.accs(1));
select is(public.cancel_registration_request(pg_temp.rid('r4'), 'ya no puedo') ->> 'status', 'CANCELED_BY_BUYER', 'R4 is canceled by its buyer');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722005", "role": "authenticated"}';
insert into ids select 'r6', public.create_registration_request('50000000-0000-4000-8000-000000722001', pg_temp.parts(1, 5, 2, 9), pg_temp.accs(10));
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722011", "role": "authenticated"}';
select is(public.confirm_registration_request(pg_temp.rid('r3')) ->> 'status', 'CONFIRMED', 'R3 is confirmed by staff (it becomes a CONFIRMED registration)');
reset role;
select is(pg_temp.avail('active_holds'), '13', 'live holds before: R1 2 + R2 1 + R6 10');
select is(pg_temp.avail('confirmed'), '1', 'and one CONFIRMED registration');
select is(pg_temp.sv($q$ select status from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000722001' $q$), 'OPEN',
  'R6 (10 places) opened the hoarding alert');

-- ===========================================================================================
-- Authority, validation
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722001", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[%L]::uuid[], 'x', 'p722-bulk-key-0001') $$,
  pg_temp.rid('r2'))) ->> 'code', 'FORBIDDEN', 'a buyer cannot bulk cancel');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722013", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[%L]::uuid[], 'x', 'p722-bulk-key-0002') $$,
  pg_temp.rid('r2'))) ->> 'code', 'FORBIDDEN', 'CHECKIN cannot bulk cancel');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722014", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[%L]::uuid[], 'x', 'p722-bulk-key-0003') $$,
  pg_temp.rid('r2'))) ->> 'code', 'FORBIDDEN', 'an OPERATOR scoped to another Edition cannot bulk cancel this one (SEC-020)');
select is(has_function_privilege('anon', 'public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text)', 'execute'), false, 'anon has no EXECUTE');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722012", "role": "authenticated"}';
select is(pg_temp.err($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722999', array[gen_random_uuid()], 'x') $$) ->> 'code', 'NOT_FOUND',
  'an unknown Edition is NOT_FOUND');
select is(pg_temp.err(format($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[%L]::uuid[], '   ') $$, pg_temp.rid('r2'))) -> 'detail' ->> 'field',
  'reason', 'a reason is mandatory');
select is(pg_temp.err(format($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[%L]::uuid[], %L) $$, pg_temp.rid('r2'), repeat('x', 501))) -> 'detail' ->> 'reason',
  'too_long', 'the reason is at most 500 characters');
select is(pg_temp.err($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[]::uuid[], 'x') $$) -> 'detail' ->> 'field',
  'request_ids', 'at least one id');
select is(pg_temp.err($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', null, 'x') $$) -> 'detail' ->> 'field',
  'request_ids', 'the id list is required');
select is(pg_temp.err($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001',
  (select array_agg(gen_random_uuid()) from generate_series(1, 101)), 'x') $$) -> 'detail' ->> 'reason', 'too_many', 'the batch is bounded (100)');
select is(pg_temp.err(format($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[%L, %L]::uuid[], 'x') $$,
  pg_temp.rid('r2'), pg_temp.rid('r2'))) -> 'detail' ->> 'reason', 'duplicates', 'duplicate ids are refused');
select is(pg_temp.err(format($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[%L, null]::uuid[], 'x') $$,
  pg_temp.rid('r2'))) -> 'detail' ->> 'reason', 'invalid_value', 'a null id is refused');
select is(pg_temp.avail('active_holds'), '13', 'refused calls released nothing');

-- ===========================================================================================
-- The batch: R1, R2 (PENDING), R3 (CONFIRMED), R4 (already canceled by the buyer), R5 (other Edition), an unknown id
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722011", "role": "authenticated"}';
insert into ids select 'batch', public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001',
  array[pg_temp.rid('r1'), pg_temp.rid('r2'), pg_temp.rid('r3'), pg_temp.rid('r4'), pg_temp.rid('r5'), '99999999-0000-4000-8000-000000722999']::uuid[],
  'Sospecha de acaparamiento: cuentas nuevas con varios lugares', 'p722-bulk-key-0004');
select is((select value ->> 'requested_count' from ids where name = 'batch'), '6', 'six ids were requested');
select is((select value ->> 'canceled_count' from ids where name = 'batch'), '2', 'two PENDING requests were canceled');
select is((select value ->> 'rejected_count' from ids where name = 'batch'), '4', 'four were rejected without effect');
select is((select value ->> 'failed_count' from ids where name = 'batch'), '0', 'none failed');
select is((select value -> 'results' from ids where name = 'batch') @> jsonb_build_array(
  jsonb_build_object('registration_request_id', pg_temp.rid('r1'), 'outcome', 'CANCELED'),
  jsonb_build_object('registration_request_id', pg_temp.rid('r2'), 'outcome', 'CANCELED'),
  jsonb_build_object('registration_request_id', pg_temp.rid('r3'), 'outcome', 'NOT_CANCELABLE', 'status', 'CONFIRMED'),
  jsonb_build_object('registration_request_id', pg_temp.rid('r4'), 'outcome', 'NOT_CANCELABLE', 'status', 'CANCELED_BY_BUYER'),
  jsonb_build_object('registration_request_id', pg_temp.rid('r5'), 'outcome', 'NOT_FOUND'),
  jsonb_build_object('registration_request_id', '99999999-0000-4000-8000-000000722999', 'outcome', 'NOT_FOUND')), true,
  'per-id results: CANCELED, CANCELED, NOT_CANCELABLE (CONFIRMED), NOT_CANCELABLE (buyer canceled), NOT_FOUND (other Edition), NOT_FOUND (unknown)');

reset role;
select is(pg_temp.sv(format($q$ select string_agg(status, ',' order by registration_request_id) from app.registration_request where registration_request_id in (%L, %L) $q$,
  pg_temp.rid('r1'), pg_temp.rid('r2'))), 'CANCELED_BY_STAFF,CANCELED_BY_STAFF', 'R1 and R2 are CANCELED_BY_STAFF');
select is(pg_temp.sv(format($q$ select count(*) from app.registration_request where registration_request_id = %L and canceled_by_staff_id = '20000000-0000-4000-8000-000000722011'
  and cancel_reason like 'Sospecha%%' and canceled_at is not null $q$, pg_temp.rid('r1'))), '1', 'with the actor, the reason and the timestamp');
select is(pg_temp.sv(format($q$ select status from app.registration_request where registration_request_id = %L $q$, pg_temp.rid('r3'))), 'CONFIRMED',
  'the CONFIRMED request is untouched');
select is(pg_temp.sv(format($q$ select count(*) from app.registration where registration_request_id = %L and status = 'CONFIRMED' $q$, pg_temp.rid('r3'))), '1',
  'and so is its CONFIRMED registration');
select is(pg_temp.sv(format($q$ select status from app.registration_request where registration_request_id = %L $q$, pg_temp.rid('r5'))), 'PENDING_CONFIRMATION',
  'a request of another Edition is untouched');
select is(pg_temp.sv(format($q$ select status from app.registration_request where registration_request_id = %L $q$, pg_temp.rid('r6'))), 'PENDING_CONFIRMATION',
  'a request nobody listed is untouched (explicit ids only)');
select is(pg_temp.sv(format($q$ select string_agg(distinct status, ',') from app.registration_hold where registration_request_id in (%L, %L) $q$, pg_temp.rid('r1'), pg_temp.rid('r2'))),
  'RELEASED', 'their holds are RELEASED');
select is(pg_temp.sv(format($q$ select string_agg(distinct status, ',') from app.registration_participant_claim where registration_request_id in (%L, %L) $q$, pg_temp.rid('r1'), pg_temp.rid('r2'))),
  'RELEASED', 'and their participant claims');
select is(pg_temp.avail('active_holds'), '10', 'capacity is recomputed from the source of truth: 13 held places became 10 (only R6 remains)');
select is(pg_temp.avail('confirmed'), '1', 'the confirmed count did not move');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event where event_type = 'RegistrationRequestCanceled' and effect_key in (
  'RegistrationRequestCanceled:' || (select value ->> 'registration_request_id' from ids where name = 'r1'),
  'RegistrationRequestCanceled:' || (select value ->> 'registration_request_id' from ids where name = 'r2')) $q$), '2', 'one RegistrationRequestCanceled event per canceled request');

-- Audit: one per canceled request (shared correlation id, reason) plus one for the batch.
select is(pg_temp.sv(format($q$ select count(*) from audit.audit_log where action = 'REGISTRATION_REQUEST_CANCELED' and entity_id in (%L, %L)
  and correlation_id = %L and actor_staff_member_id = '20000000-0000-4000-8000-000000722011' and reason like 'Sospecha%%'
  and (after_snapshot ->> 'bulk') = 'true' $q$, pg_temp.rid('r1'), pg_temp.rid('r2'), (select value ->> 'correlation_id' from ids where name = 'batch'))), '2',
  'each canceled request has its own audit record, linked by the batch correlation id');
select is(pg_temp.sv(format($q$ select (after_snapshot ->> 'canceled_count') || '/' || (after_snapshot ->> 'requested_count') || '/' || jsonb_array_length(after_snapshot -> 'canceled_request_ids')
  from audit.audit_log where action = 'REGISTRATION_REQUESTS_BULK_CANCELED' and entity_id = '50000000-0000-4000-8000-000000722001' and correlation_id = %L $q$,
  (select value ->> 'correlation_id' from ids where name = 'batch'))), '2/6/2', 'and one batch record with the counts and the canceled ids');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'REGISTRATION_REQUEST_CANCELED' and entity_id in (
  (select (value ->> 'registration_request_id')::uuid from ids where name in ('r3', 'r4', 'r5'))) $q$), '0', 'rejected ids leave no per-request audit record');

-- The alert still holds (R6 keeps 10 places) and nothing was auto-canceled.
select is(pg_temp.sv($q$ select status from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000722001' $q$), 'OPEN',
  'the hoarding alert still holds while R6 keeps 10 places');

-- ===========================================================================================
-- Idempotency
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722011", "role": "authenticated"}';
select is(public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001',
  array[pg_temp.rid('r1'), pg_temp.rid('r2'), pg_temp.rid('r3'), pg_temp.rid('r4'), pg_temp.rid('r5'), '99999999-0000-4000-8000-000000722999']::uuid[],
  'Sospecha de acaparamiento: cuentas nuevas con varios lugares', 'p722-bulk-key-0004'), (select value from ids where name = 'batch'),
  'the same key and body replay the stored result byte for byte');
select is(pg_temp.err(format($$ select public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[%L]::uuid[], 'otra razón', 'p722-bulk-key-0004') $$,
  pg_temp.rid('r6'))) ->> 'code', 'IDEMPOTENCY_CONFLICT', 'the same key with another body is an IDEMPOTENCY_CONFLICT');
select is(public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[pg_temp.rid('r1'), pg_temp.rid('r2')]::uuid[],
  'Reintento con otra clave', 'p722-bulk-key-0005') ->> 'already_canceled_count', '2', 'a retry with a new key finds both already canceled (no second effect)');
reset role;
select is(pg_temp.sv(format($q$ select count(*) from audit.audit_log where action = 'REGISTRATION_REQUEST_CANCELED' and entity_id in (%L, %L) $q$,
  pg_temp.rid('r1'), pg_temp.rid('r2'))), '2', 'neither the replay nor the retry wrote another per-request audit record');
select is(pg_temp.sv(format($q$ select count(*) from infra.outbox_event where event_type = 'RegistrationRequestCanceled' and effect_key = 'RegistrationRequestCanceled:' || %L $q$, pg_temp.rid('r1'))),
  '1', 'nor another event');

-- ===========================================================================================
-- The alert follows the holds; a global OPERATOR can use the command; the single cancel is unchanged
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722012", "role": "authenticated"}';
select is(public.staff_bulk_cancel_registration_requests('50000000-0000-4000-8000-000000722001', array[pg_temp.rid('r6')]::uuid[], 'Duplicado sospechoso', 'p722-bulk-key-0006') ->> 'canceled_count',
  '1', 'a global OPERATOR cancels the large hold');
reset role;
select is(pg_temp.sv($q$ select status || '/' || resolution_type from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000722001' $q$),
  'RESOLVED/CONDITION_CLEARED', 'with the concentration gone the alert resolves itself');
select is(pg_temp.avail('active_holds'), '0', 'no places remain held on the Edition');

-- Single staff cancel keeps its contract on the shared core.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722014", "role": "authenticated"}';
select is(public.staff_cancel_registration_request(pg_temp.rid('r5'), 'Cancelación individual', 'p722-single-key-0001') ->> 'status', 'CANCELED_BY_STAFF',
  'the single staff cancel still works (an OPERATOR scoped to that Edition)');
select is(public.staff_cancel_registration_request(pg_temp.rid('r5'), 'Cancelación individual', 'p722-single-key-0001') ->> 'status', 'CANCELED_BY_STAFF',
  'and replays by key');
select is(pg_temp.err(format($$ select public.staff_cancel_registration_request(%L, 'otra') $$, pg_temp.rid('r3'))) ->> 'code', 'FORBIDDEN',
  'its Edition scope still applies (R3 belongs to the other Edition)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000722011", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.staff_cancel_registration_request(%L, 'otra') $$, pg_temp.rid('r3'))) -> 'detail' ->> 'reason', 'REQUEST_NOT_CANCELABLE',
  'a CONFIRMED request is still REQUEST_NOT_CANCELABLE for the single cancel');
select is(public.staff_cancel_registration_request(pg_temp.rid('r1'), 'idempotente') ->> 'status', 'CANCELED_BY_STAFF', 'cancelling an already staff-canceled request is a no-op view');
reset role;
select is(pg_temp.sv(format($q$ select count(*) from audit.audit_log where action = 'REGISTRATION_REQUEST_CANCELED' and entity_id = %L and correlation_id is null $q$, pg_temp.rid('r5'))),
  '1', 'the single cancel audits once with no correlation id');
select is(pg_temp.sv($q$ select count(*) from cron.job where jobname = 'admin-task-sync' $q$), '1', 'the sweep that re-evaluates the alert is scheduled');

select * from finish();
rollback;
