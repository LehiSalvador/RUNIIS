-- P3-O Media reference lifecycle and staff-safe actor labels (P3-AC-06, P3-AC-09, P3-AC-12).
-- Media: update metadata / publish / archive over event_media_asset (grants, validation, Idempotency-Key, expected_updated_at stale protection,
-- audit, scope, ARCHIVED is final, storage key only while PENDING, archive refused with the referencing blocks while a PUBLISHED content block
-- uses the asset). Labels: private.staff_display_label per viewer role (never email, never the full name), carried by the schedule revision
-- history and the Task Center projection. Within one transaction now() is constant, so a stale token is proven against an explicit past value.
-- Synthetic ids in a 750 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(111);

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
-- The current version token of an asset (by storage key), and a way to push it back to a past instant (trigger off only inside).
create function pg_temp.tok(p_key text) returns text language plpgsql security definer as $$
declare v text;
begin select a.updated_at::text into v from app.event_media_asset a where a.storage_object_key = p_key; return v; end $$;
grant execute on function pg_temp.tok(text) to authenticated;
create function pg_temp.aid(p_key text) returns uuid language plpgsql security definer as $$
declare v uuid;
begin select a.event_media_asset_id into v from app.event_media_asset a where a.storage_object_key = p_key; return v; end $$;
grant execute on function pg_temp.aid(text) to authenticated;
create function pg_temp.back(p_key text) returns void language plpgsql security definer as $$
begin
  alter table app.event_media_asset disable trigger touch_updated_at;
  update app.event_media_asset set updated_at = '2026-01-01 00:00:00+00' where storage_object_key = p_key;
  alter table app.event_media_asset enable trigger touch_updated_at;
