-- P3-D anti-hoarding (owner decision OD-P2-01). ALTCHA clearance gate inside create_registration_request (EXTERNAL_WHATSAPP and an
-- account younger than the policy window, by server time), including the bypass analysis for the RPC callable by `authenticated`;
-- the edition-level alert (one admin task per Edition, never cancels anything) and its configurable, audited policy.
-- Synthetic ids in a 721 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(60);

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

-- ---------------------------------------------------------------------------------------------
-- Fixture. Buyers: N (account created now = NEW), O (3 days = OLD), U (created_at NULL: raw-SQL fixture rows), N2 (NEW).
-- Editions: EA / EB / EC are EXTERNAL_WHATSAPP (capacity 40 on one Modality), EF is FREE.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-000000721001', 'p721-new@example.test', now()),
  ('00000000-0000-4000-8000-000000721002', 'p721-old@example.test', now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000721005', 'p721-new2@example.test', now() - interval '30 minutes'),
  ('00000000-0000-4000-8000-000000721006', 'p721-edge@example.test', now() - interval '25 hours');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000721003', 'p721-nullage@example.test'),
  ('00000000-0000-4000-8000-000000721004', 'p721-admin@example.test'),
  ('00000000-0000-4000-8000-000000721007', 'p721-operator@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000721004', '00000000-0000-4000-8000-000000721004', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000721007', '00000000-0000-4000-8000-000000721007', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000721004', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000721007', 'OPERATOR', 'GLOBAL');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-00000072100' || i)::uuid, ('00000000-0000-4000-8000-00000072100' || i)::uuid, 'READY', 'ACTIVE',
  'Buyer 721-' || i, date '1990-01-01', 'M', '+52811007210' || i, 'Contacto', '+52811007211' || i, 'Hermano', now()
from generate_series(1, 6) i where i <> 4;
insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible)
select ('10000000-0000-4000-8000-00000072100' || i)::uuid, ('c0000000-0000-4000-8000-00000072100' || i)::uuid, 'ELIGIBLE', true
from generate_series(1, 6) i where i <> 4;
-- OWN-05: account-level acceptance of whatever TERMS/PRIVACY versions are currently published (none on a pristine db:reset; some
-- after integration runs), exactly like the integration fixtures: the gate under test comes after it.
insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context)
select rp.runner_profile_id, c.legal_document_version_id, '{"via": "test-fixture"}'::jsonb
from app.runner_profile rp cross join private.account_legal_current_versions() c
where rp.auth_user_id::text like '00000000-0000-4000-8000-00000072100_';
-- Guests: 9 for O (single-buyer trigger), 5 for N2 (share trigger), 2 for N.
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
select ('30000000-0000-4000-8000-0000007212' || lpad(g::text, 2, '0'))::uuid,
  case when g <= 9 then '10000000-0000-4000-8000-000000721002' when g <= 14 then '10000000-0000-4000-8000-000000721005'
       else '10000000-0000-4000-8000-000000721001' end::uuid,
  'Invitado 721-' || g, date '1992-02-02', 'F', '+5281100721' || lpad(g::text, 2, '0'), 'Contacto', '+5281100722' || lpad(g::text, 2, '0'), 'Amigo'
from generate_series(1, 16) g;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000721001', event_type_id, 'Hoarding Event', 'p721-hoarding-event' from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, registration_mode,
  timezone, registration_open_at, registration_close_at, city, state_region, country_code, whatsapp_phone_e164, published_at)
select ('50000000-0000-4000-8000-00000072100' || i)::uuid, '40000000-0000-4000-8000-000000721001', 'p721-hoarding-' || i, 'Hoarding ' || i,
  'PUBLISHED', 'SCHEDULED', 'OPEN', case when i = 4 then 'FREE' else 'EXTERNAL_WHATSAPP' end, 'America/Monterrey',
  now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', case when i = 4 then null else '+528110009999' end, now()
from generate_series(1, 4) i;
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order)
select ('60000000-0000-4000-8000-00000072100' || i)::uuid, ('50000000-0000-4000-8000-00000072100' || i)::uuid, '5k', '5K', 5000, true, 1
from generate_series(1, 4) i;
insert into app.modality_capacity (modality_id, effective_capacity)
select ('60000000-0000-4000-8000-00000072100' || i)::uuid, 40 from generate_series(1, 3) i;
insert into app.price_offer (modality_id, name, amount_minor, currency)
select ('60000000-0000-4000-8000-00000072100' || i)::uuid, 'General', 0, 'MXN' from generate_series(1, 4) i;

