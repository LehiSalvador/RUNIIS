-- P3-T read-only closure history and DistanceCredit ledger (P3-AC-03, P3-AC-11): finalization and closure revision history, the credit ledger
-- with the supersedes chain both ways, keyset pagination, filters, the credited-distance summary (also on the attendance workspace), RBAC
-- (ATTENDANCE_MANAGE, Edition scope, CHECKIN refused), staff labels, no write effect and the grant surface. Synthetic ids in an 800 range.
-- Fixture: a FINISHED Edition with a 10K that credits and a 3K that does not; registrations 1 and 2 (10K) and 3 (3K). History:
-- finalization 1 + closure 1 (credits for 1 and 2), reopen closure, reopen finalization, registration 1 corrected to NO_SHOW,
-- finalization 2 + closure 2 (credit for 2 only, superseding its reversed predecessor).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(82);

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
-- Fixture.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000800001', 'p800-admin@example.test'),
  ('00000000-0000-4000-8000-000000800002', 'p800-operator@example.test'),
  ('00000000-0000-4000-8000-000000800003', 'p800-checkin@example.test'),
  ('00000000-0000-4000-8000-000000800004', 'p800-operator-e2@example.test'),
  ('00000000-0000-4000-8000-000000800011', 'p800-runner-1@example.test'),
  ('00000000-0000-4000-8000-000000800012', 'p800-runner-2@example.test'),
  ('00000000-0000-4000-8000-000000800013', 'p800-runner-3@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000800001', '00000000-0000-4000-8000-000000800001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000800002', '00000000-0000-4000-8000-000000800002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000800003', '00000000-0000-4000-8000-000000800003', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000800004', '00000000-0000-4000-8000-000000800004', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000800001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000800002', 'OPERATOR', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000800003', 'CHECKIN', 'GLOBAL');
-- The first administrator has a profile name ("Ana Garcia Lopez" is shown to staff as "Ana L."); the operator has none ("Staff #200000").
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name, date_of_birth) values
  ('10000000-0000-4000-8000-000000800001', '00000000-0000-4000-8000-000000800001', 'Ana Garcia Lopez', '1985-05-05'),
  ('10000000-0000-4000-8000-000000800011', '00000000-0000-4000-8000-000000800011', 'Runner 800-1', '1990-01-01'),
  ('10000000-0000-4000-8000-000000800012', '00000000-0000-4000-8000-000000800012', 'Runner 800-2', '1990-01-01'),
  ('10000000-0000-4000-8000-000000800013', '00000000-0000-4000-8000-000000800013', 'Runner 800-3', '1990-01-01');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000800001', event_type_id, 'History Event', 'p800-history-event'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state,
  registration_state, closure_state, registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000800001', '40000000-0000-4000-8000-000000800001', 'p800-history-event-2026',
   'History Event 2026', 'FREE', 'America/Monterrey', 'FINISHED', 'CLOSED', 'PENDING', now() - interval '1 day',
   'Monterrey', 'NL', 'MX'),
  ('50000000-0000-4000-8000-000000800002', '40000000-0000-4000-8000-000000800001', 'p800-history-event-2027',
   'History Event 2027', 'FREE', 'America/Monterrey', 'FINISHED', 'CLOSED', 'PENDING', now() - interval '1 day',
   'Monterrey', 'NL', 'MX');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000800004', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000800002');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone,
  created_by_staff_id) values
  ('50000000-0000-4000-8000-000000800001', 1, 'DATE_TIME_CONFIRMED', '2026-09-20', '07:00', 'America/Monterrey',
   '20000000-0000-4000-8000-000000800001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000800001', '50000000-0000-4000-8000-000000800001', '10k', '10K', 10000, true, 1),
  ('60000000-0000-4000-8000-000000800002', '50000000-0000-4000-8000-000000800001', '3k', '3K familiar', 3000, false, 2);

insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
  registration_mode, currency, total_snapshot_minor)