end $$;
grant execute on function pg_temp.back(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture. Staff: ADMIN "Ana Maria Garcia Lopez" (profile), OPERATOR "Luis" (profile, one word), CHECKIN (no profile), MODERATOR (profile),
-- OPERATOR scoped to E2, ADMIN without a profile name. E1 is the media/schedule/task subject; E2 belongs to the scoped OPERATOR.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000750011', 'p750-admin@example.test'), ('00000000-0000-4000-8000-000000750012', 'p750-operator@example.test'),
  ('00000000-0000-4000-8000-000000750013', 'p750-checkin@example.test'), ('00000000-0000-4000-8000-000000750014', 'p750-operator-e2@example.test'),
  ('00000000-0000-4000-8000-000000750015', 'p750-buyer@example.test'), ('00000000-0000-4000-8000-000000750016', 'p750-moderator@example.test'),
  ('00000000-0000-4000-8000-000000750017', 'p750-admin-noname@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000750011', '00000000-0000-4000-8000-000000750011', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000750012', '00000000-0000-4000-8000-000000750012', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000750013', '00000000-0000-4000-8000-000000750013', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000750014', '00000000-0000-4000-8000-000000750014', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000750016', '00000000-0000-4000-8000-000000750016', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000750017', '00000000-0000-4000-8000-000000750017', 'ACTIVE');
insert into app.runner_profile (auth_user_id, full_name) values
  ('00000000-0000-4000-8000-000000750011', 'Ana  Maria Garcia   Lopez'), ('00000000-0000-4000-8000-000000750012', 'Luis'),
  ('00000000-0000-4000-8000-000000750016', 'Marta Moderadora')
on conflict (auth_user_id) do update set full_name = excluded.full_name;
insert into app.event (event_id, event_type_id, name, canonical_key, status)
select '40000000-0000-4000-8000-000000750001', et.event_type_id, 'Evento 750', 'p750-uno', 'ACTIVE'
from app.event_type et where et.key = 'ROAD_RACE';
insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, registration_mode,
  timezone, registration_close_at, city, state_region, country_code, published_at, created_at, updated_at)
values
  ('50000000-0000-4000-8000-000000750001', '40000000-0000-4000-8000-000000750001', 'p750-e1', 'E1 borrador', 'DRAFT', 'SCHEDULED', 'NOT_OPEN', 'FREE',
   'America/Monterrey', now() + interval '60 days', 'Monterrey', 'NL', 'MX', null, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('50000000-0000-4000-8000-000000750002', '40000000-0000-4000-8000-000000750001', 'p750-e2', 'E2 publicada', 'PUBLISHED', 'SCHEDULED', 'NOT_OPEN', 'FREE',
   'America/Monterrey', now() + interval '60 days', 'Monterrey', 'NL', 'MX', now(), '2026-01-02 00:00:00+00', '2026-01-01 00:00:00+00');
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values
  ('20000000-0000-4000-8000-000000750011', 'ADMIN', 'GLOBAL', null), ('20000000-0000-4000-8000-000000750012', 'OPERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000750013', 'CHECKIN', 'GLOBAL', null), ('20000000-0000-4000-8000-000000750016', 'MODERATOR', 'GLOBAL', null),
  ('20000000-0000-4000-8000-000000750014', 'OPERATOR', 'EDITION', '50000000-0000-4000-8000-000000750002'),
  ('20000000-0000-4000-8000-000000750017', 'ADMIN', 'GLOBAL', null);

-- ===========================================================================================
-- Grants
-- ===========================================================================================
select ok(not has_function_privilege('anon', 'public.update_media_asset(uuid, jsonb, text)', 'execute'), 'anon cannot update a media asset');
select ok(not has_function_privilege('anon', 'public.publish_media_asset(uuid, jsonb, text)', 'execute'), 'anon cannot publish one');
select ok(not has_function_privilege('anon', 'public.archive_media_asset(uuid, jsonb, text)', 'execute'), 'anon cannot archive one');
select ok(has_function_privilege('authenticated', 'public.update_media_asset(uuid, jsonb, text)', 'execute'), 'authenticated reaches update (it authorises inside)');
select ok(has_function_privilege('authenticated', 'public.publish_media_asset(uuid, jsonb, text)', 'execute'), '... publish');
select ok(has_function_privilege('authenticated', 'public.archive_media_asset(uuid, jsonb, text)', 'execute'), '... archive');
select ok(not has_function_privilege('service_role', 'public.archive_media_asset(uuid, jsonb, text)', 'execute'), 'service_role has no grant (no actor)');
select ok(not has_function_privilege('authenticated', 'private.staff_display_label(uuid)', 'execute'), 'the label helper has no API grant');
select ok(not has_function_privilege('authenticated', 'private.media_asset_transition(uuid, text, jsonb, text)', 'execute'), 'the transition worker has no API grant');
select ok(not has_function_privilege('authenticated', 'private.media_asset_published_references(uuid, uuid)', 'execute'), 'the references helper has no API grant');

-- ===========================================================================================
-- Fixture assets (created as the global OPERATOR)
-- ===========================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750012", "role": "authenticated"}';
select is(public.create_media_asset('50000000-0000-4000-8000-000000750001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/750/typo", "alt_text": "Linea de salida", "focal_point": {"x": 0.25, "y": 0.5}}', 'p750-create-key-0001') ->> 'status', 'PENDING',
  'fixture: a PENDING asset with a typo in its key');
select is(public.create_media_asset('50000000-0000-4000-8000-000000750001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/750/podium", "alt_text": "Podio", "status": "PUBLISHED"}', 'p750-create-key-0002') ->> 'status', 'PUBLISHED',
  'fixture: a PUBLISHED asset');
select is(public.create_media_asset('50000000-0000-4000-8000-000000750001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/750/crowd", "alt_text": "Publico", "status": "PUBLISHED"}', 'p750-create-key-0003') ->> 'status', 'PUBLISHED',
  'fixture: a second PUBLISHED asset (used by a gallery)');
select is(public.create_media_asset('50000000-0000-4000-8000-000000750001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/750/sponsor", "alt_text": "Patrocinador", "status": "PUBLISHED"}', 'p750-create-key-0004') ->> 'status', 'PUBLISHED',
  'fixture: a third PUBLISHED asset (used by a sponsor group)');
select is(public.create_media_asset('50000000-0000-4000-8000-000000750001',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/750/draft-only", "alt_text": "Borrador", "status": "PUBLISHED"}', 'p750-create-key-0005') ->> 'status', 'PUBLISHED',
  'fixture: a PUBLISHED asset only a DRAFT block uses');
select is(public.create_media_asset('50000000-0000-4000-8000-000000750002',
  '{"media_type": "IMAGE", "storage_object_key": "runiis/750/e2", "alt_text": "E2"}', 'p750-create-key-0006') ->> 'edition_id', '50000000-0000-4000-8000-000000750002',
  'fixture: an asset on E2');

-- ===========================================================================================
-- update_media_asset
-- ===========================================================================================
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "x"}', null) $$, pg_temp.aid('runiis/750/typo'))) -> 'detail' ->> 'header',
  'Idempotency-Key', 'update: the Idempotency-Key is required');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"alt_text": "x"}', 'p750-update-key-0001') $$, pg_temp.aid('runiis/750/typo'))) -> 'detail' ->> 'field',
  'expected_updated_at', 'update: the version token is required');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "mañana", "alt_text": "x"}', 'p750-update-key-0002') $$, pg_temp.aid('runiis/750/typo'))) -> 'detail' ->> 'reason',
  'invalid_timestamp', 'update: an unparseable token is a validation error');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L), 'p750-update-key-0003') $$, pg_temp.aid('runiis/750/typo'), pg_temp.tok('runiis/750/typo'))) -> 'detail' ->> 'reason',
  'no_changes', 'update: a body with a token and nothing to change is refused');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'status', 'PUBLISHED'), 'p750-update-key-0004') $$, pg_temp.aid('runiis/750/typo'), pg_temp.tok('runiis/750/typo'))) -> 'detail' ->> 'field',
  'body.status', 'update: status is not a metadata field (use publish/archive)');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'alt_text', ''), 'p750-update-key-0005') $$, pg_temp.aid('runiis/750/typo'), pg_temp.tok('runiis/750/typo'))) -> 'detail' ->> 'field',
  'alt_text', 'update: an empty alt text is refused');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'alt_text', null), 'p750-update-key-0006') $$, pg_temp.aid('runiis/750/typo'), pg_temp.tok('runiis/750/typo'))) -> 'detail' ->> 'field',
  'alt_text', 'update: alt text cannot be cleared');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'storage_object_key', 'https://res.cloudinary.com/x/a.png'), 'p750-update-key-0007') $$, pg_temp.aid('runiis/750/typo'), pg_temp.tok('runiis/750/typo'))) -> 'detail' ->> 'reason',
  'invalid_storage_object_key', 'update: a URL is not a storage key');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'focal_point', jsonb_build_object('x', 3, 'y', 0)), 'p750-update-key-0008') $$, pg_temp.aid('runiis/750/typo'), pg_temp.tok('runiis/750/typo'))) -> 'detail' ->> 'field',
  'focal_point.x', 'update: a focal point outside 0..1 is refused');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'sort_order', 20000), 'p750-update-key-0009') $$, pg_temp.aid('runiis/750/typo'), pg_temp.tok('runiis/750/typo'))) -> 'detail' ->> 'field',
  'sort_order', 'update: sort_order is bounded');
