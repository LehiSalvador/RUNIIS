-- P3-A CancelRegistration (Master §77, OWN-04 CLOSED: ADMIN/OPERATOR may cancel a CONFIRMED registration until
-- attendance is finalized; afterwards only through reopen/correction) and ChangeRegistrationModality (§78-79).
-- Covers authority (SEC-020 edition scope derived from the target row), pass/kit/capacity/credit effects, the
-- comms-ready RegistrationCanceled event (recipient reference + closed reason category, never the free text),
-- the finalization/closure block, validation of the target modality, the RegistrationRevision chain and
-- idempotency. Ids use a 712 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(63);

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
-- Reads a single value as the table owner: authenticated has no direct grants on the closure tables.
create function pg_temp.sv(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin execute p_sql into v; return v; end $$;
grant execute on function pg_temp.sv(text) to authenticated;
-- Live availability of a modality for the Edition: 'confirmed' / 'effective_capacity'.
create function pg_temp.avail(p_modality uuid, p_key text) returns text language sql security definer as $$
  select m ->> p_key from jsonb_array_elements(private.edition_availability('50000000-0000-4000-8000-000000712001') -> 'modalities') m
  where (m ->> 'modality_id')::uuid = p_modality $$;
grant execute on function pg_temp.avail(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture. Edition E1 (SCHEDULED, global capacity 6): 10K cap 2, 5K cap 1, a CLOSED modality, 21K, 15K (with a
-- USER_SELECTS category) and 42K (published form with a required field nobody answered). Registrations:
--   R1 A in 10K    R2 B in 10K    R3 C in 5K (pass + ASSIGNED kit)    R4 D in 21K
--   R5 GUEST of A in 21K (pass + DELIVERED kit)    R6 E in 21K
-- Edition E2 exists only to prove the staff scope.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000712001', 'p712-admin@example.test'),
  ('00000000-0000-4000-8000-000000712002', 'p712-operator@example.test'),
  ('00000000-0000-4000-8000-000000712003', 'p712-checkin@example.test'),
  ('00000000-0000-4000-8000-000000712004', 'p712-operator-e2@example.test');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid, format('p712-runner-%s@example.test', i)
from generate_series(1, 6) i where i <> 5;
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000712001', '00000000-0000-4000-8000-000000712001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000712002', '00000000-0000-4000-8000-000000712002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000712003', '00000000-0000-4000-8000-000000712003', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000712004', '00000000-0000-4000-8000-000000712004', 'ACTIVE');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name, date_of_birth,
  sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid,
  ('00000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid, 'READY', 'ACTIVE', 'Runner 712-' || i, date '1990-01-01',
  'M', '+52811000713' || i, 'Contacto', '+52811000714' || i, 'Hermano', now()
from generate_series(1, 6) i where i <> 5;
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000712105', '10000000-0000-4000-8000-000000712101', 'Invitado 712', '1990-01-01',
   'M', '+528110007121', 'Contacto', '+528110007122', 'Amigo');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000712001', event_type_id, 'Lifecycle Event', 'p712-lifecycle-event'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state,
  registration_state, closure_state, registration_close_at, global_capacity, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000712001', '40000000-0000-4000-8000-000000712001', 'p712-lifecycle-2026',
   'Lifecycle 2026', 'FREE', 'America/Monterrey', 'SCHEDULED', 'OPEN', 'OPEN', now() + interval '30 days', 6,
   'Monterrey', 'NL', 'MX'),
  ('50000000-0000-4000-8000-000000712002', '40000000-0000-4000-8000-000000712001', 'p712-lifecycle-other-2026',
   'Other 2026', 'FREE', 'America/Monterrey', 'SCHEDULED', 'OPEN', 'OPEN', now() + interval '30 days', null,
   'Monterrey', 'NL', 'MX');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone,
  created_by_staff_id) values
  ('50000000-0000-4000-8000-000000712001', 1, 'DATE_TIME_CONFIRMED', '2026-10-25', '07:00', 'America/Monterrey',
   '20000000-0000-4000-8000-000000712001');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000712001', 'ADMIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000712002', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000712003', 'CHECKIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000712004', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000712002');

insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order) values
  ('60000000-0000-4000-8000-000000712001', '50000000-0000-4000-8000-000000712001', '10k', '10K', 10000, true, 'ACTIVE', 1),
  ('60000000-0000-4000-8000-000000712002', '50000000-0000-4000-8000-000000712001', '5k', '5K', 5000, true, 'ACTIVE', 2),
  ('60000000-0000-4000-8000-000000712003', '50000000-0000-4000-8000-000000712001', '3k', '3K cerrada', 3000, true, 'CLOSED', 3),
  ('60000000-0000-4000-8000-000000712005', '50000000-0000-4000-8000-000000712001', '21k', '21K', 21097, true, 'ACTIVE', 5),
  ('60000000-0000-4000-8000-000000712006', '50000000-0000-4000-8000-000000712001', '15k', '15K', 15000, true, 'ACTIVE', 6),
  ('60000000-0000-4000-8000-000000712007', '50000000-0000-4000-8000-000000712001', '42k', '42K', 42195, true, 'ACTIVE', 7);
insert into app.modality_capacity (modality_id, effective_capacity) values
  ('60000000-0000-4000-8000-000000712001', 2), ('60000000-0000-4000-8000-000000712002', 1);
insert into app.category (category_id, edition_id, name, key, assignment_mode, sort_order) values
  ('b0000000-0000-4000-8000-000000712001', '50000000-0000-4000-8000-000000712001', 'Libre', 'libre', 'USER_SELECTS', 1);
insert into app.modality_category (modality_id, category_id, edition_id) values
  ('60000000-0000-4000-8000-000000712006', 'b0000000-0000-4000-8000-000000712001', '50000000-0000-4000-8000-000000712001');
insert into app.registration_form (registration_form_id, edition_id, modality_id, version, status) values
  ('c0000000-0000-4000-8000-000000712001', '50000000-0000-4000-8000-000000712001', '60000000-0000-4000-8000-000000712007', 1, 'DRAFT');
insert into app.registration_form_field (registration_form_id, field_key, label, field_type, required, sort_order) values
  ('c0000000-0000-4000-8000-000000712001', 'club', 'Club', 'TEXT', true, 1);
update app.registration_form set status = 'PUBLISHED', published_at = now() where registration_form_id = 'c0000000-0000-4000-8000-000000712001';

insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor)
select ('70000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid, 'R-712' || i || '-AAAA',
  ('10000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000712001', 'FREE', 'MXN', 0
from generate_series(1, 6) i where i <> 5;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
select ('71000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000007121' || lpad((case when i = 5 then 1 else i end)::text, 2, '0'))::uuid,
  case when i = 5 then 'GUEST' else 'PROFILE' end,
  case when i = 5 then null else ('10000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid end,
  case when i = 5 then '30000000-0000-4000-8000-000000712105'::uuid end,
  (array['60000000-0000-4000-8000-000000712001', '60000000-0000-4000-8000-000000712001', '60000000-0000-4000-8000-000000712002',
         '60000000-0000-4000-8000-000000712005', '60000000-0000-4000-8000-000000712005', '60000000-0000-4000-8000-000000712005'])[i]::uuid,
  0, 'MXN', '{}'
from generate_series(1, 6) i;
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, guest_participant_id, buyer_profile_id, registration_number)
select ('72000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000007121' || lpad((case when i = 5 then 1 else i end)::text, 2, '0'))::uuid,
  ('71000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000712001',
  (array['60000000-0000-4000-8000-000000712001', '60000000-0000-4000-8000-000000712001', '60000000-0000-4000-8000-000000712002',
         '60000000-0000-4000-8000-000000712005', '60000000-0000-4000-8000-000000712005', '60000000-0000-4000-8000-000000712005'])[i]::uuid,
  case when i = 5 then null else ('10000000-0000-4000-8000-0000007121' || lpad(i::text, 2, '0'))::uuid end,
  case when i = 5 then '30000000-0000-4000-8000-000000712105'::uuid end,
  ('10000000-0000-4000-8000-0000007121' || lpad((case when i = 5 then 1 else i end)::text, 2, '0'))::uuid,
  'I-712' || i || '-AAAA'
from generate_series(1, 6) i;

insert into app.participant_pass (registration_id, public_code) values
  ('72000000-0000-4000-8000-000000712101', 'P-7121-AAA1'), ('72000000-0000-4000-8000-000000712103', 'P-7123-AAA3'),
  ('72000000-0000-4000-8000-000000712105', 'P-7125-AAA5');
insert into app.kit_definition (kit_definition_id, edition_id, name, status) values
  ('d0000000-0000-4000-8000-000000712001', '50000000-0000-4000-8000-000000712001', 'Kit 712', 'ACTIVE');
insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, status) values
  ('e0000000-0000-4000-8000-000000712001', 'd0000000-0000-4000-8000-000000712001', 'm', 'M', 'ACTIVE');
insert into app.kit_allocation (registration_id, kit_definition_id, kit_variant_id, status) values
  ('72000000-0000-4000-8000-000000712103', 'd0000000-0000-4000-8000-000000712001', 'e0000000-0000-4000-8000-000000712001', 'ASSIGNED'),
  ('72000000-0000-4000-8000-000000712105', 'd0000000-0000-4000-8000-000000712001', 'e0000000-0000-4000-8000-000000712001', 'DELIVERED');

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;

-- ===========================================================================================
-- CANCEL REGISTRATION
-- ===========================================================================================
-- Authority: runner, CHECKIN and an OPERATOR scoped to another Edition cannot cancel (SEC-020).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712101", "role": "authenticated"}';
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712103', 'x') $$) ->> 'code', 'FORBIDDEN',
  'a runner cannot cancel a registration');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712103', 'x') $$) ->> 'code', 'FORBIDDEN',
  'CHECKIN staff cannot cancel a registration');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712103', 'x') $$) ->> 'code', 'FORBIDDEN',
  'an OPERATOR scoped to another Edition cannot cancel (scope derived from the target row)');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712103', '  ') $$) -> 'detail' ->> 'field', 'reason',
  'a reason is mandatory');
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712103', 'Motivo', 'INVENTADA') $$) -> 'detail' ->> 'field',
  'reason_category', 'the reason category is a closed set');
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712999', 'Motivo') $$) ->> 'code', 'NOT_FOUND',
  'an unknown registration is NOT_FOUND');

-- R3 (5K, pass + ASSIGNED kit) before the event.
select is(pg_temp.avail('60000000-0000-4000-8000-000000712002', 'confirmed'), '1', 'before: the 5K holds one confirmed registration');
insert into ids select 'c3', public.cancel_registration('72000000-0000-4000-8000-000000712103',
  'Texto libre interno: llamó para decir que se lesionó', 'PARTICIPANT_REQUEST', 'p712-cancel-key-0003');
select is((select value ->> 'status' from ids where name = 'c3'), 'CANCELED', 'OPERATOR cancels a CONFIRMED registration before the event');
select is(pg_temp.sv($q$ select status || '/' || (canceled_at is not null)::text from app.registration
  where registration_id = '72000000-0000-4000-8000-000000712103' $q$), 'CANCELED/true', 'the row is kept (never DELETE) with its timestamp');
select is(pg_temp.sv($q$ select status from app.participant_pass where registration_id = '72000000-0000-4000-8000-000000712103' $q$),
  'CANCELED', 'the pass is CANCELED');
select is(pg_temp.sv($q$ select status || '/' || notes from app.kit_allocation where registration_id = '72000000-0000-4000-8000-000000712103' $q$),
  'CANCELED/registration canceled', 'an undelivered kit allocation is released');
select is(pg_temp.avail('60000000-0000-4000-8000-000000712002', 'confirmed'), '0',
  'capacity is released by status alone (the live count dropped to zero)');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'REGISTRATION_CANCELED'
  and entity_id = '72000000-0000-4000-8000-000000712103' and reason like 'Texto libre interno%' $q$), '1',
  'the cancellation is audited with actor and the internal reason');

