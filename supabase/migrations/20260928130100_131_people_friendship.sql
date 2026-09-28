-- Friendship commands and reads (Master §22, §121, §158, §166, §179; SEC-010/015/141).
-- Counterparts are addressed by public_profile_id; runner_profile_id never leaves the database.

create or replace function private.people_friendship_projection(p_friendship app.friendship, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'friendship_id', p_friendship.friendship_id,
    'status', p_friendship.status,
    'direction', case when p_friendship.requester_profile_id = p_me then 'OUTGOING' else 'INCOMING' end,
    'requested_at', p_friendship.requested_at,
    'responded_at', p_friendship.responded_at,
    'removed_at', p_friendship.removed_at,
    'counterpart', private.people_public_card(
      case when p_friendship.requester_profile_id = p_me
        then p_friendship.addressee_profile_id else p_friendship.requester_profile_id end))
$$;

-- CreateFriendship always creates PENDING (Master §22). A repeated request for the same live
-- outgoing pair returns it unchanged (double submit = one effect).
create or replace function private.request_friendship(p_public_profile_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_target uuid;
  v_existing app.friendship;
  v_row app.friendship;
  v_idem jsonb;
  v_result jsonb;
  v_constraint text;
begin
  if p_public_profile_id is null then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "public_profile_id", "reason": "required"}');
  end if;
  v_target := private.people_runner_id_for_public_profile(p_public_profile_id);
  if v_target = v_me then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "SELF_FRIENDSHIP"}');
  end if;
  -- Unknown, hidden, banned, locked or incomplete profiles are indistinguishable (no oracle).
  if v_target is null or not private.people_profile_available(v_target)
     or not exists (select 1 from app.community_profile cp where cp.runner_profile_id = v_target and cp.is_visible) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('friendship.request', p_public_profile_id::text, p_idempotency_key,
      jsonb_build_object('public_profile_id', p_public_profile_id));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  select * into v_existing from app.friendship f
  where least(f.requester_profile_id, f.addressee_profile_id) = least(v_me, v_target)
    and greatest(f.requester_profile_id, f.addressee_profile_id) = greatest(v_me, v_target)
    and f.status in ('PENDING', 'ACCEPTED')
  for update;

  if found then
    if v_existing.status = 'ACCEPTED' then
      perform private.raise_domain_error('CONFLICT',
        jsonb_build_object('reason', 'ALREADY_FRIENDS', 'friendship_id', v_existing.friendship_id));
    elsif v_existing.requester_profile_id <> v_me then
      perform private.raise_domain_error('CONFLICT',
        jsonb_build_object('reason', 'INCOMING_REQUEST_PENDING', 'friendship_id', v_existing.friendship_id));
    end if;
    v_result := private.people_friendship_projection(v_existing, v_me);
  else
    -- Success-path counters (A6): bound direct PostgREST callers without double counting Next.
    perform private.consume_policy_rate_limit('friendship.request.minute:cmd', auth.uid()::text);
    perform private.consume_policy_rate_limit('friendship.request.day:cmd', auth.uid()::text);

    insert into app.friendship (requester_profile_id, addressee_profile_id, status)
    values (v_me, v_target, 'PENDING')
    returning * into v_row;

    perform private.audit('FRIENDSHIP_REQUESTED', 'friendship', v_row.friendship_id, null,
      null, jsonb_build_object('status', 'PENDING'));
    perform private.enqueue_outbox('FriendshipRequested', 'Friendship', v_row.friendship_id,
      'FriendshipRequested:' || v_row.friendship_id,
      jsonb_build_object('friendship_id', v_row.friendship_id, 'requester_profile_id', v_me,
        'addressee_profile_id', v_target));
    v_result := private.people_friendship_projection(v_row, v_me);
  end if;

  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  -- Concurrent inverse request won the unordered-pair index.
  perform private.raise_constraint_error(sqlstate, v_constraint,
    '{"friendship_live_pair_uidx": "CONFLICT"}', '{"reason": "FRIENDSHIP_EXISTS"}');
end;
$$;

-- Loads the caller's friendship row FOR UPDATE; foreign ids are NOT_FOUND (SEC-010).
create or replace function private.people_lock_my_friendship(p_friendship_id uuid, p_me uuid)
returns app.friendship
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.friendship;
begin
  select * into v_row from app.friendship f
  where f.friendship_id = p_friendship_id and p_me in (f.requester_profile_id, f.addressee_profile_id)
  for update;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  return v_row;
end;
$$;

