-- P3-L admin API gaps (P3-AC-06, P3-AC-13, P3-AC-15).
--   1. Events catalogue + Event read projection (Events without Editions, type, canonical key, status).
--   2. Optimistic-concurrency guard for Edition edits and status transitions (stale state is an error class, Roadmap 9.29).
--   3. Idempotent facade for the anti-hoarding policy update (P3-D exposed the policy as non-idempotent RPC only).
-- Additive: no existing function is replaced, no existing signature changes (pgTAP 301/304/721 keep their grants).

-- ---------------------------------------------------------------------------------------------
-- 1. Events catalogue and Event read projection (Master 27, 145, 169).
-- Scope mirrors admin_list_editions: a staff member sees an Event when they hold EVENT_CONTENT_MANAGE
-- GLOBALLY (ADMIN/OPERATOR: every Event, including those with zero Editions) or on at least one of its
-- Editions (EDITION-scoped: only those Events, with only their own Editions counted). CHECKIN/MODERATOR
-- pass the staff gate and see an empty catalogue. Never locks; never mutates.
-- ---------------------------------------------------------------------------------------------

create or replace function private.event_visible(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('EVENT_CONTENT_MANAGE')
      or exists (select 1 from app.edition e
                 where e.event_id = p_event_id and private.has_permission('EVENT_CONTENT_MANAGE', e.edition_id))
$$;

create or replace function private.admin_list_events(
  p_status text default null, p_event_type_key text default null, p_search text default null,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_search text := nullif(private.normalize_search_text(coalesce(p_search, '')), '');
  v_items jsonb;
begin
  perform private.require_actor();
  if not exists (
      select 1 from app.staff_role_assignment sra
      where sra.staff_member_id = private.current_staff_member_id()
        and sra.revoked_at is null
        and sra.role = any (array['ADMIN', 'OPERATOR', 'CHECKIN', 'MODERATOR'])) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'ARCHIVED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'status'));
  end if;
  if p_event_type_key is not null and p_event_type_key !~ '^[A-Za-z0-9_.-]{1,64}$' then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'event_type_key'));
  end if;
  if pg_catalog.char_length(coalesce(v_search, '')) > 100 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'search'));
  end if;

  select coalesce(jsonb_agg(private.event_projection(s.event_id)
      || jsonb_build_object('edition_count', s.edition_count, 'latest_edition_created_at', s.latest_edition_created_at)
      order by s.created_at desc, s.event_id desc), '[]'::jsonb)
  into v_items
  from (
    select ev.event_id, ev.created_at,
      (select count(*) from app.edition e
        where e.event_id = ev.event_id and private.has_permission('EVENT_CONTENT_MANAGE', e.edition_id))::integer as edition_count,
      (select max(e.created_at) from app.edition e
        where e.event_id = ev.event_id and private.has_permission('EVENT_CONTENT_MANAGE', e.edition_id)) as latest_edition_created_at
    from app.event ev
    join app.event_type et on et.event_type_id = ev.event_type_id
    where private.event_visible(ev.event_id)
      and (p_status is null or ev.status = p_status)
      and (p_event_type_key is null or et.key = p_event_type_key)
      and (v_search is null or pg_catalog.strpos(private.normalize_search_text(ev.name), v_search) > 0
           or pg_catalog.strpos(private.normalize_search_text(ev.canonical_key), v_search) > 0)
      and (p_cursor_created_at is null or (ev.created_at, ev.event_id) < (p_cursor_created_at, p_cursor_id))
    order by ev.created_at desc, ev.event_id desc
    limit v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_items) with ordinality t(x, o) where o <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_items) > v_limit then jsonb_build_object(
      'created_at', v_items -> (v_limit - 1) -> 'created_at', 'event_id', v_items -> (v_limit - 1) -> 'event_id') end);
end;
$$;