select is(pg_temp.err($$ select public.update_media_asset('50000000-0000-4000-8000-0000007509ff', '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "x"}', 'p750-update-key-0010') $$) ->> 'code',
  'NOT_FOUND', 'update: an unknown asset is NOT_FOUND');
select is(pg_temp.sv($$ select count(*)::text from infra.idempotency_record where idempotency_key like 'p750-update-key-%' $$), '0', 'refused updates leave no idempotency record');

-- A stale token changes nothing.
select pg_temp.back('runiis/750/typo');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "2026-02-02T00:00:00+00:00", "alt_text": "Viejo"}', 'p750-update-key-0011') $$, pg_temp.aid('runiis/750/typo'))) -> 'detail' ->> 'reason',
  'STALE_STATE', 'update: a token that does not match is STALE_STATE');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "2026-02-02T00:00:00+00:00", "alt_text": "Viejo"}', 'p750-update-key-0011') $$, pg_temp.aid('runiis/750/typo'))) -> 'detail' ->> 'current_updated_at',
  '2026-01-01T00:00:00+00:00', '... and tells the client the current version');
select is(pg_temp.sv($$ select alt_text from app.event_media_asset where storage_object_key = 'runiis/750/typo' $$), 'Linea de salida', '... without changing the asset');

-- Correct a PENDING mistake: key, alt text, sort order and clear the focal point in one call.
select is(public.update_media_asset(pg_temp.aid('runiis/750/typo'),
  '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "storage_object_key": "runiis/750/start-line", "alt_text": "  Linea de salida 2027  ", "sort_order": 9, "focal_point": null}',
  'p750-update-key-0012') ->> 'storage_object_key', 'runiis/750/start-line', 'a PENDING asset can have its storage key corrected');