-- The SPORT_WAIVER every adult participant must accept (same pattern as 400: published inside this rolled-back transaction).
insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at)
select '69000000-0000-4000-8000-000000721099', legal_document_id, 1, 'Acepto el deslinde.', 'PUBLISHED', now()
from app.legal_document where document_key = 'SPORT_WAIVER'
on conflict (legal_document_id, version) do nothing;

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
insert into ids select 'waiver', to_jsonb((select legal_document_version_id
  from private.registration_required_documents('50000000-0000-4000-8000-000000721001', false) where document_type = 'SPORT_WAIVER'));

-- participants / acceptances builders: the buyer's own profile plus the first p_guests guests of a range.
create function pg_temp.parts(p_edition int, p_buyer int, p_guest_from int, p_guests int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-00000072100' || p_buyer,
    'modality_id', '60000000-0000-4000-8000-00000072100' || p_edition))
  || coalesce((select jsonb_agg(jsonb_build_object('kind', 'GUEST', 'guest_participant_id',
       '30000000-0000-4000-8000-0000007212' || lpad(g::text, 2, '0'), 'modality_id', '60000000-0000-4000-8000-00000072100' || p_edition) order by g)
     from generate_series(p_guest_from, p_guest_from + p_guests - 1) g), '[]'::jsonb) $$;
create function pg_temp.accs(p_count int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('participant_index', i, 'legal_document_version_id', (select value from ids where name = 'waiver')) order by i), '[]'::jsonb)
  from generate_series(0, p_count - 1) i $$;
grant execute on function pg_temp.parts(int, int, int, int), pg_temp.accs(int) to authenticated;

-- ===========================================================================================
-- A. Account age by server time and what the UI is told
-- ===========================================================================================
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000721001'), true, 'an account created now is new');
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000721005'), true, 'a 30-minute-old account is new');
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000721006'), false, 'a 25-hour-old account is not new (window 24 h)');
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000721002'), false, 'a 3-day-old account is not new');
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000721003'), false,
  'created_at NULL (raw-SQL fixtures only; GoTrue always stamps it) is treated as not new');
select is(private.registration_account_is_new(null), false, 'an unknown account is not new');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721001", "role": "authenticated"}';
select is(public.registration_captcha_status('50000000-0000-4000-8000-000000721001') ->> 'required', 'true',
  'a new account on an EXTERNAL_WHATSAPP Edition is told the challenge is required');
select is(public.registration_captcha_status('50000000-0000-4000-8000-000000721004') ->> 'applies', 'false', 'a FREE Edition never applies');
select is(pg_temp.err($$ select public.registration_captcha_status('50000000-0000-4000-8000-000000721999') $$) ->> 'code', 'NOT_FOUND',
  'an unknown Edition is NOT_FOUND');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721002", "role": "authenticated"}';
select is(public.registration_captcha_status('50000000-0000-4000-8000-000000721001') ->> 'applies', 'false', 'an old account is never asked');
reset role;
set local role anon;
select is(has_function_privilege('anon', 'public.registration_captcha_status(uuid)', 'execute'), false, 'anon cannot ask for the status');
reset role;

-- ===========================================================================================
-- B. The gate inside the RPC (the direct RPC is exactly what an attacker would call)
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1)) $$) ->> 'code',
  'BUSINESS_RULE_VIOLATION', 'a new account without clearance is refused by the RPC');
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1)) $$) -> 'detail' ->> 'reason',
  'captcha_required', 'with the stable reason the UI keys on');
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1)) $$) -> 'detail' -> 'captcha' ->> 'purpose',
  'registration_request', 'and the challenge purpose');
select is(pg_temp.sv($q$ select (select count(*) from app.registration_request where edition_id = '50000000-0000-4000-8000-000000721001')
  + (select count(*) from app.registration_hold h join app.registration_request r using (registration_request_id) where r.edition_id = '50000000-0000-4000-8000-000000721001')
  + (select count(*) from app.registration_participant_claim where edition_id = '50000000-0000-4000-8000-000000721001') $q$), '0',
  'nothing was created: no request, no hold, no claim (the gate runs before capacity work)');