create or replace function private.admin_get_event(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_editions jsonb;
  v_count integer;
begin
  if not exists (select 1 from app.event ev where ev.event_id = p_event_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_actor();
  if not private.event_visible(p_event_id) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;

  select count(*)::integer into v_count from app.edition e
  where e.event_id = p_event_id and private.has_permission('EVENT_CONTENT_MANAGE', e.edition_id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'edition_id', s.edition_id, 'slug', s.slug, 'name', s.name, 'publication_state', s.publication_state,
      'registration_state', s.registration_state, 'execution_state', s.execution_state,
      'sport_date', (private.current_schedule(s.edition_id) ->> 'local_date'),
      'created_at', s.created_at, 'updated_at', s.updated_at) order by s.created_at desc, s.edition_id desc), '[]'::jsonb)
  into v_editions
  from (
    select e.edition_id, e.slug, e.name, e.publication_state, e.registration_state, e.execution_state, e.created_at, e.updated_at
    from app.edition e
    where e.event_id = p_event_id and private.has_permission('EVENT_CONTENT_MANAGE', e.edition_id)
    order by e.created_at desc, e.edition_id desc
    limit 100) s;

  return private.event_projection(p_event_id)
    || jsonb_build_object('edition_count', v_count, 'editions', v_editions);
end;
$$;

create or replace function public.admin_list_events(
  p_status text default null, p_event_type_key text default null, p_search text default null,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 20)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_list_events(p_status, p_event_type_key, p_search, p_cursor_created_at, p_cursor_id, p_limit) $$;

create or replace function public.admin_get_event(p_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_get_event(p_event_id) $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Optimistic concurrency for Edition edits and transitions (P3-AC-15).
-- The precondition is edition.updated_at (touch_updated_at bumps it on every Edition UPDATE and the
-- Edition projection already exposes it). The caller must hold the permission the inner command needs
-- BEFORE learning anything about the current state; the row is then locked, compared, and the existing
-- command runs in the same transaction, so check-and-write is atomic. A stale token refuses with
-- CONFLICT {reason: STALE_STATE} and changes nothing. A completed idempotent replay (same actor, operation,
-- Edition and key) is returned as stored even though the Edition has moved on since: the retry of a
-- successful call must never turn into a stale error. Calls without a token keep using the plain commands.
-- ---------------------------------------------------------------------------------------------

create or replace function private.guarded_edition_command(
  p_edition_id uuid, p_command text, p_expected_updated_at timestamptz,
  p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb := coalesce(p_input, '{}'::jsonb);
  v_action text;
  v_publication text;
  v_current timestamptz;
  v_replay boolean := false;
begin
  if p_command is null or p_command not in ('UPDATE', 'SET_SCHEDULE', 'PUBLISH', 'HIDE', 'OPEN_REGISTRATION',
       'PAUSE_REGISTRATION', 'RESUME_REGISTRATION', 'CLOSE_REGISTRATION', 'POSTPONE', 'RESCHEDULE', 'CANCEL',
       'START', 'FINISH') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'command'));
  end if;
  if p_expected_updated_at is null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'expected_updated_at', 'reason', 'required'));
  end if;
  if p_idempotency_key is not null and p_command in ('UPDATE', 'SET_SCHEDULE') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'idempotency_key', 'reason', 'unsupported'));
  end if;

  select e.publication_state into v_publication from app.edition e where e.edition_id = p_edition_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;

  v_action := case
    when p_command = 'UPDATE' then
      case when jsonb_typeof(v_input) = 'object' and v_input ?| array['registration_mode', 'registration_open_at', 'registration_close_at']
           then 'EDITION_LIFECYCLE_MANAGE' else 'EVENT_CONTENT_MANAGE' end
    when p_command = 'SET_SCHEDULE' then
      case when v_publication = 'DRAFT' then 'EVENT_CONTENT_MANAGE' else 'EDITION_LIFECYCLE_MANAGE' end
    when p_command in ('PUBLISH', 'HIDE') then 'EDITION_PUBLISH'
    else 'EDITION_LIFECYCLE_MANAGE' end;
  perform private.require_permission(v_action, p_edition_id);

  if p_idempotency_key is not null then
    select exists (
      select 1 from infra.idempotency_record r
      where r.actor_auth_user_id = auth.uid() and r.operation_key = 'edition.' || lower(p_command)
        and r.resource_scope = p_edition_id::text and r.idempotency_key = p_idempotency_key
        and r.state = 'COMPLETED' and r.expires_at > pg_catalog.now()) into v_replay;
  end if;

  -- The lock serialises concurrent guarded calls: the loser re-reads the committed row and is stale.
  select e.updated_at into v_current from app.edition e where e.edition_id = p_edition_id for update;
  if not v_replay and v_current is distinct from p_expected_updated_at then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object(
      'reason', 'STALE_STATE', 'field', 'expected_updated_at', 'current_updated_at', v_current));
  end if;

  if p_command = 'UPDATE' then
    return private.update_edition(p_edition_id, v_input);
  elsif p_command = 'SET_SCHEDULE' then
    return private.set_edition_schedule(p_edition_id, v_input);
  end if;
  return private.cfg_edition_transition(p_edition_id, p_command, v_input, p_idempotency_key);
