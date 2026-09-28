-- Participants list/export (Master §172, SEC-023/025), Friend/guardian document acceptance (Master §124,
-- SEC-013) and the expire-registration-requests worker (Master §152).

-- ---------------------------------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------------------------------
create function private.registration_participant_row(p_registration_id uuid, p_include_contact boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registration_id', r.registration_id,
    'registration_number', r.registration_number,
    'status', r.status,
    'confirmed_at', r.confirmed_at,
    'participant_kind', case when r.runner_profile_id is not null then 'PROFILE' else 'GUEST' end,
    'full_name', coalesce(rp.full_name, g.full_name),
    'public_profile_id', cp.public_profile_id,
    'buyer_full_name', b.full_name,
    'registration_request_id', r.registration_request_id,
    'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
    'category', case when c.category_id is not null then jsonb_build_object('category_id', c.category_id, 'name', c.name) end,
    'is_minor', coalesce((rq.eligibility_snapshot ->> 'is_minor')::boolean, false),
    'guardian_verification_status', gev.status,
    'pass', case when pp.participant_pass_id is not null then jsonb_build_object(
      'participant_pass_id', pp.participant_pass_id, 'public_code', pp.public_code, 'status', pp.status,
      'has_active_credential', pp.current_credential_id is not null) end,
    'kit', case when ka.kit_allocation_id is not null then jsonb_build_object(
      'status', ka.status, 'kit_variant_id', ka.kit_variant_id, 'variant_label', kv.label) end,
    'attendance', jsonb_build_object(
      'checked_in', exists (select 1 from app.attendance_checkin ac
                            where ac.registration_id = r.registration_id and ac.status = 'VERIFIED_PRESENT'),
      'resolution_status', ar.status),
    'contact', case when p_include_contact then jsonb_build_object(
      'phone_e164', coalesce(rp.phone_e164, g.phone_e164),
      'emergency_contact_name', coalesce(rp.emergency_contact_name, g.emergency_contact_name),
      'emergency_contact_phone_e164', coalesce(rp.emergency_contact_phone_e164, g.emergency_contact_phone_e164)) end)
  from app.registration r
  join app.registration_request_participant rq on rq.request_participant_id = r.request_participant_id
  join app.modality m on m.modality_id = r.modality_id
  join app.runner_profile b on b.runner_profile_id = r.buyer_profile_id
  left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
  left join app.community_profile cp on cp.runner_profile_id = r.runner_profile_id
  left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
  left join app.registration_category_assignment rca on rca.registration_id = r.registration_id
  left join app.category c on c.category_id = rca.category_id
  left join app.participant_pass pp on pp.registration_id = r.registration_id
  left join app.kit_allocation ka on ka.registration_id = r.registration_id
  left join app.kit_variant kv on kv.kit_variant_id = ka.kit_variant_id
  left join app.guardian_event_verification gev on gev.registration_id = r.registration_id
  left join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  where r.registration_id = p_registration_id
$$;

-- Filtered, name-ordered registration ids of an Edition. Filter values are validated by the callers.
create function private.registration_participant_ids(
  p_edition_id uuid, p_status text, p_modality_id uuid, p_participant_kind text, p_kit_status text,
  p_attendance_status text, p_search text, p_cursor_name text, p_cursor_id uuid, p_limit integer)