select is(pg_temp.sv($$ select alt_text from app.event_media_asset where storage_object_key = 'runiis/750/start-line' $$), 'Linea de salida 2027', '... alt text trimmed and saved');
select is(pg_temp.sv($$ select sort_order::text from app.event_media_asset where storage_object_key = 'runiis/750/start-line' $$), '9', '... sort order saved');
select is(pg_temp.sv($$ select (focal_point is null)::text from app.event_media_asset where storage_object_key = 'runiis/750/start-line' $$), 'true', '... focal point cleared by null');
select is(pg_temp.sv($$ select status from app.event_media_asset where storage_object_key = 'runiis/750/start-line' $$), 'PENDING', '... and still PENDING (update never publishes)');
select isnt(pg_temp.tok('runiis/750/start-line'), '2026-01-01 00:00:00+00', 'the version token moved');
select is(pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'EVENT_MEDIA_ASSET_UPDATED' and entity_id = '$$ || pg_temp.aid('runiis/750/start-line') || $$' $$), '1', 'audited once');
select is(pg_temp.sv($$ select (after_snapshot -> 'changed_fields')::text from audit.audit_log where action = 'EVENT_MEDIA_ASSET_UPDATED' and entity_id = '$$ || pg_temp.aid('runiis/750/start-line') || $$' $$),
  '["alt_text", "sort_order", "storage_object_key", "focal_point"]'::jsonb::text, 'the audit names the changed fields, not their values');

-- Replay of the same key + same body: stored result, no second audit, even though the token on the wire is now stale.
select is(public.update_media_asset(pg_temp.aid('runiis/750/start-line'),
  '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "storage_object_key": "runiis/750/start-line", "alt_text": "  Linea de salida 2027  ", "sort_order": 9, "focal_point": null}',
  'p750-update-key-0012') ->> 'alt_text', 'Linea de salida 2027', 'replay of a completed key returns the stored asset');
select is(pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'EVENT_MEDIA_ASSET_UPDATED' and edition_id = '50000000-0000-4000-8000-000000750001' $$), '1', '... with no second audit');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "Otra"}', 'p750-update-key-0012') $$, pg_temp.aid('runiis/750/start-line'))) ->> 'code',
  'IDEMPOTENCY_CONFLICT', 'the same key with another body is IDEMPOTENCY_CONFLICT');

-- A no-op (same values) neither writes nor audits.
select pg_temp.back('runiis/750/start-line');
select is(public.update_media_asset(pg_temp.aid('runiis/750/start-line'),
  '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "Linea de salida 2027"}', 'p750-update-key-0013') ->> 'updated_at', '2026-01-01T00:00:00+00:00',
  'an update that changes nothing leaves the version alone');
select is(pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'EVENT_MEDIA_ASSET_UPDATED' and edition_id = '50000000-0000-4000-8000-000000750001' $$), '1', '... and writes no audit');

-- A PUBLISHED asset: metadata yes, storage key no.
select pg_temp.back('runiis/750/podium');
select is(public.update_media_asset(pg_temp.aid('runiis/750/podium'),
  '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "Podio del maraton", "focal_point": {"x": 0.5, "y": 0.4}}', 'p750-update-key-0014') ->> 'alt_text', 'Podio del maraton',
  'a PUBLISHED asset keeps editable metadata');
select is(pg_temp.sv($$ select focal_point ->> 'y' from app.event_media_asset where storage_object_key = 'runiis/750/podium' $$), '0.4', '... including the focal point');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'storage_object_key', 'runiis/750/other'), 'p750-update-key-0015') $$,
  pg_temp.aid('runiis/750/podium'), pg_temp.tok('runiis/750/podium'))) -> 'detail' ->> 'field', 'storage_object_key', 'a PUBLISHED asset cannot be repointed to another file');
select is(pg_temp.sv($$ select storage_object_key from app.event_media_asset where event_media_asset_id = '$$ || pg_temp.aid('runiis/750/podium') || $$' $$), 'runiis/750/podium', '... and kept its key');

-- ===========================================================================================
-- publish_media_asset
-- ===========================================================================================
select is(pg_temp.err(format($$ select public.publish_media_asset(%L, jsonb_build_object('expected_updated_at', %L), null) $$, pg_temp.aid('runiis/750/start-line'), pg_temp.tok('runiis/750/start-line'))) -> 'detail' ->> 'header',
  'Idempotency-Key', 'publish: the Idempotency-Key is required');