-- Minting is SYSTEM only: an authenticated caller cannot grant itself a clearance.
select is(has_function_privilege('authenticated', 'public.grant_registration_captcha_clearance(uuid, uuid)', 'execute'), false,
  'authenticated cannot mint a clearance (public wrapper)');
select is(has_function_privilege('authenticated', 'private.grant_registration_captcha_clearance(uuid, uuid)', 'execute'), false,
  'authenticated cannot mint a clearance (private function)');
select is(has_function_privilege('anon', 'public.grant_registration_captcha_clearance(uuid, uuid)', 'execute'), false, 'anon cannot either');
select is(has_function_privilege('service_role', 'public.grant_registration_captcha_clearance(uuid, uuid)', 'execute'), true, 'service_role (Next after verifying ALTCHA) can');
select is(has_function_privilege('authenticated', 'private.registration_consume_captcha_clearance(uuid, uuid)', 'execute'), false,
  'consuming is internal: no API role can drain someone else''s clearance');
select is(has_table_privilege('authenticated', 'private.registration_captcha_clearance', 'select, insert, update, delete'), false,
  'the clearance table is not reachable by API roles');

-- A clearance for another user / another Edition does not apply.
reset role;
select private.grant_registration_captcha_clearance('00000000-0000-4000-8000-000000721005', '50000000-0000-4000-8000-000000721001');
select private.grant_registration_captcha_clearance('00000000-0000-4000-8000-000000721001', '50000000-0000-4000-8000-000000721002');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1)) $$) -> 'detail' ->> 'reason',
  'captcha_required', 'another user''s clearance and another Edition''s clearance do not open this request');

-- ===========================================================================================
-- C. With a valid clearance: single use, rolled back on failure, expiry, idempotent replay
-- ===========================================================================================
reset role;
select private.grant_registration_captcha_clearance('00000000-0000-4000-8000-000000721001', '50000000-0000-4000-8000-000000721001');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721001", "role": "authenticated"}';
select is(public.registration_captcha_status('50000000-0000-4000-8000-000000721001') ->> 'has_clearance', 'true', 'the status shows a held clearance');

-- A failing command rolls the consumption back: the corrected retry still has its clearance.
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000721001',
  jsonb_build_array(jsonb_build_object('kind', 'PROFILE', 'public_profile_id', 'c0000000-0000-4000-8000-000000721001',
    'modality_id', '60000000-0000-4000-8000-000000721002')), pg_temp.accs(1)) $$) ->> 'code', 'MODALITY_NOT_AVAILABLE',
  'a request that fails later (modality of another Edition) reports its own error, not the captcha');
select is(pg_temp.sv($q$ select count(*) from private.registration_captcha_clearance
  where auth_user_id = '00000000-0000-4000-8000-000000721001' and edition_id = '50000000-0000-4000-8000-000000721001' $q$), '1',
  'and the failed command did not consume the clearance (it rolled back with it)');

insert into ids select 'n_req', public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1),
  'p721-create-key-0001');
select is((select value ->> 'status' from ids where name = 'n_req'), 'PENDING_CONFIRMATION', 'with a clearance the new account''s request is accepted');
select is(pg_temp.sv($q$ select count(*) from private.registration_captcha_clearance
  where auth_user_id = '00000000-0000-4000-8000-000000721001' and edition_id = '50000000-0000-4000-8000-000000721001' $q$), '0',
  'the clearance was consumed by the success');

-- Idempotent replay: no clearance, same key and body -> the stored response, nothing new.
select is(public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1), 'p721-create-key-0001'),
  (select value from ids where name = 'n_req'), 'a replay with the same key returns the stored response without a new clearance');
select is(pg_temp.sv($q$ select count(*) from app.registration_request where buyer_profile_id = '10000000-0000-4000-8000-000000721001'
  and edition_id = '50000000-0000-4000-8000-000000721001' $q$), '1', 'and creates nothing');