returns table (registration_id uuid, sort_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.registration_id, s.sort_name
  from (
    select r.registration_id, private.normalize_search_text(coalesce(rp.full_name, g.full_name)) as sort_name,
      r.registration_number, pp.public_code, r.status, r.modality_id, r.runner_profile_id,
      (select ka.status from app.kit_allocation ka where ka.registration_id = r.registration_id) as kit_status,
      (select ar.status from app.attendance_resolution ar
       where ar.registration_id = r.registration_id and ar.superseded_at is null) as attendance_status
    from app.registration r
    left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
    left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
    left join app.participant_pass pp on pp.registration_id = r.registration_id
    where r.edition_id = p_edition_id) s
  where (p_status is null or s.status = p_status)
    and (p_modality_id is null or s.modality_id = p_modality_id)
    and (p_participant_kind is null or (p_participant_kind = 'PROFILE') = (s.runner_profile_id is not null))
    and (p_kit_status is null or coalesce(s.kit_status, 'NONE') = p_kit_status)
    and (p_attendance_status is null or coalesce(s.attendance_status, 'NONE') = p_attendance_status)
    and (p_search is null or pg_catalog.strpos(s.sort_name, p_search) > 0
         or pg_catalog.upper(p_search) in (s.registration_number, s.public_code))
    and (p_cursor_name is null or (s.sort_name, s.registration_id) > (p_cursor_name, p_cursor_id))
  order by s.sort_name, s.registration_id
  limit p_limit
$$;

create function private.registration_validate_participant_filters(
  p_status text, p_participant_kind text, p_kit_status text, p_attendance_status text, p_search text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_status is not null and p_status not in ('CONFIRMED', 'CANCELED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'status'));
  elsif p_participant_kind is not null and p_participant_kind not in ('PROFILE', 'GUEST') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'type'));
  elsif p_kit_status is not null and p_kit_status not in ('ASSIGNED', 'READY', 'DELIVERED', 'CANCELED', 'EXCEPTION', 'NONE') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'kit'));
  elsif p_attendance_status is not null and p_attendance_status not in ('PENDING', 'PRESENT', 'NO_SHOW', 'EXCLUDED', 'NONE') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'attendance'));
  elsif pg_catalog.char_length(p_search) > 100 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'search'));
  end if;
end;
$$;

-- Contact data is shown only to staff who may export PII (Master §145 "export PII requiere permiso explícito").
create function private.admin_list_participants(
  p_edition_id uuid, p_status text default null, p_modality_id uuid default null, p_participant_kind text default null,
  p_kit_status text default null, p_attendance_status text default null, p_search text default null,
  p_cursor_name text default null, p_cursor_id uuid default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(private.normalize_search_text(coalesce(p_search, '')), '');
  v_contact boolean;
  v_page jsonb;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_permission('PARTICIPANT_LIST_READ', p_edition_id);
  perform private.registration_validate_participant_filters(p_status, p_participant_kind, p_kit_status, p_attendance_status, v_search);
  v_contact := private.has_permission('PII_EXPORT', p_edition_id);

  select coalesce(jsonb_agg(jsonb_build_object('id', s.registration_id, 'sort_name', s.sort_name)
                  order by s.sort_name, s.registration_id), '[]'::jsonb)
  into v_page
  from private.registration_participant_ids(p_edition_id, p_status, p_modality_id, p_participant_kind, p_kit_status,
    p_attendance_status, v_search, p_cursor_name, p_cursor_id, v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(private.registration_participant_row((e ->> 'id')::uuid, v_contact) order by o)
                       from jsonb_array_elements(v_page) with ordinality x(e, o) where o <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_page) > v_limit then jsonb_build_object(
      'sort_name', v_page -> (v_limit - 1) -> 'sort_name', 'registration_id', v_page -> (v_limit - 1) -> 'id') end,
    'contact_visible', v_contact);
end;
$$;

