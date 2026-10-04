-- T40 Kit Center (Master §86-89) and manual participant lookup (SEC-024). Duplicate pickup never
-- delivers twice, reversal is audited and KIT_MANAGE-only, size change validates availability.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(19);

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

-- ---------------------------------------------------------------------------------------------
-- Fixture: buyer + adult Guest, two confirmed Registrations, one kit with three variants
-- (S capacity 1, M capacity 1, L capacity 2), one allocation each for S and M.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000601001', 'raceday-kit-buyer@example.test'),
  ('00000000-0000-4000-8000-000000601002', 'raceday-kit-operator@example.test'),
  ('00000000-0000-4000-8000-000000601003', 'raceday-kit-checkin@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
  emergency_contact_relationship, ready_at) values
  ('10000000-0000-4000-8000-000000601001', '00000000-0000-4000-8000-000000601001', 'READY', 'ACTIVE',
   'Raceday Kit Buyer', '1985-05-05', 'M', '+528110016001', 'Contacto', '+528110016002', 'Hermano', now());
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible) values
  ('10000000-0000-4000-8000-000000601001', 'c0000000-0000-4000-8000-000000601001', 'ELIGIBLE', true);
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000601001', '10000000-0000-4000-8000-000000601001', 'Raceday Kit Guest',
   '1990-01-01', 'M', '+528110016003', 'Contacto', '+528110016004', 'Amigo');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000601001', event_type_id, 'Test Raceday Kit Evento', 'test-raceday-kit-evento-601'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state,
  registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at) values
  ('50000000-0000-4000-8000-000000601001', '40000000-0000-4000-8000-000000601001', 'test-raceday-kit-601',
   'Test Raceday Kit Edition', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'FREE', 'America/Monterrey',
   now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', now());
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000601001', '50000000-0000-4000-8000-000000601001', '10k', '10K', 10000, true, 1);

insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000601001', '00000000-0000-4000-8000-000000601002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000601002', '00000000-0000-4000-8000-000000601003', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000601001', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000601002', 'CHECKIN', 'EDITION', '50000000-0000-4000-8000-000000601001');

insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at)
select '69000000-0000-4000-8000-000000601001', legal_document_id, 1, 'Acepto el deslinde.', 'PUBLISHED', now()
from app.legal_document where document_key = 'SPORT_WAIVER'
on conflict (legal_document_id, version) do nothing;
create temp table doc_ids (name text primary key, value uuid) on commit drop;
insert into doc_ids select 'waiver', (private.current_legal_version(legal_document_id) ->> 'legal_document_version_id')::uuid
from app.legal_document where document_key = 'SPORT_WAIVER';
grant select on doc_ids to authenticated;

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000601001", "role": "authenticated"}';
insert into ids select 'buyer_reg', public.create_registration_request('50000000-0000-4000-8000-000000601001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000601001',
    'modality_id', '60000000-0000-4000-8000-000000601001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver'))));
insert into ids select 'guest_reg', public.create_registration_request('50000000-0000-4000-8000-000000601001',
  jsonb_build_array(jsonb_build_object('kind', 'GUEST', 'guest_participant_id', '30000000-0000-4000-8000-000000601001',
    'modality_id', '60000000-0000-4000-8000-000000601001')),
  jsonb_build_array(jsonb_build_object('participant_index', 0, 'legal_document_version_id', (select value from doc_ids where name = 'waiver'))));

select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_buyer from ids where name = 'buyer_reg';
select value -> 'participants' -> 0 -> 'registration' ->> 'registration_id' as reg_id,
       value -> 'participants' -> 0 -> 'registration' ->> 'participant_pass_id' as pass_id
  into temp t_guest from ids where name = 'guest_reg';
grant select on t_buyer, t_guest to authenticated;