-- Single use: cancel, then a new request needs a new clearance.
select is(public.cancel_registration_request(((select value ->> 'registration_request_id' from ids where name = 'n_req'))::uuid, 'cambio de planes') ->> 'status',
  'CANCELED_BY_BUYER', 'the buyer cancels');
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1)) $$) -> 'detail' ->> 'reason',
  'captcha_required', 'one clearance buys one request: the next attempt asks again');
-- A replay with the same key after a cancel still returns the stored response (it is a replay, not a new request).
select is(public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1), 'p721-create-key-0001') ->> 'status',
  'PENDING_CONFIRMATION', 'the stored response of the original key is replayed as it was');

-- Expiry.
reset role;
select private.grant_registration_captcha_clearance('00000000-0000-4000-8000-000000721001', '50000000-0000-4000-8000-000000721001');
update private.registration_captcha_clearance set granted_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
where auth_user_id = '00000000-0000-4000-8000-000000721001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 1, 15, 0), pg_temp.accs(1)) $$) -> 'detail' ->> 'reason',
  'captcha_required', 'an expired clearance is refused');
select is(public.registration_captcha_status('50000000-0000-4000-8000-000000721001') ->> 'has_clearance', 'false', 'and the status no longer reports it');

-- ===========================================================================================
-- D. Who is unaffected
-- ===========================================================================================
insert into ids select 'free', public.create_registration_request('50000000-0000-4000-8000-000000721004', pg_temp.parts(4, 1, 15, 0), pg_temp.accs(1));
select is((select value ->> 'status' from ids where name = 'free'), 'CONFIRMED', 'FREE registration by a new account needs no challenge');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721002", "role": "authenticated"}';
insert into ids select 'old_small', public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 2, 1, 0), pg_temp.accs(1));
select is((select value ->> 'status' from ids where name = 'old_small'), 'PENDING_CONFIRMATION', 'an account of 3 days needs no challenge');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721006", "role": "authenticated"}';
insert into ids select 'edge', public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 6, 1, 0), pg_temp.accs(1));
select is((select value ->> 'status' from ids where name = 'edge'), 'PENDING_CONFIRMATION', 'an account just past the 24 h window needs no challenge');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721003", "role": "authenticated"}';
insert into ids select 'nullage', public.create_registration_request('50000000-0000-4000-8000-000000721001', pg_temp.parts(1, 3, 1, 0), pg_temp.accs(1));
select is((select value ->> 'status' from ids where name = 'nullage'), 'PENDING_CONFIRMATION', 'a fixture account with NULL created_at is not challenged');

-- ===========================================================================================
-- E. Edition alert: single buyer
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721002", "role": "authenticated"}';
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key like 'hold-concentration:%' and edition_id = '50000000-0000-4000-8000-000000721002' $q$), '0',
  'no alert before any concentration exists');
insert into ids select 'o_big', public.create_registration_request('50000000-0000-4000-8000-000000721002', pg_temp.parts(2, 2, 1, 9), pg_temp.accs(10));
select is((select jsonb_array_length(value -> 'participants') from ids where name = 'o_big'), 10, 'an established account holds 10 places for 24 h');
select is(pg_temp.sv($q$ select status || '/' || blocking_level || '/' || category || '/' || task_key from app.admin_task
  where edition_id = '50000000-0000-4000-8000-000000721002' and source_rule = 'hold-concentration' $q$),
  'OPEN/ACTION_REQUIRED/ANTI_HOARDING/hold-concentration:50000000-0000-4000-8000-000000721002',
  'one ACTION_REQUIRED admin task per Edition opens when a single account holds the policy number of places');
select is(pg_temp.sv($q$ select metadata -> 'triggers' ->> 0 || '/' || (metadata ->> 'top_buyer_places') from app.admin_task
  where source_rule = 'hold-concentration' and edition_id = '50000000-0000-4000-8000-000000721002' $q$), 'SINGLE_BUYER/10', 'with the trigger and the figure in its metadata');
select is(pg_temp.sv($q$ select (metadata::text ~* '(example\.test|Buyer 721|Invitado)')::text from app.admin_task
  where source_rule = 'hold-concentration' and edition_id = '50000000-0000-4000-8000-000000721002' $q$), 'false',
  'the task carries request references, never names or emails');
