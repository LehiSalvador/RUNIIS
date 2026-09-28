-- T30 platform settings (Master §155) and legal documents (Master §123, §165): ADMIN GLOBAL only;
-- the public read returns the current PUBLISHED version of an ACTIVE document or nothing.

-- ---------------------------------------------------------------------------------------------
-- Platform settings.
-- ---------------------------------------------------------------------------------------------

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
    'updated_at', s.updated_at, 'updated_by_staff_id', s.updated_by_staff_id)
  from app.platform_settings s
  where s.settings_id = 1
$$;

create or replace function private.admin_get_platform_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('PLATFORM_SETTINGS_MANAGE');
  return private.platform_settings_projection();
end;
$$;

-- Changing defaults never rewrites existing Editions (Master §155).
create or replace function private.update_platform_settings(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_input jsonb;
  v_s app.platform_settings%rowtype;
  v_n app.platform_settings%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_constraint text;
begin
  v_staff_id := private.cfg_authorize('PLATFORM_SETTINGS_MANAGE');
  v_input := private.cfg_object(p_input, array['timezone', 'default_whatsapp_phone_e164', 'registration_hold_minutes',
    'registration_close_offset_minutes', 'email_otp_expiry_seconds', 'availability_low_threshold_percent']);
  select * into v_s from app.platform_settings s where s.settings_id = 1 for update;
  v_n := v_s;
  if v_input ? 'timezone' then
    v_n.timezone := private.cfg_text(v_input, 'timezone', true, 64);
    if not private.is_iana_timezone(v_n.timezone) then perform private.cfg_fail('timezone', 'invalid_timezone'); end if;
  end if;
  if v_input ? 'default_whatsapp_phone_e164' then
    v_n.default_whatsapp_phone_e164 := private.cfg_e164(v_input, 'default_whatsapp_phone_e164', false);
  end if;
  if v_input ? 'registration_hold_minutes' then
    v_n.registration_hold_minutes := private.cfg_int(v_input, 'registration_hold_minutes', true, 1, 10080);
  end if;
  if v_input ? 'registration_close_offset_minutes' then
    v_n.registration_close_offset_minutes := private.cfg_int(v_input, 'registration_close_offset_minutes', true, 0, 43200);
  end if;
  if v_input ? 'email_otp_expiry_seconds' then
    v_n.email_otp_expiry_seconds := private.cfg_int(v_input, 'email_otp_expiry_seconds', true, 60, 3600);
  end if;
  if v_input ? 'availability_low_threshold_percent' then
    v_n.availability_low_threshold_percent :=
      private.cfg_numeric(v_input, 'availability_low_threshold_percent', false, 0.01, 99.99, false);
  end if;

  update app.platform_settings set timezone = v_n.timezone, default_whatsapp_phone_e164 = v_n.default_whatsapp_phone_e164,
    registration_hold_minutes = v_n.registration_hold_minutes,
    registration_close_offset_minutes = v_n.registration_close_offset_minutes,
    email_otp_expiry_seconds = v_n.email_otp_expiry_seconds,
    availability_low_threshold_percent = v_n.availability_low_threshold_percent, updated_by_staff_id = v_staff_id
  where settings_id = 1;

  select jsonb_object_agg(k, to_jsonb(v_s) -> k), jsonb_object_agg(k, to_jsonb(v_n) -> k) into v_before, v_after
  from jsonb_object_keys(v_input) k where to_jsonb(v_s) -> k is distinct from to_jsonb(v_n) -> k;
  if v_after is not null then
    perform private.audit('PLATFORM_SETTINGS_UPDATED', 'platform_settings', null, null, v_before, v_after);
  end if;
  return private.platform_settings_projection();
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Legal documents and versions.
-- ---------------------------------------------------------------------------------------------

create or replace function private.legal_document_projection(p_legal_document_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('legal_document_id', d.legal_document_id, 'document_key', d.document_key,
    'document_type', d.document_type, 'status', d.status, 'created_at', d.created_at,
    'edition_id', (select e.edition_id from app.edition e
                   where d.document_type = 'EVENT_RULES' and private.edition_rules_document_key(e.edition_id) = d.document_key),
    'current_version', private.current_legal_version(d.legal_document_id),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('legal_document_version_id', v.legal_document_version_id, 'version', v.version,
          'status', v.status, 'published_at', v.published_at, 'created_at', v.created_at,
          'has_content', v.content_markdown is not null, 'public_asset_key', v.public_asset_key) order by v.version desc)
      from app.legal_document_version v where v.legal_document_id = d.legal_document_id), '[]'::jsonb))
  from app.legal_document d
  where d.legal_document_id = p_legal_document_id