reset role;
insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash,
  token_ciphertext, encryption_key_version, status) values
  ('39000000-0000-4000-8000-000000601001', (select pass_id from t_buyer)::uuid, 1, repeat('7', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE'),
  ('39000000-0000-4000-8000-000000601002', (select pass_id from t_guest)::uuid, 1, repeat('8', 64), decode(repeat('00', 40), 'hex'), 1, 'ACTIVE');
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000601001' where participant_pass_id = (select pass_id from t_buyer)::uuid;
update app.participant_pass set current_credential_id = '39000000-0000-4000-8000-000000601002' where participant_pass_id = (select pass_id from t_guest)::uuid;

insert into app.kit_definition (kit_definition_id, edition_id, name, status, pickup_start_at, pickup_end_at) values
  ('70000000-0000-4000-8000-000000601001', '50000000-0000-4000-8000-000000601001', 'Playera', 'ACTIVE', null, null);
insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, capacity, status) values
  ('71000000-0000-4000-8000-000000601001', '70000000-0000-4000-8000-000000601001', 'S', 'Chica', 1, 'ACTIVE'),
  ('71000000-0000-4000-8000-000000601002', '70000000-0000-4000-8000-000000601001', 'M', 'Mediana', 1, 'ACTIVE'),
  ('71000000-0000-4000-8000-000000601003', '70000000-0000-4000-8000-000000601001', 'L', 'Grande', 2, 'ACTIVE');
insert into app.kit_allocation (kit_allocation_id, registration_id, kit_definition_id, kit_variant_id, status, assigned_at) values
  ('72000000-0000-4000-8000-000000601001', (select reg_id from t_buyer)::uuid, '70000000-0000-4000-8000-000000601001',
   '71000000-0000-4000-8000-000000601001', 'ASSIGNED', now()),
  ('72000000-0000-4000-8000-000000601002', (select reg_id from t_guest)::uuid, '70000000-0000-4000-8000-000000601001',
   '71000000-0000-4000-8000-000000601002', 'ASSIGNED', now());

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Inventory (KIT_PICKUP_RECORD suffices; CHECKIN can read it).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000601003", "role": "authenticated"}';
select is((select v ->> 'available' from jsonb_array_elements(
    public.raceday_kit_inventory('50000000-0000-4000-8000-000000601001') -> 'items' -> 0 -> 'variants') v
    where v ->> 'variant_key' = 'S'), '0', 'variant S (capacity 1, one ASSIGNED allocation) shows 0 available');
select is((select v ->> 'allocated_count' from jsonb_array_elements(
    public.raceday_kit_inventory('50000000-0000-4000-8000-000000601001') -> 'items' -> 0 -> 'variants') v
    where v ->> 'variant_key' = 'L'), '0', 'variant L has no allocations yet');

-- ---------------------------------------------------------------------------------------------
-- Pickup via scan (QR) and duplicate never delivers twice.
-- ---------------------------------------------------------------------------------------------
select is((public.raceday_record_kit_pickup('50000000-0000-4000-8000-000000601001', '70000000-0000-4000-8000-000000601001',
  repeat('7', 64)) ->> 'outcome'), 'VALID', 'first pickup scan of the buyer''s kit is VALID');
select is((public.raceday_record_kit_pickup('50000000-0000-4000-8000-000000601001', '70000000-0000-4000-8000-000000601001',
  repeat('7', 64)) ->> 'outcome'), 'ALREADY_CHECKED_IN', 'a duplicate pickup scan of the same pass is ALREADY_CHECKED_IN');
reset role;
select is((select count(*)::int from app.kit_pickup where kit_allocation_id = '72000000-0000-4000-8000-000000601001' and status = 'DELIVERED'), 1,
  'exactly one DELIVERED kit_pickup row exists for the buyer''s allocation (no double delivery)');
select is((select status from app.kit_allocation where kit_allocation_id = '72000000-0000-4000-8000-000000601001'), 'DELIVERED',
  'the buyer''s allocation is now DELIVERED');
create temp table t_pickup (kit_pickup_id uuid) on commit drop;
insert into t_pickup select kit_pickup_id from app.kit_pickup where kit_allocation_id = '72000000-0000-4000-8000-000000601001';
grant select on t_pickup to authenticated;
set local role authenticated;

-- Third-party manual pickup (SEC-032/Master §89: requires an explicit reason).
select is(pg_temp.err(format($$ select public.raceday_record_kit_pickup('50000000-0000-4000-8000-000000601001',
    '70000000-0000-4000-8000-000000601001', null, %L, null, true, '') $$, (select reg_id from t_guest))) ->> 'code',
  'VALIDATION_ERROR', 'a third-party pickup without a reason is rejected');
select is((public.raceday_record_kit_pickup('50000000-0000-4000-8000-000000601001', '70000000-0000-4000-8000-000000601001',
  null, (select reg_id from t_guest)::uuid, null, true, 'recoge el esposo, presenta identificacion') ->> 'outcome'), 'VALID',
  'a third-party manual pickup with a reason succeeds');

-- ---------------------------------------------------------------------------------------------
-- Reversal (KIT_MANAGE only; CHECKIN does not hold it) and idempotent double-reversal is a CONFLICT.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(format($$ select public.raceday_reverse_kit_pickup(%L, 'entrega registrada por error') $$,
  (select kit_pickup_id from t_pickup))) ->> 'code',
  'FORBIDDEN', 'CHECKIN does not hold KIT_MANAGE and cannot reverse a pickup');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000601002", "role": "authenticated"}';
