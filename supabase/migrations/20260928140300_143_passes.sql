-- Participant passes and QR credentials (T34, Master §80-84, ADR-001 A1-A3, SEC-011/030/033-036).
-- No function callable by anon/authenticated accepts or returns credential material (token, hash,
-- ciphertext, key version). Issuance is SYSTEM-only; the staff replacement only retires.

create index participant_pass_missing_credential_idx on app.participant_pass (created_at)
  where status = 'ACTIVE' and current_credential_id is null;

create function private.participant_pass_view(p_participant_pass_id uuid, p_viewer_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'participant_pass_id', p.participant_pass_id,
    'public_code', p.public_code,
    'status', p.status,
    'issued_at', p.issued_at,
    'canceled_at', p.canceled_at,
    'has_active_credential', p.current_credential_id is not null,
    'registration', jsonb_build_object(
      'registration_id', r.registration_id, 'registration_number', r.registration_number,
      'status', r.status, 'confirmed_at', r.confirmed_at),
    'participant', jsonb_build_object(
      'participant_kind', case when r.runner_profile_id is not null then 'PROFILE' else 'GUEST' end,
      'is_self', r.runner_profile_id is not distinct from p_viewer_profile_id,
      'display_name', coalesce(cp.display_name, g.full_name)),
    'edition', jsonb_build_object(
      'edition_id', e.edition_id, 'name', e.name, 'slug', e.slug,
      'event_date', private.people_edition_event_date(e.edition_id)),
    'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
    'category', case when c.category_id is not null then jsonb_build_object('category_id', c.category_id, 'name', c.name) end)
  from app.participant_pass p
  join app.registration r on r.registration_id = p.registration_id
  join app.edition e on e.edition_id = r.edition_id
  join app.modality m on m.modality_id = r.modality_id
  left join app.community_profile cp on cp.runner_profile_id = r.runner_profile_id
  left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
  left join app.registration_category_assignment rca on rca.registration_id = r.registration_id
  left join app.category c on c.category_id = rca.category_id
  where p.participant_pass_id = p_participant_pass_id
$$;

create function private.list_my_passes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := private.registration_require_viewer();
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(private.participant_pass_view(s.participant_pass_id, v_viewer) order by s.sort_date desc nulls last, s.public_code)
    from (
      select p.participant_pass_id, p.public_code, private.people_edition_event_date(r.edition_id) as sort_date
      from app.participant_pass p
      join app.registration r on r.registration_id = p.registration_id
      where (r.runner_profile_id = v_viewer or (r.guest_participant_id is not null and r.buyer_profile_id = v_viewer))
        and private.pass_viewer_allowed(r.registration_id, v_viewer)
      order by p.created_at desc
      limit 200) s), '[]'::jsonb));
end;
$$;

