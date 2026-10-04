-- P3-P Backend follow-ups (P3-AC-06, P3-AC-09, P3-AC-11).
--   1. A content block can no longer reach PUBLISHED carrying a media reference that is not a PUBLISHED asset of its own Edition. Until now
--      the references were validated only when the payload was written (create / update with payload), so the path
--      "DRAFT block -> asset archived (a DRAFT block does not block the archive) -> block set to PUBLISHED" published an ARCHIVED asset.
--      The publish transition (status becomes PUBLISHED from any other status) now re-checks every event_media_asset_id the stored payload
--      carries, under the same Edition lock the asset commands take, so it cannot interleave with an archive either.
--   2. Staff-safe actor labels (private.staff_display_label, P3-O) on the remaining projections that exposed only an opaque staff id:
--      attendance resolution (resolved_by), sporting eligibility (resolved_by), attendance finalization (finalized_by), administrative
--      closure (closed_by), route revision (created_by) and platform settings (updated_by). reopened_by_staff_id is not part of any projection
--      (a reopen supersedes the row, and only the current row is projected), so there is nothing to label for it.
-- Additive: every projection keeps its previous keys and gains one *_label key; the labels are viewer-dependent (never share a cached response
-- across roles) and never an email, an auth id or a full name.

-- ---------------------------------------------------------------------------------------------
-- 1. Media references
-- ---------------------------------------------------------------------------------------------