select is((public.raceday_reverse_kit_pickup((select kit_pickup_id from t_pickup)::uuid, 'entrega registrada por error') ->> 'status'),
  'REVERSED', 'OPERATOR (KIT_MANAGE) reverses the pickup');
select is(pg_temp.err(format($$ select public.raceday_reverse_kit_pickup(%L, 'de nuevo') $$, (select kit_pickup_id from t_pickup)))
  ->> 'code', 'CONFLICT', 'reversing an already-reversed pickup is a CONFLICT');
reset role;
select is((select status from app.kit_allocation where kit_allocation_id = '72000000-0000-4000-8000-000000601001'), 'ASSIGNED',
  'reversal restores the allocation to ASSIGNED so it can be delivered again');
select is((select count(*)::int from audit.audit_log where action = 'KIT_PICKUP_REVERSED'
  and entity_id = '72000000-0000-4000-8000-000000601001'), 1, 'the reversal is audited (Master §219)');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000601002", "role": "authenticated"}';

-- ---------------------------------------------------------------------------------------------
-- Size change validates availability (Master §88): the buyer is back to ASSIGNED on S after the
-- reversal above; the guest's pickup (variant M) is still DELIVERED and occupies M's capacity of 1.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(format($$ select public.raceday_change_kit_allocation_size(%L, '71000000-0000-4000-8000-000000601002', 'talla incorrecta') $$,
  '72000000-0000-4000-8000-000000601001')) ->> 'code', 'CAPACITY_UNAVAILABLE',
  'moving the buyer to variant M (capacity 1, taken by the guest''s DELIVERED kit) is rejected');
select is((public.raceday_change_kit_allocation_size('72000000-0000-4000-8000-000000601001',
  '71000000-0000-4000-8000-000000601003', 'talla incorrecta') ->> 'kit_variant_id'), '71000000-0000-4000-8000-000000601003',
  'moving the buyer to variant L (capacity 2, empty) succeeds');
select is(pg_temp.err(format($$ select public.raceday_change_kit_allocation_size(%L, '71000000-0000-4000-8000-000000601001', 'motivo') $$,
  '72000000-0000-4000-8000-000000601002')) ->> 'code', 'BUSINESS_RULE_VIOLATION',
  'a DELIVERED allocation (the guest''s) cannot be resized without reversing pickup first');

-- ---------------------------------------------------------------------------------------------
-- Manual participant lookup (SEC-024): >=3 chars, minimal fields.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.raceday_participant_search('50000000-0000-4000-8000-000000601001', 'ab') $$) ->> 'code',
  'VALIDATION_ERROR', 'SEC-024 a query under 3 characters is rejected');
select is((select jsonb_array_length(public.raceday_participant_search('50000000-0000-4000-8000-000000601001', 'Raceday Kit Guest') -> 'items')), 1,
  'a >=3 char query finds the participant by name');
select is((select array_agg(k order by k) from jsonb_object_keys(
    public.raceday_participant_search('50000000-0000-4000-8000-000000601001', 'Raceday Kit Guest') -> 'items' -> 0) k),
  array['display_name', 'guardian_state', 'kit', 'modality', 'participant_pass_id', 'public_code', 'registration_id', 'registration_number'],
  'SEC-024 only minimal fields are returned');

reset role;
select * from finish();
rollback;
