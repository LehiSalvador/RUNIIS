-- GuestParticipant commands, archive recomputation and the archive-guests worker
-- (Master §24-25, §152, §158, §166; SEC-010/016). Owner = caller; foreign guests are NOT_FOUND.

create or replace function private.people_clean_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(pg_catalog.regexp_replace(p_value, '\s+', ' ', 'g')), '')
$$;

-- Strict ISO date (YYYY-MM-DD, calendar-valid); NULL otherwise, so DateStyle never changes the meaning.
create or replace function private.people_parse_iso_date(p_value text)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

-- Master §24 fields; ages 15+ only (under 15 is rejected outright, Master §19/§24).
create or replace function private.people_validate_guest_fields(p_guest app.guest_participant)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_age integer;
  v_invalid text;
begin
  v_invalid := case
    when p_guest.full_name is null or char_length(p_guest.full_name) not between 2 and 120
      or p_guest.full_name ~ '[[:cntrl:]]' then 'full_name'
    when p_guest.date_of_birth is null or p_guest.date_of_birth > private.people_today() then 'date_of_birth'
    when p_guest.sex_code is null or p_guest.sex_code not in ('F', 'M', 'X') then 'sex_code'
    when p_guest.phone_e164 is null or p_guest.phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then 'phone_e164'
    when p_guest.emergency_contact_name is null or char_length(p_guest.emergency_contact_name) not between 2 and 120
      or p_guest.emergency_contact_name ~ '[[:cntrl:]]' then 'emergency_contact_name'
    when p_guest.emergency_contact_phone_e164 is null
      or p_guest.emergency_contact_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then 'emergency_contact_phone_e164'
    when p_guest.emergency_contact_relationship is null or char_length(p_guest.emergency_contact_relationship) > 60
      or p_guest.emergency_contact_relationship ~ '[[:cntrl:]]' then 'emergency_contact_relationship'
  end;
  if v_invalid is not null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', v_invalid, 'reason', 'invalid'));
  end if;
  v_age := private.people_age_years(p_guest.date_of_birth, private.people_today());
  if v_age < 15 then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "date_of_birth", "reason": "UNDER_MIN_AGE"}');
  end if;
  if v_age > 120 then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "date_of_birth", "reason": "invalid"}');
  end if;
end;
$$;

-- Owner view of a Guest (the owner entered this data). identity_locked: name/DOB/sex are frozen
-- once the Guest appears in any registration request.
create or replace function private.people_guest_projection(p_guest app.guest_participant)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'guest_participant_id', p_guest.guest_participant_id,
    'full_name', p_guest.full_name,
    'date_of_birth', p_guest.date_of_birth,
    'sex_code', p_guest.sex_code,
    'phone_e164', p_guest.phone_e164,
    'emergency_contact_name', p_guest.emergency_contact_name,
    'emergency_contact_phone_e164', p_guest.emergency_contact_phone_e164,
    'emergency_contact_relationship', p_guest.emergency_contact_relationship,
    'status', p_guest.status,
    'is_minor', private.people_age_years(p_guest.date_of_birth, private.people_today()) < 18,
    'identity_locked', exists (select 1 from app.registration_request_participant p
                               where p.guest_participant_id = p_guest.guest_participant_id),
    'guardian_status', case
      when exists (select 1 from app.guardian_assignment ga
                   where ga.minor_guest_participant_id = p_guest.guest_participant_id and ga.status = 'ACTIVE'
                     and private.people_profile_available(ga.guardian_profile_id)) then 'ACTIVE'
      when exists (select 1 from app.guardian_assignment ga
                   where ga.minor_guest_participant_id = p_guest.guest_participant_id and ga.status = 'PENDING') then 'PENDING'
      else 'NONE' end,
    'last_event_end_at', p_guest.last_event_end_at,
    'archive_after', p_guest.archive_after,
    'archived_at', p_guest.archived_at,
    'created_at', p_guest.created_at,
    'updated_at', p_guest.updated_at)
$$;