-- SEC-023: explicit PII_EXPORT permission + reason; the audit row records filters and row count, never rows.
create function private.admin_export_participants(
  p_edition_id uuid, p_reason text, p_status text default null, p_modality_id uuid default null,
  p_participant_kind text default null, p_kit_status text default null, p_attendance_status text default null,
  p_search text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_rows constant integer := 10000;
  v_reason text := pg_catalog.btrim(p_reason);
  v_search text := nullif(private.normalize_search_text(coalesce(p_search, '')), '');
  v_rows jsonb;
  v_count integer;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_permission('PII_EXPORT', p_edition_id);
  if v_reason is null or pg_catalog.char_length(v_reason) not between 3 and 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  perform private.registration_validate_participant_filters(p_status, p_participant_kind, p_kit_status, p_attendance_status, v_search);
  perform private.consume_policy_rate_limit('participant.export:cmd', auth.uid()::text);

  select coalesce(jsonb_agg(private.registration_participant_row(s.registration_id, true) order by s.sort_name, s.registration_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from private.registration_participant_ids(p_edition_id, p_status, p_modality_id, p_participant_kind, p_kit_status,
    p_attendance_status, v_search, null, null, v_max_rows + 1) s;

  perform private.audit('PARTICIPANT_EXPORT', 'edition', p_edition_id, p_edition_id, null,
    jsonb_build_object('filters', jsonb_strip_nulls(jsonb_build_object('status', p_status, 'modality_id', p_modality_id,
        'type', p_participant_kind, 'kit', p_kit_status, 'attendance', p_attendance_status, 'search_used', v_search is not null)),
      'row_count', least(v_count, v_max_rows), 'truncated', v_count > v_max_rows),
    v_reason);

  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality t(x, o) where o <= v_max_rows),
    'row_count', least(v_count, v_max_rows),
    'truncated', v_count > v_max_rows,
    'edition', (select jsonb_build_object('edition_id', e.edition_id, 'slug', e.slug) from app.edition e where e.edition_id = p_edition_id));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Pending actions and own acceptance (Master §124, UX J1 step 4 / OQ-1).
-- ---------------------------------------------------------------------------------------------
create function private.registration_documents_json(p_edition_id uuid, p_version_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('legal_document_version_id', d.legal_document_version_id,
    'document_type', d.document_type, 'version', d.version) order by d.document_type), '[]'::jsonb)
  from private.registration_required_documents(p_edition_id, true) d
  where d.legal_document_version_id = any (p_version_ids)
$$;

