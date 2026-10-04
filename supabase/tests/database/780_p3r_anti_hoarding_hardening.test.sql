-- P3-R part 1 (P3SECA-01, -02, -07, -13): hold-concentration against TOTAL capacity and per modality whatever the account age, the waived-task
-- re-open, the ALTCHA gate evaluated after the locked Edition re-read, and the queue's is_new_account badge using the gate's source and hours.
-- OD-P2-01 still holds: the alert never cancels anything. Synthetic ids in a 780 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(46);

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
-- Fixture. Buyers 1..13 are ALL established accounts (3 days old) except where a test says otherwise, so every trigger below is the
-- age-blind one. Staff: ADMIN (a) and OPERATOR (b).
--   E1  capacity 40 (one modality)            E2  two modalities, caps 20 + 40       E3  capacity 100 (quiet)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, created_at)
select ('00000000-0000-4000-8000-0000007800' || lpad(i::text, 2, '0'))::uuid, 'p780-' || i || '@example.test', now() - interval '3 days'
from generate_series(1, 13) i;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000780090', 'p780-admin@example.test'),
  ('00000000-0000-4000-8000-000000780091', 'p780-operator@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000780090', '00000000-0000-4000-8000-000000780090', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000780091', '00000000-0000-4000-8000-000000780091', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000780090', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000780091', 'OPERATOR', 'GLOBAL');
insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
  date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
select ('10000000-0000-4000-8000-0000007800' || lpad(i::text, 2, '0'))::uuid, ('00000000-0000-4000-8000-0000007800' || lpad(i::text, 2, '0'))::uuid,
  'READY', 'ACTIVE', 'Buyer 780-' || i, date '1990-01-01', 'M', '+5281100780' || lpad(i::text, 2, '0'), 'Contacto',
  '+5281100781' || lpad(i::text, 2, '0'), 'Hermano', now()
from generate_series(1, 13) i;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000780001', event_type_id, 'P3R Hoarding Event', 'p780-hoarding-event' from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, registration_mode,
  timezone, registration_open_at, registration_close_at, city, state_region, country_code, whatsapp_phone_e164, published_at)
select ('50000000-0000-4000-8000-00000078000' || i)::uuid, '40000000-0000-4000-8000-000000780001', 'p780-hoarding-' || i, 'P3R ' || i,
  'PUBLISHED', 'SCHEDULED', 'OPEN', 'EXTERNAL_WHATSAPP', 'America/Monterrey',
  now() - interval '1 hour', now() + interval '30 days', 'Monterrey', 'NL', 'MX', '+528110009999', now()
from generate_series(1, 3) i;
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000780001', '50000000-0000-4000-8000-000000780001', '5k', '5K', 5000, true, 1),
  ('60000000-0000-4000-8000-000000780002', '50000000-0000-4000-8000-000000780002', '5k', '5K', 5000, true, 1),
  ('60000000-0000-4000-8000-000000780003', '50000000-0000-4000-8000-000000780002', '10k', '10K', 10000, true, 2),
  ('60000000-0000-4000-8000-000000780004', '50000000-0000-4000-8000-000000780003', '5k', '5K', 5000, true, 1);
insert into app.modality_capacity (modality_id, effective_capacity) values
  ('60000000-0000-4000-8000-000000780001', 40), ('60000000-0000-4000-8000-000000780002', 20),
  ('60000000-0000-4000-8000-000000780003', 40), ('60000000-0000-4000-8000-000000780004', 100);

-- One PENDING request per buyer and Edition (a unique index), each holding p_places on one modality.
create function pg_temp.pending(p_buyer int, p_edition int, p_modality int, p_places int) returns void language plpgsql as $$
declare v_request uuid;
begin
  insert into app.registration_request (public_reference, buyer_profile_id, edition_id, registration_mode, currency, total_snapshot_minor,
    whatsapp_phone_snapshot, expires_at)
  values (private.registration_new_public_reference(), ('10000000-0000-4000-8000-0000007800' || lpad(p_buyer::text, 2, '0'))::uuid,
    ('50000000-0000-4000-8000-00000078000' || p_edition)::uuid, 'EXTERNAL_WHATSAPP', 'MXN', 0, '+528110009999', now() + interval '24 hours')
  returning registration_request_id into v_request;
  insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at)
  values (v_request, ('60000000-0000-4000-8000-00000078000' || p_modality)::uuid, p_places, now() + interval '24 hours');
