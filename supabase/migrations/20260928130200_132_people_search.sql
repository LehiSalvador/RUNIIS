-- People search (Master §23, §121, §179; ADR-001 A10; SEC-008/120).
-- Adults only (minors are never searchable), visible + searchable, READY + ACTIVE, not blocked.
-- Response keys are an allowlist: never DOB, email, phone, emergency, guardian or auth ids.

create or replace function private.search_people(
  p_query text, p_after_sort_key text default null, p_after_public_profile_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  c_page_size constant integer := 20;
  v_query text := private.normalize_search_text(p_query);
  v_pattern text;
  v_adult_born_before date := (private.people_today() - interval '18 years')::date;
  v_items jsonb;
  v_has_more boolean;
  v_last_key text;
  v_last_id uuid;
begin
  if v_query is null or char_length(v_query) < 2 or char_length(v_query) > 80 then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "q", "reason": "length"}');
  end if;
  if (p_after_sort_key is null) <> (p_after_public_profile_id is null) then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "cursor", "reason": "invalid_cursor"}');
  end if;
  perform private.consume_policy_rate_limit('people.search:cmd', auth.uid()::text);

  v_pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with page as (
    select cp.runner_profile_id, cp.public_profile_id, cp.display_name, cp.competition_status, cp.avatar_asset_id,
      cp.verified_distance_projection_m, cp.verified_participation_count,
      private.normalize_search_text(cp.display_name) collate "C" as sort_key
    from app.community_profile cp
    join app.runner_profile rp on rp.runner_profile_id = cp.runner_profile_id
    where cp.is_visible
      and cp.is_searchable
      and cp.competition_status <> 'MINOR_NONCOMPETITIVE'
      and rp.profile_readiness = 'READY'
      and rp.account_state = 'ACTIVE'
      and rp.date_of_birth <= v_adult_born_before
      and rp.runner_profile_id <> v_me
      and (private.normalize_search_text(cp.display_name) like v_pattern or rp.search_name like v_pattern)
      and not exists (select 1 from private.blocked_identity b where b.runner_profile_id = rp.runner_profile_id and b.active)
      and (p_after_sort_key is null
        or (private.normalize_search_text(cp.display_name) collate "C", cp.public_profile_id)
           > (p_after_sort_key collate "C", p_after_public_profile_id))
    order by sort_key, cp.public_profile_id
    limit c_page_size + 1
  ), ranked as (
    select page.*, row_number() over (order by sort_key, public_profile_id) as rn from page
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
        'public_profile_id', r.public_profile_id,
        'display_name', r.display_name,
        'avatar_object_key', (select a.public_object_key from app.profile_image_asset a
                              where a.profile_image_asset_id = r.avatar_asset_id and a.status = 'APPROVED'),
        -- Public km/achievements only for competitively ELIGIBLE profiles.
        'public_stats', case when r.competition_status = 'ELIGIBLE' then jsonb_build_object(
          'verified_distance_m', r.verified_distance_projection_m,
          'verified_participation_count', r.verified_participation_count,
          'achievement_count', (select count(*) from app.achievement_grant g
                                where g.runner_profile_id = r.runner_profile_id and g.status = 'ACTIVE')) end,
        'friendship', coalesce(
          (select jsonb_build_object('friendship_id', f.friendship_id, 'state',
              case when f.status = 'ACCEPTED' then 'FRIENDS'
                   when f.requester_profile_id = v_me then 'PENDING_OUTGOING'
                   else 'PENDING_INCOMING' end)
           from app.friendship f
           where least(f.requester_profile_id, f.addressee_profile_id) = least(v_me, r.runner_profile_id)
             and greatest(f.requester_profile_id, f.addressee_profile_id) = greatest(v_me, r.runner_profile_id)
             and f.status in ('PENDING', 'ACCEPTED')),
          jsonb_build_object('friendship_id', null, 'state', 'NONE'))
      ) order by r.rn) filter (where r.rn <= c_page_size), '[]'::jsonb),
    count(*) > c_page_size,
    min(r.sort_key) filter (where r.rn = c_page_size),
    min(r.public_profile_id::text) filter (where r.rn = c_page_size)
  into v_items, v_has_more, v_last_key, v_last_id
  from ranked r;

  return jsonb_build_object('items', v_items, 'next_cursor',
    case when v_has_more then jsonb_build_object('sort_key', v_last_key, 'id', v_last_id) end);
end;
$$;

create or replace function public.search_people(
  p_query text, p_after_sort_key text default null, p_after_public_profile_id uuid default null)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.search_people(p_query, p_after_sort_key, p_after_public_profile_id) $$;

revoke all on function private.search_people(text, text, uuid), public.search_people(text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.search_people(text, text, uuid), public.search_people(text, text, uuid)
  to authenticated;