-- The comms layer gets the recipient reference and the closed category; the free text never leaves the DB.
select is(pg_temp.sv($q$ select payload ->> 'recipient_profile_id' || '/' || (payload ->> 'reason_category') || '/' || (payload ->> 'participant_kind')
  from infra.outbox_event where effect_key = 'RegistrationCanceled:72000000-0000-4000-8000-000000712103' $q$),
  '10000000-0000-4000-8000-000000712103/PARTICIPANT_REQUEST/PROFILE', 'RegistrationCanceled carries the recipient profile, the reason category and the kind');
select is(pg_temp.sv($q$ select (payload ?& array['registration_id', 'edition_id', 'recipient_profile_id', 'reason_category'])::text
  from infra.outbox_event where effect_key = 'RegistrationCanceled:72000000-0000-4000-8000-000000712103' $q$), 'true',
  'the event has registration_id, edition_id, recipient and category');
select is(pg_temp.sv($q$ select (payload::text like '%lesion%' or payload ? 'reason' or payload ? 'cancel_reason')::text
  from infra.outbox_event where effect_key = 'RegistrationCanceled:72000000-0000-4000-8000-000000712103' $q$), 'false',
  'the free-text reason is never in the event');

-- Replay and double cancel.
insert into ids select 'c3b', public.cancel_registration('72000000-0000-4000-8000-000000712103',
  'Texto libre interno: llamó para decir que se lesionó', 'PARTICIPANT_REQUEST', 'p712-cancel-key-0003');
select is((select value from ids where name = 'c3b'), (select value from ids where name = 'c3'), 'a retry with the same key replays');
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712103', 'otra vez') $$) -> 'detail' ->> 'reason',
  'invalid_transition', 'cancelling twice is an invalid transition');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event where effect_key like 'RegistrationCanceled:72000000-0000-4000-8000-000000712103%' $q$),
  '1', 'one event for one cancellation');

-- A Guest has no account: the recipient is the buyer; a DELIVERED kit is flagged for review, not rewritten.
insert into ids select 'c5', public.cancel_registration('72000000-0000-4000-8000-000000712105', 'Duplicado', 'DUPLICATE_REGISTRATION');
select is(pg_temp.sv($q$ select (payload ->> 'participant_kind') || '/' || (payload ->> 'recipient_profile_id') || '/' || (payload ->> 'kit_review_required')
  from infra.outbox_event where effect_key = 'RegistrationCanceled:72000000-0000-4000-8000-000000712105' $q$),
  'GUEST/10000000-0000-4000-8000-000000712101/true', 'a Guest cancellation is addressed to the buyer and flags the delivered kit');
select is(pg_temp.sv($q$ select status || '/' || (notes like '%review kit%')::text from app.kit_allocation
  where registration_id = '72000000-0000-4000-8000-000000712105' $q$), 'DELIVERED/true', 'a DELIVERED kit stays DELIVERED and is marked for review');
select throws_ok($$ delete from app.registration where registration_id = '72000000-0000-4000-8000-000000712105' $$, null, null,
  'a registration can never be deleted');

-- ===========================================================================================
-- CHANGE REGISTRATION MODALITY  (E1: R1,R2 in 10K [full], R4,R6 in 21K, R3/R5 canceled; global 6, confirmed 4)
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712104',
  '60000000-0000-4000-8000-000000712002', null, 'Cambio') $$) ->> 'code', 'FORBIDDEN', 'CHECKIN staff cannot change a modality');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712104',
  '60000000-0000-4000-8000-000000712002', null, null) $$) -> 'detail' ->> 'field', 'reason', 'a reason is mandatory');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712104',
  '60000000-0000-4000-8000-000000712005', null, 'Cambio') $$) -> 'detail' ->> 'reason', 'same_as_current', 'the target must differ from the current modality');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712104',
  '60000000-0000-4000-8000-000000712003', null, 'Cambio') $$) ->> 'code', 'MODALITY_NOT_AVAILABLE', 'a CLOSED target modality is refused');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712104',
  '60000000-0000-4000-8000-000000000999', null, 'Cambio') $$) ->> 'code', 'MODALITY_NOT_AVAILABLE', 'a modality of another Edition (or unknown) is refused');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712104',
  '60000000-0000-4000-8000-000000712001', null, 'Cambio') $$) ->> 'code', 'CAPACITY_UNAVAILABLE', 'a full target modality (10K 2/2) is refused');
