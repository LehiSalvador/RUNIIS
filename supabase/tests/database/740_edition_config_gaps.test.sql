-- P3-M Edition configuration API gaps (P3-AC-06, P3-AC-15): set_edition_schedule moves edition.updated_at (so the P3-L token covers a time-only
-- schedule edit and a stale one is refused), the schedule revision history read (newest first, keyset cursor, scope, no extra actor data) and the
-- event_media_asset reference commands (validated storage key, idempotent create, audit, scope, list). Within one transaction now() is constant, so
-- the version is proven against explicit past values; real two-session races live in tests/integration/events/edition-config-gaps.test.ts.
-- Synthetic ids in a 740 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(81);

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

-- ---------------------------------------------------------------------------------------------
-- Fixture. Staff: ADMIN, OPERATOR (global), CHECKIN, OPERATOR scoped to E2; a buyer without staff role.
-- E1 (DRAFT, past updated_at T0) is the schedule and media subject; E2 (PUBLISHED) is the scoped OPERATOR's Edition.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000740011', 'p740-admin@example.test'), ('00000000-0000-4000-8000-000000740012', 'p740-operator@example.test'),
  ('00000000-0000-4000-8000-000000740013', 'p740-checkin@example.test'), ('00000000-0000-4000-8000-000000740014', 'p740-operator-e2@example.test'),
  ('00000000-0000-4000-8000-000000740015', 'p740-buyer@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000740011', '00000000-0000-4000-8000-000000740011', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000740012', '00000000-0000-4000-8000-000000740012', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000740013', '00000000-0000-4000-8000-000000740013', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000740014', '00000000-0000-4000-8000-000000740014', 'ACTIVE');
insert into app.event (event_id, event_type_id, name, canonical_key, status)
select '40000000-0000-4000-8000-000000740001', et.event_type_id, 'Evento 740', 'p740-uno', 'ACTIVE'
from app.event_type et where et.key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, registration_mode,
  timezone, registration_close_at, city, state_region, country_code, published_at, created_at, updated_at)
values
  ('50000000-0000-4000-8000-000000740001', '40000000-0000-4000-8000-000000740001', 'p740-e1', 'E1 borrador', 'DRAFT', 'SCHEDULED', 'NOT_OPEN', 'FREE',
   'America/Monterrey', now() + interval '60 days', 'Monterrey', 'NL', 'MX', null, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('50000000-0000-4000-8000-000000740002', '40000000-0000-4000-8000-000000740001', 'p740-e2', 'E2 publicada', 'PUBLISHED', 'SCHEDULED', 'NOT_OPEN', 'FREE',
   'America/Monterrey', now() + interval '60 days', 'Monterrey', 'NL', 'MX', now(), '2026-01-02 00:00:00+00', '2026-01-01 00:00:00+00');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000740011', 'ADMIN', 'GLOBAL', null), ('20000000-0000-4000-8000-000000740012', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000740013', 'CHECKIN', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000740014', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000740002');

-- ===========================================================================================
-- Grants
-- ===========================================================================================
select ok(not has_function_privilege('anon', 'public.admin_list_schedule_revisions(uuid, integer, integer)', 'execute'), 'anon cannot read the revision history');
select ok(not has_function_privilege('anon', 'public.admin_list_media_assets(uuid, text, integer, uuid, integer)', 'execute'), 'anon cannot list media assets');
select ok(not has_function_privilege('anon', 'public.create_media_asset(uuid, jsonb, text)', 'execute'), 'anon cannot create a media asset');
select ok(has_function_privilege('authenticated', 'public.create_media_asset(uuid, jsonb, text)', 'execute'), 'authenticated reaches the command (it authorises inside)');
select ok(not has_function_privilege('service_role', 'public.create_media_asset(uuid, jsonb, text)', 'execute'), 'service_role has no grant (no actor)');
select ok(not has_function_privilege('authenticated', 'private.media_asset_projection(uuid)', 'execute'), 'the projection helper has no API grant');

