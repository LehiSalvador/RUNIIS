-- P3-O Media reference lifecycle and staff-safe actor labels (P3-AC-06, P3-AC-09, P3-AC-12).
--   1. event_media_asset lifecycle (Master 52): update metadata, publish, archive. Every command is authenticated, authorised on the asset's
--      Edition (EVENT_CONTENT_MANAGE), validated here, idempotent (Idempotency-Key required), stale-protected (expected_updated_at) and audited.
--      Archiving is refused (CONFLICT reason in_use, with the referencing blocks) while a PUBLISHED content block still uses the asset.
--   2. private.staff_display_label: the one place that turns an opaque staff_member_id into text a staff screen may show, and the two reads that
--      carry an actor now include it (schedule revision history, Task Center assigned staff).
-- Additive. Two existing read functions are replaced with their previous bodies plus one key; grants are kept by CREATE OR REPLACE.

-- ---------------------------------------------------------------------------------------------
-- 1. Staff display label (Master 144/145).
--    app.staff_member carries no name (identity is auth.users), and the email NEVER leaves auth.users through this label. The only human name a
--    staff member has is app.runner_profile.full_name (staff are runners too; optional). Who may see it follows the RBAC matrix: ADMIN and OPERATOR
--    already work with participant names (participant list, requests, registrations), so they get "First L." (first name + last initial, never
--    the full name). CHECKIN, MODERATOR, a viewer without a live ADMIN/OPERATOR role and any staff member without a profile name get the neutral
--    "Staff #abc123" (first 6 hex of the opaque id), which discloses nothing and is stable for the same person.
-- ---------------------------------------------------------------------------------------------

create or replace function private.staff_display_label(p_staff_member_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid;
  v_name text;
  v_parts text[];
  v_first text;
  v_last text;
begin
  if p_staff_member_id is null then return null; end if;
  v_viewer := private.current_staff_member_id();
  if v_viewer is not null and exists (
       select 1 from app.staff_role_assignment sra
       where sra.staff_member_id = v_viewer and sra.revoked_at is null and sra.role in ('ADMIN', 'OPERATOR')) then
    select pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.regexp_replace(rp.full_name, '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'))
    into v_name
    from app.staff_member sm
    join app.runner_profile rp on rp.auth_user_id = sm.auth_user_id
    where sm.staff_member_id = p_staff_member_id;
    if v_name is not null and v_name <> '' then
      v_parts := pg_catalog.string_to_array(v_name, ' ');
      v_first := pg_catalog.left(v_parts[1], 30);
      v_last := v_parts[pg_catalog.array_length(v_parts, 1)];
      if pg_catalog.array_length(v_parts, 1) > 1 then
        return v_first || ' ' || pg_catalog.upper(pg_catalog.left(v_last, 1)) || '.';
      end if;
      return v_first;
    end if;
  end if;
  return 'Staff #' || pg_catalog.left(pg_catalog.replace(p_staff_member_id::text, '-', ''), 6);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Schedule revision history: the body of migration 740 plus created_by_staff_label.
-- ---------------------------------------------------------------------------------------------

create or replace function private.admin_list_schedule_revisions(
  p_edition_id uuid, p_cursor_revision integer default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows jsonb;
  v_total integer;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_permission('EVENT_CONTENT_MANAGE', p_edition_id);
  if p_cursor_revision is not null and p_cursor_revision < 1 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'cursor'));
  end if;

  select count(*)::integer into v_total from app.edition_schedule_revision r where r.edition_id = p_edition_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'edition_schedule_revision_id', s.edition_schedule_revision_id, 'revision', s.revision,
      'schedule_state', s.schedule_state, 'local_date', s.local_date, 'local_start_time', s.local_start_time,
      'local_end_time', s.local_end_time, 'timezone', s.timezone, 'effective_start_at', s.effective_start_at,
      'effective_end_at', s.effective_end_at, 'reason', s.reason, 'created_at', s.created_at,
      'superseded_at', s.superseded_at, 'is_current', s.superseded_at is null,
      'created_by_staff_id', s.created_by_staff_id,
      'created_by_staff_label', private.staff_display_label(s.created_by_staff_id)) order by s.revision desc), '[]'::jsonb)
  into v_rows
  from (
    select r.* from app.edition_schedule_revision r
    where r.edition_id = p_edition_id and (p_cursor_revision is null or r.revision < p_cursor_revision)
    order by r.revision desc
    limit v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_rows) with ordinality t(x, o) where o <= v_limit), '[]'::jsonb),
    'total', v_total,
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then jsonb_build_object(
      'revision', v_rows -> (v_limit - 1) -> 'revision') end);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Task Center projection: the body of migration 720 plus assigned_staff_label (null while unassigned).