$$;

create or replace function private.legal_version_projection(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('legal_document_version_id', v.legal_document_version_id,
    'legal_document_id', v.legal_document_id, 'document_key', d.document_key, 'document_type', d.document_type,
    'version', v.version, 'status', v.status, 'content_markdown', v.content_markdown,
    'public_asset_key', v.public_asset_key, 'published_at', v.published_at, 'created_at', v.created_at)
  from app.legal_document_version v
  join app.legal_document d on d.legal_document_id = v.legal_document_id
  where v.legal_document_version_id = p_version_id
$$;

create or replace function private.admin_list_legal_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('LEGAL_DOCUMENTS_PUBLISH');
  return coalesce((
    select jsonb_agg(private.legal_document_projection(d.legal_document_id) order by d.document_type, d.document_key)
    from (select d.legal_document_id, d.document_type, d.document_key from app.legal_document d
          order by d.document_type, d.document_key limit 200) d), '[]'::jsonb);
end;
$$;

create or replace function private.admin_get_legal_document_version(p_legal_document_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('LEGAL_DOCUMENTS_PUBLISH');
  if not exists (select 1 from app.legal_document_version v where v.legal_document_version_id = p_legal_document_version_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  return private.legal_version_projection(p_legal_document_version_id);
end;
$$;

-- EVENT_RULES documents are bound to an Edition through their derived key; other types use an
-- uppercase key (the public API path segment).
create or replace function private.create_legal_document(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_type text;
  v_key text;
  v_edition_id uuid;
  v_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  perform private.cfg_authorize('LEGAL_DOCUMENTS_PUBLISH');
  v_input := private.cfg_object(p_input, array['document_type', 'document_key', 'edition_id']);
  v_type := private.cfg_enum(v_input, 'document_type', true,
    array['TERMS_OF_SERVICE', 'PRIVACY_NOTICE', 'SPORT_WAIVER', 'MINOR_TERMS', 'EVENT_RULES']);
  if v_type = 'EVENT_RULES' then
    if v_input ? 'document_key' then perform private.cfg_fail('document_key', 'derived_for_event_rules'); end if;
    v_edition_id := private.cfg_uuid(v_input, 'edition_id', true);
    if not exists (select 1 from app.edition e where e.edition_id = v_edition_id) then
      perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'edition_id'));
    end if;
    v_key := private.edition_rules_document_key(v_edition_id);
  else
    if v_input ? 'edition_id' then perform private.cfg_fail('edition_id', 'only_for_event_rules'); end if;
    v_key := private.cfg_text(v_input, 'document_key', true, 64, 3);
    if v_key !~ '^[A-Z][A-Z0-9_]{2,63}$' or v_key like 'EVENT\_RULES\_%' then
      perform private.cfg_fail('document_key', 'invalid_key');
    end if;
  end if;

  insert into app.legal_document (document_key, document_type, status) values (v_key, v_type, 'ACTIVE')
  returning legal_document_id into v_id;
  v_result := private.legal_document_projection(v_id);
  perform private.audit('LEGAL_DOCUMENT_CREATED', 'legal_document', v_id, v_edition_id, null,
    jsonb_build_object('document_key', v_key, 'document_type', v_type));
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- A storage object key, never a URL (SEC-150: nothing here is fetched server-side).
create or replace function private.cfg_asset_key(p_input jsonb, p_key text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := private.cfg_text(p_input, p_key, false, 512);
begin
  if v_value is not null and (v_value !~ '^[A-Za-z0-9][A-Za-z0-9/_.-]*$' or v_value like '%..%' or v_value like '%//%') then
    perform private.cfg_fail(p_key, 'invalid_asset_key');
  end if;
  return v_value;
end;
$$;

create or replace function private.cfg_legal_content(p_input jsonb, p_current_markdown text, p_current_asset text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_markdown text := case when p_input ? 'content_markdown'
                          then private.cfg_markdown(p_input, 'content_markdown', false, 200000, 'content_markdown')
                          else p_current_markdown end;
  v_asset text := case when p_input ? 'public_asset_key' then private.cfg_asset_key(p_input, 'public_asset_key')
                       else p_current_asset end;
begin
  if v_markdown is null and v_asset is null then perform private.cfg_fail('content_markdown', 'content_required'); end if;
  return jsonb_build_object('content_markdown', v_markdown, 'public_asset_key', v_asset);
end;
$$;

create or replace function private.create_legal_document_version(p_legal_document_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_input jsonb;
  v_content jsonb;
  v_id uuid;
  v_constraint text;
begin
  perform private.cfg_authorize('LEGAL_DOCUMENTS_PUBLISH');
  select d.status into v_status from app.legal_document d where d.legal_document_id = p_legal_document_id for update;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if v_status <> 'ACTIVE' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'document_archived'));
  end if;
  v_input := private.cfg_object(p_input, array['content_markdown', 'public_asset_key']);
  v_content := private.cfg_legal_content(v_input, null, null);

  insert into app.legal_document_version (legal_document_id, version, content_markdown, public_asset_key, status)
  values (p_legal_document_id,
    (select coalesce(max(v.version), 0) + 1 from app.legal_document_version v where v.legal_document_id = p_legal_document_id),
    v_content ->> 'content_markdown', v_content ->> 'public_asset_key', 'DRAFT')
  returning legal_document_version_id into v_id;
  perform private.audit('LEGAL_DOCUMENT_VERSION_CREATED', 'legal_document_version', v_id, null, null,
    jsonb_build_object('legal_document_id', p_legal_document_id));
  return private.legal_version_projection(v_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.update_legal_document_version(p_legal_document_version_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_v app.legal_document_version%rowtype;
  v_content jsonb;
  v_constraint text;
begin
  perform private.cfg_authorize('LEGAL_DOCUMENTS_PUBLISH');
  select * into v_v from app.legal_document_version v where v.legal_document_version_id = p_legal_document_version_id for update;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if v_v.status <> 'DRAFT' then perform private.cfg_invalid_transition('status', v_v.status); end if;
  v_input := private.cfg_object(p_input, array['content_markdown', 'public_asset_key']);
  v_content := private.cfg_legal_content(v_input, v_v.content_markdown, v_v.public_asset_key);

  update app.legal_document_version set content_markdown = v_content ->> 'content_markdown',
    public_asset_key = v_content ->> 'public_asset_key'
  where legal_document_version_id = p_legal_document_version_id;
  perform private.audit('LEGAL_DOCUMENT_VERSION_UPDATED', 'legal_document_version', p_legal_document_version_id, null, null,
    jsonb_build_object('changed_fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_input) k)));
  return private.legal_version_projection(p_legal_document_version_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- DRAFT -> PUBLISHED; the previous PUBLISHED version of the document becomes SUPERSEDED.
create or replace function private.publish_legal_document_version(p_legal_document_version_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_v app.legal_document_version%rowtype;
  v_superseded uuid;
  v_idem jsonb;
  v_result jsonb;
  v_constraint text;
begin
  perform private.cfg_authorize('LEGAL_DOCUMENTS_PUBLISH');
  select v.legal_document_id into v_document_id from app.legal_document_version v
  where v.legal_document_version_id = p_legal_document_version_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_idem := private.cfg_idempotency_begin('legal_document_version.publish', p_legal_document_version_id::text,
    p_idempotency_key, jsonb_build_object('legal_document_version_id', p_legal_document_version_id));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.legal_document d where d.legal_document_id = v_document_id for update;
  select * into v_v from app.legal_document_version v where v.legal_document_version_id = p_legal_document_version_id for update;
  if v_v.status <> 'DRAFT' then perform private.cfg_invalid_transition('status', v_v.status); end if;
  if exists (select 1 from app.legal_document d where d.legal_document_id = v_document_id and d.status <> 'ACTIVE') then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'document_archived'));
  end if;

  update app.legal_document_version v set status = 'SUPERSEDED'
  where v.legal_document_id = v_document_id and v.status = 'PUBLISHED'
  returning v.legal_document_version_id into v_superseded;
  update app.legal_document_version set status = 'PUBLISHED', published_at = now()
  where legal_document_version_id = p_legal_document_version_id;

  perform private.audit('LEGAL_DOCUMENT_VERSION_PUBLISHED', 'legal_document_version', p_legal_document_version_id, null,
    jsonb_build_object('status', 'DRAFT'),
    jsonb_build_object('status', 'PUBLISHED', 'superseded_legal_document_version_id', v_superseded));
  v_result := private.legal_version_projection(p_legal_document_version_id) - 'content_markdown'
    || jsonb_build_object('superseded_legal_document_version_id', v_superseded);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- Public (Master §165): GET /api/v1/legal/:documentKey. NULL (404) unless an ACTIVE document has a
-- PUBLISHED version.
create or replace function private.get_legal_document(p_document_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('document_key', d.document_key, 'document_type', d.document_type,
    'legal_document_version_id', v.legal_document_version_id, 'version', v.version,
    'content_markdown', v.content_markdown, 'public_asset_key', v.public_asset_key, 'published_at', v.published_at)
  from app.legal_document d
  join lateral (
    select lv.* from app.legal_document_version lv
    where lv.legal_document_id = d.legal_document_id and lv.status = 'PUBLISHED'
    order by lv.version desc
    limit 1) v on true
  where p_document_key ~ '^[A-Z][A-Z0-9_]{2,63}$' and d.document_key = p_document_key and d.status = 'ACTIVE'
$$;

-- ---------------------------------------------------------------------------------------------
-- Public facades (security invoker, same signature/name, ADR-001 §2) and grants.
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_get_platform_settings()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_get_platform_settings() $$;
create or replace function public.update_platform_settings(p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_platform_settings(p_input) $$;
create or replace function public.admin_list_legal_documents()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_list_legal_documents() $$;
create or replace function public.admin_get_legal_document_version(p_legal_document_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_get_legal_document_version(p_legal_document_version_id) $$;
create or replace function public.create_legal_document(p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_legal_document(p_input) $$;
create or replace function public.create_legal_document_version(p_legal_document_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_legal_document_version(p_legal_document_id, p_input) $$;
create or replace function public.update_legal_document_version(p_legal_document_version_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_legal_document_version(p_legal_document_version_id, p_input) $$;
create or replace function public.publish_legal_document_version(p_legal_document_version_id uuid, p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.publish_legal_document_version(p_legal_document_version_id, p_idempotency_key) $$;
create or replace function public.get_legal_document(p_document_key text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_legal_document(p_document_key) $$;

revoke all on function
  private.admin_get_platform_settings(), public.admin_get_platform_settings(),
  private.update_platform_settings(jsonb), public.update_platform_settings(jsonb),
  private.admin_list_legal_documents(), public.admin_list_legal_documents(),
  private.admin_get_legal_document_version(uuid), public.admin_get_legal_document_version(uuid),
  private.create_legal_document(jsonb), public.create_legal_document(jsonb),
  private.create_legal_document_version(uuid, jsonb), public.create_legal_document_version(uuid, jsonb),
  private.update_legal_document_version(uuid, jsonb), public.update_legal_document_version(uuid, jsonb),
  private.publish_legal_document_version(uuid, text), public.publish_legal_document_version(uuid, text),
  private.get_legal_document(text), public.get_legal_document(text)
from public, anon, authenticated, service_role;

grant execute on function
  private.admin_get_platform_settings(), public.admin_get_platform_settings(),
  private.update_platform_settings(jsonb), public.update_platform_settings(jsonb),
  private.admin_list_legal_documents(), public.admin_list_legal_documents(),
  private.admin_get_legal_document_version(uuid), public.admin_get_legal_document_version(uuid),
  private.create_legal_document(jsonb), public.create_legal_document(jsonb),
  private.create_legal_document_version(uuid, jsonb), public.create_legal_document_version(uuid, jsonb),
  private.update_legal_document_version(uuid, jsonb), public.update_legal_document_version(uuid, jsonb),
  private.publish_legal_document_version(uuid, text), public.publish_legal_document_version(uuid, text)
to authenticated;

grant execute on function
  private.get_legal_document(text), public.get_legal_document(text)
to anon, authenticated;