-- Actions the caller must take: their own acceptance (adult) and acceptances for minors they guard, for
-- every effective PENDING request that includes them; plus, with p_edition_id, the caller's own missing
-- acceptance for that registrable Edition (FREE: Friends accept before the buyer submits).
create function private.list_my_pending_actions(p_edition_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.registration_require_viewer();
  v_items jsonb;
  v_self_minor boolean;
  v_missing uuid[];
begin
  with included as (
    select distinct r.edition_id, p.runner_profile_id, p.guest_participant_id,
      coalesce((p.eligibility_snapshot ->> 'is_minor')::boolean, false) as is_minor
    from app.registration_request r
    join app.registration_request_participant p on p.registration_request_id = r.registration_request_id
    where r.status = 'PENDING_CONFIRMATION' and r.expires_at > pg_catalog.now()
      and (p.runner_profile_id = v_me
        or exists (select 1 from private.registration_active_guardian_assignments(p.runner_profile_id, p.guest_participant_id) ga
                   where ga.guardian_profile_id = v_me))),
  actionable as (
    select i.*, private.registration_missing_documents(i.edition_id, i.runner_profile_id, i.guest_participant_id, i.is_minor) as missing
    from included i
    -- Only the valid acceptor gets the action: an adult for themself, a guardian for a minor.
    where (i.runner_profile_id = v_me and not i.is_minor) or (i.is_minor and i.runner_profile_id is distinct from v_me))
  select coalesce(jsonb_agg(jsonb_build_object(
      'action_type', 'LEGAL_ACCEPTANCE_REQUIRED',
      'edition', jsonb_build_object('edition_id', e.edition_id, 'name', e.name, 'slug', e.slug),
      'subject', case
        when a.runner_profile_id = v_me then jsonb_build_object('kind', 'SELF')
        when a.runner_profile_id is not null then jsonb_build_object('kind', 'MINOR_PROFILE',
          'public_profile_id', cp.public_profile_id, 'display_name', cp.display_name)
        else jsonb_build_object('kind', 'MINOR_GUEST', 'guest_participant_id', a.guest_participant_id,
          'display_name', g.full_name) end,
      'documents', private.registration_documents_json(a.edition_id, a.missing))
      order by e.name, a.runner_profile_id, a.guest_participant_id), '[]'::jsonb)
  into v_items
  from actionable a
  join app.edition e on e.edition_id = a.edition_id
  left join app.community_profile cp on cp.runner_profile_id = a.runner_profile_id
  left join app.guest_participant g on g.guest_participant_id = a.guest_participant_id
  where pg_catalog.cardinality(a.missing) > 0;

  if p_edition_id is not null and exists (
       select 1 from app.edition e
       where e.edition_id = p_edition_id and e.publication_state = 'PUBLISHED' and e.execution_state = 'SCHEDULED'
         and e.registration_state = 'OPEN')
     and not exists (select 1 from jsonb_array_elements(v_items) x
                     where x -> 'edition' ->> 'edition_id' = p_edition_id::text and x -> 'subject' ->> 'kind' = 'SELF') then
    select private.people_age_years(rp.date_of_birth,
             coalesce(private.people_edition_event_date(p_edition_id), private.people_today())) < 18
    into v_self_minor from app.runner_profile rp where rp.runner_profile_id = v_me;
    if not coalesce(v_self_minor, false) then
      v_missing := private.registration_missing_documents(p_edition_id, v_me, null, false);
      if pg_catalog.cardinality(v_missing) > 0 then
        v_items := v_items || (select jsonb_build_object('action_type', 'LEGAL_ACCEPTANCE_REQUIRED',
          'edition', jsonb_build_object('edition_id', e.edition_id, 'name', e.name, 'slug', e.slug),
          'subject', jsonb_build_object('kind', 'SELF'),
          'documents', private.registration_documents_json(p_edition_id, v_missing))
          from app.edition e where e.edition_id = p_edition_id);
      end if;
    end if;
  end if;
  return jsonb_build_object('items', v_items);
end;
$$;

-- The caller records their own acceptance (adult), or an ACTIVE guardian records it for a minor
-- (p_minor_public_profile_id or p_minor_guest_participant_id). Nobody accepts for another adult.
create function private.accept_edition_documents(
  p_edition_id uuid, p_legal_document_version_ids uuid[],
  p_minor_public_profile_id uuid default null, p_minor_guest_participant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_runner uuid;
  v_guest uuid;
  v_is_minor boolean;
  v_acceptor record;
  v_check jsonb;
  v_age integer;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id and e.publication_state = 'PUBLISHED') then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if coalesce(pg_catalog.cardinality(p_legal_document_version_ids), 0) not between 1 and 10
     or array_position(p_legal_document_version_ids, null) is not null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'legal_document_version_ids'));
  end if;
  if p_minor_public_profile_id is not null and p_minor_guest_participant_id is not null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'minor'));
  end if;

  if p_minor_public_profile_id is not null then
    v_runner := private.people_runner_id_for_public_profile(p_minor_public_profile_id);
    v_is_minor := true;
  elsif p_minor_guest_participant_id is not null then
    v_guest := p_minor_guest_participant_id;
    v_is_minor := true;
  else
    v_runner := v_me;
    select private.people_age_years(rp.date_of_birth, coalesce(private.people_edition_event_date(p_edition_id), private.people_today()))
    into v_age from app.runner_profile rp where rp.runner_profile_id = v_me;
    if v_age < 18 then
      -- Master §124: a minor's documents are accepted by the guardian.
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'GUARDIAN_ACCEPTANCE_REQUIRED'));
    end if;
    v_is_minor := false;
  end if;

  select * into v_acceptor from private.registration_acceptor_assignment(v_me, v_runner, v_guest, v_is_minor);
  if v_runner is null and v_guest is null or not v_acceptor.allowed then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if exists (select 1 from unnest(p_legal_document_version_ids) v(id)
             where not exists (select 1 from private.registration_required_documents(p_edition_id, v_is_minor) d
                               where d.legal_document_version_id = v.id)) then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'legal_document_version_ids',
      'reason', 'document_not_applicable'));
  end if;
  perform private.consume_policy_rate_limit('legal.accept:cmd', auth.uid()::text);

  perform private.registration_record_acceptances(v_me, p_edition_id, null, v_runner, v_guest,
    v_acceptor.guardian_assignment_id, p_legal_document_version_ids, 'EDITION_ACCEPTANCE');

  return jsonb_build_object('edition_id', p_edition_id,
    'missing_document_version_ids', to_jsonb(private.registration_missing_documents(p_edition_id, v_runner, v_guest, v_is_minor)));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Worker expire-registration-requests (Master §152): every 5 min via pg_cron. Commands never depend on
-- it (expires_at governs); it only materialises EXPIRED, releases holds/claims and emits the outbox event.
-- ---------------------------------------------------------------------------------------------
create function private.worker_expire_registration_requests()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_edition_id uuid;
  v_expired integer := 0;
  v_skipped integer := 0;
  v_errors integer := 0;
  v_last_error text;