-- ===========================================================================================
-- set_edition_schedule moves edition.updated_at (E1, DRAFT, T0 = 2026-01-01)
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000740012", "role": "authenticated"}';
select is(public.set_edition_schedule('50000000-0000-4000-8000-000000740001', '{"local_date": "2027-03-01", "local_start_time": "07:00"}') ->> 'changed', 'true',
  'the first schedule is a real revision');
select is(pg_temp.sv($$ select (updated_at = now())::text from app.edition where edition_id = '50000000-0000-4000-8000-000000740001' $$), 'true',
  'and moved edition.updated_at off T0');
select is(pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000740001' $$), pg_temp.sv($$ select now()::text $$),
  '... to the transaction time');

-- touch_updated_at would re-stamp a fixture reset; it is off for this section only (the command stamps updated_at explicitly).
select pg_temp.exec($$ alter table app.edition disable trigger touch_updated_at $$);
select is(pg_temp.sv($$ update app.edition set updated_at = '2026-01-01 00:00:00+00' where edition_id = '50000000-0000-4000-8000-000000740001' returning 'x' $$), 'x', 'fixture: version back to T0');
select is(pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000740001' $$), '2026-01-01 00:00:00+00', '... confirmed');

select is(public.set_edition_schedule('50000000-0000-4000-8000-000000740001', '{"local_date": "2027-03-01", "local_start_time": "07:00"}') ->> 'changed', 'false',
  'the same date/time again is a no-op');
select is(pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000740001' $$), '2026-01-01 00:00:00+00',
  '... and does not move the version');

select is(public.set_edition_schedule('50000000-0000-4000-8000-000000740001', '{"local_date": "2027-03-01", "local_start_time": "07:30", "reason": "Ajuste de hora"}') ->> 'changed', 'true',
  'a time-only edit is a revision');
select isnt(pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000740001' $$), '2026-01-01 00:00:00+00',
  '... and moves the version (P3-AC-15)');
select is(public.set_edition_schedule('50000000-0000-4000-8000-000000740001', '{"local_date": "2027-03-01", "local_start_time": "07:30"}') -> 'edition' ->> 'updated_at',
  pg_temp.sv($$ select to_json(updated_at)#>>'{}' from app.edition where edition_id = '50000000-0000-4000-8000-000000740001' $$),
  'the Edition projection returned to the caller carries the new token');

select pg_temp.exec($$ alter table app.edition enable trigger touch_updated_at $$);

-- A client holding T0 (read before the edit) is refused by the guard: the time-only edit above is now visible to the token.
select is(pg_temp.err($$ select public.guarded_edition_command('50000000-0000-4000-8000-000000740001', 'SET_SCHEDULE', '2026-01-01T00:00:00+00:00', '{"local_date": "2027-03-01", "local_start_time": "08:00"}') $$) -> 'detail' ->> 'reason',
  'STALE_STATE', 'a second time-only edit with the pre-edit token is STALE_STATE');
select is(pg_temp.sv($$ select local_start_time::text from app.edition_schedule_revision where edition_id = '50000000-0000-4000-8000-000000740001' and superseded_at is null $$), '07:30:00',
  '... and changed nothing');
select is(public.guarded_edition_command('50000000-0000-4000-8000-000000740001', 'SET_SCHEDULE',
  (pg_temp.sv($$ select updated_at::text from app.edition where edition_id = '50000000-0000-4000-8000-000000740001' $$))::timestamptz,
  '{"local_date": "2027-03-01", "local_start_time": "08:00", "reason": "Ultimo ajuste"}') ->> 'changed', 'true', 'with the re-read token it goes through');

-- ===========================================================================================
-- Schedule revision history (E1 now has revisions 1..3, newest = 3)
-- ===========================================================================================
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') ->> 'total', '3', 'ADMIN/OPERATOR: total revisions');
select is(jsonb_array_length(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items'), 3, '... all on the first page');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 0 ->> 'revision', '3', 'newest first');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 2 ->> 'revision', '1', '... oldest last');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 0 ->> 'is_current', 'true', 'the newest is the current one');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 1 ->> 'is_current', 'false', '... older ones are not');
select isnt(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 1 ->> 'superseded_at', null, '... and carry superseded_at');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 1 ->> 'reason', 'Ajuste de hora', 'the reason is readable');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 1 ->> 'local_start_time', '07:30:00', 'date and times are readable');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 2 ->> 'local_start_time', '07:00:00', '... per revision');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 0 ->> 'timezone', 'America/Monterrey', 'timezone');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 0 ->> 'schedule_state', 'DATE_TIME_CONFIRMED', 'state');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 0 ->> 'created_by_staff_id', '20000000-0000-4000-8000-000000740012',
  'the actor is the opaque staff id');