end $$;

-- ===========================================================================================
-- A. Policy defaults, validation, audit
-- ===========================================================================================
select is(private.anti_hoarding_policy_projection() ->> 'total_hold_share_percent', '50.00', 'default: all pending holds >= 50% of capacity');
select is(private.anti_hoarding_policy_projection() ->> 'total_hold_min_places', '20', 'default: and at least 20 places');
select is(private.anti_hoarding_policy_projection() ->> 'modality_hold_share_percent', '70.00', 'default: one modality >= 70% of its capacity');
select is(private.anti_hoarding_policy_projection() ->> 'modality_hold_min_places', '10', 'default: and at least 10 places');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000780091", "role": "authenticated"}';
select is(pg_temp.err($$ select public.update_anti_hoarding_policy('{"total_hold_share_percent": 30}') $$) ->> 'code', 'FORBIDDEN', 'an OPERATOR cannot change the new thresholds');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000780090", "role": "authenticated"}';
select is(public.admin_get_anti_hoarding_policy() ->> 'total_hold_min_places', '20', 'ADMIN reads the new thresholds through the existing route RPC');
select is(pg_temp.err($$ select public.update_anti_hoarding_policy('{"total_hold_share_percent": 0}') $$) -> 'detail' ->> 'field', 'total_hold_share_percent', 'validated: share > 0');
select is(pg_temp.err($$ select public.update_anti_hoarding_policy('{"modality_hold_share_percent": 101}') $$) -> 'detail' ->> 'field', 'modality_hold_share_percent', 'validated: share <= 100');
select is(pg_temp.err($$ select public.update_anti_hoarding_policy('{"total_hold_min_places": 0}') $$) -> 'detail' ->> 'field', 'total_hold_min_places', 'validated: floor >= 1');
select is(public.update_anti_hoarding_policy('{"modality_hold_min_places": 10}') ->> 'modality_hold_min_places', '10', 'a partial update leaves the other thresholds alone');
reset role;

-- ===========================================================================================
-- B. TOTAL_HOLD_SHARE: six ESTABLISHED accounts, 4 places each (24 of 40 = 60%) -- the P3SECA-01 blind spot
-- ===========================================================================================
select pg_temp.pending(i, 1, 1, 4) from generate_series(1, 6) i;
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$), '0',
  'raw-SQL holds do not evaluate by themselves (the evaluation is driven by the create RPC, bulk cancel and the sweep)');
select is(private.registration_evaluate_hold_concentration('50000000-0000-4000-8000-000000780001') ->> 'triggered', 'true',
  'many aged accounts holding a few places each now trigger the alert');
select is(pg_temp.sv($q$ select status || '/' || blocking_level || '/' || category from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$),
  'OPEN/ACTION_REQUIRED/ANTI_HOARDING', 'one ACTION_REQUIRED ANTI_HOARDING task');
select is(pg_temp.sv($q$ select (metadata -> 'triggers')::text from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$),
  '["TOTAL_HOLD_SHARE"]', 'by the total trigger only: nobody is new and nobody holds 10');
select is(pg_temp.sv($q$ select (metadata ->> 'pending_places') || '/' || (metadata ->> 'capacity') || '/' || (metadata -> 'policy' ->> 'total_hold_min_places')
  from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$), '24/40/20', 'with the figures and the policy snapshot in the metadata');
select is(pg_temp.sv($q$ select (description ~ '60[.]0%')::text from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$), 'true',
  'and the description states the share of capacity');
select is(pg_temp.sv($q$ select (metadata::text ~* '(example\.test|Buyer 780)')::text from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$), 'false',
  'the task carries request references, never names or emails');
select is(pg_temp.sv($q$ select count(*) from app.registration_request where edition_id = '50000000-0000-4000-8000-000000780001' and status = 'PENDING_CONFIRMATION' $q$), '6',
  'never auto-cancel: every request is still PENDING_CONFIRMATION');
select is(pg_temp.sv($q$ select count(*) from app.registration_hold h join app.registration_request r using (registration_request_id)
  where r.edition_id = '50000000-0000-4000-8000-000000780001' and h.status = 'ACTIVE' $q$), '6', 'and every hold is still ACTIVE');
select is(private.registration_evaluate_hold_concentration('50000000-0000-4000-8000-000000780001') ->> 'task', 'UNCHANGED', 'a second evaluation is idempotent');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$), '1', 'still one task for the Edition');