select is(pg_temp.avail('60000000-0000-4000-8000-000000712005', 'confirmed'), '2', 'a refused change moved nothing (21K still 2)');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712104',
  '60000000-0000-4000-8000-000000712007', null, 'Cambio') $$) -> 'detail' ->> 'field_key', 'club',
  'a REQUIRED form field of the target modality that was never answered is refused (FORM_INVALID)');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712106',
  '60000000-0000-4000-8000-000000712006', null, 'Cambio') $$) -> 'detail' ->> 'reason', 'required', 'a USER_SELECTS category must be chosen');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712106',
  '60000000-0000-4000-8000-000000712006', 'b0000000-0000-4000-8000-000000000999', 'Cambio') $$) -> 'detail' ->> 'reason', 'invalid_category',
  'a category outside the target modality is refused');

reset role;
update app.runner_profile set account_state = 'BANNED' where runner_profile_id = '10000000-0000-4000-8000-000000712106';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712106',
  '60000000-0000-4000-8000-000000712006', 'b0000000-0000-4000-8000-000000712001', 'Cambio') $$) ->> 'code', 'PARTICIPANT_NOT_ELIGIBLE',
  'the participant must still be eligible (a banned account is refused)');
reset role;
update app.runner_profile set account_state = 'ACTIVE' where runner_profile_id = '10000000-0000-4000-8000-000000712106';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712002", "role": "authenticated"}';

-- A valid change with category: R6 21K -> 15K. The first change records the pre-change state as revision 1.
insert into ids select 'm6', public.change_registration_modality('72000000-0000-4000-8000-000000712106',
  '60000000-0000-4000-8000-000000712006', 'b0000000-0000-4000-8000-000000712001', 'Cambio solicitado por el corredor', 'p712-change-key-0006');
select is((select value ->> 'modality_id' from ids where name = 'm6'), '60000000-0000-4000-8000-000000712006', 'staff moved the registration to the 15K');
select is((select value -> 'official_distance_impact' ->> 'from_m' from ids where name = 'm6') || '>' ||
          (select value -> 'official_distance_impact' ->> 'to_m' from ids where name = 'm6'), '21097>15000', 'the official distance impact is reported');
select is(pg_temp.sv($q$ select modality_id::text from app.registration where registration_id = '72000000-0000-4000-8000-000000712106' $q$),
  '60000000-0000-4000-8000-000000712006', 'the registration row points at the new modality');
select is(pg_temp.sv($q$ select string_agg(revision || ':' || modality_id || ':' || status, ' ' order by revision) from app.registration_revision
  where registration_id = '72000000-0000-4000-8000-000000712106' $q$),
  '1:60000000-0000-4000-8000-000000712005:SUPERSEDED 2:60000000-0000-4000-8000-000000712006:ACTIVE',
  'RegistrationRevision chain: baseline 21K superseded, 15K current');
select is(pg_temp.sv($q$ select count(*) from app.registration_revision where registration_id = '72000000-0000-4000-8000-000000712106' and superseded_at is null $q$),
  '1', 'exactly one current revision');
select is(pg_temp.sv($q$ select category_id::text || '/' || assignment_source from app.registration_category_assignment
  where registration_id = '72000000-0000-4000-8000-000000712106' $q$), 'b0000000-0000-4000-8000-000000712001/USER_SELECTION', 'the category assignment follows the change');
select is(pg_temp.avail('60000000-0000-4000-8000-000000712005', 'confirmed'), '1', 'the old modality released a place');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'REGISTRATION_MODALITY_CHANGED'
  and entity_id = '72000000-0000-4000-8000-000000712106' and reason = 'Cambio solicitado por el corredor' $q$), '1', 'the change is audited');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event where effect_key like 'RegistrationModalityChanged:72000000-0000-4000-8000-000000712106:%' $q$),
  '1', 'one RegistrationModalityChanged event');