select is((select array_agg(k order by k) from jsonb_object_keys(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') -> 'items' -> 0) k),
  array['created_at', 'created_by_staff_id', 'created_by_staff_label', 'edition_schedule_revision_id', 'effective_end_at', 'effective_start_at', 'is_current', 'local_date',
        'local_end_time', 'local_start_time', 'reason', 'revision', 'schedule_state', 'superseded_at', 'timezone'],
  'exactly these fields: the opaque id and a staff-safe label (P3-O), never an email or auth id of the actor');
select is(jsonb_array_length(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001', null, 2) -> 'items'), 2, 'limit 2 returns 2');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001', null, 2) -> 'next_cursor' ->> 'revision', '2', '... with a cursor on the last revision shown');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001', 2, 2) -> 'items' -> 0 ->> 'revision', '1', 'the cursor continues with the older revision');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001', 2, 2) -> 'next_cursor', 'null'::jsonb, '... and ends');
select is(pg_temp.err($$ select public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001', 0) $$) -> 'detail' ->> 'field', 'cursor', 'an invalid cursor is a validation error');
select is(pg_temp.err($$ select public.admin_list_schedule_revisions('50000000-0000-4000-8000-0000007409ff') $$) ->> 'code', 'NOT_FOUND', 'unknown Edition is NOT_FOUND');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740002') -> 'items', '[]'::jsonb, 'an Edition without revisions returns an empty list');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000740014", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') $$) ->> 'code', 'FORBIDDEN', 'OPERATOR scoped to E2 cannot read E1');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740002') ->> 'total', '0', '... but can read their own Edition');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000740013", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') $$) ->> 'code', 'FORBIDDEN', 'CHECKIN is FORBIDDEN');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000740015", "role": "authenticated"}';
select is(pg_temp.err($$ select public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000740001') $$) ->> 'code', 'FORBIDDEN', 'a user without a staff role is FORBIDDEN');

-- ===========================================================================================
-- Media asset references
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000740012", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/start", "alt_text": "x"}', null) $$) -> 'detail' ->> 'header',
  'Idempotency-Key', 'the Idempotency-Key is required');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/start", "alt_text": "x"}', 'short') $$) -> 'detail' ->> 'reason',
  'invalid_format', '... and its format is validated');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-0000007409ff', '{"media_type": "IMAGE", "storage_object_key": "runiis/start", "alt_text": "x"}', 'p740-media-key-nf') $$) ->> 'code',
  'NOT_FOUND', 'unknown Edition is NOT_FOUND');