-- ===========================================================================================
-- C. MODALITY_HOLD_SHARE: 15 of the 20 places of one modality (75%) while the Edition total (15 of 60) is quiet
-- ===========================================================================================
select pg_temp.pending(i, 2, 2, 5) from generate_series(7, 9) i;
select is(private.registration_evaluate_hold_concentration('50000000-0000-4000-8000-000000780002') ->> 'triggered', 'true', 'one nearly exhausted modality alerts');
select is(pg_temp.sv($q$ select (metadata -> 'triggers')::text from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780002' $q$),
  '["MODALITY_HOLD_SHARE"]', 'by the modality trigger only (total 15 of 60 = 25%, top buyer 5)');
select is(pg_temp.sv($q$ select (metadata -> 'modalities_over_threshold' -> 0 ->> 'pending_places') || '/' || (metadata -> 'modalities_over_threshold' -> 0 ->> 'capacity')
  || '/' || (metadata -> 'modalities_over_threshold' -> 0 ->> 'name') from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780002' $q$),
  '15/20/5K', 'the metadata names the modality with its pending places and capacity (no personal data)');

-- ===========================================================================================
-- D. Normal traffic does not alert
-- ===========================================================================================
select pg_temp.pending(10, 3, 4, 3);
select pg_temp.pending(11, 3, 4, 2);
select is(private.registration_evaluate_hold_concentration('50000000-0000-4000-8000-000000780003') ->> 'triggered', 'false', 'five places on a 100-place Edition is normal traffic');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780003' $q$), '0', 'no task');

-- ===========================================================================================
-- E. P3SECA-02: a waive silences one wave, not the alert forever
-- ===========================================================================================
create temp table task_ids (name text primary key, value uuid) on commit drop;
grant select, insert on task_ids to authenticated;
insert into task_ids select 'e1', admin_task_id from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000780090", "role": "authenticated"}';
select is(public.waive_admin_task((select value from task_ids where name = 'e1'), 'Evento popular, retenciones legítimas') ->> 'status', 'WAIVED', 'staff waive the alert');
reset role;
select is(private.registration_evaluate_hold_concentration('50000000-0000-4000-8000-000000780001') ->> 'task', 'UNCHANGED', 'while the condition holds the waived task stays waived');
select is(pg_temp.sv($q$ select status from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$), 'WAIVED', 'still WAIVED');

update app.registration_hold set status = 'RELEASED', released_at = now()
where registration_request_id in (select registration_request_id from app.registration_request where edition_id = '50000000-0000-4000-8000-000000780001');
select is(private.registration_evaluate_hold_concentration('50000000-0000-4000-8000-000000780001') ->> 'triggered', 'false', 'the holds go away: the condition clears');
select is(pg_temp.sv($q$ select status || '/' || (metadata ->> 'active') from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$), 'WAIVED/false',
  'the waived task is marked inactive (the waive record is kept)');

update app.registration_hold set status = 'ACTIVE', released_at = null
where registration_request_id in (select registration_request_id from app.registration_request where edition_id = '50000000-0000-4000-8000-000000780001');
select is(private.registration_evaluate_hold_concentration('50000000-0000-4000-8000-000000780001') ->> 'task', 'REOPENED', 'the concentration comes back: the same task re-opens');
select is(pg_temp.sv($q$ select status || '/' || blocking_level || '/' || coalesce(resolution_type, '-') from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$),
  'OPEN/ACTION_REQUIRED/-', 'OPEN again, resolution cleared');
select is(pg_temp.sv($q$ select (metadata -> 'reopened_after_waive' ->> 'waive_reason') from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$),
  'Evento popular, retenciones legítimas', 'the previous waive reason is kept in the metadata');
select is(pg_temp.sv($q$ select count(*) from app.admin_task where task_key = 'hold-concentration:50000000-0000-4000-8000-000000780001' $q$), '1', 'still one task for the Edition (no duplicate wave task)');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'ADMIN_TASK_WAIVED' and entity_id = (select value from task_ids where name = 'e1') $q$), '1',
  'the original waive audit row is untouched');