select is(pg_temp.err(format($$ select public.publish_media_asset(%L, '{}', 'p750-publish-key-0001') $$, pg_temp.aid('runiis/750/start-line'))) -> 'detail' ->> 'field',
  'expected_updated_at', 'publish: the version token is required');
select is(pg_temp.err(format($$ select public.publish_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'status', 'ARCHIVED'), 'p750-publish-key-0002') $$,
  pg_temp.aid('runiis/750/start-line'), pg_temp.tok('runiis/750/start-line'))) -> 'detail' ->> 'field', 'body.status', 'publish: no other field is accepted');
select is(pg_temp.err(format($$ select public.publish_media_asset(%L, '{"expected_updated_at": "2026-02-02T00:00:00+00:00"}', 'p750-publish-key-0003') $$, pg_temp.aid('runiis/750/start-line'))) -> 'detail' ->> 'reason',
  'STALE_STATE', 'publish: a stale token is refused');
select is(public.publish_media_asset(pg_temp.aid('runiis/750/start-line'), '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-publish-key-0004') ->> 'status', 'PUBLISHED',
  'a PENDING asset can be published');
select is(public.publish_media_asset(pg_temp.aid('runiis/750/start-line'), '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-publish-key-0004') ->> 'status', 'PUBLISHED',
  'the same key replays the stored result');
select is(pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'EVENT_MEDIA_ASSET_PUBLISHED' and edition_id = '50000000-0000-4000-8000-000000750001' $$), '1', '... with one audit row');
select is(pg_temp.err(format($$ select public.publish_media_asset(%L, jsonb_build_object('expected_updated_at', %L), 'p750-publish-key-0005') $$, pg_temp.aid('runiis/750/start-line'), pg_temp.tok('runiis/750/start-line'))) -> 'detail' ->> 'reason',
  'invalid_transition', 'publishing a PUBLISHED asset is an invalid transition');
-- The published asset can now back a content block (existing cfg_media_ref rule).
select is(public.create_content_block('50000000-0000-4000-8000-000000750001', jsonb_build_object('block_type', 'IMAGE', 'status', 'PUBLISHED', 'payload',
  jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/750/start-line')::text))) ->> 'block_type', 'IMAGE', 'a freshly published asset can be used by a published block');

-- ===========================================================================================
-- archive_media_asset: refused while a PUBLISHED block uses the asset
-- ===========================================================================================
select pg_temp.back('runiis/750/start-line');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0001') $$, pg_temp.aid('runiis/750/start-line'))) ->> 'code',
  'CONFLICT', 'archive: refused while a PUBLISHED IMAGE block uses it');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0001') $$, pg_temp.aid('runiis/750/start-line'))) -> 'detail' ->> 'reason',
  'in_use', '... with reason in_use');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0001') $$, pg_temp.aid('runiis/750/start-line'))) -> 'detail' ->> 'total',
  '1', '... and the exact number of referencing blocks');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0001') $$, pg_temp.aid('runiis/750/start-line'))) -> 'detail' -> 'blocks' -> 0 ->> 'block_type',
  'IMAGE', '... listing the block (id, type, position) so the operator can find it');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0001') $$,
  pg_temp.aid('runiis/750/start-line'))) -> 'detail' -> 'blocks' -> 0) k), array['block_type', 'event_content_block_id', 'position'], 'the listed block carries no payload');
select is(pg_temp.sv($$ select status from app.event_media_asset where storage_object_key = 'runiis/750/start-line' $$), 'PUBLISHED', 'the refused archive changed nothing');
select is(pg_temp.sv($$ select count(*)::text from infra.idempotency_record where idempotency_key = 'p750-archive-key-0001' $$), '0', '... and left no idempotency record (the same key can retry after fixing the block)');