select is(pg_temp.sv($q$ select status from app.registration_request where buyer_profile_id = '10000000-0000-4000-8000-000000721002'
  and edition_id = '50000000-0000-4000-8000-000000721002' $q$), 'PENDING_CONFIRMATION', 'the alert never cancels anything');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000721002' $q$), '1',
  'one task per Edition (stable task_key)');
select is(pg_temp.sv($q$ select private.registration_evaluate_hold_concentration('50000000-0000-4000-8000-000000721004')::text $q$), null, 'a FREE Edition is never evaluated');

-- ===========================================================================================
-- F. Policy: read, update (ADMIN only, validated, audited) and the share trigger
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721007", "role": "authenticated"}';
select is(pg_temp.err($$ select public.update_anti_hoarding_policy('{"captcha_new_account_hours": 48}') $$) ->> 'code', 'FORBIDDEN', 'an OPERATOR cannot change the policy');
select is(pg_temp.err($$ select public.admin_get_anti_hoarding_policy() $$) ->> 'code', 'FORBIDDEN', 'nor read it');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721004", "role": "authenticated"}';
select is(public.admin_get_anti_hoarding_policy() ->> 'captcha_new_account_hours', '24', 'the default window is 24 h (OD-P2-01)');
select is(public.admin_get_anti_hoarding_policy() ->> 'single_buyer_hold_places', '10', 'the default single-buyer threshold is 10');
select is(pg_temp.err($$ select public.update_anti_hoarding_policy('{"captcha_new_account_hours": 0}') $$) -> 'detail' ->> 'field', 'captcha_new_account_hours', 'validated: window >= 1 h');
select is(pg_temp.err($$ select public.update_anti_hoarding_policy('{"nope": 1}') $$) -> 'detail' ->> 'reason', 'unknown_field', 'validated: unknown field');
select is(public.update_anti_hoarding_policy('{"large_hold_min_places": 2, "new_account_hold_min_places": 3, "new_account_hold_share_percent": 10}') ->> 'large_hold_min_places',
  '2', 'ADMIN lowers the share thresholds');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'ANTI_HOARDING_POLICY_UPDATED'
  and after_snapshot ->> 'large_hold_min_places' = '2' and actor_staff_member_id = '20000000-0000-4000-8000-000000721004' $q$), '1', 'the change is audited');

reset role;
select private.grant_registration_captcha_clearance('00000000-0000-4000-8000-000000721005', '50000000-0000-4000-8000-000000721003');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000721005", "role": "authenticated"}';
insert into ids select 'n2_five', public.create_registration_request('50000000-0000-4000-8000-000000721003', pg_temp.parts(3, 5, 10, 4), pg_temp.accs(5));
select is(pg_temp.sv($q$ select (metadata -> 'triggers')::text || '/' || (metadata ->> 'new_account_large_places') from app.admin_task
  where source_rule = 'hold-concentration' and edition_id = '50000000-0000-4000-8000-000000721003' $q$), '["NEW_ACCOUNT_SHARE"]/5',
  'five places held by a new account (>= 10% of 40 and >= the floor) open the alert through the share trigger');
select is(pg_temp.sv($q$ select (metadata -> 'top_requests' -> 0 ->> 'new_account') from app.admin_task
  where source_rule = 'hold-concentration' and edition_id = '50000000-0000-4000-8000-000000721003' $q$), 'true', 'the top request is flagged as a new account');

-- The alert clears by itself when the concentration goes away; a staff-cancel of the request is exercised in 722.
select is(public.cancel_registration_request(((select value ->> 'registration_request_id' from ids where name = 'n2_five'))::uuid, null) ->> 'status',
  'CANCELED_BY_BUYER', 'the buyer cancels the large hold');
reset role;
select private.admin_tasks_sync('50000000-0000-4000-8000-000000721003');
select is(pg_temp.sv($q$ select status || '/' || resolution_type from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000721003' $q$),
  'RESOLVED/CONDITION_CLEARED', 'the sweep resolves the alert once the hold is gone');

-- The window is configurable: with 1 h the 30-minute account is still new, the 25-hour one is not.
update private.anti_hoarding_policy set captcha_new_account_hours = 1;
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000721005'), true, 'policy window 1 h: 30 minutes is still new');
update private.anti_hoarding_policy set captcha_new_account_hours = 168;
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000721002'), true, 'policy window 168 h: a 3-day-old account is new');

select * from finish();
rollback;