select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "https://res.cloudinary.com/x/a.png", "alt_text": "x"}', 'p740-media-key-url') $$) -> 'detail' ->> 'reason',
  'invalid_storage_object_key', 'an https URL is not a storage key');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "a/../b", "alt_text": "x"}', 'p740-media-key-dd') $$) -> 'detail' ->> 'reason',
  'invalid_storage_object_key', 'a .. segment is refused');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "/abs", "alt_text": "x"}', 'p740-media-key-abs') $$) -> 'detail' ->> 'field',
  'storage_object_key', 'a leading slash is refused');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "VIDEO", "storage_object_key": "runiis/v", "alt_text": "x"}', 'p740-media-key-vid') $$) -> 'detail' ->> 'field',
  'media_type', 'only IMAGE is accepted');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/s", "alt_text": ""}', 'p740-media-key-alt') $$) -> 'detail' ->> 'field',
  'alt_text', 'alt text is required');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/s", "alt_text": "x", "status": "ARCHIVED"}', 'p740-media-key-arc') $$) -> 'detail' ->> 'field',
  'status', 'ARCHIVED is not a creation state');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/s", "alt_text": "x", "focal_point": {"x": 2, "y": 0}}', 'p740-media-key-fp') $$) -> 'detail' ->> 'field',
  'focal_point.x', 'the focal point is bounded to 0..1');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/s", "alt_text": "x", "edition_id": "50000000-0000-4000-8000-000000740002"}', 'p740-media-key-ed') $$) -> 'detail' ->> 'reason',
  'unknown_field', 'unknown fields (an Edition in the body) are refused');
select is(pg_temp.sv($$ select count(*)::text from infra.idempotency_record where idempotency_key like 'p740-media-key-%' $$), '0', 'refused creates leave no idempotency record');

select set_config('p740.audit_before', pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'EVENT_MEDIA_ASSET_CREATED' $$), true);
select is(public.create_media_asset('50000000-0000-4000-8000-000000740001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/2027/start-line", "alt_text": "Linea de salida", "focal_point": {"x": 0.25, "y": 0.5}}', 'p740-media-key-01') ->> 'status', 'PENDING',
  'a reference is created PENDING by default');
select is(pg_temp.sv($$ select storage_object_key from app.event_media_asset where edition_id = '50000000-0000-4000-8000-000000740001' $$), 'runiis/2027/start-line', '... with the key as given');
select is(public.create_media_asset('50000000-0000-4000-8000-000000740001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/2027/start-line", "alt_text": "Linea de salida", "focal_point": {"x": 0.25, "y": 0.5}}', 'p740-media-key-01') ->> 'storage_object_key', 'runiis/2027/start-line',
  'the replay of the same key and body returns the stored asset');
select is(pg_temp.sv($$ select count(*)::text from app.event_media_asset where edition_id = '50000000-0000-4000-8000-000000740001' $$), '1', '... without a second row');
select is(pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'EVENT_MEDIA_ASSET_CREATED' $$)::int - current_setting('p740.audit_before')::int, 1, '... and audited once');
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/otra", "alt_text": "Otra"}', 'p740-media-key-01') $$) ->> 'code',
  'IDEMPOTENCY_CONFLICT', 'the same key with another body conflicts');
select is(public.create_media_asset('50000000-0000-4000-8000-000000740001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/2027/podium", "alt_text": "Podio", "status": "PUBLISHED", "sort_order": 5}', 'p740-media-key-02') ->> 'status', 'PUBLISHED',
  'a PUBLISHED reference can be created directly (content blocks need one)');
select is(public.create_media_asset('50000000-0000-4000-8000-000000740001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/2027/crowd", "alt_text": "Publico"}', 'p740-media-key-03') ->> 'sort_order', '6', 'sort_order defaults to the next position');
select is(pg_temp.sv($$ select (focal_point is null)::text from app.event_media_asset where storage_object_key = 'runiis/2027/crowd' $$), 'true', 'the focal point is optional');

