-- P3-P backend follow-ups (P3-AC-06, P3-AC-09, P3-AC-11).
-- 1. Content block publish re-validates every media reference the stored payload carries: the DRAFT -> asset archived -> PUBLISHED path is refused
--    with NOT_FOUND {field, reason: media_not_published} for IMAGE, GALLERY and SPONSOR_GROUP, from DRAFT and from ARCHIVED, with and without a
--    payload in the same call; healthy and media-free blocks still publish; an already PUBLISHED block is not re-checked for unrelated edits.
-- 2. Staff-safe actor labels on the attendance resolution, sporting eligibility, attendance finalization, administrative closure, route revision
--    and platform settings projections: "First L." for a live ADMIN/OPERATOR viewer, "Staff #abc123" for everyone else, null when there is no actor,
--    the opaque ids are still returned, never an email. Synthetic ids in a 760 range.
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
create function pg_temp.exec(p_sql text) returns void language plpgsql security definer as $$
begin execute p_sql; end $$;
grant execute on function pg_temp.exec(text) to authenticated;
create function pg_temp.tok(p_key text) returns text language plpgsql security definer as $$
declare v text;
begin select a.updated_at::text into v from app.event_media_asset a where a.storage_object_key = p_key; return v; end $$;
grant execute on function pg_temp.tok(text) to authenticated;
create function pg_temp.aid(p_key text) returns uuid language plpgsql security definer as $$
declare v uuid;
begin select a.event_media_asset_id into v from app.event_media_asset a where a.storage_object_key = p_key; return v; end $$;
grant execute on function pg_temp.aid(text) to authenticated;
-- The status of a block read as the owner.
create function pg_temp.bstatus(p_id uuid) returns text language plpgsql security definer as $$
declare v text;
begin select b.status into v from app.event_content_block b where b.event_content_block_id = p_id; return v; end $$;
grant execute on function pg_temp.bstatus(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture. Staff: ADMIN "Ana Maria Garcia Lopez", OPERATOR "Luis" (one word), CHECKIN (profile, but no ADMIN/OPERATOR role).
-- E1 is FINISHED with one registration (attendance/closure), E2 hosts media and content blocks.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000760001', 'p760-admin@example.test'),
  ('00000000-0000-4000-8000-000000760002', 'p760-operator@example.test'),
  ('00000000-0000-4000-8000-000000760003', 'p760-checkin@example.test'),
  ('00000000-0000-4000-8000-000000760004', 'p760-runner@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000760001', '00000000-0000-4000-8000-000000760001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000760002', '00000000-0000-4000-8000-000000760002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000760003', '00000000-0000-4000-8000-000000760003', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000760001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000760002', 'OPERATOR', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000760003', 'CHECKIN', 'GLOBAL');
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name, date_of_birth) values
  ('10000000-0000-4000-8000-000000760001', '00000000-0000-4000-8000-000000760001', 'Ana  Maria Garcia   Lopez', '1990-01-01'),
  ('10000000-0000-4000-8000-000000760002', '00000000-0000-4000-8000-000000760002', 'Luis', '1990-01-01'),
  ('10000000-0000-4000-8000-000000760003', '00000000-0000-4000-8000-000000760003', 'Carlos Checkin Perez', '1990-01-01'),
  ('10000000-0000-4000-8000-000000760004', '00000000-0000-4000-8000-000000760004', 'Runner Setecientos', '1990-01-01')
on conflict (auth_user_id) do update set full_name = excluded.full_name;

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000760001', event_type_id, 'Evento 760', 'p760-evento'
from app.event_type where key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, registration_mode, timezone, execution_state,
  registration_state, closure_state, registration_close_at, city, state_region, country_code) values
  ('50000000-0000-4000-8000-000000760001', '40000000-0000-4000-8000-000000760001', 'p760-e1', 'E1 760', 'FREE', 'America/Monterrey',
   'FINISHED', 'CLOSED', 'PENDING', now() - interval '1 day', 'Monterrey', 'NL', 'MX'),
  ('50000000-0000-4000-8000-000000760002', '40000000-0000-4000-8000-000000760001', 'p760-e2', 'E2 760', 'FREE', 'America/Monterrey',
   'SCHEDULED', 'NOT_OPEN', 'OPEN', now() + interval '60 days', 'Monterrey', 'NL', 'MX');
insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time, timezone, created_by_staff_id)
values ('50000000-0000-4000-8000-000000760001', 1, 'DATE_TIME_CONFIRMED', '2026-03-15', '07:00', 'America/Monterrey',
  '20000000-0000-4000-8000-000000760001');
insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, sort_order) values
  ('60000000-0000-4000-8000-000000760001', '50000000-0000-4000-8000-000000760001', '10k', '10K', 10000, true, 1),
  ('60000000-0000-4000-8000-000000760002', '50000000-0000-4000-8000-000000760002', '10k', '10K', 10000, true, 1);
insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, registration_mode, currency, total_snapshot_minor)
values ('70000000-0000-4000-8000-000000760001', 'R-7601-AAAA', '10000000-0000-4000-8000-000000760004', '50000000-0000-4000-8000-000000760001', 'FREE', 'MXN', 0);
insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, runner_profile_id,
  guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot) values
  ('71000000-0000-4000-8000-000000760001', '70000000-0000-4000-8000-000000760001', 'PROFILE', '10000000-0000-4000-8000-000000760004', null,
   '60000000-0000-4000-8000-000000760001', 0, 'MXN', '{}');
insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id, runner_profile_id,
  guest_participant_id, buyer_profile_id, registration_number) values
  ('72000000-0000-4000-8000-000000760001', '70000000-0000-4000-8000-000000760001', '71000000-0000-4000-8000-000000760001',
   '50000000-0000-4000-8000-000000760001', '60000000-0000-4000-8000-000000760001', '10000000-0000-4000-8000-000000760004', null,
   '10000000-0000-4000-8000-000000760004', 'I-7601-AAAA');

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;

-- ===========================================================================================
-- 1. Content block publish re-validates media references
-- ===========================================================================================
select ok(not has_function_privilege('authenticated', 'private.cfg_assert_block_media_published(jsonb, uuid)', 'execute'),
  'the re-validation helper has no API grant');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000760001", "role": "authenticated"}';