insert into ids select 'm6b', public.change_registration_modality('72000000-0000-4000-8000-000000712106',
  '60000000-0000-4000-8000-000000712006', 'b0000000-0000-4000-8000-000000712001', 'Cambio solicitado por el corredor', 'p712-change-key-0006');
select is((select value from ids where name = 'm6b'), (select value from ids where name = 'm6'), 'a retry with the same key replays');
select is(pg_temp.sv($q$ select count(*) from app.registration_revision where registration_id = '72000000-0000-4000-8000-000000712106' $q$), '2',
  'the replay added no revision');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712103',
  '60000000-0000-4000-8000-000000712002', null, 'Cambio') $$) -> 'detail' ->> 'reason', 'invalid_transition', 'a CANCELED registration cannot change modality');

-- Capacity in a sold-out Edition: R4 21K -> 5K (free since R3 canceled). Global capacity is exactly used (4 of 4):
-- the move is net-zero, so it must not be refused by the global limit.
reset role;
update app.edition set global_capacity = 4 where edition_id = '50000000-0000-4000-8000-000000712001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712002", "role": "authenticated"}';
insert into ids select 'm4', public.change_registration_modality('72000000-0000-4000-8000-000000712104',
  '60000000-0000-4000-8000-000000712002', null, 'Mejor ritmo en 5K');
select is((select value ->> 'revision' from ids where name = 'm4'), '2', 'a sold-out Edition still allows a net-zero move into a free modality');
select is(pg_temp.avail('60000000-0000-4000-8000-000000712002', 'confirmed') || '/' || pg_temp.avail('60000000-0000-4000-8000-000000712005', 'confirmed'),
  '1/0', 'the 5K gained the place and the 21K released it (live counts)');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712106',
  '60000000-0000-4000-8000-000000712002', null, 'Otro') $$) ->> 'code', 'CAPACITY_UNAVAILABLE', 'the 5K (cap 1) is now full for the next one');

-- ===========================================================================================
-- FINALIZATION / CLOSURE BLOCK, REOPEN AND CREDIT REVERSAL
-- ===========================================================================================
reset role;
update app.edition set execution_state = 'FINISHED', registration_state = 'CLOSED', closure_state = 'PENDING' where edition_id = '50000000-0000-4000-8000-000000712001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712002", "role": "authenticated"}';
-- Universe: R1, R2 (10K), R4 (5K), R6 (15K).
select public.resolve_attendance('72000000-0000-4000-8000-000000712101', 'PRESENT', 'Presente', '{"kind": "judge_note"}');
select public.resolve_attendance('72000000-0000-4000-8000-000000712102', 'NO_SHOW', 'No llegó');
select public.resolve_attendance('72000000-0000-4000-8000-000000712104', 'PRESENT', 'Presente', '{"kind": "judge_note"}');
select public.resolve_attendance('72000000-0000-4000-8000-000000712106', 'PRESENT', 'Presente', '{"kind": "judge_note"}');
select public.finalize_attendance('50000000-0000-4000-8000-000000712001');
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712101', 'Tarde') $$) -> 'detail' ->> 'reason',
  'attendance_finalized', 'after finalization a cancellation needs the reopen/correction workflow');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712101',
  '60000000-0000-4000-8000-000000712005', null, 'Tarde') $$) -> 'detail' ->> 'reason', 'attendance_finalized',
  'the same block applies to a modality change');
select is(pg_temp.sv($q$ select status from app.registration where registration_id = '72000000-0000-4000-8000-000000712101' $q$), 'CONFIRMED',
  'a blocked cancellation changed nothing');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712001", "role": "authenticated"}';
insert into ids select 'close1', public.close_edition('50000000-0000-4000-8000-000000712001');
select is((select value ->> 'credits_created' from ids where name = 'close1'), '3', 'closure credits R1, R4 (5K) and R6 (15K) at their CURRENT modality');
select is(pg_temp.sv($q$ select string_agg(official_distance_snapshot_m::text, ',' order by official_distance_snapshot_m) from app.distance_credit
  where edition_id = '50000000-0000-4000-8000-000000712001' $q$), '5000,10000,15000',
  'the credits carry the official distance of the modality in force at closure (a changed modality changes the credit)');
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712101', 'Tarde') $$) -> 'detail' ->> 'reason',
  'edition_closed', 'after closure the cancellation is blocked (edition_closed)');
