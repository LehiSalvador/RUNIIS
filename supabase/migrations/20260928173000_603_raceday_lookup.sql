-- Manual participant lookup for Race Day staff (SEC-024): >=3 chars, Edition-scoped, minimal fields only
-- (name + registration_number + modality + guardian state), rate-limited and audited. Feeds MANUAL_VERIFY
-- and kit pickup's manual/third-party path (both take the resolved registration_id/participant_pass_id).

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('raceday.participant_search:cmd', 60, 600, 'ACTOR', 'SEC-024 Race Day participant lookup per staff (command)')
on conflict (scope) do nothing;

create function private.raceday_participant_search(p_edition_id uuid, p_query text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_query text := pg_catalog.btrim(coalesce(p_query, ''));
  v_norm text;
begin
  v_staff := private.require_permission('PARTICIPANT_LOOKUP', p_edition_id);
  if pg_catalog.char_length(v_query) < 3 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'q', 'reason', 'min_length_3'));
  end if;
  perform private.consume_policy_rate_limit('raceday.participant_search:cmd', auth.uid()::text);
  -- SEC-024 audit: the query text itself is not retained, only that a lookup happened and its length.
  perform private.audit('PARTICIPANT_LOOKUP_PERFORMED', 'edition', p_edition_id, p_edition_id,
    null, jsonb_build_object('query_length', pg_catalog.char_length(v_query)));

  v_norm := private.normalize_search_text(v_query);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'registration_id', r.registration_id,
        'participant_pass_id', pp.participant_pass_id,
        'registration_number', r.registration_number,
        'display_name', coalesce(cp.display_name, g.full_name),
        'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
        'guardian_state', case
          when private.people_age_years(coalesce(rp.date_of_birth, g.date_of_birth),
            coalesce(private.people_edition_event_date(p_edition_id), private.people_today())) >= 18 then null
          else coalesce(gv.status, 'PENDING') end)
      order by coalesce(cp.display_name, g.full_name))
    from app.registration r
    join app.modality m on m.modality_id = r.modality_id
    left join app.participant_pass pp on pp.registration_id = r.registration_id and pp.status = 'ACTIVE'
    left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
    left join app.community_profile cp on cp.runner_profile_id = r.runner_profile_id
    left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
    left join app.guardian_event_verification gv on gv.registration_id = r.registration_id
    where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
      and (private.normalize_search_text(coalesce(cp.display_name, g.full_name)) like '%' || v_norm || '%'
        or r.registration_number ilike v_query || '%')
    limit 20), '[]'::jsonb));
end;
$$;

create function public.raceday_participant_search(p_edition_id uuid, p_query text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.raceday_participant_search(p_edition_id, p_query) $$;

revoke all on function
  private.raceday_participant_search(uuid, text), public.raceday_participant_search(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.raceday_participant_search(uuid, text), public.raceday_participant_search(uuid, text)
to authenticated;