select is(public.create_media_asset('50000000-0000-4000-8000-000000760002',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/760/hero", "alt_text": "Hero", "status": "PUBLISHED"}', 'p760-asset-key-0001') ->> 'status', 'PUBLISHED', 'fixture: hero asset PUBLISHED');
select is(public.create_media_asset('50000000-0000-4000-8000-000000760002',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/760/gal-a", "alt_text": "Galeria A", "status": "PUBLISHED"}', 'p760-asset-key-0002') ->> 'status', 'PUBLISHED', 'fixture: gallery asset A PUBLISHED');
select is(public.create_media_asset('50000000-0000-4000-8000-000000760002',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/760/gal-b", "alt_text": "Galeria B", "status": "PUBLISHED"}', 'p760-asset-key-0003') ->> 'status', 'PUBLISHED', 'fixture: gallery asset B PUBLISHED');
select is(public.create_media_asset('50000000-0000-4000-8000-000000760002',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/760/sponsor", "alt_text": "Sponsor", "status": "PUBLISHED"}', 'p760-asset-key-0004') ->> 'status', 'PUBLISHED', 'fixture: sponsor asset PUBLISHED');
select is(public.create_media_asset('50000000-0000-4000-8000-000000760002',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/760/healthy", "alt_text": "Sana", "status": "PUBLISHED"}', 'p760-asset-key-0005') ->> 'status', 'PUBLISHED', 'fixture: healthy asset PUBLISHED');
select is(public.create_media_asset('50000000-0000-4000-8000-000000760002',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/760/rich", "alt_text": "Rich", "status": "PUBLISHED"}', 'p760-asset-key-0006') ->> 'status', 'PUBLISHED', 'fixture: asset for a block that swaps payload');

-- DRAFT blocks that reference PUBLISHED assets (legal at write time).
insert into ids select 'img', public.create_content_block('50000000-0000-4000-8000-000000760002',
  jsonb_build_object('block_type', 'IMAGE', 'status', 'DRAFT', 'payload', jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/760/hero'))));
insert into ids select 'gal', public.create_content_block('50000000-0000-4000-8000-000000760002',
  jsonb_build_object('block_type', 'GALLERY', 'status', 'DRAFT', 'payload', jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/760/gal-a')), jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/760/gal-b'))))));
insert into ids select 'spo', public.create_content_block('50000000-0000-4000-8000-000000760002',
  jsonb_build_object('block_type', 'SPONSOR_GROUP', 'status', 'DRAFT', 'payload', jsonb_build_object('sponsors', jsonb_build_array(
    jsonb_build_object('name', 'Patrocinador', 'event_media_asset_id', pg_temp.aid('runiis/760/sponsor'))))));
insert into ids select 'ok', public.create_content_block('50000000-0000-4000-8000-000000760002',
  jsonb_build_object('block_type', 'IMAGE', 'status', 'DRAFT', 'payload', jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/760/healthy'))));
insert into ids select 'txt', public.create_content_block('50000000-0000-4000-8000-000000760002',
  jsonb_build_object('block_type', 'RICH_TEXT', 'status', 'DRAFT', 'payload', jsonb_build_object('markdown', 'Sin medios')));
insert into ids select 'swap', public.create_content_block('50000000-0000-4000-8000-000000760002',
  jsonb_build_object('block_type', 'IMAGE', 'status', 'DRAFT', 'payload', jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/760/rich'))));
select is((select count(*)::integer from ids where name in ('img', 'gal', 'spo', 'ok', 'txt', 'swap')), 6, 'fixture: six DRAFT blocks created');

-- Archiving is allowed while only DRAFT blocks use the assets (P3-O rule); this is the gap's entry.
select is(public.archive_media_asset(pg_temp.aid('runiis/760/hero'), jsonb_build_object('expected_updated_at', pg_temp.tok('runiis/760/hero')), 'p760-arch-key-0001') ->> 'status',
  'ARCHIVED', 'a DRAFT block does not block archiving its asset');
select is(public.archive_media_asset(pg_temp.aid('runiis/760/gal-b'), jsonb_build_object('expected_updated_at', pg_temp.tok('runiis/760/gal-b')), 'p760-arch-key-0002') ->> 'status',
  'ARCHIVED', 'archiving only the second gallery asset');
select is(public.archive_media_asset(pg_temp.aid('runiis/760/sponsor'), jsonb_build_object('expected_updated_at', pg_temp.tok('runiis/760/sponsor')), 'p760-arch-key-0003') ->> 'status',
  'ARCHIVED', 'archiving the sponsor asset');
select is(public.archive_media_asset(pg_temp.aid('runiis/760/rich'), jsonb_build_object('expected_updated_at', pg_temp.tok('runiis/760/rich')), 'p760-arch-key-0004') ->> 'status',
  'ARCHIVED', 'archiving the swap asset');

-- The gap: setting the DRAFT block to PUBLISHED without touching the payload.
select is(pg_temp.err(format($$ select public.update_content_block(%L, '{"status": "PUBLISHED"}') $$, (select value ->> 'event_content_block_id' from ids where name = 'img')))
  ->> 'code', 'NOT_FOUND', 'IMAGE: DRAFT -> PUBLISHED over an ARCHIVED asset is refused');
select is(pg_temp.err(format($$ select public.update_content_block(%L, '{"status": "PUBLISHED"}') $$, (select value ->> 'event_content_block_id' from ids where name = 'img')))
  -> 'detail' ->> 'reason', 'media_not_published', '... with the stable reason');
select is(pg_temp.err(format($$ select public.update_content_block(%L, '{"status": "PUBLISHED"}') $$, (select value ->> 'event_content_block_id' from ids where name = 'img')))
  -> 'detail' ->> 'field', 'payload.event_media_asset_id', '... and the field');
select is(pg_temp.bstatus((select (value ->> 'event_content_block_id')::uuid from ids where name = 'img')), 'DRAFT', '... the block stays DRAFT');
select is(pg_temp.err(format($$ select public.update_content_block(%L, '{"status": "PUBLISHED"}') $$, (select value ->> 'event_content_block_id' from ids where name = 'gal')))
  -> 'detail' ->> 'reason', 'media_not_published', 'GALLERY: one archived item among live ones refuses the publish');
select is(pg_temp.bstatus((select (value ->> 'event_content_block_id')::uuid from ids where name = 'gal')), 'DRAFT', '... the gallery stays DRAFT');
select is(pg_temp.err(format($$ select public.update_content_block(%L, '{"status": "PUBLISHED"}') $$, (select value ->> 'event_content_block_id' from ids where name = 'spo')))
  -> 'detail' ->> 'reason', 'media_not_published', 'SPONSOR_GROUP: an archived sponsor logo refuses the publish');

-- Same call that re-sends the payload: the payload write itself refuses an archived asset (unchanged), now with the reason.
select is(pg_temp.err(format($$ select public.update_content_block(%L, jsonb_build_object('status', 'PUBLISHED', 'payload',
  jsonb_build_object('event_media_asset_id', %L))) $$, (select value ->> 'event_content_block_id' from ids where name = 'img'), pg_temp.aid('runiis/760/hero')))
  ->> 'code', 'NOT_FOUND', 'status + payload in one call that still points at the archived asset is refused');
select is(pg_temp.err(format($$ select public.update_content_block(%L, jsonb_build_object('status', 'PUBLISHED', 'payload',
  jsonb_build_object('event_media_asset_id', %L))) $$, (select value ->> 'event_content_block_id' from ids where name = 'img'), pg_temp.aid('runiis/760/hero')))
  -> 'detail' ->> 'reason', 'media_not_published', '... same stable reason from the payload path');
select is(pg_temp.err(format($$ select public.create_content_block('50000000-0000-4000-8000-000000760002', jsonb_build_object('block_type', 'IMAGE', 'status', 'PUBLISHED',
  'payload', jsonb_build_object('event_media_asset_id', %L))) $$, pg_temp.aid('runiis/760/hero'))) -> 'detail' ->> 'reason', 'media_not_published',
  'create with status PUBLISHED over an ARCHIVED asset is refused with the reason');

-- ARCHIVED -> PUBLISHED is a publish too.
select pg_temp.exec(format($$ update app.event_content_block set status = 'ARCHIVED' where event_content_block_id = %L $$, (select value ->> 'event_content_block_id' from ids where name = 'img')));
select is(pg_temp.err(format($$ select public.update_content_block(%L, '{"status": "PUBLISHED"}') $$, (select value ->> 'event_content_block_id' from ids where name = 'img')))
  -> 'detail' ->> 'reason', 'media_not_published', 'ARCHIVED -> PUBLISHED over an ARCHIVED asset is refused');
select is(pg_temp.bstatus((select (value ->> 'event_content_block_id')::uuid from ids where name = 'img')), 'ARCHIVED', '... the block is unchanged');

-- A reference that never was PUBLISHED (PENDING asset smuggled into a DRAFT payload) and one from another Edition.
select is(public.create_media_asset('50000000-0000-4000-8000-000000760002',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/760/pending", "alt_text": "Pendiente"}', 'p760-asset-key-0007') ->> 'status', 'PENDING', 'fixture: a PENDING asset');
select is(public.create_media_asset('50000000-0000-4000-8000-000000760001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/760/other-edition", "alt_text": "Otra", "status": "PUBLISHED"}', 'p760-asset-key-0008') ->> 'status', 'PUBLISHED', 'fixture: a PUBLISHED asset of E1');
select pg_temp.exec(format($$ insert into app.event_content_block (event_content_block_id, edition_id, block_type, position, status, payload)
  values ('b0000000-0000-4000-8000-000000760001', '50000000-0000-4000-8000-000000760002', 'IMAGE', 90, 'DRAFT', jsonb_build_object('event_media_asset_id', %L)),
         ('b0000000-0000-4000-8000-000000760002', '50000000-0000-4000-8000-000000760002', 'IMAGE', 91, 'DRAFT', jsonb_build_object('event_media_asset_id', %L)) $$,
  pg_temp.aid('runiis/760/pending'), pg_temp.aid('runiis/760/other-edition')));
select is(pg_temp.err($$ select public.update_content_block('b0000000-0000-4000-8000-000000760001', '{"status": "PUBLISHED"}') $$) -> 'detail' ->> 'reason', 'media_not_published',
  'a PENDING asset in a DRAFT payload does not reach PUBLISHED');
select is(pg_temp.err($$ select public.update_content_block('b0000000-0000-4000-8000-000000760002', '{"status": "PUBLISHED"}') $$) -> 'detail' ->> 'reason', 'media_not_published',
  'an asset of another Edition does not reach PUBLISHED');

-- Swapping to a live asset in the same call is the way out; the healthy and media-free blocks publish.
select is(public.update_content_block((select (value ->> 'event_content_block_id')::uuid from ids where name = 'swap'), jsonb_build_object('status', 'PUBLISHED', 'payload',
  jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/760/healthy')))) ->> 'status', 'PUBLISHED', 'swapping to a PUBLISHED asset and publishing in one call works');
select is(public.update_content_block((select (value ->> 'event_content_block_id')::uuid from ids where name = 'ok'), '{"status": "PUBLISHED"}') ->> 'status', 'PUBLISHED',
  'a DRAFT block over a PUBLISHED asset publishes');
select is(public.update_content_block((select (value ->> 'event_content_block_id')::uuid from ids where name = 'txt'), '{"status": "PUBLISHED"}') ->> 'status', 'PUBLISHED',
  'a block without media publishes');
select is(public.update_content_block((select (value ->> 'event_content_block_id')::uuid from ids where name = 'ok'), '{"position": 77}') ->> 'position', '77',
  'an unrelated edit of an already PUBLISHED block is not re-validated and works');
select is(public.update_content_block((select (value ->> 'event_content_block_id')::uuid from ids where name = 'ok'), '{"status": "DRAFT"}') ->> 'status', 'DRAFT',
  'un-publishing is never refused');

-- The healthy PUBLISHED asset is protected from archive while a PUBLISHED block uses it (P3-O), and the refused publish left no audit row.
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, jsonb_build_object('expected_updated_at', %L), 'p760-arch-key-0005') $$,
  pg_temp.aid('runiis/760/healthy'), pg_temp.tok('runiis/760/healthy'))) -> 'detail' ->> 'reason', 'in_use', 'the swap block now holds the healthy asset: archive is refused in_use');
select is(pg_temp.sv($q$ select count(*) from audit.audit_log where action = 'CONTENT_BLOCK_UPDATED' and entity_id in
  ('b0000000-0000-4000-8000-000000760001', 'b0000000-0000-4000-8000-000000760002') $q$), '0', 'a refused publish writes no audit row');

-- ===========================================================================================
-- 2. Actor labels
-- ===========================================================================================
-- 2a. Attendance, sporting eligibility, finalization and closure resolved by the ADMIN ("Ana Maria Garcia Lopez" -> "Ana L.").
insert into ids select 'ar', public.resolve_attendance('72000000-0000-4000-8000-000000760001', 'PRESENT', 'Vi al corredor', '{"kind": "judge_note"}');
select is((select value ->> 'resolved_by_staff_label' from ids where name = 'ar'), 'Ana L.', 'attendance resolution: an ADMIN viewer reads "First L."');
select is((select value ->> 'resolved_by_staff_id' from ids where name = 'ar'), '20000000-0000-4000-8000-000000760001', '... the opaque id is still returned');
insert into ids select 'se', public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000760001', 'DISQUALIFIED', 'DENY', 'CUT_COURSE', 'Corte de ruta');
select is((select value ->> 'resolved_by_staff_label' from ids where name = 'se'), 'Ana L.', 'sporting eligibility: "First L."');
select public.resolve_sporting_eligibility('72000000-0000-4000-8000-000000760001', 'ELIGIBLE', 'ALLOW');
insert into ids select 'fin', public.finalize_attendance('50000000-0000-4000-8000-000000760001', false, null, 'p760-finalize-key-0001');
select is((select value ->> 'finalized_by_staff_label' from ids where name = 'fin'), 'Ana L.', 'attendance finalization: "First L."');
insert into ids select 'clo', public.close_edition('50000000-0000-4000-8000-000000760001', 'p760-close-key-0001');
select is((select value ->> 'closed_by_staff_label' from ids where name = 'clo'), 'Ana L.', 'administrative closure: "First L."');
select is((select value ->> 'status' from ids where name = 'clo'), 'CLOSED', '... the closure itself is unchanged');
select is(public.attendance_workspace('50000000-0000-4000-8000-000000760001') -> 'current_closure' ->> 'closed_by_staff_label', 'Ana L.',
  'the workspace read carries the label inside the closure projection');

-- Viewer dependence on the same stored rows: the OPERATOR ("Luis") reads the ADMIN as "Ana L."; a CHECKIN viewer (no ADMIN/OPERATOR role) and no
-- session read the neutral label. Projections are read directly as the owner with the viewer in the JWT claims.
reset role;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000760002", "role": "authenticated"}';
select is(private.administrative_closure_projection('50000000-0000-4000-8000-000000760001') ->> 'closed_by_staff_label', 'Ana L.', 'an OPERATOR viewer reads "Ana L."');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000760003", "role": "authenticated"}';
select is(private.administrative_closure_projection('50000000-0000-4000-8000-000000760001') ->> 'closed_by_staff_label', 'Staff #200000',
  'a CHECKIN viewer reads the neutral "Staff #abc123" (first 6 hex of the opaque id)');
select is(private.attendance_finalization_projection('50000000-0000-4000-8000-000000760001') ->> 'finalized_by_staff_label', 'Staff #200000', 'finalization: neutral for CHECKIN');
select is(private.attendance_resolution_projection('72000000-0000-4000-8000-000000760001') ->> 'resolved_by_staff_label', 'Staff #200000', 'attendance resolution: neutral for CHECKIN');
select is(private.sporting_eligibility_projection('72000000-0000-4000-8000-000000760001') ->> 'resolved_by_staff_label', 'Staff #200000', 'eligibility: neutral for CHECKIN');
select is(private.attendance_resolution_projection('72000000-0000-4000-8000-000000760001') ->> 'resolved_by_staff_id', '20000000-0000-4000-8000-000000760001',
  'the neutral viewer still gets the opaque id');
set local "request.jwt.claims" = '{}';
select is(private.administrative_closure_projection('50000000-0000-4000-8000-000000760001') ->> 'closed_by_staff_label', 'Staff #200000', 'no session: neutral label');
select ok(private.administrative_closure_projection('50000000-0000-4000-8000-000000760001')::text !~* '(@example\.test|Maria|Garcia)',
  'no label or field carries an email or the full name');

-- 2b. Route revision created_by (ADMIN creates; OPERATOR and CHECKIN read).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000760001", "role": "authenticated"}';
insert into ids select 'route', public.create_route('50000000-0000-4000-8000-000000760002', jsonb_build_object('name', 'Ruta 760', 'modality_ids', jsonb_build_array('60000000-0000-4000-8000-000000760002')));
insert into ids select 'rev', public.create_manual_revision((select (value ->> 'route_id')::uuid from ids where name = 'route'),
  jsonb_build_object('geometry', jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(
    jsonb_build_array(-100.3098, 25.67), jsonb_build_array(-100.305, 25.673), jsonb_build_array(-100.3, 25.676)))));
select is((select value ->> 'created_by_staff_label' from ids where name = 'rev'), 'Ana L.', 'route revision: the creating ADMIN reads "Ana L."');
select is((select value ->> 'created_by_staff_id' from ids where name = 'rev'), '20000000-0000-4000-8000-000000760001', '... the opaque id is still returned');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000760002", "role": "authenticated"}';
select is(public.admin_get_route_revision((select (value ->> 'route_revision_id')::uuid from ids where name = 'rev')) ->> 'created_by_staff_label', 'Ana L.',
  'an OPERATOR reading the revision gets "Ana L."');
reset role;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000760003", "role": "authenticated"}';
select is(private.route_revision_projection((select (value ->> 'route_revision_id')::uuid from ids where name = 'rev')) ->> 'created_by_staff_label', 'Staff #200000',
  'a CHECKIN viewer reads the neutral label for the same revision');

-- 2c. Platform settings updated_by (null actor -> null label; the ADMIN who updates reads "Ana L.").
update app.platform_settings set updated_by_staff_id = null where settings_id = 1;
select ok(private.platform_settings_projection() -> 'updated_by_staff_label' = 'null'::jsonb and (private.platform_settings_projection() ? 'updated_by_staff_label'),
  'platform settings: nobody updated yet -> label present and null');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000760001", "role": "authenticated"}';
insert into ids select 'settings', public.update_platform_settings(jsonb_build_object('registration_hold_minutes', 21));
select is((select value ->> 'updated_by_staff_label' from ids where name = 'settings'), 'Ana L.', 'platform settings: the updating ADMIN reads "Ana L."');
select is((select value ->> 'updated_by_staff_id' from ids where name = 'settings'), '20000000-0000-4000-8000-000000760001', '... the opaque id is still returned');
select is(public.admin_get_platform_settings() ->> 'updated_by_staff_label', 'Ana L.', 'the settings read carries the label');
select is((select value ->> 'registration_hold_minutes' from ids where name = 'settings'), '21', '... the settings themselves are unchanged in shape');
reset role;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000760003", "role": "authenticated"}';
select is(private.platform_settings_projection() ->> 'updated_by_staff_label', 'Staff #200000', 'a CHECKIN viewer reads the neutral label for the settings');

select * from finish();
rollback;