-- ---------------------------------------------------------------------------------------------

create or replace function private.admin_task_projection(p_admin_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'admin_task_id', t.admin_task_id, 'task_key', t.task_key, 'category', t.category, 'scope_type', t.scope_type,
    'scope_id', t.scope_id, 'edition_id', t.edition_id, 'related_entity_type', t.related_entity_type,
    'related_entity_id', t.related_entity_id, 'title', t.title, 'description', t.description, 'priority', t.priority,
    'blocking_level', t.blocking_level, 'status', t.status, 'assigned_role', t.assigned_role,
    'assigned_staff_id', t.assigned_staff_id, 'assigned_staff_label', private.staff_display_label(t.assigned_staff_id),
    'detected_at', t.detected_at, 'due_at', t.due_at, 'started_at', t.started_at,
    'resolved_at', t.resolved_at, 'resolution_type', t.resolution_type, 'resolution_reason', t.resolution_reason,
    'source_rule', t.source_rule, 'metadata', t.metadata, 'created_at', t.created_at, 'updated_at', t.updated_at)
  from app.admin_task t
  where t.admin_task_id = p_admin_task_id
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Media asset lifecycle (Master 52). The bytes stay in Cloudinary (ADR-001); this is metadata and publication authority only.
--    Transitions: PENDING -> PUBLISHED, PENDING|PUBLISHED -> ARCHIVED. ARCHIVED is final (nothing edits or republishes it: create a new reference).
--    Editable metadata: alt_text, sort_order, focal_point (null clears) on PENDING or PUBLISHED; storage_object_key only while PENDING (a
--    PENDING reference may have been typed wrong; once PUBLISHED the public page may already render it). Caption and credit are not part of the
--    Master 52 table: a caption lives on the content block payload that uses the asset.
--    Concurrency: the Edition row is locked first (the same lock create/update/delete content block take), then the asset row, so "archive"
--    cannot interleave with a block being published that references the asset; the caller's token (expected_updated_at) is compared on the
--    locked row. A completed idempotent replay returns the stored result even though the row has moved on.
-- ---------------------------------------------------------------------------------------------

-- PUBLISHED content blocks of the Edition whose payload references the asset (IMAGE, GALLERY items and SPONSOR_GROUP sponsors all use the
-- key event_media_asset_id). At most 20 are listed; total is exact.
create or replace function private.media_asset_published_references(p_asset_id uuid, p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with refs as (
    select b.event_content_block_id, b.block_type, b.position
    from app.event_content_block b
    where b.edition_id = p_edition_id and b.status = 'PUBLISHED'
      and pg_catalog.jsonb_path_exists(b.payload, '$.**.event_media_asset_id ? (@ == $id)', pg_catalog.jsonb_build_object('id', p_asset_id::text))
  )
  select pg_catalog.jsonb_build_object(
    'total', (select count(*) from refs),
    'blocks', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'event_content_block_id', x.event_content_block_id, 'block_type', x.block_type, 'position', x.position)
        order by x.position, x.event_content_block_id)
      from (select * from refs order by position, event_content_block_id limit 20) x), '[]'::jsonb))
$$;

-- Shared opening of the three lifecycle commands: resolve the Edition, authorise, require the key, read and validate the body token.
create or replace function private.media_asset_command_begin(
  p_asset_id uuid, p_operation text, p_input jsonb, p_idempotency_key text, p_allowed text[],
  out o_edition_id uuid, out o_expected timestamptz, out o_input jsonb, out o_idem jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text text;
begin
  select a.edition_id into o_edition_id from app.event_media_asset a where a.event_media_asset_id = p_asset_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', o_edition_id);
  if p_idempotency_key is null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('header', 'Idempotency-Key', 'reason', 'missing'));
  end if;
  o_input := private.cfg_object(p_input, p_allowed);
  v_text := private.cfg_text(o_input, 'expected_updated_at', true, 40);
  begin
    o_expected := v_text::timestamptz;
  exception when others then
    perform private.cfg_fail('expected_updated_at', 'invalid_timestamp');
  end;
  o_idem := private.cfg_idempotency_begin(p_operation, p_asset_id::text, p_idempotency_key,
    pg_catalog.jsonb_build_object('asset_id', p_asset_id, 'input', o_input));