-- Accept/Reject: addressee only (Master §22). Repeating the same answer is a no-op.
create or replace function private.people_respond_friendship(p_friendship_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_row app.friendship;
  v_target_status text := case when p_accept then 'ACCEPTED' else 'REJECTED' end;
begin
  v_row := private.people_lock_my_friendship(p_friendship_id, v_me);
  if v_row.addressee_profile_id <> v_me then
    perform private.raise_domain_error('FORBIDDEN', '{"reason": "ADDRESSEE_ONLY"}');
  end if;
  if v_row.status = v_target_status then
    return private.people_friendship_projection(v_row, v_me);
  end if;
  if v_row.status <> 'PENDING' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'NOT_PENDING', 'status', v_row.status));
  end if;
  if p_accept and not private.people_profile_available(v_row.requester_profile_id) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "COUNTERPART_UNAVAILABLE"}');
  end if;

  update app.friendship f set status = v_target_status, responded_at = pg_catalog.now()
  where f.friendship_id = v_row.friendship_id
  returning * into v_row;

  perform private.audit(case when p_accept then 'FRIENDSHIP_ACCEPTED' else 'FRIENDSHIP_REJECTED' end,
    'friendship', v_row.friendship_id, null,
    jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', v_target_status));
  if p_accept then
    perform private.enqueue_outbox('FriendshipAccepted', 'Friendship', v_row.friendship_id,
      'FriendshipAccepted:' || v_row.friendship_id,
      jsonb_build_object('friendship_id', v_row.friendship_id, 'requester_profile_id', v_row.requester_profile_id,
        'addressee_profile_id', v_row.addressee_profile_id));
  end if;
  return private.people_friendship_projection(v_row, v_me);
end;
$$;

create or replace function private.accept_friendship(p_friendship_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.people_respond_friendship(p_friendship_id, true)
$$;

create or replace function private.reject_friendship(p_friendship_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.people_respond_friendship(p_friendship_id, false)
$$;

-- Remove: either party, from PENDING (cancel/decline) or ACCEPTED (Master §22). Idempotent on REMOVED.
-- A REJECTED row is not shown to the requester, so it is NOT_FOUND here too (no rejection oracle).
create or replace function private.remove_friendship(p_friendship_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_row app.friendship;
  v_before text;
begin
  v_row := private.people_lock_my_friendship(p_friendship_id, v_me);
  if v_row.status = 'REMOVED' then
    return private.people_friendship_projection(v_row, v_me);
  end if;
  if v_row.status = 'REJECTED' then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_before := v_row.status;

  update app.friendship f set status = 'REMOVED', removed_at = pg_catalog.now()
  where f.friendship_id = v_row.friendship_id
  returning * into v_row;

  perform private.audit('FRIENDSHIP_REMOVED', 'friendship', v_row.friendship_id, null,
    jsonb_build_object('status', v_before), jsonb_build_object('status', 'REMOVED'));
  return private.people_friendship_projection(v_row, v_me);
end;
$$;

-- Caller's friendships: FRIENDS (ACCEPTED), INCOMING or OUTGOING (PENDING). Counterparts that are
-- no longer available (banned/locked/deactivated) are omitted. Page size is fixed (SEC-008).
create or replace function private.list_my_friendships(
  p_view text default 'FRIENDS', p_after_sort_key text default null, p_after_friendship_id uuid default null)
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
  if coalesce(p_view, '') not in ('FRIENDS', 'INCOMING', 'OUTGOING') then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "view", "reason": "invalid"}');
  end if;
  if (p_after_sort_key is null) <> (p_after_friendship_id is null) then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "cursor", "reason": "invalid_cursor"}');
  end if;

  with page as (
    select f as fr, f.friendship_id as id, private.normalize_search_text(cp.display_name) collate "C" as sort_key
    from app.friendship f
    join app.community_profile cp on cp.runner_profile_id =
      case when f.requester_profile_id = v_me then f.addressee_profile_id else f.requester_profile_id end
    where case p_view
        when 'FRIENDS' then f.status = 'ACCEPTED' and v_me in (f.requester_profile_id, f.addressee_profile_id)
        when 'INCOMING' then f.status = 'PENDING' and f.addressee_profile_id = v_me
        else f.status = 'PENDING' and f.requester_profile_id = v_me
      end
      and private.people_profile_available(cp.runner_profile_id)
      and (p_after_sort_key is null
        or (private.normalize_search_text(cp.display_name) collate "C", f.friendship_id)
           > (p_after_sort_key collate "C", p_after_friendship_id))
    order by sort_key, id
    limit c_page_size + 1
  ), ranked as (
    select page.*, row_number() over (order by sort_key, id) as rn from page
  )
  select
    coalesce(jsonb_agg(private.people_friendship_projection(r.fr, v_me) order by r.rn)
      filter (where r.rn <= c_page_size), '[]'::jsonb),
    count(*) > c_page_size,
    min(r.sort_key) filter (where r.rn = c_page_size),
    min(r.id::text) filter (where r.rn = c_page_size)
  into v_items, v_has_more, v_last_key, v_last_id
  from ranked r;

  return jsonb_build_object('items', v_items, 'next_cursor',
    case when v_has_more then jsonb_build_object('sort_key', v_last_key, 'id', v_last_id) end);
end;
$$;

-- Public facades (ADR-001 §2): security invoker one-liners with identical signatures and grants.
create or replace function public.request_friendship(p_public_profile_id uuid, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.request_friendship(p_public_profile_id, p_idempotency_key) $$;
create or replace function public.accept_friendship(p_friendship_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.accept_friendship(p_friendship_id) $$;
create or replace function public.reject_friendship(p_friendship_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.reject_friendship(p_friendship_id) $$;
create or replace function public.remove_friendship(p_friendship_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.remove_friendship(p_friendship_id) $$;
create or replace function public.list_my_friendships(
  p_view text default 'FRIENDS', p_after_sort_key text default null, p_after_friendship_id uuid default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_my_friendships(p_view, p_after_sort_key, p_after_friendship_id) $$;

revoke all on function
  private.people_friendship_projection(app.friendship, uuid),
  private.people_lock_my_friendship(uuid, uuid),
  private.people_respond_friendship(uuid, boolean),
  private.request_friendship(uuid, text), public.request_friendship(uuid, text),
  private.accept_friendship(uuid), public.accept_friendship(uuid),
  private.reject_friendship(uuid), public.reject_friendship(uuid),
  private.remove_friendship(uuid), public.remove_friendship(uuid),
  private.list_my_friendships(text, text, uuid), public.list_my_friendships(text, text, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  private.request_friendship(uuid, text), public.request_friendship(uuid, text),
  private.accept_friendship(uuid), public.accept_friendship(uuid),
  private.reject_friendship(uuid), public.reject_friendship(uuid),
  private.remove_friendship(uuid), public.remove_friendship(uuid),
  private.list_my_friendships(text, text, uuid), public.list_my_friendships(text, text, uuid)
to authenticated;
