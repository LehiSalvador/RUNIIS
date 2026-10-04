-- P3-M Edition configuration API gaps (P3-AC-06, P3-AC-15).
--   1. set_edition_schedule now moves edition.updated_at, so the P3-L expected_updated_at token covers a time-only schedule edit.
--   2. Schedule revision history read (Master 29): newest first, keyset-paginated, EVENT_CONTENT_MANAGE on the Edition.
--   3. event_media_asset references (Master 52): list + idempotent create. No upload pipeline and no new bucket: storage_object_key is the
--      Cloudinary public id of an asset that already exists (ADR-001, lib/shared/media-url.ts delivers by key only).
-- Additive: one existing function is replaced with an identical body plus the touch; nothing else changes signature or grants.

-- ---------------------------------------------------------------------------------------------
-- 1. set_edition_schedule: the body of migration 301 plus one statement. A real revision is an Edition change, so the Edition row moves
-- (touch_updated_at stamps now()); a no-op call (same date/times) still returns changed=false and leaves the row alone. Grants are kept by
-- CREATE OR REPLACE.
-- ---------------------------------------------------------------------------------------------

create or replace function private.set_edition_schedule(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publication text;
  v_staff_id uuid;
  v_input jsonb;
  v_schedule jsonb;
  v_current jsonb;
  v_e app.edition%rowtype;
  v_reason text;
  v_revision_id uuid;
  v_constraint text;
begin
  select e.publication_state into v_publication from app.edition e where e.edition_id = p_edition_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize(
    case when v_publication = 'DRAFT' then 'EVENT_CONTENT_MANAGE' else 'EDITION_LIFECYCLE_MANAGE' end, p_edition_id);
  v_input := private.cfg_object(p_input, array['local_date', 'local_start_time', 'local_end_time', 'reason']);
  v_schedule := private.cfg_schedule_input(v_input);
  v_reason := private.cfg_text(v_input, 'reason', false, 500);

  select * into v_e from app.edition e where e.edition_id = p_edition_id for update;
  if v_e.execution_state <> 'SCHEDULED' then
    perform private.cfg_invalid_transition('execution_state', v_e.execution_state);
  end if;
  v_current := private.current_schedule(p_edition_id);
  if v_current is not null
     and v_current -> 'local_date' = v_schedule -> 'local_date'
     and v_current -> 'local_start_time' = v_schedule -> 'local_start_time'
     and v_current -> 'local_end_time' = v_schedule -> 'local_end_time' then
    return jsonb_build_object('edition', private.edition_projection(p_edition_id), 'changed', false);
  end if;
  if v_e.publication_state <> 'DRAFT' and v_current ->> 'local_date' is not null
     and v_current -> 'local_date' <> v_schedule -> 'local_date' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'date_change_requires_reschedule'));
  end if;

  v_revision_id := private.insert_schedule_revision(p_edition_id, v_schedule, v_reason, v_staff_id);
  -- P3-M: the revision is an Edition change; move the optimistic-concurrency token (touch_updated_at stamps now()).
  update app.edition e set updated_at = pg_catalog.now() where e.edition_id = p_edition_id;
  perform private.audit('EDITION_SCHEDULE_SET', 'edition', p_edition_id, p_edition_id,
    v_current - array['edition_schedule_revision_id', 'created_at', 'effective_start_at', 'effective_end_at', 'revision'],
    v_schedule, v_reason);
  if v_e.publication_state <> 'DRAFT' then
    perform private.enqueue_outbox('EditionRescheduled', 'Edition', p_edition_id,
      'EditionRescheduled:' || p_edition_id || ':' || v_revision_id,
      jsonb_build_object('edition_id', p_edition_id, 'edition_schedule_revision_id', v_revision_id));
  end if;
  return jsonb_build_object('edition', private.edition_projection(p_edition_id), 'changed', true,
    'announced', v_e.publication_state <> 'DRAFT');
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Schedule revision history (Master 29). Revisions are append-only (only superseded_at moves), so a keyset on the revision number is
-- stable. The actor is the opaque staff_member_id: app.staff_member carries no display name (identity lives in auth.users), and nothing
-- else about the actor leaves here. EVENT_CONTENT_MANAGE on the Edition = ADMIN/OPERATOR (global or scoped to this Edition).
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
      'created_by_staff_id', s.created_by_staff_id) order by s.revision desc), '[]'::jsonb)
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

create or replace function public.admin_list_schedule_revisions(
  p_edition_id uuid, p_cursor_revision integer default null, p_limit integer default 20)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_list_schedule_revisions(p_edition_id, p_cursor_revision, p_limit) $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Media asset references (Master 52). The DB keeps metadata and publication authority; the bytes live in Cloudinary (ADR-001), which
-- this unit never calls: a reference points at an asset that was uploaded out of band. storage_object_key therefore has the exact shape
-- lib/shared/media-url.ts can deliver (a plain public id, no scheme, no host, no ".." segment); an https URL is refused because the
-- public page could never render it. IMAGE is the only media_type the delivery URL (image/upload) can serve.
-- Content blocks (IMAGE/GALLERY/SPONSOR_GROUP) can only reference a PUBLISHED asset (cfg_media_ref), so create accepts PENDING (default)
-- or PUBLISHED; ARCHIVED is not a creation state.
-- ---------------------------------------------------------------------------------------------