select ('70000000-0000-4000-8000-0000008001' || lpad(i::text, 2, '0'))::uuid, 'R-800' || i || '-AAAA',
  ('10000000-0000-4000-8000-0000008000' || lpad((10 + i)::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000800001', 'FREE', 'MXN', 0
from generate_series(1, 3) i;
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
  runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot)
select ('71000000-0000-4000-8000-0000008001' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000008001' || lpad(i::text, 2, '0'))::uuid, 'PROFILE',
  ('10000000-0000-4000-8000-0000008000' || lpad((10 + i)::text, 2, '0'))::uuid,
  case when i = 3 then '60000000-0000-4000-8000-000000800002'::uuid else '60000000-0000-4000-8000-000000800001'::uuid end,
  0, 'MXN', '{}'
from generate_series(1, 3) i;
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
  runner_profile_id, buyer_profile_id, registration_number)
select ('72000000-0000-4000-8000-0000008001' || lpad(i::text, 2, '0'))::uuid,
  ('70000000-0000-4000-8000-0000008001' || lpad(i::text, 2, '0'))::uuid,
  ('71000000-0000-4000-8000-0000008001' || lpad(i::text, 2, '0'))::uuid,
  '50000000-0000-4000-8000-000000800001',
  case when i = 3 then '60000000-0000-4000-8000-000000800002'::uuid else '60000000-0000-4000-8000-000000800001'::uuid end,
  ('10000000-0000-4000-8000-0000008000' || lpad((10 + i)::text, 2, '0'))::uuid,
  ('10000000-0000-4000-8000-0000008000' || lpad((10 + i)::text, 2, '0'))::uuid,
  'I-800' || i || '-AAAA'
from generate_series(1, 3) i;
update app.competition_settings set ranking_epoch = null, ranking_epoch_frozen_at = null where settings_id = 1;

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Before any finalization the history is empty (not an error) and so is the ledger.
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800002", "role": "authenticated"}';
insert into ids select 'fin0', public.admin_list_attendance_finalizations('50000000-0000-4000-8000-000000800001');
select is((select value ->> 'total' from ids where name = 'fin0') || '/' || jsonb_array_length((select value -> 'items' from ids where name = 'fin0'))::text,
  '0/0', 'no finalization yet: an empty history');
select ok((select value -> 'next_cursor' from ids where name = 'fin0') = 'null'::jsonb, 'and no next cursor');
insert into ids select 'cr0', public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001');
select is((select value ->> 'total' from ids where name = 'cr0'), '0', 'no credit yet: an empty ledger');
select is((select value -> 'summary' ->> 'total_m' from ids where name = 'cr0'), '0', 'and a zero credited distance');

-- ---------------------------------------------------------------------------------------------
-- 2. Build the history through the real commands.
-- ---------------------------------------------------------------------------------------------
select public.resolve_attendance(('72000000-0000-4000-8000-0000008001' || lpad(i::text, 2, '0'))::uuid, 'PRESENT', 'Resolución 800',
  '{"kind": "judge_note"}'::jsonb) from generate_series(1, 3) i;
insert into ids select 'fin1', public.finalize_attendance('50000000-0000-4000-8000-000000800001');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800001", "role": "authenticated"}';
insert into ids select 'close1', public.close_edition('50000000-0000-4000-8000-000000800001', 'p800-close-key-0001');
select is((select value ->> 'credits_created' from ids where name = 'close1'), '2', 'closure 1 credited registrations 1 and 2 (the 3K does not credit)');
insert into ids select 'reopen1', public.reopen_edition('50000000-0000-4000-8000-000000800001', 'Error en la lista de PRESENT', 'p800-reopen-key-0001');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800002", "role": "authenticated"}';
select public.reopen_attendance_finalization('50000000-0000-4000-8000-000000800001', 'Corrección de lista');
select public.resolve_attendance('72000000-0000-4000-8000-000000800101', 'NO_SHOW', 'No cruzó meta (video)');
insert into ids select 'fin2', public.finalize_attendance('50000000-0000-4000-8000-000000800001');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800001", "role": "authenticated"}';
insert into ids select 'close2', public.close_edition('50000000-0000-4000-8000-000000800001', 'p800-close-key-0002');
select is((select value ->> 'credits_created' from ids where name = 'close2'), '1', 'closure 2 credited only registration 2');

-- Baseline of every row the reads could touch, to prove they write nothing.
create temp table baseline (k text primary key, v bigint) on commit drop;
grant select, insert on baseline to authenticated;
insert into baseline values
  ('credits', pg_temp.sv($q$ select count(*) from app.distance_credit $q$)::bigint),
  ('finalizations', pg_temp.sv($q$ select count(*) from app.attendance_finalization $q$)::bigint),
  ('closures', pg_temp.sv($q$ select count(*) from app.administrative_closure $q$)::bigint),
  ('audit', pg_temp.sv($q$ select count(*) from audit.audit_log $q$)::bigint),
  ('outbox', pg_temp.sv($q$ select count(*) from infra.outbox_event $q$)::bigint);

-- ---------------------------------------------------------------------------------------------
-- 3. Finalization revision history (ADMIN viewer).
-- ---------------------------------------------------------------------------------------------
insert into ids select 'fh', public.admin_list_attendance_finalizations('50000000-0000-4000-8000-000000800001');
select is((select value ->> 'total' from ids where name = 'fh'), '2', 'two finalization revisions');
select is((select string_agg(i ->> 'revision' || ':' || (i ->> 'status'), ',' order by o)
           from ids, jsonb_array_elements(value -> 'items') with ordinality t(i, o) where name = 'fh'),
  '2:FINALIZED,1:SUPERSEDED', 'newest first: revision 2 current, revision 1 superseded');
select is((select (value -> 'items' -> 0 ->> 'is_current') || '/' || (value -> 'items' -> 1 ->> 'is_current') from ids where name = 'fh'),
  'true/false', 'is_current marks the live revision');
select is((select (value -> 'items' -> 1 ->> 'expected_count') || '/' || (value -> 'items' -> 1 ->> 'present_count') || '/'
           || (value -> 'items' -> 1 ->> 'no_show_count') || '/' || (value -> 'items' -> 1 ->> 'excluded_count') from ids where name = 'fh'),
  '3/3/0/0', 'revision 1 counts');
select is((select (value -> 'items' -> 0 ->> 'expected_count') || '/' || (value -> 'items' -> 0 ->> 'present_count') || '/'
           || (value -> 'items' -> 0 ->> 'no_show_count') from ids where name = 'fh'),
  '3/2/1', 'revision 2 counts after the correction');
select is((select value -> 'items' -> 1 ->> 'reopen_reason' from ids where name = 'fh'), 'Corrección de lista', 'the reopen reason is kept on the superseded revision');
select ok((select value -> 'items' -> 1 ->> 'reopened_at' is not null and value -> 'items' -> 1 ->> 'superseded_at' is not null from ids where name = 'fh'),
  'reopened_at and superseded_at are set on the superseded revision');
select ok((select value -> 'items' -> 0 -> 'superseded_at' = 'null'::jsonb and value -> 'items' -> 0 -> 'reopen_reason' = 'null'::jsonb
           from ids where name = 'fh'), 'the current revision has no supersession or reopen data');
select is((select value -> 'items' -> 0 ->> 'finalized_by_staff_label' from ids where name = 'fh'), 'Staff #200000',
  'the operator who finalized has no profile name: the neutral staff label');
select is((select value -> 'items' -> 1 ->> 'reopened_by_staff_label' from ids where name = 'fh'), 'Staff #200000', 'the reopening actor has a label');
select is((select value -> 'items' -> 0 ->> 'finalized_by_staff_id' from ids where name = 'fh'), '20000000-0000-4000-8000-000000800002',
  'the opaque staff id travels next to the label');
select ok(not (select value::text ~ '@example\.test' from ids where name = 'fh'), 'no email appears anywhere in the history');

-- ---------------------------------------------------------------------------------------------
-- 4. Administrative closure revision history (ADMIN viewer sees the abbreviated actor name).
-- ---------------------------------------------------------------------------------------------
insert into ids select 'ch', public.admin_list_administrative_closures('50000000-0000-4000-8000-000000800001');
select is((select value ->> 'total' from ids where name = 'ch'), '2', 'two closure revisions');
select is((select string_agg(i ->> 'revision' || ':' || (i ->> 'status'), ',' order by o)
           from ids, jsonb_array_elements(value -> 'items') with ordinality t(i, o) where name = 'ch'),
  '2:CLOSED,1:SUPERSEDED', 'newest first: closure 2 current, closure 1 superseded');
select is((select value -> 'items' -> 1 ->> 'reopen_reason' from ids where name = 'ch'), 'Error en la lista de PRESENT', 'the closure reopen reason');
select is((select value -> 'items' -> 1 ->> 'reopened_by_staff_label' from ids where name = 'ch'), 'Ana L.',
  'an ADMIN viewer sees the abbreviated profile name of the administrator who reopened');
select is((select value -> 'items' -> 0 ->> 'closed_by_staff_label' from ids where name = 'ch'), 'Ana L.', 'and of the one who closed');
select is((select (value -> 'items' -> 1 ->> 'credit_count') || '/' || (value -> 'items' -> 1 ->> 'active_credit_count') || '/'
           || (value -> 'items' -> 1 ->> 'reversed_credit_count') || '/' || (value -> 'items' -> 1 ->> 'active_credited_distance_m') from ids where name = 'ch'),
  '2/0/2/0', 'closure 1: two credits, both reversed, no active distance');
select is((select (value -> 'items' -> 0 ->> 'credit_count') || '/' || (value -> 'items' -> 0 ->> 'active_credit_count') || '/'
           || (value -> 'items' -> 0 ->> 'reversed_credit_count') || '/' || (value -> 'items' -> 0 ->> 'active_credited_distance_m') from ids where name = 'ch'),
  '1/1/0/10000', 'closure 2: one active credit of 10000 m');
select is((select (value -> 'items' -> 0 ->> 'attendance_finalization_revision') || '/' || (value -> 'items' -> 1 ->> 'attendance_finalization_revision')
           from ids where name = 'ch'), '2/1', 'each closure names the finalization revision it closed');
select ok((select (value -> 'items' -> 0 ->> 'attendance_finalization_id') = (select value ->> 'attendance_finalization_id' from ids where name = 'fin2')
           from ids where name = 'ch'), 'and its finalization id');
select ok((select value -> 'items' -> 0 -> 'reopened_at' = 'null'::jsonb and value -> 'items' -> 0 -> 'superseded_at' = 'null'::jsonb
           from ids where name = 'ch'), 'the current closure has no reopen data');

-- ---------------------------------------------------------------------------------------------
-- 5. Credit ledger.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'cl', public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001');
select is((select value ->> 'total' from ids where name = 'cl'), '3', 'three credit rows: two reversed, one active');
select is((select string_agg((i ->> 'closure_revision') || ':' || (i ->> 'registration_number') || ':' || (i ->> 'status'), ',' order by o)
           from ids, jsonb_array_elements(value -> 'items') with ordinality t(i, o) where name = 'cl'),
  '2:I-8002-AAAA:ACTIVE,1:I-8001-AAAA:REVERSED,1:I-8002-AAAA:REVERSED', 'ordered by closure revision desc then registration number');
select is((select i ->> 'participant_label' || '|' || (i -> 'modality' ->> 'name') || '|' || (i ->> 'official_distance_snapshot_m') || '|' || (i ->> 'credited_distance_m')
                  || '|' || (i ->> 'sport_date') || '|' || (i ->> 'sport_timezone') || '|' || (i ->> 'source')
           from ids, jsonb_array_elements(value -> 'items') i where name = 'cl' and i ->> 'status' = 'ACTIVE'),
  'Runner 800-2|10K|10000|10000|2026-09-20|America/Monterrey|EVENT_ATTENDANCE', 'label, modality, official and credited distance, sport date and source');
select is((select i ->> 'participant_kind' from ids, jsonb_array_elements(value -> 'items') i where name = 'cl' limit 1), 'PROFILE', 'ledger rows are PROFILE credits (a Guest never holds one)');
select is((select i ->> 'reversal_reason' || '|' || (i ->> 'reversed_by_staff_label') || '|' || (i ->> 'reversed_at' is not null)::text
           from ids, jsonb_array_elements(value -> 'items') i where name = 'cl' and i ->> 'registration_number' = 'I-8001-AAAA'),
  'Error en la lista de PRESENT|Ana L.|true', 'a reversed credit carries the reversal reason, actor label and timestamp');
select ok((select i -> 'reversed_at' = 'null'::jsonb and i -> 'reversal_reason' = 'null'::jsonb and i -> 'reversed_by_staff_label' = 'null'::jsonb
           from ids, jsonb_array_elements(value -> 'items') i where name = 'cl' and i ->> 'status' = 'ACTIVE'), 'an active credit has no reversal data');
select ok((select a ->> 'supersedes_distance_credit_id' = (r ->> 'distance_credit_id') and r ->> 'superseded_by_distance_credit_id' = (a ->> 'distance_credit_id')
           from (select value as v from ids where name = 'cl') w, jsonb_array_elements(w.v -> 'items') a, jsonb_array_elements(w.v -> 'items') r
           where a ->> 'status' = 'ACTIVE' and r ->> 'registration_number' = 'I-8002-AAAA' and r ->> 'status' = 'REVERSED'),
  'the supersedes link runs both ways: the active credit supersedes the reversed one, which names its successor');
select ok((select i -> 'superseded_by_distance_credit_id' = 'null'::jsonb and i -> 'supersedes_distance_credit_id' = 'null'::jsonb
           from ids, jsonb_array_elements(value -> 'items') i where name = 'cl' and i ->> 'registration_number' = 'I-8001-AAAA'),
  'a credit with no successor and no predecessor has null links');
select is((select (i ->> 'closure_revision') || '/' || ((i ->> 'administrative_closure_id') = (select value ->> 'administrative_closure_id' from ids where name = 'close2'))::text
           from ids, jsonb_array_elements(value -> 'items') i where name = 'cl' and i ->> 'status' = 'ACTIVE'), '2/true',
  'the active credit is linked to the current closure');

-- Filters.
select is((public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', 'ACTIVE') ->> 'total'), '1', 'status filter ACTIVE');
select is((public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', 'REVERSED') ->> 'total'), '2', 'status filter REVERSED');
select is((public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', null, '60000000-0000-4000-8000-000000800001') ->> 'total'), '3', 'modality filter 10K');
select is((public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', null, '60000000-0000-4000-8000-000000800002') ->> 'total'), '0', 'modality filter 3K: no credit');
select is((public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', null, null, '72000000-0000-4000-8000-000000800102') ->> 'total'), '2',
  'registration filter shows the whole chain of one participant');
select is(pg_temp.err($$ select public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', 'BOGUS') $$) ->> 'code', 'VALIDATION_ERROR',
  'an unknown status is a validation error');

-- Summary: ACTIVE credits only, per modality (the 3K neither credits nor has credits: absent).
select is((select value -> 'summary' ->> 'total_m' || '/' || (value -> 'summary' ->> 'active_credit_count') || '/' || (value -> 'summary' ->> 'reversed_credit_count')
           from ids where name = 'cl'), '10000/1/2', 'summary: only the ACTIVE credit counts toward the credited distance');
select is((select jsonb_array_length(value -> 'summary' -> 'by_modality') from ids where name = 'cl'), 1, 'one modality row: the 10K');
select is((select (value -> 'summary' -> 'by_modality' -> 0 ->> 'name') || '/' || (value -> 'summary' -> 'by_modality' -> 0 ->> 'credited_distance_m')
           || '/' || (value -> 'summary' -> 'by_modality' -> 0 ->> 'active_credit_count') || '/' || (value -> 'summary' -> 'by_modality' -> 0 ->> 'reversed_credit_count')
           from ids where name = 'cl'), '10K/10000/1/2', 'per modality: credited distance and counts');

-- Pagination (keyset): pages of two then one, no overlap and a stable cursor.
insert into ids select 'p1', public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', null, null, null, null, null, null, 2);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'p1')), 2, 'page 1 has two rows');
select ok((select value -> 'next_cursor' <> 'null'::jsonb from ids where name = 'p1'), 'page 1 has a next cursor');
insert into ids select 'p2', public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', null, null, null,
  ((select value -> 'next_cursor' ->> 'revision' from ids where name = 'p1'))::integer,
  (select value -> 'next_cursor' ->> 'registration_number' from ids where name = 'p1'),
  ((select value -> 'next_cursor' ->> 'id' from ids where name = 'p1'))::uuid, 2);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'p2')), 1, 'page 2 has the remaining row');
select ok((select value -> 'next_cursor' = 'null'::jsonb from ids where name = 'p2'), 'and no further cursor');
select is((select count(distinct i ->> 'distance_credit_id')::int from ids, jsonb_array_elements(value -> 'items') i where name in ('p1', 'p2')), 3,
  'the two pages cover the three credits with no overlap');
select is(pg_temp.err($$ select public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001', null, null, null, 1, null, null, 2) $$) ->> 'code',
  'VALIDATION_ERROR', 'a partial cursor is a validation error');
insert into ids select 'fp1', public.admin_list_attendance_finalizations('50000000-0000-4000-8000-000000800001', null, 1);
select is((select (value -> 'items' -> 0 ->> 'revision') || '/' || (value -> 'next_cursor' ->> 'revision') from ids where name = 'fp1'), '2/2',
  'finalization pagination: page of one, cursor = last revision');
select is((public.admin_list_attendance_finalizations('50000000-0000-4000-8000-000000800001', 2, 1) -> 'items' -> 0 ->> 'revision'), '1', 'the next finalization page starts below the cursor');
select is((public.admin_list_administrative_closures('50000000-0000-4000-8000-000000800001', 2, 5) -> 'items' -> 0 ->> 'revision'), '1', 'closure pagination below the cursor');
select is(jsonb_array_length(public.admin_list_administrative_closures('50000000-0000-4000-8000-000000800001', null, 0) -> 'items'), 1, 'limit 0 is clamped to 1');
select is(pg_temp.err($$ select public.admin_list_attendance_finalizations('50000000-0000-4000-8000-000000800001', 0) $$) ->> 'code', 'VALIDATION_ERROR',
  'a non-positive revision cursor is a validation error');

-- ---------------------------------------------------------------------------------------------
-- 6. Attendance workspace: the additive credited_distance matches the ledger summary; the rest is unchanged.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'ws', public.attendance_workspace('50000000-0000-4000-8000-000000800001');
select is((select value -> 'credited_distance' from ids where name = 'ws'), (select value -> 'summary' from ids where name = 'cl'),
  'the workspace credited_distance equals the ledger summary');
select is((select value -> 'current_closure' ->> 'revision' from ids where name = 'ws'), '2', 'the workspace still exposes the current closure');
select is((select value ->> 'universe_count' from ids where name = 'ws'), '3', 'and the universe');

-- ---------------------------------------------------------------------------------------------
-- 7. The reads write nothing.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.sv($q$ select count(*) from app.distance_credit $q$), (select v::text from baseline where k = 'credits'), 'no credit was written');
select is(pg_temp.sv($q$ select count(*) from app.attendance_finalization $q$), (select v::text from baseline where k = 'finalizations'), 'no finalization was written');
select is(pg_temp.sv($q$ select count(*) from app.administrative_closure $q$), (select v::text from baseline where k = 'closures'), 'no closure was written');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log $q$), (select v::text from baseline where k = 'audit'), 'no audit row (a read is not an audited command)');
select is(pg_temp.sv($q$ select count(*) from infra.outbox_event $q$), (select v::text from baseline where k = 'outbox'), 'no outbox event');
reset role;
select is((select string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname in ('admin_list_attendance_finalizations', 'admin_list_administrative_closures',
             'admin_list_distance_credits', 'edition_credited_distance_summary')),
  'admin_list_administrative_closures:s,admin_list_attendance_finalizations:s,admin_list_distance_credits:s,edition_credited_distance_summary:s',
  'all four read functions are STABLE (the database refuses writes from them)');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. RBAC and scope (ATTENDANCE_MANAGE; SEC-020).
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800002", "role": "authenticated"}';
select is(public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001') ->> 'total', '3', 'a global OPERATOR reads the ledger');
select is(public.admin_list_administrative_closures('50000000-0000-4000-8000-000000800001') -> 'items' -> 1 ->> 'reopened_by_staff_label', 'Ana L.',
  'an OPERATOR viewer sees the same abbreviated name');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800003", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_attendance_finalizations('50000000-0000-4000-8000-000000800001') $$) ->> 'code', 'FORBIDDEN', 'CHECKIN cannot read the finalization history');
select is(pg_temp.err($$ select public.admin_list_administrative_closures('50000000-0000-4000-8000-000000800001') $$) ->> 'code', 'FORBIDDEN', 'CHECKIN cannot read the closure history');
select is(pg_temp.err($$ select public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001') $$) ->> 'code', 'FORBIDDEN', 'CHECKIN cannot read the credit ledger');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800004", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001') $$) ->> 'code', 'FORBIDDEN',
  'an OPERATOR scoped to another Edition is refused (SEC-020)');
select is(pg_temp.err($$ select public.admin_list_attendance_finalizations('50000000-0000-4000-8000-000000800001') $$) ->> 'code', 'FORBIDDEN', 'also the finalization history');
select is(public.admin_list_distance_credits('50000000-0000-4000-8000-000000800002') ->> 'total', '0', 'but their own Edition reads (empty)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800011", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001') $$) ->> 'code', 'FORBIDDEN',
  'a participant with no staff role is refused');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000800001", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_distance_credits('50000000-0000-4000-8000-000000899999') $$) ->> 'code', 'NOT_FOUND', 'an unknown Edition is NOT_FOUND for an ADMIN');
select is(pg_temp.err($$ select public.admin_list_administrative_closures('50000000-0000-4000-8000-000000899999') $$) ->> 'code', 'NOT_FOUND', 'also the closure history');
select is(pg_temp.err($$ select public.admin_list_attendance_finalizations('50000000-0000-4000-8000-000000899999') $$) ->> 'code', 'NOT_FOUND', 'also the finalization history');
reset role;
set local role anon;
select throws_ok($$ select public.admin_list_distance_credits('50000000-0000-4000-8000-000000800001') $$, '42501', null, 'anon has no execute grant');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 9. Grant surface (the 110 catalog lint: one public signature per name, a public wrapper for every granted private function).
-- ---------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.admin_list_distance_credits(uuid, text, uuid, uuid, integer, text, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_list_attendance_finalizations(uuid, integer, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_list_administrative_closures(uuid, integer, integer)', 'execute'),
  'the three public wrappers are executable by authenticated');
select ok(not has_function_privilege('authenticated', 'private.edition_credited_distance_summary(uuid)', 'execute'), 'the summary helper has no API grant');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('admin_list_attendance_finalizations', 'admin_list_administrative_closures', 'admin_list_distance_credits')),
  3, 'exactly one public signature per new name (no overloads)');

select * from finish();
rollback;