-- Master §25 recomputation. T34 calls this (inside its transaction, after its own locks) whenever a
-- Guest's requests/registrations change; the worker calls it before archiving.
--  * future participation (live CONFIRMED registration on a not finished/canceled Edition that has not
--    ended, or a live PENDING_CONFIRMATION request) => archive_after NULL (never archived);
--  * otherwise archive_after = 30 days after the effective end of the latest related Edition, floored
--    at 30 days after an explicit reactivation; NULL when the Guest has no related Edition.
create or replace function private.recompute_guest_archive_after(p_guest_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest app.guest_participant;
  v_has_future boolean;
  v_last_end timestamptz;
  v_archive_after timestamptz;
begin
  select * into v_guest from app.guest_participant g where g.guest_participant_id = p_guest_participant_id for update;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;

  with related as (
    select reg.status as registration_status, e.execution_state,
      coalesce(private.people_edition_effective_end(e.edition_id),
               case when e.execution_state in ('FINISHED', 'CANCELED') then e.updated_at end) as end_at
    from app.registration reg
    join app.edition e on e.edition_id = reg.edition_id
    where reg.guest_participant_id = p_guest_participant_id
  )
  select
    coalesce(bool_or(registration_status = 'CONFIRMED' and execution_state not in ('FINISHED', 'CANCELED')
                     and (end_at is null or end_at > pg_catalog.now())), false),
    max(end_at)
  into v_has_future, v_last_end
  from related;

  v_has_future := v_has_future or exists (
    select 1 from app.registration_request_participant p
    join app.registration_request rr on rr.registration_request_id = p.registration_request_id
    where p.guest_participant_id = p_guest_participant_id
      and rr.status = 'PENDING_CONFIRMATION'
      and (rr.expires_at is null or rr.expires_at > pg_catalog.now()));

  v_archive_after := case when not v_has_future and v_last_end is not null
    then greatest(v_last_end + interval '30 days', v_guest.reactivated_at + interval '30 days') end;

  if (v_guest.last_event_end_at, v_guest.archive_after) is distinct from (v_last_end, v_archive_after) then
    update app.guest_participant g set last_event_end_at = v_last_end, archive_after = v_archive_after
    where g.guest_participant_id = p_guest_participant_id;
  end if;

  return jsonb_build_object('guest_participant_id', p_guest_participant_id, 'archive_after', v_archive_after,
    'last_event_end_at', v_last_end, 'has_future_participation', v_has_future);
end;
$$;

-- Caller holds the row lock. ARCHIVED is not deletion (Master §25).
create or replace function private.people_archive_guest_row(p_guest_participant_id uuid, p_reason text)
returns app.guest_participant
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.guest_participant;
begin
  update app.guest_participant g set status = 'ARCHIVED', archived_at = pg_catalog.now()
  where g.guest_participant_id = p_guest_participant_id and g.status = 'ACTIVE'
  returning * into v_row;
  perform private.audit('GUEST_ARCHIVED', 'guest_participant', v_row.guest_participant_id, null,
    jsonb_build_object('status', 'ACTIVE'), jsonb_build_object('status', 'ARCHIVED'), p_reason);
  perform private.enqueue_outbox('GuestArchived', 'GuestParticipant', v_row.guest_participant_id,
    'GuestArchived:' || v_row.guest_participant_id || ':' || (extract(epoch from v_row.archived_at) * 1000000)::bigint,
    jsonb_build_object('guest_participant_id', v_row.guest_participant_id, 'owner_profile_id', v_row.owner_profile_id,
      'archived_at', v_row.archived_at));
  return v_row;
end;
$$;

create or replace function private.people_lock_my_guest(p_guest_participant_id uuid, p_me uuid)
returns app.guest_participant
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.guest_participant;
begin
  select * into v_row from app.guest_participant g
  where g.guest_participant_id = p_guest_participant_id and g.owner_profile_id = p_me
  for update;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  return v_row;
end;
$$;

create or replace function private.create_guest(
  p_full_name text, p_date_of_birth date, p_sex_code text, p_phone_e164 text,
  p_emergency_contact_name text, p_emergency_contact_phone_e164 text, p_emergency_contact_relationship text,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_new app.guest_participant;
  v_existing app.guest_participant;
  v_idem jsonb;
  v_result jsonb;
  v_constraint text;
begin
  v_new.owner_profile_id := v_me;
  v_new.full_name := private.people_clean_text(p_full_name);
  v_new.date_of_birth := p_date_of_birth;
  v_new.sex_code := p_sex_code;
  v_new.phone_e164 := private.people_clean_text(p_phone_e164);
  v_new.emergency_contact_name := private.people_clean_text(p_emergency_contact_name);
  v_new.emergency_contact_phone_e164 := private.people_clean_text(p_emergency_contact_phone_e164);
  v_new.emergency_contact_relationship := private.people_clean_text(p_emergency_contact_relationship);
  perform private.people_validate_guest_fields(v_new);

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('guest.create', v_me::text, p_idempotency_key, jsonb_build_object(
      'full_name', v_new.full_name, 'date_of_birth', v_new.date_of_birth, 'sex_code', v_new.sex_code,
      'phone_e164', v_new.phone_e164, 'emergency_contact_name', v_new.emergency_contact_name,
      'emergency_contact_phone_e164', v_new.emergency_contact_phone_e164,
      'emergency_contact_relationship', v_new.emergency_contact_relationship));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  select * into v_existing from app.guest_participant g
  where g.owner_profile_id = v_me
    and private.normalize_search_text(g.full_name) = private.normalize_search_text(v_new.full_name)
    and g.date_of_birth = v_new.date_of_birth
  order by g.status = 'ACTIVE' desc, g.created_at desc
  limit 1;
  if found then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object(
      'reason', case when v_existing.status = 'ACTIVE' then 'DUPLICATE_GUEST' else 'DUPLICATE_ARCHIVED_GUEST' end,
      'guest_participant_id', v_existing.guest_participant_id));
  end if;

  perform private.consume_policy_rate_limit('guest.create:cmd', auth.uid()::text);

  insert into app.guest_participant (owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
    emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
  values (v_me, v_new.full_name, v_new.date_of_birth, v_new.sex_code, v_new.phone_e164,
    v_new.emergency_contact_name, v_new.emergency_contact_phone_e164, v_new.emergency_contact_relationship)
  returning * into v_new;

  perform private.audit('GUEST_CREATED', 'guest_participant', v_new.guest_participant_id, null,
    null, jsonb_build_object('status', v_new.status));
  v_result := private.people_guest_projection(v_new);
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 201, v_result);
  end if;
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint,
    '{"guest_participant_owner_identity_live_uidx": "CONFLICT"}', '{"reason": "DUPLICATE_GUEST"}');
