-- P2-G3: edition-scoped pending actions for a guardian before any request exists (Master §19-21, §24, §124).
--
-- Gap closed (P2-G2 DISCOVERY-1): list_my_pending_actions(p_edition_id) only added the caller's own SELF
-- acceptance when no request existed. A FREE request that includes a minor Guest (only its owner can include
-- it) is refused with LEGAL_ACCEPTANCE_REQUIRED / PARTICIPANT_ACCEPTANCE_PENDING until the ACTIVE guardian
-- accepts, but that guardian (a different account) was listed the minor only once a request existed, so the
-- owner was blocked with no path forward.
--
-- Now, with p_edition_id on a registrable Edition, the caller also gets one item per minor they are the ACTIVE
-- guardian of (PROFILE minors and Guests, whoever owns the Guest) that can take part in the Edition (15-17 on the
-- event date, available profile / ACTIVE Guest) and still lacks required event documents. Authorisation is the
-- same ACTIVE GuardianAssignment rule accept_edition_documents enforces (private.registration_active_guardian_assignments).
-- Response shape unchanged (same item/subject shapes); request-based items and the SELF item are untouched and a
-- minor already listed through a pending request is not repeated. Nothing is accepted automatically.

create or replace function private.list_my_pending_actions(p_edition_id uuid default null)
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
  v_registrable boolean := false;
  v_event_date date;
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

  if p_edition_id is not null then
    v_registrable := exists (
      select 1 from app.edition e
      where e.edition_id = p_edition_id and e.publication_state = 'PUBLISHED' and e.execution_state = 'SCHEDULED'
        and e.registration_state = 'OPEN');
  end if;

  if v_registrable
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

  -- P2-G3: wards of the caller (ACTIVE guardian) for this Edition, before any request exists.
  if v_registrable then
    v_event_date := coalesce(private.people_edition_event_date(p_edition_id), private.people_today());
    v_items := v_items || coalesce((
      select jsonb_agg(w.item order by w.sort_name, w.sort_id)
      from (
        select
          jsonb_build_object(
            'action_type', 'LEGAL_ACCEPTANCE_REQUIRED',
            'edition', jsonb_build_object('edition_id', e.edition_id, 'name', e.name, 'slug', e.slug),
            'subject', case when ward.runner_profile_id is not null
              then jsonb_build_object('kind', 'MINOR_PROFILE', 'public_profile_id', ward.public_profile_id,
                'display_name', ward.display_name)
              else jsonb_build_object('kind', 'MINOR_GUEST', 'guest_participant_id', ward.guest_participant_id,
                'display_name', ward.display_name) end,
            'documents', private.registration_documents_json(e.edition_id, ward.missing)) as item,
          private.normalize_search_text(coalesce(ward.display_name, '')) collate "C" as sort_name,
          coalesce(ward.runner_profile_id, ward.guest_participant_id) as sort_id
        from app.edition e
        cross join lateral (
          select w1.*, private.registration_missing_documents(p_edition_id, w1.runner_profile_id, w1.guest_participant_id, true) as missing
          from (
            select ga.minor_runner_profile_id as runner_profile_id, null::uuid as guest_participant_id,
              cp.public_profile_id, cp.display_name, rp.date_of_birth, private.people_profile_available(rp.runner_profile_id) as usable
            from app.guardian_assignment ga
            join app.runner_profile rp on rp.runner_profile_id = ga.minor_runner_profile_id
            join app.community_profile cp on cp.runner_profile_id = rp.runner_profile_id
            where ga.guardian_profile_id = v_me and ga.status = 'ACTIVE' and ga.minor_runner_profile_id is not null
            union all
            select null::uuid, ga.minor_guest_participant_id, null::uuid, gp.full_name, gp.date_of_birth, gp.status = 'ACTIVE'
            from app.guardian_assignment ga
            join app.guest_participant gp on gp.guest_participant_id = ga.minor_guest_participant_id
            where ga.guardian_profile_id = v_me and ga.status = 'ACTIVE' and ga.minor_guest_participant_id is not null
          ) w1
          -- Same acceptor rule as accept_edition_documents (ACTIVE assignment, adult available guardian).
          where w1.usable
            and exists (select 1 from private.registration_active_guardian_assignments(w1.runner_profile_id, w1.guest_participant_id) g
                        where g.guardian_profile_id = v_me)
            and private.people_age_years(w1.date_of_birth, v_event_date) between 15 and 17
        ) ward
        where e.edition_id = p_edition_id
          and pg_catalog.cardinality(ward.missing) > 0
          -- Already listed through a pending request: do not repeat the minor.
          and not exists (
            select 1 from jsonb_array_elements(v_items) x
            where x -> 'edition' ->> 'edition_id' = p_edition_id::text
              and ((ward.runner_profile_id is not null and x -> 'subject' ->> 'kind' = 'MINOR_PROFILE'
                    and x -> 'subject' ->> 'public_profile_id' = ward.public_profile_id::text)
                or (ward.guest_participant_id is not null and x -> 'subject' ->> 'kind' = 'MINOR_GUEST'
                    and x -> 'subject' ->> 'guest_participant_id' = ward.guest_participant_id::text)))
      ) w), '[]'::jsonb);
  end if;
  return jsonb_build_object('items', v_items);
end;
$$;
