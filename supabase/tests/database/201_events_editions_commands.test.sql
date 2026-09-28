-- T30 Event/Edition commands (Master §27-33, §59, §155; SEC-005/006/020): create/update, slug history
-- + redirect, schedule revisions and every Edition transition, incl. readiness gating and RBAC
-- (OPERATOR vs EDITION-scoped ADMIN of another Edition). Synthetic ids in a private 2010x range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(34);

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
-- Fixture: a GLOBAL ADMIN, a GLOBAL OPERATOR and an ADMIN scoped only to Edition A.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000201001', 'events-admin-global@example.test'),
  ('00000000-0000-4000-8000-000000201002', 'events-operator-global@example.test'),
  ('00000000-0000-4000-8000-000000201003', 'events-admin-edition-a@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000201001', '00000000-0000-4000-8000-000000201001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000201002', '00000000-0000-4000-8000-000000201002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000201003', '00000000-0000-4000-8000-000000201003', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000201001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000201002', 'OPERATOR', 'GLOBAL');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000201001', event_type_id, 'Editions Cmd Event', 'editions-cmd-event'
from app.event_type where key = 'ROAD_RACE';

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Events: EVENT_CREATE is GLOBAL only.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000201002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_event(jsonb_build_object('event_type_key', 'ROAD_RACE',
  'name', 'Denied Event', 'canonical_key', 'denied-event')) $$) ->> 'code', 'FORBIDDEN',
  '§145 OPERATOR cannot EVENT_CREATE');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000201001", "role": "authenticated"}';
insert into ids select 'event', public.create_event(jsonb_build_object('event_type_key', 'ROAD_RACE',
  'name', 'Second Cmd Event', 'canonical_key', 'second-cmd-event'));
select is((select value ->> 'name' from ids where name = 'event'), 'Second Cmd Event', 'ADMIN creates an Event');
insert into ids select 'event_renamed', public.update_event((select value ->> 'event_id' from ids where name = 'event')::uuid,
  jsonb_build_object('name', 'Second Cmd Event Renamed'));
select is((select value ->> 'canonical_key' from ids where name = 'event_renamed'),
  (select value ->> 'canonical_key' from ids where name = 'event'), '§27 canonical_key is immutable across update_event');

-- ---------------------------------------------------------------------------------------------
-- Editions: close_at materialised from schedule + §155 offset when no explicit value is given.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select public.create_edition('40000000-0000-4000-8000-000000201001',
  jsonb_build_object('slug', 'no-date-no-close', 'name', 'X', 'registration_mode', 'FREE', 'city', 'Monterrey',
    'state_region', 'NL')) $$) ->> 'code', 'VALIDATION_ERROR',
  '§155 registration_close_at is required when no schedule date is given');

insert into ids select 'edition_a', public.create_edition('40000000-0000-4000-8000-000000201001',
  jsonb_build_object('slug', 'edition-a-cmd', 'name', 'Edition A', 'registration_mode', 'FREE', 'city', 'Monterrey',
    'state_region', 'NL', 'schedule', jsonb_build_object('local_date', (current_date + 30)::text, 'local_start_time', '07:00:00')));
select isnt((select value ->> 'registration_close_at' from ids where name = 'edition_a'), null,
  '§155 registration_close_at is materialised from schedule date minus the platform offset');
select ok((select (value ->> 'registration_close_at')::timestamptz from ids where name = 'edition_a')
  < (select (value -> 'schedule' ->> 'effective_start_at')::timestamptz from ids where name = 'edition_a'),
  'materialised close precedes the schedule start');