end;
$$;

-- PATCH with a strict allowlist (SEC-016): owner, status and archive fields are never writable here.
create or replace function private.update_guest(p_guest_participant_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_allowed constant text[] := array['full_name', 'date_of_birth', 'sex_code', 'phone_e164',
    'emergency_contact_name', 'emergency_contact_phone_e164', 'emergency_contact_relationship'];
  v_me uuid := private.require_ready_profile();
  v_key text;
  v_old app.guest_participant;
  v_new app.guest_participant;
  v_changed text[];
  v_identity_changed text[];
  v_constraint text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "changes", "reason": "empty"}');
  end if;
  for v_key in select k from jsonb_object_keys(p_changes) k order by k loop
    if not v_key = any (c_allowed) then
      perform private.raise_domain_error('VALIDATION_ERROR',
        jsonb_build_object('field', private.people_safe_field(v_key), 'reason', 'not_allowed'));
    end if;
    if jsonb_typeof(p_changes -> v_key) <> 'string' then
      perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', v_key, 'reason', 'invalid'));
    end if;
  end loop;

  v_old := private.people_lock_my_guest(p_guest_participant_id, v_me);
  if v_old.status <> 'ACTIVE' then
    perform private.raise_domain_error('CONFLICT', '{"reason": "GUEST_ARCHIVED"}');
  end if;

  v_new := v_old;
  if p_changes ? 'full_name' then v_new.full_name := private.people_clean_text(p_changes ->> 'full_name'); end if;
  if p_changes ? 'date_of_birth' then
    v_new.date_of_birth := private.people_parse_iso_date(p_changes ->> 'date_of_birth');
  end if;
  if p_changes ? 'sex_code' then v_new.sex_code := p_changes ->> 'sex_code'; end if;
  if p_changes ? 'phone_e164' then v_new.phone_e164 := private.people_clean_text(p_changes ->> 'phone_e164'); end if;
  if p_changes ? 'emergency_contact_name' then
    v_new.emergency_contact_name := private.people_clean_text(p_changes ->> 'emergency_contact_name');
  end if;
  if p_changes ? 'emergency_contact_phone_e164' then
    v_new.emergency_contact_phone_e164 := private.people_clean_text(p_changes ->> 'emergency_contact_phone_e164');
  end if;
  if p_changes ? 'emergency_contact_relationship' then
    v_new.emergency_contact_relationship := private.people_clean_text(p_changes ->> 'emergency_contact_relationship');
  end if;
  perform private.people_validate_guest_fields(v_new);

  select coalesce(array_agg(o.key order by o.key), '{}') into v_changed
  from jsonb_each(to_jsonb(v_old)) o
  join jsonb_each(to_jsonb(v_new)) n using (key)
  where o.key = any (c_allowed) and o.value is distinct from n.value;
  if cardinality(v_changed) = 0 then
    return private.people_guest_projection(v_old);
  end if;

  v_identity_changed := array(select unnest(v_changed) intersect select unnest(array['full_name', 'date_of_birth', 'sex_code']));
  if cardinality(v_identity_changed) > 0 and exists (
      select 1 from app.registration_request_participant p where p.guest_participant_id = v_old.guest_participant_id) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
      jsonb_build_object('reason', 'GUEST_IDENTITY_LOCKED', 'fields', to_jsonb(v_identity_changed)));
  end if;

  update app.guest_participant g set
    full_name = v_new.full_name, date_of_birth = v_new.date_of_birth, sex_code = v_new.sex_code,
    phone_e164 = v_new.phone_e164, emergency_contact_name = v_new.emergency_contact_name,
    emergency_contact_phone_e164 = v_new.emergency_contact_phone_e164,
    emergency_contact_relationship = v_new.emergency_contact_relationship
  where g.guest_participant_id = v_old.guest_participant_id
  returning * into v_new;

  -- Field names only: guest PII never goes into the audit snapshot (SEC-112).
  perform private.audit('GUEST_UPDATED', 'guest_participant', v_new.guest_participant_id, null,
    null, jsonb_build_object('changed_fields', to_jsonb(v_changed)));
  return private.people_guest_projection(v_new);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint,
    '{"guest_participant_owner_identity_live_uidx": "CONFLICT"}', '{"reason": "DUPLICATE_GUEST"}');