-- Galleries and sponsor groups count too; a DRAFT block does not.
select is(public.create_content_block('50000000-0000-4000-8000-000000750001', jsonb_build_object('block_type', 'GALLERY', 'status', 'PUBLISHED', 'payload',
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/750/crowd')::text))))) ->> 'block_type', 'GALLERY', 'fixture: a PUBLISHED gallery');
select is(public.create_content_block('50000000-0000-4000-8000-000000750001', jsonb_build_object('block_type', 'SPONSOR_GROUP', 'status', 'PUBLISHED', 'payload',
  jsonb_build_object('sponsors', jsonb_build_array(jsonb_build_object('name', 'Marca', 'event_media_asset_id', pg_temp.aid('runiis/750/sponsor')::text))))) ->> 'block_type', 'SPONSOR_GROUP', 'fixture: a PUBLISHED sponsor group');
select public.create_content_block('50000000-0000-4000-8000-000000750001', jsonb_build_object('block_type', 'IMAGE', 'status', 'DRAFT', 'payload',
  jsonb_build_object('event_media_asset_id', pg_temp.aid('runiis/750/draft-only')::text)));
select pg_temp.back('runiis/750/crowd');
select pg_temp.back('runiis/750/sponsor');
select pg_temp.back('runiis/750/draft-only');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0002') $$, pg_temp.aid('runiis/750/crowd'))) -> 'detail' ->> 'reason',
  'in_use', 'a PUBLISHED gallery item blocks the archive');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0003') $$, pg_temp.aid('runiis/750/sponsor'))) -> 'detail' ->> 'reason',
  'in_use', '... and a PUBLISHED sponsor logo');
select is(public.archive_media_asset(pg_temp.aid('runiis/750/draft-only'), '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0004') ->> 'status', 'ARCHIVED',
  'an asset used only by a DRAFT block can be archived');

-- Once the block is no longer PUBLISHED, the same asset archives.
select pg_temp.exec($$ update app.event_content_block set status = 'ARCHIVED' where payload @> jsonb_build_object('event_media_asset_id', '$$ || pg_temp.aid('runiis/750/start-line') || $$') $$);
select is(public.archive_media_asset(pg_temp.aid('runiis/750/start-line'), '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0001') ->> 'status', 'ARCHIVED',
  'after the block leaves PUBLISHED, the asset archives (same key as the refused attempt)');
select is(pg_temp.sv($$ select count(*)::text from audit.audit_log where action = 'EVENT_MEDIA_ASSET_ARCHIVED' and edition_id = '50000000-0000-4000-8000-000000750001' $$), '2', 'both archives were audited');
select is(public.admin_list_media_assets('50000000-0000-4000-8000-000000750001', 'ARCHIVED') -> 'items' -> 0 ->> 'status', 'ARCHIVED', 'the list reads ARCHIVED assets with the status filter');

-- Archived is final.
select is(pg_temp.err(format($$ select public.publish_media_asset(%L, jsonb_build_object('expected_updated_at', %L), 'p750-archive-key-0005') $$, pg_temp.aid('runiis/750/start-line'), pg_temp.tok('runiis/750/start-line'))) -> 'detail' ->> 'reason',
  'invalid_transition', 'an ARCHIVED asset cannot be published again');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, jsonb_build_object('expected_updated_at', %L), 'p750-archive-key-0006') $$, pg_temp.aid('runiis/750/start-line'), pg_temp.tok('runiis/750/start-line'))) -> 'detail' ->> 'reason',
  'invalid_transition', '... nor archived twice');
select is(pg_temp.err(format($$ select public.update_media_asset(%L, jsonb_build_object('expected_updated_at', %L, 'alt_text', 'x'), 'p750-archive-key-0007') $$, pg_temp.aid('runiis/750/start-line'), pg_temp.tok('runiis/750/start-line'))) -> 'detail' ->> 'reason',
  'not_editable', '... nor edited');
select is(pg_temp.err(format($$ select public.create_content_block('50000000-0000-4000-8000-000000750001', jsonb_build_object('block_type', 'IMAGE', 'status', 'PUBLISHED', 'payload',
  jsonb_build_object('event_media_asset_id', %L))) $$, pg_temp.aid('runiis/750/start-line')::text)) ->> 'code', 'NOT_FOUND', 'and a new block cannot reference it (existing rule: only PUBLISHED assets)');

-- A PENDING asset can be archived (mistake discarded).
select is(public.create_media_asset('50000000-0000-4000-8000-000000750001', '{"media_type": "IMAGE", "storage_object_key": "runiis/750/oops", "alt_text": "Equivocado"}', 'p750-create-key-0007') ->> 'status', 'PENDING',
  'fixture: another PENDING asset');
select pg_temp.back('runiis/750/oops');
select is(public.archive_media_asset(pg_temp.aid('runiis/750/oops'), '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-archive-key-0008') ->> 'status', 'ARCHIVED', 'a PENDING mistake can be archived');