-- cfg_media_ref: same contract as before (NOT_FOUND + field), plus a stable machine reason in the details.
create or replace function private.cfg_media_ref(p_input jsonb, p_key text, p_required boolean, p_edition_id uuid, p_field text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.cfg_uuid(p_input, p_key, p_required, p_field);
begin
  if v_id is not null and not exists (
       select 1 from app.event_media_asset a
       where a.event_media_asset_id = v_id and a.edition_id = p_edition_id and a.status = 'PUBLISHED') then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', p_field, 'reason', 'media_not_published'));
  end if;
  return v_id;
end;
$$;

-- Every event_media_asset_id the payload carries (IMAGE, GALLERY items, SPONSOR_GROUP sponsors) must be a PUBLISHED asset of the Edition.
-- Only the media references are re-checked (not the rest of the payload), so an old block is never refused for an unrelated rule.
create or replace function private.cfg_assert_block_media_published(p_payload jsonb, p_edition_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref jsonb;
  v_id uuid;
begin
  if p_payload is null then return; end if;
  for v_ref in
    select r from pg_catalog.jsonb_path_query(p_payload, '$.**.event_media_asset_id') r
  loop
    begin
      v_id := (v_ref #>> '{}')::uuid;
    exception when others then
      v_id := null;
    end;
    if v_id is null or not exists (
         select 1 from app.event_media_asset a
         where a.event_media_asset_id = v_id and a.edition_id = p_edition_id and a.status = 'PUBLISHED') then
      perform private.raise_domain_error('NOT_FOUND', pg_catalog.jsonb_build_object(
        'field', 'payload.event_media_asset_id', 'reason', 'media_not_published'));
    end if;
  end loop;
end;
$$;

-- update_content_block: the body of migration 302 plus the publish re-validation.
create or replace function private.update_content_block(p_block_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_n app.event_content_block%rowtype;
  v_before_status text;
  v_constraint text;
begin
  select b.edition_id into v_edition_id from app.event_content_block b where b.event_content_block_id = p_block_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['modality_id', 'position', 'status', 'payload']);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  select * into v_n from app.event_content_block b where b.event_content_block_id = p_block_id for update;
  v_before_status := v_n.status;
  if v_input ? 'modality_id' then
    v_n.modality_id := private.cfg_uuid(v_input, 'modality_id', false);
    perform private.cfg_schedule_item_refs(v_edition_id, v_n.modality_id, null);
  end if;
  if v_input ? 'position' then v_n.position := private.cfg_int(v_input, 'position', true, 0, 10000); end if;
  if v_input ? 'status' then v_n.status := private.cfg_enum(v_input, 'status', true, array['DRAFT', 'PUBLISHED', 'ARCHIVED']); end if;
  if v_input ? 'payload' then v_n.payload := private.cfg_content_payload(v_n.block_type, v_input -> 'payload', v_edition_id); end if;
  -- Becoming PUBLISHED: the stored payload may reference an asset archived (or never published) since it was written as a DRAFT.
  if v_n.status = 'PUBLISHED' and v_before_status is distinct from 'PUBLISHED' then
    perform private.cfg_assert_block_media_published(v_n.payload, v_edition_id);
  end if;

  update app.event_content_block set modality_id = v_n.modality_id, position = v_n.position, status = v_n.status,
    payload = v_n.payload
  where event_content_block_id = p_block_id;
  perform private.audit('CONTENT_BLOCK_UPDATED', 'event_content_block', p_block_id, v_edition_id,
    jsonb_build_object('status', v_before_status),
    jsonb_build_object('status', v_n.status, 'changed_fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_input) k)));
  return private.content_block_projection(p_block_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Actor labels (the bodies of 710 / 320 / 303 plus one key each)
-- ---------------------------------------------------------------------------------------------

create or replace function private.attendance_resolution_projection(p_registration_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('attendance_resolution_id', ar.attendance_resolution_id, 'registration_id', ar.registration_id,
    'revision', ar.revision, 'status', ar.status, 'source', ar.source, 'checkin_id', ar.checkin_id,
    'reason', ar.reason, 'evidence_metadata', ar.evidence_metadata, 'resolved_by_staff_id', ar.resolved_by_staff_id,
    'resolved_by_staff_label', private.staff_display_label(ar.resolved_by_staff_id),
    'resolved_at', ar.resolved_at)
  from app.attendance_resolution ar
  where ar.registration_id = p_registration_id and ar.superseded_at is null
$$;

create or replace function private.sporting_eligibility_projection(p_registration_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('sporting_eligibility_resolution_id', s.sporting_eligibility_resolution_id,
    'registration_id', s.registration_id, 'revision', s.revision, 'status', s.status,
    'distance_credit_disposition', s.distance_credit_disposition, 'reason_code', s.reason_code, 'reason', s.reason,
    'resolved_by_staff_id', s.resolved_by_staff_id,
    'resolved_by_staff_label', private.staff_display_label(s.resolved_by_staff_id),
    'resolved_at', s.resolved_at)
  from app.sporting_eligibility_resolution s
  where s.registration_id = p_registration_id and s.superseded_at is null
$$;

create or replace function private.attendance_finalization_projection(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('attendance_finalization_id', f.attendance_finalization_id, 'edition_id', f.edition_id,
    'revision', f.revision, 'status', f.status, 'expected_count', f.expected_count, 'present_count', f.present_count,
    'no_show_count', f.no_show_count, 'excluded_count', f.excluded_count,
    'finalized_by_staff_id', f.finalized_by_staff_id,
    'finalized_by_staff_label', private.staff_display_label(f.finalized_by_staff_id),
    'finalized_at', f.finalized_at)
  from app.attendance_finalization f
  where f.edition_id = p_edition_id and f.superseded_at is null and f.status = 'FINALIZED'
$$;

create or replace function private.administrative_closure_projection(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('administrative_closure_id', c.administrative_closure_id, 'edition_id', c.edition_id,
    'revision', c.revision, 'attendance_finalization_id', c.attendance_finalization_id, 'status', c.status,
    'closed_by_staff_id', c.closed_by_staff_id,
    'closed_by_staff_label', private.staff_display_label(c.closed_by_staff_id),
    'closed_at', c.closed_at)
  from app.administrative_closure c
  where c.edition_id = p_edition_id and c.superseded_at is null and c.status = 'CLOSED'
$$;

create or replace function private.route_revision_projection(p_route_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('route_revision_id', rr.route_revision_id, 'route_id', rr.route_id,
    'edition_id', r.edition_id,
    'revision', rr.revision, 'status', rr.status, 'source', rr.source, 'source_filename', rr.source_filename,
    'geometry', extensions.st_asgeojson(rr.geometry)::jsonb, 'computed_distance_m', rr.computed_distance_m,
    'validation_result', rr.validation_result,
    'pois', coalesce((select jsonb_agg(jsonb_build_object('route_poi_id', p.route_poi_id, 'poi_type', p.poi_type,
               'name', p.name, 'longitude', extensions.st_x(p.geometry::extensions.geometry),
               'latitude', extensions.st_y(p.geometry::extensions.geometry), 'sort_order', p.sort_order,
               'metadata', p.metadata) order by p.sort_order)
             from app.route_poi p where p.route_revision_id = rr.route_revision_id), '[]'::jsonb),
    'created_by_staff_id', rr.created_by_staff_id,
    'created_by_staff_label', private.staff_display_label(rr.created_by_staff_id),
    'created_at', rr.created_at,
    'published_at', rr.published_at, 'superseded_at', rr.superseded_at)
  from app.route_revision rr
  join app.route r on r.route_id = rr.route_id
  where rr.route_revision_id = p_route_revision_id
$$;

create or replace function private.platform_settings_projection()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('timezone', s.timezone, 'default_whatsapp_phone_e164', s.default_whatsapp_phone_e164,
    'registration_hold_minutes', s.registration_hold_minutes,
    'registration_close_offset_minutes', s.registration_close_offset_minutes,
    'email_otp_expiry_seconds', s.email_otp_expiry_seconds,
    'availability_low_threshold_percent', s.availability_low_threshold_percent,
    'updated_at', s.updated_at, 'updated_by_staff_id', s.updated_by_staff_id,
    'updated_by_staff_label', private.staff_display_label(s.updated_by_staff_id))
  from app.platform_settings s
  where s.settings_id = 1
$$;

-- Grants: CREATE OR REPLACE keeps the existing ones on the replaced functions. The new helper is internal (no API grant).
revoke all on function private.cfg_assert_block_media_published(jsonb, uuid) from public, anon, authenticated, service_role;