create function private.get_my_pass(p_participant_pass_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := private.registration_require_viewer();
  v_registration_id uuid;
begin
  select p.registration_id into v_registration_id from app.participant_pass p where p.participant_pass_id = p_participant_pass_id;
  if v_registration_id is null or not private.pass_viewer_allowed(v_registration_id, v_viewer) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  return private.participant_pass_view(p_participant_pass_id, v_viewer);
end;
$$;

-- Authorises a QR render for the caller; the SYSTEM client then issues (if missing) and decrypts.
-- Returns ids only (A1). Counts successful renders for direct callers (SEC-141).
create function private.authorize_pass_render(p_participant_pass_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := private.registration_require_viewer();
  v_pass record;
begin
  select p.participant_pass_id, p.status as pass_status, r.registration_id, r.status as registration_status
  into v_pass
  from app.participant_pass p
  join app.registration r on r.registration_id = p.registration_id
  where p.participant_pass_id = p_participant_pass_id;
  if not found or not private.pass_viewer_allowed(v_pass.registration_id, v_viewer) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if v_pass.pass_status <> 'ACTIVE' or v_pass.registration_status <> 'CONFIRMED' then
    perform private.raise_domain_error('PASS_REVOKED');
  end if;
  perform private.consume_policy_rate_limit('pass.render_qr:cmd', auth.uid()::text);
  return jsonb_build_object('participant_pass_id', v_pass.participant_pass_id);
end;
$$;

-- Master §83 staff replacement: the ACTIVE credential stops authorising in this transaction; the next
-- version is issued by the SYSTEM step (A1). Never creates a second pass.
create function private.replace_pass_credential(
  p_participant_pass_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_idem jsonb;
  v_pass record;
  v_old record;
  v_next_version integer;
  v_reason text := pg_catalog.btrim(p_reason);
  v_result jsonb;
begin
  select r.edition_id into v_edition_id
  from app.participant_pass p join app.registration r on r.registration_id = p.registration_id
  where p.participant_pass_id = p_participant_pass_id;
  if v_edition_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_permission('PASS_CREDENTIAL_REPLACE', v_edition_id);
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('participant_pass.replace_credential', p_participant_pass_id::text, p_idempotency_key,
      jsonb_build_object('participant_pass_id', p_participant_pass_id, 'reason', v_reason));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  select p.participant_pass_id, p.status, p.registration_id, r.status as registration_status
  into v_pass
  from app.participant_pass p join app.registration r on r.registration_id = p.registration_id
  where p.participant_pass_id = p_participant_pass_id
  for update of p;
  if v_pass.status <> 'ACTIVE' or v_pass.registration_status <> 'CONFIRMED' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'PASS_NOT_ACTIVE'));
  end if;

  update app.participant_pass_credential c
  set status = 'REPLACED', replaced_at = pg_catalog.now()
  where c.participant_pass_id = p_participant_pass_id and c.status = 'ACTIVE'
  returning c.participant_pass_credential_id, c.version into v_old;
  update app.participant_pass p set current_credential_id = null where p.participant_pass_id = p_participant_pass_id;

  select coalesce(max(c.version), 0) + 1 into v_next_version
  from app.participant_pass_credential c where c.participant_pass_id = p_participant_pass_id;

  perform private.audit('PASS_CREDENTIAL_REPLACED', 'participant_pass', p_participant_pass_id, v_edition_id,
    jsonb_build_object('participant_pass_credential_id', v_old.participant_pass_credential_id, 'version', v_old.version),
    jsonb_build_object('credential_status', 'REPLACED', 'next_version', v_next_version), v_reason);
  perform private.enqueue_outbox('ParticipantPassCredentialReplaced', 'ParticipantPass', p_participant_pass_id,
    'ParticipantPassCredentialReplaced:' || p_participant_pass_id || ':' || v_next_version,
    jsonb_build_object('participant_pass_id', p_participant_pass_id, 'registration_id', v_pass.registration_id,
      'edition_id', v_edition_id, 'replaced_credential_id', v_old.participant_pass_credential_id));

  v_result := jsonb_build_object('participant_pass_id', p_participant_pass_id,
    'replaced_credential_id', v_old.participant_pass_credential_id, 'replaced_version', v_old.version,
    'next_version', v_next_version);
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

-- SYSTEM-only (service_role). Issues the next version for an ACTIVE pass of a CONFIRMED Registration with no
-- ACTIVE credential; the partial unique index keeps exactly one ACTIVE even under concurrent issuers.
create function private.issue_pass_credential(
  p_participant_pass_id uuid, p_participant_pass_credential_id uuid, p_token_hash text,
  p_token_ciphertext bytea, p_encryption_key_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass record;
  v_active_id uuid;
  v_version integer;
begin
  if p_participant_pass_id is null or p_participant_pass_credential_id is null
     or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
     or p_token_ciphertext is null or pg_catalog.octet_length(p_token_ciphertext) <= 28
     or coalesce(p_encryption_key_version, 0) < 1 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('reason', 'invalid_credential_arguments'));
  end if;

  select p.participant_pass_id, p.status, r.status as registration_status
  into v_pass
  from app.participant_pass p join app.registration r on r.registration_id = p.registration_id
  where p.participant_pass_id = p_participant_pass_id
  for update of p;
  if not found or v_pass.status <> 'ACTIVE' or v_pass.registration_status <> 'CONFIRMED' then
    return jsonb_build_object('participant_pass_id', p_participant_pass_id, 'participant_pass_credential_id', null,
      'issued', false, 'reason', 'NOT_ISSUABLE');
  end if;

  select c.participant_pass_credential_id into v_active_id
  from app.participant_pass_credential c
  where c.participant_pass_id = p_participant_pass_id and c.status = 'ACTIVE';
  if v_active_id is not null then
    return jsonb_build_object('participant_pass_id', p_participant_pass_id, 'participant_pass_credential_id', v_active_id,
      'issued', false, 'reason', 'ALREADY_ACTIVE');
  end if;

  select coalesce(max(c.version), 0) + 1 into v_version
  from app.participant_pass_credential c where c.participant_pass_id = p_participant_pass_id;
  insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash,
    token_ciphertext, encryption_key_version)
  values (p_participant_pass_credential_id, p_participant_pass_id, v_version, p_token_hash, p_token_ciphertext,
    p_encryption_key_version);
  update app.participant_pass p set current_credential_id = p_participant_pass_credential_id
  where p.participant_pass_id = p_participant_pass_id;

  return jsonb_build_object('participant_pass_id', p_participant_pass_id,
    'participant_pass_credential_id', p_participant_pass_credential_id, 'issued', true, 'reason', 'ISSUED');