-- ===========================================================================================
-- Scope and roles
-- ===========================================================================================
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750014", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "x"}', 'p750-scope-key-00001') $$, pg_temp.aid('runiis/750/podium'))) ->> 'code',
  'FORBIDDEN', 'OPERATOR scoped to E2 cannot update an E1 asset');
select pg_temp.back('runiis/750/e2');
select is(public.publish_media_asset(pg_temp.aid('runiis/750/e2'), '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-scope-key-00002') ->> 'status',
  'PUBLISHED', '... but can publish on their own Edition');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-scope-key-00003') $$, pg_temp.aid('runiis/750/podium'))) ->> 'code',
  'FORBIDDEN', '... nor archive it');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750013", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "x"}', 'p750-scope-key-00004') $$, pg_temp.aid('runiis/750/podium'))) ->> 'code',
  'FORBIDDEN', 'CHECKIN cannot update');
select is(pg_temp.err(format($$ select public.publish_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-scope-key-00005') $$, pg_temp.aid('runiis/750/podium'))) ->> 'code',
  'FORBIDDEN', '... publish');
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-scope-key-00006') $$, pg_temp.aid('runiis/750/podium'))) ->> 'code',
  'FORBIDDEN', '... or archive');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750016", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.archive_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00"}', 'p750-scope-key-00007') $$, pg_temp.aid('runiis/750/podium'))) ->> 'code',
  'FORBIDDEN', 'MODERATOR cannot archive');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750015", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "x"}', 'p750-scope-key-00008') $$, pg_temp.aid('runiis/750/podium'))) ->> 'code',
  'FORBIDDEN', 'a user without a staff role cannot update');
select is(pg_temp.sv($$ select alt_text from app.event_media_asset where storage_object_key = 'runiis/750/podium' $$), 'Podio del maraton', 'refused calls changed nothing');
set local "request.jwt.claims" = '{}';
select is(pg_temp.err(format($$ select public.update_media_asset(%L, '{"expected_updated_at": "2026-01-01T00:00:00+00:00", "alt_text": "x"}', 'p750-scope-key-00009') $$, pg_temp.aid('runiis/750/podium'))) ->> 'code',
  'AUTH_REQUIRED', 'an unauthenticated caller is refused inside the function too');

-- ===========================================================================================
-- Staff labels
-- ===========================================================================================
-- A schedule revision by the OPERATOR ("Luis") and one by the ADMIN ("Ana Maria Garcia Lopez").
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750012", "role": "authenticated"}';
select is(public.set_edition_schedule('50000000-0000-4000-8000-000000750001', '{"local_date": "2027-03-01", "local_start_time": "07:00"}') ->> 'changed', 'true', 'fixture: revision 1 by the OPERATOR');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750011", "role": "authenticated"}';
select is(public.set_edition_schedule('50000000-0000-4000-8000-000000750001', '{"local_date": "2027-03-01", "local_start_time": "07:30"}') ->> 'changed', 'true', 'fixture: revision 2 by the ADMIN');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000750001') -> 'items' -> 0 ->> 'created_by_staff_label', 'Ana L.',
  'ADMIN viewer: a multi-word name is first name + last initial, whitespace collapsed (never the full name)');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000750001') -> 'items' -> 1 ->> 'created_by_staff_label', 'Luis',
  '... a one-word name stays as is');
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000750001') -> 'items' -> 0 ->> 'created_by_staff_id', '20000000-0000-4000-8000-000000750011',
  'the opaque id is still returned');