end;
$$;

-- Owner archive (DELETE /me/guests/:id). Never while the Guest has future participation.
create or replace function private.archive_guest(p_guest_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_row app.guest_participant;
begin
  v_row := private.people_lock_my_guest(p_guest_participant_id, v_me);
  if v_row.status = 'ACTIVE' then
    if (private.recompute_guest_archive_after(v_row.guest_participant_id) ->> 'has_future_participation')::boolean then
      perform private.raise_domain_error('CONFLICT', '{"reason": "GUEST_HAS_FUTURE_PARTICIPATION"}');
    end if;
    v_row := private.people_archive_guest_row(v_row.guest_participant_id, 'owner');
  end if;
  return private.people_guest_projection(v_row);
end;
$$;

-- Explicit reactivation of an ARCHIVED Guest. Conflicts with a live Guest of the same identity
-- (CONFLICT DUPLICATE_GUEST); archive_after restarts no earlier than 30 days from now.
create or replace function private.reactivate_guest(p_guest_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_row app.guest_participant;
  v_constraint text;
begin
  v_row := private.people_lock_my_guest(p_guest_participant_id, v_me);
  if v_row.status = 'ARCHIVED' then
    perform private.people_validate_guest_fields(v_row);
    update app.guest_participant g
    set status = 'ACTIVE', archived_at = null, reactivated_at = pg_catalog.now()
    where g.guest_participant_id = v_row.guest_participant_id;
    perform private.recompute_guest_archive_after(v_row.guest_participant_id);
    perform private.audit('GUEST_REACTIVATED', 'guest_participant', v_row.guest_participant_id, null,
      jsonb_build_object('status', 'ARCHIVED'), jsonb_build_object('status', 'ACTIVE'));
    select * into v_row from app.guest_participant g where g.guest_participant_id = p_guest_participant_id;
  end if;
  return private.people_guest_projection(v_row);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint,
    '{"guest_participant_owner_identity_live_uidx": "CONFLICT"}', '{"reason": "DUPLICATE_GUEST"}');
end;
$$;

-- Owner's Guests by status (ACTIVE by default; ARCHIVED listed separately). Fixed page (SEC-008).
create or replace function private.list_my_guests(
  p_status text default 'ACTIVE', p_after_sort_key text default null, p_after_guest_participant_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  c_page_size constant integer := 50;
  v_items jsonb;
  v_has_more boolean;
  v_last_key text;
  v_last_id uuid;
begin
  if coalesce(p_status, '') not in ('ACTIVE', 'ARCHIVED') then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "status", "reason": "invalid"}');
  end if;
  if (p_after_sort_key is null) <> (p_after_guest_participant_id is null) then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "cursor", "reason": "invalid_cursor"}');
  end if;

  with page as (
    select g as guest, g.guest_participant_id as id, private.normalize_search_text(g.full_name) collate "C" as sort_key
    from app.guest_participant g
    where g.owner_profile_id = v_me and g.status = p_status
      and (p_after_sort_key is null
        or (private.normalize_search_text(g.full_name) collate "C", g.guest_participant_id)
           > (p_after_sort_key collate "C", p_after_guest_participant_id))
    order by sort_key, id
    limit c_page_size + 1
  ), ranked as (
    select page.*, row_number() over (order by sort_key, id) as rn from page
  )
  select
    coalesce(jsonb_agg(private.people_guest_projection(r.guest) order by r.rn) filter (where r.rn <= c_page_size), '[]'::jsonb),
    count(*) > c_page_size,
    min(r.sort_key) filter (where r.rn = c_page_size),
    min(r.id::text) filter (where r.rn = c_page_size)
  into v_items, v_has_more, v_last_key, v_last_id
  from ranked r;

  return jsonb_build_object('items', v_items, 'next_cursor',
    case when v_has_more then jsonb_build_object('sort_key', v_last_key, 'id', v_last_id) end);