begin
  insert into infra.worker_run (worker_key) values ('expire-registration-requests') returning worker_run_id into v_run_id;

  for v_edition_id in
    select distinct r.edition_id from app.registration_request r
    where r.status = 'PENDING_CONFIRMATION' and r.expires_at <= pg_catalog.now()
    limit 500
  loop
    begin
      -- Same lock order as the commands; a busy Edition is retried on the next run.
      perform 1 from app.edition e where e.edition_id = v_edition_id for update skip locked;
      if not found then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_expired := v_expired + private.registration_materialise_expired(v_edition_id);
    exception when others then
      v_errors := v_errors + 1;
      v_last_error := sqlstate;
    end;
  end loop;

  update infra.worker_run set
    status = case when v_errors = 0 then 'SUCCEEDED' else 'PARTIAL' end,
    completed_at = pg_catalog.now(),
    processed_count = v_expired,
    error_count = v_errors,
    metadata = jsonb_strip_nulls(jsonb_build_object('skipped_editions', v_skipped, 'last_error_sqlstate', v_last_error))
  where worker_run_id = v_run_id;
  return jsonb_build_object('worker_run_id', v_run_id, 'expired', v_expired, 'skipped_editions', v_skipped, 'errors', v_errors);
end;
$$;

select cron.schedule('expire-registration-requests', '*/5 * * * *', 'select private.worker_expire_registration_requests()');

create function public.admin_list_participants(
  p_edition_id uuid, p_status text default null, p_modality_id uuid default null, p_participant_kind text default null,
  p_kit_status text default null, p_attendance_status text default null, p_search text default null,
  p_cursor_name text default null, p_cursor_id uuid default null, p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_list_participants(p_edition_id, p_status, p_modality_id, p_participant_kind, p_kit_status,
  p_attendance_status, p_search, p_cursor_name, p_cursor_id, p_limit) $$;
create function public.admin_export_participants(
  p_edition_id uuid, p_reason text, p_status text default null, p_modality_id uuid default null,
  p_participant_kind text default null, p_kit_status text default null, p_attendance_status text default null,
  p_search text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.admin_export_participants(p_edition_id, p_reason, p_status, p_modality_id, p_participant_kind,
  p_kit_status, p_attendance_status, p_search) $$;
create function public.list_my_pending_actions(p_edition_id uuid default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_my_pending_actions(p_edition_id) $$;
create function public.accept_edition_documents(
  p_edition_id uuid, p_legal_document_version_ids uuid[],
  p_minor_public_profile_id uuid default null, p_minor_guest_participant_id uuid default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.accept_edition_documents(p_edition_id, p_legal_document_version_ids, p_minor_public_profile_id,
  p_minor_guest_participant_id) $$;

revoke all on function
  private.registration_participant_row(uuid, boolean),
  private.registration_participant_ids(uuid, text, uuid, text, text, text, text, text, uuid, integer),
  private.registration_validate_participant_filters(text, text, text, text, text),
  private.registration_documents_json(uuid, uuid[]),
  private.worker_expire_registration_requests(),
  private.admin_list_participants(uuid, text, uuid, text, text, text, text, text, uuid, integer),
  public.admin_list_participants(uuid, text, uuid, text, text, text, text, text, uuid, integer),
  private.admin_export_participants(uuid, text, text, uuid, text, text, text, text),
  public.admin_export_participants(uuid, text, text, uuid, text, text, text, text),
  private.list_my_pending_actions(uuid), public.list_my_pending_actions(uuid),
  private.accept_edition_documents(uuid, uuid[], uuid, uuid), public.accept_edition_documents(uuid, uuid[], uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  private.admin_list_participants(uuid, text, uuid, text, text, text, text, text, uuid, integer),
  public.admin_list_participants(uuid, text, uuid, text, text, text, text, text, uuid, integer),
  private.admin_export_participants(uuid, text, text, uuid, text, text, text, text),
  public.admin_export_participants(uuid, text, text, uuid, text, text, text, text),
  private.list_my_pending_actions(uuid), public.list_my_pending_actions(uuid),
  private.accept_edition_documents(uuid, uuid[], uuid, uuid), public.accept_edition_documents(uuid, uuid[], uuid, uuid)
to authenticated;