end;
$$;

-- Locks the Edition then the asset and refuses a stale token. Returns the locked row.
create or replace function private.media_asset_lock(p_asset_id uuid, p_edition_id uuid, p_expected timestamptz)
returns app.event_media_asset
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a app.event_media_asset%rowtype;
begin
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  select * into v_a from app.event_media_asset a where a.event_media_asset_id = p_asset_id for update;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if v_a.updated_at is distinct from p_expected then
    perform private.raise_domain_error('CONFLICT', pg_catalog.jsonb_build_object(
      'reason', 'STALE_STATE', 'field', 'expected_updated_at', 'current_updated_at', v_a.updated_at));
  end if;
  return v_a;
end;
$$;

create or replace function private.update_media_asset(p_asset_id uuid, p_input jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_expected timestamptz;
  v_input jsonb;
  v_idem jsonb;
  v_a app.event_media_asset%rowtype;
  v_alt text;
  v_sort integer;
  v_key text;
  v_focal jsonb;
  v_changed text[] := '{}';
  v_result jsonb;
  v_constraint text;
begin
  select * into v_edition_id, v_expected, v_input, v_idem from private.media_asset_command_begin(
    p_asset_id, 'media_asset.update', p_input, p_idempotency_key,
    array['expected_updated_at', 'alt_text', 'sort_order', 'focal_point', 'storage_object_key']);
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;
  if not (v_input ?| array['alt_text', 'sort_order', 'focal_point', 'storage_object_key']) then
    perform private.cfg_fail('body', 'no_changes');
  end if;

  v_a := private.media_asset_lock(p_asset_id, v_edition_id, v_expected);
  if v_a.status = 'ARCHIVED' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'not_editable', 'field', 'status', 'current', v_a.status));
  end if;

  if v_input ? 'alt_text' then v_alt := private.cfg_text(v_input, 'alt_text', true, 300); end if;
  if v_input ? 'sort_order' then v_sort := private.cfg_int(v_input, 'sort_order', true, 0, 10000); end if;
  if v_input ? 'storage_object_key' then
    v_key := private.cfg_text(v_input, 'storage_object_key', true, 255);
    if v_key !~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,254}$' or v_key ~ '(^|/)\.\.(/|$)' then
      perform private.cfg_fail('storage_object_key', 'invalid_storage_object_key');
    end if;
    if v_key is distinct from v_a.storage_object_key and v_a.status <> 'PENDING' then
      perform private.raise_domain_error('CONFLICT', jsonb_build_object(
        'reason', 'not_editable', 'field', 'storage_object_key', 'current', v_a.status));
    end if;
  end if;
  if v_input ? 'focal_point' then
    if jsonb_typeof(v_input -> 'focal_point') = 'null' then
      v_focal := null;
    else
      v_focal := v_input -> 'focal_point';
      if jsonb_typeof(v_focal) <> 'object' then perform private.cfg_fail('focal_point', 'must_be_object'); end if;
      perform private.cfg_object(v_focal, array['x', 'y'], 'focal_point');
      perform private.cfg_numeric(v_focal, 'x', true, 0, 1, false, 'focal_point.x');
      perform private.cfg_numeric(v_focal, 'y', true, 0, 1, false, 'focal_point.y');
    end if;
  end if;

  if v_input ? 'alt_text' and v_alt is distinct from v_a.alt_text then v_changed := pg_catalog.array_append(v_changed, 'alt_text'); end if;
  if v_input ? 'sort_order' and v_sort is distinct from v_a.sort_order then v_changed := pg_catalog.array_append(v_changed, 'sort_order'); end if;
  if v_input ? 'storage_object_key' and v_key is distinct from v_a.storage_object_key then v_changed := pg_catalog.array_append(v_changed, 'storage_object_key'); end if;
  if v_input ? 'focal_point' and v_focal is distinct from v_a.focal_point then v_changed := pg_catalog.array_append(v_changed, 'focal_point'); end if;

  if pg_catalog.cardinality(v_changed) > 0 then
    update app.event_media_asset a set
      alt_text = case when v_input ? 'alt_text' then v_alt else a.alt_text end,
      sort_order = case when v_input ? 'sort_order' then v_sort else a.sort_order end,
      storage_object_key = case when v_input ? 'storage_object_key' then v_key else a.storage_object_key end,
      focal_point = case when v_input ? 'focal_point' then v_focal else a.focal_point end
    where a.event_media_asset_id = p_asset_id;
    perform private.audit('EVENT_MEDIA_ASSET_UPDATED', 'event_media_asset', p_asset_id, v_edition_id,
      jsonb_build_object('status', v_a.status),
      jsonb_build_object('status', v_a.status, 'changed_fields', to_jsonb(v_changed)));
  end if;

  v_result := private.media_asset_projection(p_asset_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.media_asset_transition(p_asset_id uuid, p_command text, p_input jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_expected timestamptz;
  v_input jsonb;
  v_idem jsonb;
  v_a app.event_media_asset%rowtype;
  v_target text := case p_command when 'PUBLISH' then 'PUBLISHED' else 'ARCHIVED' end;
  v_refs jsonb;
  v_result jsonb;
  v_constraint text;
begin
  select * into v_edition_id, v_expected, v_input, v_idem from private.media_asset_command_begin(
    p_asset_id, 'media_asset.' || pg_catalog.lower(p_command), p_input, p_idempotency_key, array['expected_updated_at']);
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  v_a := private.media_asset_lock(p_asset_id, v_edition_id, v_expected);
  if (p_command = 'PUBLISH' and v_a.status <> 'PENDING') or (p_command = 'ARCHIVE' and v_a.status not in ('PENDING', 'PUBLISHED')) then
    perform private.cfg_invalid_transition('status', v_a.status);
  end if;
  if p_command = 'ARCHIVE' then
    v_refs := private.media_asset_published_references(p_asset_id, v_edition_id);
    if (v_refs ->> 'total')::integer > 0 then
      perform private.raise_domain_error('CONFLICT', jsonb_build_object(
        'reason', 'in_use', 'field', 'status', 'blocks', v_refs -> 'blocks', 'total', (v_refs ->> 'total')::integer));
    end if;
  end if;

  update app.event_media_asset a set status = v_target where a.event_media_asset_id = p_asset_id;
  perform private.audit(case p_command when 'PUBLISH' then 'EVENT_MEDIA_ASSET_PUBLISHED' else 'EVENT_MEDIA_ASSET_ARCHIVED' end,
    'event_media_asset', p_asset_id, v_edition_id,
    jsonb_build_object('status', v_a.status), jsonb_build_object('status', v_target));
  v_result := private.media_asset_projection(p_asset_id);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.publish_media_asset(p_asset_id uuid, p_input jsonb, p_idempotency_key text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.media_asset_transition(p_asset_id, 'PUBLISH', p_input, p_idempotency_key) $$;

create or replace function private.archive_media_asset(p_asset_id uuid, p_input jsonb, p_idempotency_key text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.media_asset_transition(p_asset_id, 'ARCHIVE', p_input, p_idempotency_key) $$;

create or replace function public.update_media_asset(p_asset_id uuid, p_input jsonb, p_idempotency_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_media_asset(p_asset_id, p_input, p_idempotency_key) $$;

create or replace function public.publish_media_asset(p_asset_id uuid, p_input jsonb, p_idempotency_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.publish_media_asset(p_asset_id, p_input, p_idempotency_key) $$;

create or replace function public.archive_media_asset(p_asset_id uuid, p_input jsonb, p_idempotency_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.archive_media_asset(p_asset_id, p_input, p_idempotency_key) $$;

-- ---------------------------------------------------------------------------------------------
-- Grants: closed by default, authenticated only on the three commands (each authorises from auth.uid()); every helper has no API grant.
-- ---------------------------------------------------------------------------------------------

revoke all on function
  private.staff_display_label(uuid),
  private.media_asset_published_references(uuid, uuid),
  private.media_asset_command_begin(uuid, text, jsonb, text, text[]),
  private.media_asset_lock(uuid, uuid, timestamptz),
  private.media_asset_transition(uuid, text, jsonb, text),
  private.update_media_asset(uuid, jsonb, text), public.update_media_asset(uuid, jsonb, text),
  private.publish_media_asset(uuid, jsonb, text), public.publish_media_asset(uuid, jsonb, text),
  private.archive_media_asset(uuid, jsonb, text), public.archive_media_asset(uuid, jsonb, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.update_media_asset(uuid, jsonb, text), public.update_media_asset(uuid, jsonb, text),
  private.publish_media_asset(uuid, jsonb, text), public.publish_media_asset(uuid, jsonb, text),
  private.archive_media_asset(uuid, jsonb, text), public.archive_media_asset(uuid, jsonb, text)
to authenticated;