end;
$$;

-- Daily DB-only worker (ADR-001 §10, Master §152 archive-guests). Rows locked by a concurrent
-- registration transaction are skipped and retried on the next run.
create or replace function private.people_archive_guest_if_due(p_guest_participant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_info jsonb;
begin
  perform 1 from app.guest_participant g
  where g.guest_participant_id = p_guest_participant_id and g.status = 'ACTIVE'
  for update skip locked;
  if not found then
    return false;
  end if;
  v_info := private.recompute_guest_archive_after(p_guest_participant_id);
  if (v_info ->> 'archive_after') is null or (v_info ->> 'archive_after')::timestamptz > pg_catalog.now() then
    return false;
  end if;
  perform private.people_archive_guest_row(p_guest_participant_id, 'archive_after reached');
  return true;
end;
$$;

create or replace function private.worker_archive_guests(p_batch_size integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 500), 5000));
  v_run_id uuid;
  v_guest_id uuid;
  v_processed integer := 0;
  v_archived integer := 0;
  v_errors integer := 0;
  v_last_error text;
begin
  insert into infra.worker_run (worker_key, metadata)
  values ('archive-guests', jsonb_build_object('batch_size', v_batch))
  returning worker_run_id into v_run_id;

  -- Due rows, plus Guests with registrations whose archive_after was never computed.
  for v_guest_id in
    select g.guest_participant_id from app.guest_participant g
    where g.status = 'ACTIVE'
      and (g.archive_after <= pg_catalog.now()
        or (g.archive_after is null
            and exists (select 1 from app.registration r where r.guest_participant_id = g.guest_participant_id)))
    order by g.archive_after nulls last, g.guest_participant_id
    limit v_batch
  loop
    v_processed := v_processed + 1;
    begin
      if private.people_archive_guest_if_due(v_guest_id) then
        v_archived := v_archived + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      v_last_error := sqlstate;
    end;
  end loop;

  update infra.worker_run set
    status = case when v_errors = 0 then 'SUCCEEDED' else 'PARTIAL' end,
    completed_at = pg_catalog.now(),
    processed_count = v_processed,
    error_count = v_errors,
    metadata = metadata || jsonb_build_object('archived', v_archived, 'last_error_sqlstate', v_last_error)
  where worker_run_id = v_run_id;

  return jsonb_build_object('worker_run_id', v_run_id, 'processed', v_processed, 'archived', v_archived, 'errors', v_errors);