select is(pg_temp.err($$ select public.change_registration_modality('72000000-0000-4000-8000-000000712101',
  '60000000-0000-4000-8000-000000712005', null, 'Tarde') $$) -> 'detail' ->> 'reason', 'edition_closed',
  'a modality change after closure is blocked (the credit path is correction, i.e. reopen)');

-- Correction path: reopen the closure (credits reversed), then the finalization, then cancel R1 and re-close.
insert into ids select 'reopen1', public.reopen_edition('50000000-0000-4000-8000-000000712001', 'Corrección de cancelación');
select is(pg_temp.err($$ select public.cancel_registration('72000000-0000-4000-8000-000000712101', 'Tarde') $$) -> 'detail' ->> 'reason',
  'attendance_finalized', 'reopening the closure alone does not unlock registrations: attendance must be reopened too');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712002", "role": "authenticated"}';
select public.reopen_attendance_finalization('50000000-0000-4000-8000-000000712001', 'Corrección de cancelación');
insert into ids select 'c1', public.cancel_registration('72000000-0000-4000-8000-000000712101', 'Duplicada con otra cuenta', 'DUPLICATE_REGISTRATION');
select is((select value ->> 'status' from ids where name = 'c1'), 'CANCELED', 'after reopen the cancellation is allowed');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where registration_id = '72000000-0000-4000-8000-000000712101' and status = 'ACTIVE' $q$),
  '0', 'the canceled registration holds no ACTIVE credit (its credit was reversed by the reopen)');
select is(pg_temp.sv($q$ select count(*) from app.distance_credit where registration_id = '72000000-0000-4000-8000-000000712101' and status = 'REVERSED' $q$),
  '1', 'and its reversed credit stays as history');
insert into ids select 'ws', public.attendance_workspace('50000000-0000-4000-8000-000000712001');
select is((select value ->> 'universe_count' from ids where name = 'ws'), '3', 'the canceled registration left the universe (R2, R4, R6)');
select public.finalize_attendance('50000000-0000-4000-8000-000000712001');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712001", "role": "authenticated"}';
insert into ids select 'close2', public.close_edition('50000000-0000-4000-8000-000000712001');
select is((select value ->> 'credits_created' from ids where name = 'close2'), '2', 'the second closure credits only the two remaining PRESENT registrations');

-- Defensive path: an ACTIVE credit that survived outside a closure (a legacy/inconsistent state) is reversed
-- by the cancellation itself. Simulated by retiring the closure and finalization rows directly.
reset role;
update app.administrative_closure set status = 'SUPERSEDED', superseded_at = now(), reopened_at = now(),
  reopened_by_staff_id = '20000000-0000-4000-8000-000000712001', reopen_reason = 'simulacion'
  where edition_id = '50000000-0000-4000-8000-000000712001' and status = 'CLOSED';
update app.attendance_finalization set status = 'SUPERSEDED', superseded_at = now(), reopened_at = now(),
  reopened_by_staff_id = '20000000-0000-4000-8000-000000712001', reopen_reason = 'simulacion'
  where edition_id = '50000000-0000-4000-8000-000000712001' and status = 'FINALIZED';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000712002", "role": "authenticated"}';
insert into ids select 'c6', public.cancel_registration('72000000-0000-4000-8000-000000712106', 'Lesión', 'PARTICIPANT_REQUEST');
select is(pg_temp.sv($q$ select status from app.distance_credit where registration_id = '72000000-0000-4000-8000-000000712106' $q$), 'REVERSED',
  'cancelling a registration that still has an ACTIVE credit reverses it (REVERSED, never deleted)');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event where effect_key like 'DistanceCreditReversed:%'
  and payload ->> 'edition_id' = '50000000-0000-4000-8000-000000712001' $q$), '4', 'every reversal emitted its event (3 from the reopen, 1 from the cancellation)');

select * from finish();
rollback;