-- Any other waived task keeps the original rule: a waive is final until staff say otherwise.
select private.admin_task_sync_open('some-rule:p780', 'RECONCILIATION', null, 'platform', null, 'T', 'D', 'HIGH', 'ACTION_REQUIRED', 'ADMIN', '{}');
update app.admin_task set status = 'WAIVED', resolved_at = now(), resolution_type = 'WAIVED', resolution_reason = 'x', metadata = metadata || '{"active": false}'
where task_key = 'some-rule:p780';
select is(private.admin_task_sync_open('some-rule:p780', 'RECONCILIATION', null, 'platform', null, 'T', 'D', 'HIGH', 'ACTION_REQUIRED', 'ADMIN', '{}'), 'UNCHANGED',
  'a waived task of any other rule is NOT re-opened (only the hold-concentration alert works per wave)');

-- ===========================================================================================
-- F. P3SECA-07: the ALTCHA gate is decided on the Edition row read UNDER the lock
-- ===========================================================================================
select ok(position('for update' in lower(pg_get_functiondef('private.create_registration_request(uuid, jsonb, jsonb, text)'::regprocedure)))
  < position('captcha_required' in pg_get_functiondef('private.create_registration_request(uuid, jsonb, jsonb, text)'::regprocedure)),
  'create_registration_request takes the Edition lock before it can raise captcha_required');
select is(pg_temp.sv($q$ select (regexp_count(pg_get_functiondef('private.create_registration_request(uuid, jsonb, jsonb, text)'::regprocedure), 'registration_consume_captcha_clearance'))::text $q$), '1',
  'and consumes the clearance in exactly one place (the gate was moved, not duplicated)');

-- ===========================================================================================
-- G. P3SECA-13: the queue badge uses the gate's source (auth.users.created_at) and hours (policy)
-- ===========================================================================================
update auth.users set created_at = now() - interval '30 minutes' where id = '00000000-0000-4000-8000-000000780001';
-- The PROFILE row is old (3 days) but the GoTrue account is 30 minutes old: the gate says new, so must the badge.
update app.runner_profile set created_at = now() - interval '3 days' where runner_profile_id = '10000000-0000-4000-8000-000000780001';
select is(pg_temp.sv($q$ select (private.registration_request_view((select registration_request_id from app.registration_request
  where buyer_profile_id = '10000000-0000-4000-8000-000000780001' and edition_id = '50000000-0000-4000-8000-000000780001'), null, true) -> 'buyer' ->> 'is_new_account') $q$),
  'true', 'badge: a new GoTrue account is new even when the profile row is old');
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000780001'), true, 'which is exactly what the gate decides');
-- Established account: not new on either side.
select is(pg_temp.sv($q$ select (private.registration_request_view((select registration_request_id from app.registration_request
  where buyer_profile_id = '10000000-0000-4000-8000-000000780002' and edition_id = '50000000-0000-4000-8000-000000780001'), null, true) -> 'buyer' ->> 'is_new_account') $q$),
  'false', 'badge: a 3-day-old account is not new');
-- The window is the policy, not a fixed 24 h.
update auth.users set created_at = now() - interval '25 hours' where id = '00000000-0000-4000-8000-000000780003';
update private.anti_hoarding_policy set captcha_new_account_hours = 48;
select is(pg_temp.sv($q$ select (private.registration_request_view((select registration_request_id from app.registration_request
  where buyer_profile_id = '10000000-0000-4000-8000-000000780003' and edition_id = '50000000-0000-4000-8000-000000780001'), null, true) -> 'buyer' ->> 'is_new_account') $q$),
  'true', 'badge: 25 hours old is new under a 48 h policy window (the old hard-coded 24 h said false)');
select is(private.registration_account_is_new('00000000-0000-4000-8000-000000780003'), true, 'and so does the gate');
update private.anti_hoarding_policy set captcha_new_account_hours = 24;
select is(pg_temp.sv($q$ select (private.registration_request_view((select registration_request_id from app.registration_request
  where buyer_profile_id = '10000000-0000-4000-8000-000000780003' and edition_id = '50000000-0000-4000-8000-000000780001'), null, true) -> 'buyer' ->> 'is_new_account') $q$),
  'false', 'badge: back to 24 h, 25 hours old is not new');
select is(pg_temp.sv($q$ select (private.registration_request_view((select registration_request_id from app.registration_request
  where buyer_profile_id = '10000000-0000-4000-8000-000000780002' and edition_id = '50000000-0000-4000-8000-000000780001'), null, false) ? 'buyer')::text $q$),
  'false', 'the buyer block (and the badge) stays staff-only');

select * from finish();
rollback;