create or replace function private.media_asset_projection(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('event_media_asset_id', a.event_media_asset_id, 'edition_id', a.edition_id,
    'media_type', a.media_type, 'storage_object_key', a.storage_object_key, 'alt_text', a.alt_text, 'status', a.status,
    'sort_order', a.sort_order, 'focal_point', a.focal_point, 'created_at', a.created_at, 'updated_at', a.updated_at)
  from app.event_media_asset a where a.event_media_asset_id = p_asset_id
$$;

create or replace function private.admin_list_media_assets(
  p_edition_id uuid, p_status text default null, p_cursor_sort_order integer default null, p_cursor_id uuid default null,
  p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows jsonb;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_permission('EVENT_CONTENT_MANAGE', p_edition_id);
  if p_status is not null and p_status not in ('PENDING', 'PUBLISHED', 'ARCHIVED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'status'));
  end if;
  if (p_cursor_sort_order is null) <> (p_cursor_id is null) then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'cursor'));
  end if;

  select coalesce(jsonb_agg(private.media_asset_projection(s.event_media_asset_id) order by s.sort_order, s.event_media_asset_id), '[]'::jsonb)
  into v_rows
  from (
    select a.event_media_asset_id, a.sort_order from app.event_media_asset a
    where a.edition_id = p_edition_id
      and (p_status is null or a.status = p_status)
      and (p_cursor_sort_order is null or (a.sort_order, a.event_media_asset_id) > (p_cursor_sort_order, p_cursor_id))
    order by a.sort_order, a.event_media_asset_id
    limit v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_rows) with ordinality t(x, o) where o <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then jsonb_build_object(
      'sort_order', v_rows -> (v_limit - 1) -> 'sort_order', 'event_media_asset_id', v_rows -> (v_limit - 1) -> 'event_media_asset_id') end);
end;
$$;

create or replace function private.create_media_asset(p_edition_id uuid, p_input jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_type text;
  v_key text;
  v_alt text;
  v_status text;
  v_focal jsonb;
  v_idem jsonb;
  v_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', p_edition_id);
  if p_idempotency_key is null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('header', 'Idempotency-Key', 'reason', 'missing'));
  end if;
  v_input := private.cfg_object(p_input, array['media_type', 'storage_object_key', 'alt_text', 'status', 'sort_order', 'focal_point']);
  v_type := private.cfg_enum(v_input, 'media_type', true, array['IMAGE']);
  v_key := private.cfg_text(v_input, 'storage_object_key', true, 255);
  if v_key !~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,254}$' or v_key ~ '(^|/)\.\.(/|$)' then
    perform private.cfg_fail('storage_object_key', 'invalid_storage_object_key');
  end if;
  v_alt := private.cfg_text(v_input, 'alt_text', true, 300);
  v_status := coalesce(private.cfg_enum(v_input, 'status', false, array['PENDING', 'PUBLISHED']), 'PENDING');
  if private.cfg_present(v_input, 'focal_point') then
    v_focal := v_input -> 'focal_point';
    if jsonb_typeof(v_focal) <> 'object' then perform private.cfg_fail('focal_point', 'must_be_object'); end if;
    perform private.cfg_object(v_focal, array['x', 'y'], 'focal_point');
    perform private.cfg_numeric(v_focal, 'x', true, 0, 1, false, 'focal_point.x');
    perform private.cfg_numeric(v_focal, 'y', true, 0, 1, false, 'focal_point.y');
  end if;

  v_idem := private.cfg_idempotency_begin('media_asset.create', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  insert into app.event_media_asset (edition_id, media_type, storage_object_key, alt_text, status, sort_order, focal_point)
  values (p_edition_id, v_type, v_key, v_alt, v_status,
    coalesce(private.cfg_int(v_input, 'sort_order', false, 0, 10000),
             (select coalesce(max(a.sort_order), 0) + 1 from app.event_media_asset a where a.edition_id = p_edition_id)),
    v_focal)
  returning event_media_asset_id into v_id;

  v_result := private.media_asset_projection(v_id);
  perform private.audit('EVENT_MEDIA_ASSET_CREATED', 'event_media_asset', v_id, p_edition_id, null,
    jsonb_build_object('media_type', v_type, 'status', v_status));
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function public.admin_list_media_assets(
  p_edition_id uuid, p_status text default null, p_cursor_sort_order integer default null, p_cursor_id uuid default null,
  p_limit integer default 20)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_list_media_assets(p_edition_id, p_status, p_cursor_sort_order, p_cursor_id, p_limit) $$;

create or replace function public.create_media_asset(p_edition_id uuid, p_input jsonb, p_idempotency_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_media_asset(p_edition_id, p_input, p_idempotency_key) $$;

-- ---------------------------------------------------------------------------------------------
-- Grants: closed by default, authenticated only (every function authorises from auth.uid()). media_asset_projection is an internal helper.
-- ---------------------------------------------------------------------------------------------

revoke all on function
  private.admin_list_schedule_revisions(uuid, integer, integer), public.admin_list_schedule_revisions(uuid, integer, integer),
  private.media_asset_projection(uuid),
  private.admin_list_media_assets(uuid, text, integer, uuid, integer), public.admin_list_media_assets(uuid, text, integer, uuid, integer),
  private.create_media_asset(uuid, jsonb, text), public.create_media_asset(uuid, jsonb, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.admin_list_schedule_revisions(uuid, integer, integer), public.admin_list_schedule_revisions(uuid, integer, integer),
  private.admin_list_media_assets(uuid, text, integer, uuid, integer), public.admin_list_media_assets(uuid, text, integer, uuid, integer),
  private.create_media_asset(uuid, jsonb, text), public.create_media_asset(uuid, jsonb, text)
to authenticated;