select is(pg_temp.err(format($$ select public.create_edition('40000000-0000-4000-8000-000000201001',
  jsonb_build_object('slug', %L, 'name', 'Dup slug', 'registration_mode', 'FREE', 'city', 'Monterrey',
    'state_region', 'NL', 'registration_close_at', %L)) $$,
  (select value ->> 'slug' from ids where name = 'edition_a'),
  to_char(now() + interval '10 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) ->> 'code', 'CONFLICT',
  '§59 a slug already used by another Edition is CONFLICT');

-- ---------------------------------------------------------------------------------------------
-- update_edition: slug change writes edition_slug_history and old slugs redirect (Master §59).
-- ---------------------------------------------------------------------------------------------
insert into ids select 'edition_a_v2', public.update_edition((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid,
  jsonb_build_object('slug', 'edition-a-cmd-v2'));
select is((select count(*)::int from app.edition_slug_history
           where edition_id = (select value ->> 'edition_id' from ids where name = 'edition_a')::uuid and old_slug = 'edition-a-cmd'),
  1, '§59 slug change is recorded in edition_slug_history');
reset role;
select is((private.resolve_edition_slug('edition-a-cmd') ->> 'slug'), 'edition-a-cmd-v2',
  '§59 the old slug resolves to the current one');
select ok((private.resolve_edition_slug('edition-a-cmd') ->> 'redirect')::boolean,
  '§59 resolving an old slug flags redirect=true');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture to reach readiness: modality, capacity, form, legal docs (own set; seeded placeholders
-- lack a PUBLISHED version so they are archived here to keep the check deterministic, as in 200).
-- ---------------------------------------------------------------------------------------------
-- Default eligibility_rules ({} => min_age 15) admits minors (KERNEL_READY: "V1 15+"), so MINOR_TERMS
-- is required too.
reset role;
update app.legal_document set status = 'ARCHIVED' where document_type in ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE', 'SPORT_WAIVER', 'MINOR_TERMS');
insert into app.legal_document (legal_document_id, document_key, document_type, status) values
  ('92000000-0000-4000-8000-000000201001', 'TERMS_OF_SERVICE_2', 'TERMS_OF_SERVICE', 'ACTIVE'),
  ('92000000-0000-4000-8000-000000201002', 'PRIVACY_NOTICE_2', 'PRIVACY_NOTICE', 'ACTIVE'),
  ('92000000-0000-4000-8000-000000201003', 'SPORT_WAIVER_2', 'SPORT_WAIVER', 'ACTIVE'),
  ('92000000-0000-4000-8000-000000201004', 'MINOR_TERMS_2', 'MINOR_TERMS', 'ACTIVE');
insert into app.legal_document_version (legal_document_id, version, content_markdown, status, published_at)
select legal_document_id, 1, '[DOCUMENTO DE PRUEBA LOCAL — no es texto legal]', 'PUBLISHED', now()
from app.legal_document where legal_document_id in
  ('92000000-0000-4000-8000-000000201001', '92000000-0000-4000-8000-000000201002', '92000000-0000-4000-8000-000000201003',
   '92000000-0000-4000-8000-000000201004');
set local role authenticated;

insert into ids select 'modality_a', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid,
  jsonb_build_object('key', '5k', 'name', '5K', 'official_distance_m', 5000, 'effective_capacity', 100));
insert into ids select 'price_a', public.create_price_offer((select value ->> 'modality_id' from ids where name = 'modality_a')::uuid,
  jsonb_build_object('name', 'General', 'amount_minor', 0));
insert into ids select 'form_a', public.create_registration_form((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid,
  jsonb_build_object('copy_published_fields', false));
select public.publish_registration_form((select value ->> 'registration_form_id' from ids where name = 'form_a')::uuid);

reset role;
select ok(not (private.publication_readiness((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid) ->> 'ready')::boolean,
  'publication is not ready without a description content block');
set local role authenticated;
select is(pg_temp.err(format($$ select public.publish_edition(%L) $$,
  (select value ->> 'edition_id' from ids where name = 'edition_a'))) ->> 'code', 'BUSINESS_RULE_VIOLATION',
  '§30 PUBLISH is refused while publication_readiness is not ready');

select public.create_content_block((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid,
  jsonb_build_object('block_type', 'RICH_TEXT', 'status', 'PUBLISHED', 'payload', jsonb_build_object('markdown', repeat('a', 40))));

insert into ids select 'edition_a_pub', public.publish_edition((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid);
select is((select value -> 'edition' ->> 'publication_state' from ids where name = 'edition_a_pub'), 'PUBLISHED',
  '§30 PUBLISH succeeds once publication_readiness is ready');

select is(pg_temp.err(format($$ select public.publish_edition(%L) $$,
  (select value ->> 'edition_id' from ids where name = 'edition_a'))) ->> 'code', 'CONFLICT',
  '§32 publishing an already-PUBLISHED Edition is an invalid_transition CONFLICT');

select is(pg_temp.err(format($$ select public.update_edition(%L, jsonb_build_object('timezone', 'America/Mexico_City')) $$,
  (select value ->> 'edition_id' from ids where name = 'edition_a'))) ->> 'code', 'BUSINESS_RULE_VIOLATION',
  '§29 timezone is locked once the Edition left DRAFT');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000201002", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.open_edition_registration(%L) $$,
  (select value ->> 'edition_id' from ids where name = 'edition_a'))) ->> 'code', 'FORBIDDEN',
  '§145 OPERATOR cannot EDITION_LIFECYCLE_MANAGE (open registration)');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000201001", "role": "authenticated"}';
insert into ids select 'edition_a_open', public.open_edition_registration((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid);
select is((select value -> 'edition' ->> 'registration_state' from ids where name = 'edition_a_open'), 'OPEN',
  '§30-31 OPEN_REGISTRATION succeeds once registration_readiness is ready');

select is(pg_temp.err(format($$ select public.update_edition(%L, jsonb_build_object('registration_mode', 'EXTERNAL_WHATSAPP')) $$,
  (select value ->> 'edition_id' from ids where name = 'edition_a'))) ->> 'code', 'BUSINESS_RULE_VIOLATION',
  '§32 registration_mode is locked once registration has opened');

insert into ids select 'edition_a_paused', public.pause_edition_registration((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid);
select is((select value -> 'edition' ->> 'registration_state' from ids where name = 'edition_a_paused'), 'PAUSED', 'PAUSE_REGISTRATION');
insert into ids select 'edition_a_resumed', public.resume_edition_registration((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid);
select is((select value -> 'edition' ->> 'registration_state' from ids where name = 'edition_a_resumed'), 'OPEN', 'RESUME_REGISTRATION');

-- Cancel: releases ACTIVE holds/claims of the Edition (Master §33), no refund processed here.
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000201004', 'events-buyer@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
values ('10000000-0000-4000-8000-000000201001', '00000000-0000-4000-8000-000000201004', 'READY', 'ACTIVE', 'Buyer',
  '1990-01-01', 'F', '+528110020101', 'Contacto', '+528110020102', 'Madre', now());
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  status, registration_mode, currency, total_snapshot_minor, expires_at)
values ('80000000-0000-4000-8000-000000201001', 'R-EVT1-0001', '10000000-0000-4000-8000-000000201001',
  (select value ->> 'edition_id' from ids where name = 'edition_a')::uuid, 'PENDING_CONFIRMATION', 'FREE', 'MXN', 0, now() + interval '1 day');
insert into app.registration_hold (registration_hold_id, registration_request_id, modality_id, quantity, status, expires_at)
values ('82000000-0000-4000-8000-000000201001', '80000000-0000-4000-8000-000000201001',
  (select value ->> 'modality_id' from ids where name = 'modality_a')::uuid, 1, 'ACTIVE', now() + interval '1 day');
set local role authenticated;

insert into ids select 'edition_a_canceled', public.cancel_edition((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid,
  jsonb_build_object('reason', 'weather'));
select is((select value -> 'edition' ->> 'execution_state' from ids where name = 'edition_a_canceled'), 'CANCELED', '§33 CANCEL sets execution_state CANCELED');
select is((select value -> 'edition' ->> 'registration_state' from ids where name = 'edition_a_canceled'), 'CLOSED', '§33 CANCEL closes registration');
select is((select value ->> 'released_holds' from ids where name = 'edition_a_canceled'), '1', '§33 CANCEL releases the ACTIVE hold');
reset role;
select is((select status from app.registration_hold where registration_hold_id = '82000000-0000-4000-8000-000000201001'), 'RELEASED',
  '§33 the hold row is materialised RELEASED');
set local role authenticated;

select is(pg_temp.err(format($$ select public.start_edition(%L) $$,
  (select value ->> 'edition_id' from ids where name = 'edition_a'))) ->> 'code', 'CONFLICT',
  '§32 START from CANCELED execution_state is an invalid_transition');

-- ---------------------------------------------------------------------------------------------
-- A second Edition to exercise start/finish/postpone/reschedule and cross-Edition RBAC.
-- ---------------------------------------------------------------------------------------------
reset role;
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id)
select '20000000-0000-4000-8000-000000201003', 'ADMIN', 'EDITION', (value ->> 'edition_id')::uuid from ids where name = 'edition_a';
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000201001", "role": "authenticated"}';
insert into ids select 'edition_b', public.create_edition('40000000-0000-4000-8000-000000201001',
  jsonb_build_object('slug', 'edition-b-cmd', 'name', 'Edition B', 'registration_mode', 'FREE', 'city', 'Monterrey',
    'state_region', 'NL', 'schedule', jsonb_build_object('local_date', (current_date + 30)::text)));

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000201003", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.update_edition(%L, jsonb_build_object('name', 'Hijacked')) $$,
  (select value ->> 'edition_id' from ids where name = 'edition_b'))) ->> 'code', 'FORBIDDEN',
  '§145 an EDITION-scoped ADMIN of Edition A cannot manage Edition B');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000201001", "role": "authenticated"}';
insert into ids select 'edition_a_renamed', public.update_edition((select value ->> 'edition_id' from ids where name = 'edition_a')::uuid,
  jsonb_build_object('name', 'Edition A Renamed'));
select is((select value ->> 'name' from ids where name = 'edition_a_renamed'), 'Edition A Renamed',
  '§33 editorial fields (name) stay editable on a CANCELED Edition; the page is kept');
select public.create_content_block((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid,
  jsonb_build_object('block_type', 'RICH_TEXT', 'status', 'PUBLISHED', 'payload', jsonb_build_object('markdown', repeat('b', 40))));
insert into ids select 'modality_b', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid,
  jsonb_build_object('key', '5k', 'name', '5K', 'official_distance_m', 5000, 'effective_capacity', 100));
insert into ids select 'price_b', public.create_price_offer((select value ->> 'modality_id' from ids where name = 'modality_b')::uuid,
  jsonb_build_object('name', 'General', 'amount_minor', 0));
insert into ids select 'form_b', public.create_registration_form((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid,
  jsonb_build_object('copy_published_fields', false));
select public.publish_registration_form((select value ->> 'registration_form_id' from ids where name = 'form_b')::uuid);
select public.publish_edition((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid);

insert into ids select 'edition_b_postponed', public.postpone_edition((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid,
  jsonb_build_object('reason', 'venue unavailable'));
select is((select value -> 'edition' ->> 'execution_state' from ids where name = 'edition_b_postponed'), 'POSTPONED', '§33 POSTPONE');
select is((select value -> 'edition' ->> 'registration_state' from ids where name = 'edition_b_postponed'), 'NOT_OPEN',
  '§33 POSTPONE leaves registration_state untouched when it was never OPEN');

insert into ids select 'edition_b_rescheduled', public.reschedule_edition((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid,
  jsonb_build_object('reason', 'new venue confirmed', 'local_date', (current_date + 60)::text));
select is((select value -> 'edition' ->> 'execution_state' from ids where name = 'edition_b_rescheduled'), 'SCHEDULED', '§29/§33 RESCHEDULE');

insert into ids select 'edition_b_started', public.start_edition((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid);
select is((select value -> 'edition' ->> 'execution_state' from ids where name = 'edition_b_started'), 'IN_PROGRESS', 'START');

insert into ids select 'edition_b_finished', public.finish_edition((select value ->> 'edition_id' from ids where name = 'edition_b')::uuid);
select is((select value -> 'edition' ->> 'execution_state' from ids where name = 'edition_b_finished'), 'FINISHED', 'FINISH');
select is((select value -> 'edition' ->> 'closure_state' from ids where name = 'edition_b_finished'), 'PENDING',
  '§32 FINISH moves closure_state OPEN -> PENDING');
select is((select value -> 'edition' ->> 'registration_state' from ids where name = 'edition_b_finished'), 'CLOSED', 'FINISH closes registration');

select * from finish();
rollback;