select is((select array_agg(k order by k) from jsonb_object_keys(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000750001') -> 'items' -> 0) k),
  array['created_at', 'created_by_staff_id', 'created_by_staff_label', 'edition_schedule_revision_id', 'effective_end_at', 'effective_start_at', 'is_current',
        'local_date', 'local_end_time', 'local_start_time', 'reason', 'revision', 'schedule_state', 'superseded_at', 'timezone'],
  'exactly the previous fields plus the label: no email, no auth id');
select ok(position('example.test' in public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000750001')::text) = 0
  and position('p750-' in public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000750001')::text) = 0, 'no email fragment anywhere in the history response');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750014", "role": "authenticated"}';
select is(public.admin_list_schedule_revisions('50000000-0000-4000-8000-000000750002') ->> 'total', '0', 'a scoped OPERATOR reads their own Edition history');

-- Direct label checks per viewer (the helper has no API grant, so it is called as the table owner with the viewer''s claims).
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750011", "role": "authenticated"}';
select is(pg_temp.sv($$ select private.staff_display_label('20000000-0000-4000-8000-000000750013') $$), 'Staff #200000',
  'ADMIN viewer, target without a profile name: neutral label with the first 6 hex of the id');
select is(pg_temp.sv($$ select private.staff_display_label('20000000-0000-4000-8000-000000750017') $$), 'Staff #200000', '... same for an ADMIN without a profile');
select is(pg_temp.sv($$ select private.staff_display_label('20000000-0000-4000-8000-000000750016') $$), 'Marta M.', 'ADMIN viewer: a MODERATOR with a profile is named like any staff member');
select is(pg_temp.sv($$ select private.staff_display_label(null) $$), null, 'a null staff id has a null label');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750014", "role": "authenticated"}';
select is(pg_temp.sv($$ select private.staff_display_label('20000000-0000-4000-8000-000000750011') $$), 'Ana L.', 'a scoped OPERATOR viewer sees the abbreviated name');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750013", "role": "authenticated"}';
select is(pg_temp.sv($$ select private.staff_display_label('20000000-0000-4000-8000-000000750011') $$), 'Staff #200000', 'CHECKIN viewer: no name, only the neutral label');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750016", "role": "authenticated"}';
select is(pg_temp.sv($$ select private.staff_display_label('20000000-0000-4000-8000-000000750012') $$), 'Staff #200000', 'MODERATOR viewer: no name, only the neutral label');
set local "request.jwt.claims" = '{}';
select is(pg_temp.sv($$ select private.staff_display_label('20000000-0000-4000-8000-000000750012') $$), 'Staff #200000', 'no viewer (system/anon): no name, only the neutral label');
select pg_temp.exec($$ update app.staff_role_assignment set revoked_at = now() where staff_member_id = '20000000-0000-4000-8000-000000750012' $$);
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750012", "role": "authenticated"}';
select is(pg_temp.sv($$ select private.staff_display_label('20000000-0000-4000-8000-000000750011') $$), 'Staff #200000', 'a viewer whose ADMIN/OPERATOR role was revoked loses the name');
select pg_temp.exec($$ update app.staff_role_assignment set revoked_at = null where staff_member_id = '20000000-0000-4000-8000-000000750012' $$);

-- Task Center: assigned_staff_label follows the viewer; unassigned is null.
select pg_temp.exec($$ insert into app.admin_task (task_key, category, scope_type, scope_id, edition_id, title, description, priority, blocking_level, source_rule)
  values ('raceday_unknown_pass_burst:50000000-0000-4000-8000-000000750001:p750', 'RACE_DAY', 'EDITION', '50000000-0000-4000-8000-000000750001',
    '50000000-0000-4000-8000-000000750001', 'Rafaga', 'Rafaga de pruebas', 'HIGH', 'ACTION_REQUIRED', 'raceday_unknown_pass_burst') $$);
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750012", "role": "authenticated"}';
select is(public.admin_list_tasks('50000000-0000-4000-8000-000000750001') -> 'items' -> 0 ->> 'assigned_staff_label', null, 'an unassigned task has a null label');
select is(public.start_admin_task(pg_temp.sv($$ select admin_task_id::text from app.admin_task where task_key like '%p750' $$)::uuid, 'p750-task-start-key-01') ->> 'assigned_staff_label', 'Luis',
  'starting a task assigns the actor and the response labels them for ADMIN/OPERATOR');
select is(public.admin_list_tasks('50000000-0000-4000-8000-000000750001') -> 'items' -> 0 ->> 'assigned_staff_label', 'Luis', 'the list carries the label');
select is(public.admin_list_tasks('50000000-0000-4000-8000-000000750001') -> 'items' -> 0 ->> 'assigned_staff_id', '20000000-0000-4000-8000-000000750012', '... next to the opaque id');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000750013", "role": "authenticated"}';
select is(public.admin_get_task(pg_temp.sv($$ select admin_task_id::text from app.admin_task where task_key like '%p750' $$)::uuid) ->> 'assigned_staff_label', 'Staff #200000',
  'CHECKIN reading the same RACE_DAY task sees only the neutral label');
select ok(position('Luis' in public.admin_get_task(pg_temp.sv($$ select admin_task_id::text from app.admin_task where task_key like '%p750' $$)::uuid)::text) = 0,
  '... and the name appears nowhere in the response');

select * from finish();
rollback;