end;
$$;

-- 03:15 America/Monterrey (UTC-6, no DST) = 09:15 UTC. cron.schedule upserts by job name.
select cron.schedule('archive-guests', '15 9 * * *', 'select private.worker_archive_guests()');

create or replace function public.create_guest(
  p_full_name text, p_date_of_birth date, p_sex_code text, p_phone_e164 text,
  p_emergency_contact_name text, p_emergency_contact_phone_e164 text, p_emergency_contact_relationship text,
  p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_guest(p_full_name, p_date_of_birth, p_sex_code, p_phone_e164, p_emergency_contact_name,
  p_emergency_contact_phone_e164, p_emergency_contact_relationship, p_idempotency_key) $$;
create or replace function public.update_guest(p_guest_participant_id uuid, p_changes jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.update_guest(p_guest_participant_id, p_changes) $$;
create or replace function public.archive_guest(p_guest_participant_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.archive_guest(p_guest_participant_id) $$;
create or replace function public.reactivate_guest(p_guest_participant_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.reactivate_guest(p_guest_participant_id) $$;
create or replace function public.list_my_guests(
  p_status text default 'ACTIVE', p_after_sort_key text default null, p_after_guest_participant_id uuid default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_my_guests(p_status, p_after_sort_key, p_after_guest_participant_id) $$;

revoke all on function
  private.people_clean_text(text),
  private.people_parse_iso_date(text),
  private.people_validate_guest_fields(app.guest_participant),
  private.people_guest_projection(app.guest_participant),
  private.recompute_guest_archive_after(uuid),
  private.people_archive_guest_row(uuid, text),
  private.people_lock_my_guest(uuid, uuid),
  private.people_archive_guest_if_due(uuid),
  private.worker_archive_guests(integer),
  private.create_guest(text, date, text, text, text, text, text, text),
  public.create_guest(text, date, text, text, text, text, text, text),
  private.update_guest(uuid, jsonb), public.update_guest(uuid, jsonb),
  private.archive_guest(uuid), public.archive_guest(uuid),
  private.reactivate_guest(uuid), public.reactivate_guest(uuid),
  private.list_my_guests(text, text, uuid), public.list_my_guests(text, text, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  private.create_guest(text, date, text, text, text, text, text, text),
  public.create_guest(text, date, text, text, text, text, text, text),
  private.update_guest(uuid, jsonb), public.update_guest(uuid, jsonb),
  private.archive_guest(uuid), public.archive_guest(uuid),
  private.reactivate_guest(uuid), public.reactivate_guest(uuid),
  private.list_my_guests(text, text, uuid), public.list_my_guests(text, text, uuid)
to authenticated;