exception when unique_violation then
  perform private.raise_domain_error('CONFLICT', jsonb_build_object('retryable', true));
end;
$$;

-- SYSTEM-only: the ACTIVE credential material of an ACTIVE pass (render path, after authorisation).
create function private.get_pass_credential_material(p_participant_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'participant_pass_credential_id', c.participant_pass_credential_id,
    'token_hash', c.token_hash,
    'token_ciphertext', c.token_ciphertext,
    'encryption_key_version', c.encryption_key_version)
  from app.participant_pass p
  join app.registration r on r.registration_id = p.registration_id
  join app.participant_pass_credential c on c.participant_pass_id = p.participant_pass_id and c.status = 'ACTIVE'
  where p.participant_pass_id = p_participant_pass_id and p.status = 'ACTIVE' and r.status = 'CONFIRMED'
$$;

-- SYSTEM-only: passes the issuance worker still has to serve.
create function private.list_passes_missing_credential(p_limit integer, p_registration_request_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(s.participant_pass_id), '[]'::jsonb)
  from (
    select p.participant_pass_id
    from app.participant_pass p
    join app.registration r on r.registration_id = p.registration_id
    where p.status = 'ACTIVE' and p.current_credential_id is null and r.status = 'CONFIRMED'
      and (p_registration_request_id is null or r.registration_request_id = p_registration_request_id)
    order by p.created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)) s
$$;

-- SYSTEM-only (SEC-035): key versions still referenced by ACTIVE credentials.
create function private.pass_credential_key_versions_in_use()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct c.encryption_key_version), '[]'::jsonb)
  from app.participant_pass_credential c where c.status = 'ACTIVE'
$$;

-- Public invoker wrappers (ADR-001 §2).
create function public.list_my_passes()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_my_passes() $$;
create function public.get_my_pass(p_participant_pass_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_my_pass(p_participant_pass_id) $$;
create function public.authorize_pass_render(p_participant_pass_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.authorize_pass_render(p_participant_pass_id) $$;
create function public.replace_pass_credential(p_participant_pass_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.replace_pass_credential(p_participant_pass_id, p_reason, p_idempotency_key) $$;
create function public.issue_pass_credential(
  p_participant_pass_id uuid, p_participant_pass_credential_id uuid, p_token_hash text,
  p_token_ciphertext bytea, p_encryption_key_version integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.issue_pass_credential(p_participant_pass_id, p_participant_pass_credential_id, p_token_hash,
  p_token_ciphertext, p_encryption_key_version) $$;
create function public.get_pass_credential_material(p_participant_pass_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_pass_credential_material(p_participant_pass_id) $$;
create function public.list_passes_missing_credential(p_limit integer, p_registration_request_id uuid default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_passes_missing_credential(p_limit, p_registration_request_id) $$;
create function public.pass_credential_key_versions_in_use()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.pass_credential_key_versions_in_use() $$;

revoke all on function
  private.participant_pass_view(uuid, uuid),
  private.list_my_passes(), public.list_my_passes(),
  private.get_my_pass(uuid), public.get_my_pass(uuid),
  private.authorize_pass_render(uuid), public.authorize_pass_render(uuid),
  private.replace_pass_credential(uuid, text, text), public.replace_pass_credential(uuid, text, text),
  private.issue_pass_credential(uuid, uuid, text, bytea, integer), public.issue_pass_credential(uuid, uuid, text, bytea, integer),
  private.get_pass_credential_material(uuid), public.get_pass_credential_material(uuid),
  private.list_passes_missing_credential(integer, uuid), public.list_passes_missing_credential(integer, uuid),
  private.pass_credential_key_versions_in_use(), public.pass_credential_key_versions_in_use()
from public, anon, authenticated, service_role;

grant execute on function
  private.list_my_passes(), public.list_my_passes(),
  private.get_my_pass(uuid), public.get_my_pass(uuid),
  private.authorize_pass_render(uuid), public.authorize_pass_render(uuid),
  private.replace_pass_credential(uuid, text, text), public.replace_pass_credential(uuid, text, text)
to authenticated;
grant execute on function
  private.issue_pass_credential(uuid, uuid, text, bytea, integer), public.issue_pass_credential(uuid, uuid, text, bytea, integer),
  private.get_pass_credential_material(uuid), public.get_pass_credential_material(uuid),
  private.list_passes_missing_credential(integer, uuid), public.list_passes_missing_credential(integer, uuid),
  private.pass_credential_key_versions_in_use(), public.pass_credential_key_versions_in_use()
to service_role;