end;
$$;

create or replace function public.guarded_edition_command(
  p_edition_id uuid, p_command text, p_expected_updated_at timestamptz,
  p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.guarded_edition_command(p_edition_id, p_command, p_expected_updated_at, p_input, p_idempotency_key) $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Anti-hoarding policy update with idempotency (P3-AC-13). Same permission and validation as
-- private.update_anti_hoarding_policy (which audits ANTI_HOARDING_POLICY_UPDATED); a replay of a
-- completed key returns the stored policy projection and neither writes nor audits again.
-- ---------------------------------------------------------------------------------------------

create or replace function private.update_anti_hoarding_policy_idempotent(p_input jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idem jsonb;
  v_result jsonb;
begin
  perform private.require_permission('PLATFORM_SETTINGS_MANAGE');
  v_idem := private.cfg_idempotency_begin('anti_hoarding_policy.update', 'global', p_idempotency_key,
    jsonb_build_object('input', coalesce(p_input, '{}'::jsonb)));
  if v_idem is null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('header', 'Idempotency-Key', 'reason', 'missing'));
  end if;
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;
  v_result := private.update_anti_hoarding_policy(p_input);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

create or replace function public.update_anti_hoarding_policy_idempotent(p_input jsonb, p_idempotency_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_anti_hoarding_policy_idempotent(p_input, p_idempotency_key) $$;

-- ---------------------------------------------------------------------------------------------
-- Grants: closed by default, authenticated only (the functions authorise from auth.uid()).
-- event_visible is an internal helper: no API grant.
-- ---------------------------------------------------------------------------------------------

revoke all on function
  private.event_visible(uuid),
  private.admin_list_events(text, text, text, timestamptz, uuid, integer),
  public.admin_list_events(text, text, text, timestamptz, uuid, integer),
  private.admin_get_event(uuid), public.admin_get_event(uuid),
  private.guarded_edition_command(uuid, text, timestamptz, jsonb, text),
  public.guarded_edition_command(uuid, text, timestamptz, jsonb, text),
  private.update_anti_hoarding_policy_idempotent(jsonb, text),
  public.update_anti_hoarding_policy_idempotent(jsonb, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.admin_list_events(text, text, text, timestamptz, uuid, integer),
  public.admin_list_events(text, text, text, timestamptz, uuid, integer),
  private.admin_get_event(uuid), public.admin_get_event(uuid),
  private.guarded_edition_command(uuid, text, timestamptz, jsonb, text),
  public.guarded_edition_command(uuid, text, timestamptz, jsonb, text),
  private.update_anti_hoarding_policy_idempotent(jsonb, text),
  public.update_anti_hoarding_policy_idempotent(jsonb, text)
to authenticated;