select is(jsonb_array_length(public.admin_list_media_assets('50000000-0000-4000-8000-000000740001') -> 'items'), 3, 'list: the 3 references');
select is(public.admin_list_media_assets('50000000-0000-4000-8000-000000740001') -> 'items' -> 0 ->> 'storage_object_key', 'runiis/2027/start-line', 'list: ordered by sort_order');
select is(jsonb_array_length(public.admin_list_media_assets('50000000-0000-4000-8000-000000740001', 'PUBLISHED') -> 'items'), 1, 'list: status filter');
select is(jsonb_array_length(public.admin_list_media_assets('50000000-0000-4000-8000-000000740001', null, null, null, 2) -> 'items'), 2, 'list: limit 2');
select is(jsonb_array_length(public.admin_list_media_assets('50000000-0000-4000-8000-000000740001', null,
  (public.admin_list_media_assets('50000000-0000-4000-8000-000000740001', null, null, null, 2) -> 'next_cursor' ->> 'sort_order')::integer,
  (public.admin_list_media_assets('50000000-0000-4000-8000-000000740001', null, null, null, 2) -> 'next_cursor' ->> 'event_media_asset_id')::uuid, 2) -> 'items'), 1,
  'list: the cursor continues with the remaining reference');
select is(pg_temp.err($$ select public.admin_list_media_assets('50000000-0000-4000-8000-000000740001', 'DELETED') $$) -> 'detail' ->> 'field', 'status', 'list: invalid status is a validation error');
select is(pg_temp.err($$ select public.admin_list_media_assets('50000000-0000-4000-8000-000000740001', null, 1, null) $$) -> 'detail' ->> 'field', 'cursor', 'list: a half cursor is a validation error');
select is(public.admin_list_media_assets('50000000-0000-4000-8000-000000740002') -> 'items', '[]'::jsonb, 'list: another Edition has none of E1''s assets');

-- A content block can now reference the PUBLISHED asset and not the PENDING one (existing cfg_media_ref rule).
select is(public.create_content_block('50000000-0000-4000-8000-000000740001', jsonb_build_object('block_type', 'IMAGE', 'payload',
  jsonb_build_object('event_media_asset_id', pg_temp.sv($$ select event_media_asset_id::text from app.event_media_asset where storage_object_key = 'runiis/2027/podium' $$), 'caption', 'Podio'))) ->> 'block_type', 'IMAGE',
  'an IMAGE block can reference the PUBLISHED asset');
select is(pg_temp.err(format($$ select public.create_content_block('50000000-0000-4000-8000-000000740001', jsonb_build_object('block_type', 'IMAGE', 'status', 'PUBLISHED', 'payload',
  jsonb_build_object('event_media_asset_id', %L::text, 'caption', 'x'))) $$,
  pg_temp.sv($$ select event_media_asset_id::text from app.event_media_asset where storage_object_key = 'runiis/2027/start-line' $$))) ->> 'code', 'NOT_FOUND',
  '... but not the PENDING one when the block is published');

-- Scope
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000740014", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/x", "alt_text": "x"}', 'p740-media-key-sc1') $$) ->> 'code',
  'FORBIDDEN', 'OPERATOR scoped to E2 cannot create on E1');
select is(pg_temp.err($$ select public.admin_list_media_assets('50000000-0000-4000-8000-000000740001') $$) ->> 'code', 'FORBIDDEN', '... nor list it');
select is(public.create_media_asset('50000000-0000-4000-8000-000000740002', '{"media_type": "IMAGE", "storage_object_key": "runiis/e2", "alt_text": "E2"}', 'p740-media-key-sc2') ->> 'edition_id',
  '50000000-0000-4000-8000-000000740002', '... but can on their own Edition');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000740013", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/x", "alt_text": "x"}', 'p740-media-key-sc3') $$) ->> 'code',
  'FORBIDDEN', 'CHECKIN cannot create');
select is(pg_temp.err($$ select public.admin_list_media_assets('50000000-0000-4000-8000-000000740001') $$) ->> 'code', 'FORBIDDEN', '... nor list');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000740015", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_media_asset('50000000-0000-4000-8000-000000740001', '{"media_type": "IMAGE", "storage_object_key": "runiis/x", "alt_text": "x"}', 'p740-media-key-sc4') $$) ->> 'code',
  'FORBIDDEN', 'a user without a staff role cannot create');

select * from finish();
rollback;
