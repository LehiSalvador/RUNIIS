-- P3-Q race-day API gaps (P3-AC-09, P3-AC-10). Closes the gaps P3-H found while wiring /scanner, the
-- Guardian desk and the Kit Center. Additive and backwards compatible: every function below is replaced
-- with `create or replace` under the same signature and return type, only adding keys to the jsonb it
-- already returned (grants are kept), plus one new read function.
--   D1  guardian display name + relationship_type on the participant view (scan GUARDIAN_VERIFICATION_REQUIRED
--       and the Guardian desk list). Minimum needed to verify in person; never email/phone/DOB/auth ids.
--   D2  kit_allocation_id, kit_definition_id and the ACTIVE (DELIVERED) kit_pickup_id on the admin participant
--       kit object and on the race-day participant search.
--   D3  edition list for scanner staff gated by PASS_SCAN, per Edition scope.
--   D6  a REJECTED guardian verification is FINAL (Master §21 defines no re-open; raceday_guardian_verify
--       already answers CONFLICT ALREADY_REJECTED): the list now says is_final=true and offers no actions.
--   D8  participant search also matches public_code (exact, case-insensitive).

-- ---------------------------------------------------------------------------------------------
-- D1: participant view (scan outcome + guardian desk row). `guardian` is only present for a minor whose
-- verification is not yet VERIFIED, i.e. exactly when staff must verify the person in front of them. The
-- name is the guardian's legal name (runner_profile.full_name), the one an ID document will show.
-- ---------------------------------------------------------------------------------------------
create or replace function private.raceday_participant_view(p_registration_id uuid, p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registration_id', r.registration_id,
    'registration_number', r.registration_number,
    'registration_status', r.status,
    'participant_kind', case when r.runner_profile_id is not null then 'PROFILE' else 'GUEST' end,
    'display_name', coalesce(cp.display_name, g.full_name),
    'avatar_object_key', a.public_object_key,
    'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
    'category', case when c.category_id is not null then jsonb_build_object('category_id', c.category_id, 'name', c.name) end,
    'is_minor', private.people_age_years(coalesce(rp.date_of_birth, g.date_of_birth),
      coalesce(private.people_edition_event_date(p_edition_id), private.people_today())) < 18,
    'guardian_state', case
      when private.people_age_years(coalesce(rp.date_of_birth, g.date_of_birth),
        coalesce(private.people_edition_event_date(p_edition_id), private.people_today())) >= 18 then null
      else coalesce(gv.status, 'PENDING') end,
    'guardian', case
      when private.people_age_years(coalesce(rp.date_of_birth, g.date_of_birth),
        coalesce(private.people_edition_event_date(p_edition_id), private.people_today())) < 18
        and coalesce(gv.status, 'PENDING') <> 'VERIFIED' and ga.guardian_assignment_id is not null
      then jsonb_build_object('display_name', gp.full_name, 'relationship_type', ga.relationship_type) end)
  from app.registration r
  join app.modality m on m.modality_id = r.modality_id
  left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
  left join app.community_profile cp on cp.runner_profile_id = r.runner_profile_id
  left join app.profile_image_asset a on a.profile_image_asset_id = cp.avatar_asset_id and a.status = 'APPROVED'
  left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
  left join app.registration_category_assignment rca on rca.registration_id = r.registration_id
  left join app.category c on c.category_id = rca.category_id
  left join app.guardian_event_verification gv on gv.registration_id = r.registration_id
  -- The assignment the verification row points at; before the row exists, the oldest live one, which is the
  -- same deterministic pick private.raceday_ensure_guardian_pending makes.
  left join app.guardian_assignment ga on ga.guardian_assignment_id = coalesce(gv.guardian_assignment_id, (
    select x.guardian_assignment_id
    from private.registration_active_guardian_assignments(r.runner_profile_id, r.guest_participant_id) x
    order by x.guardian_assignment_id
    limit 1))
  left join app.runner_profile gp on gp.runner_profile_id = ga.guardian_profile_id
  where r.registration_id = p_registration_id
$$;

-- ---------------------------------------------------------------------------------------------
-- D6: Guardian desk list. PENDING rows are actionable; REJECTED rows are final (no re-open in Master §21).
-- ---------------------------------------------------------------------------------------------
create or replace function private.raceday_list_guardian_verifications(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('GUARDIAN_VERIFY', p_edition_id);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'guardian_event_verification_id', gv.guardian_event_verification_id,
        'status', gv.status,
        'is_final', gv.status = 'REJECTED',
        'actions', case when gv.status = 'PENDING' then jsonb_build_array('VERIFY', 'REJECT') else '[]'::jsonb end,
        'created_at', gv.created_at,
        'participant', private.raceday_participant_view(gv.registration_id, p_edition_id))
      order by gv.created_at)
    from app.guardian_event_verification gv
    join app.registration r on r.registration_id = gv.registration_id
    where r.edition_id = p_edition_id and gv.status in ('PENDING', 'REJECTED')
    limit 200), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- D2: admin participant row (Master §172). The kit object gains the ids the size-change and the
-- pickup-reversal APIs need; `kit_pickup_id` is the DELIVERED pickup (the partial unique index
-- kit_pickup_delivered_uidx guarantees at most one) and is null when nothing is delivered.
-- ---------------------------------------------------------------------------------------------
create or replace function private.registration_participant_row(p_registration_id uuid, p_include_contact boolean)
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
      'status', ka.status, 'kit_variant_id', ka.kit_variant_id, 'variant_label', kv.label,
      'kit_allocation_id', ka.kit_allocation_id, 'kit_definition_id', ka.kit_definition_id,
      'kit_pickup_id', kp.kit_pickup_id) end,
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
  left join app.kit_pickup kp on kp.kit_allocation_id = ka.kit_allocation_id and kp.status = 'DELIVERED'
  left join app.guardian_event_verification gev on gev.registration_id = r.registration_id
  left join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  where r.registration_id = p_registration_id
$$;

-- ---------------------------------------------------------------------------------------------
-- D2 + D8: race-day participant search. Items gain `public_code` and a `kit` object with the ids the
-- kit desk needs; the query also matches the pass public_code exactly (case-insensitive), still
-- Edition-scoped, CONFIRMED-only, PARTICIPANT_LOOKUP-gated, rate-limited and audited as before.
-- ---------------------------------------------------------------------------------------------
create or replace function private.raceday_participant_search(p_edition_id uuid, p_query text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_query text := pg_catalog.btrim(coalesce(p_query, ''));
  v_norm text;
  v_code text;
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
  v_code := pg_catalog.upper(v_query);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'registration_id', r.registration_id,
        'participant_pass_id', pp.participant_pass_id,
        'public_code', pp.public_code,
        'registration_number', r.registration_number,
        'display_name', coalesce(cp.display_name, g.full_name),
        'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
        'guardian_state', case
          when private.people_age_years(coalesce(rp.date_of_birth, g.date_of_birth),
            coalesce(private.people_edition_event_date(p_edition_id), private.people_today())) >= 18 then null
          else coalesce(gv.status, 'PENDING') end,
        'kit', case when ka.kit_allocation_id is not null then jsonb_build_object(
          'kit_allocation_id', ka.kit_allocation_id, 'kit_definition_id', ka.kit_definition_id,
          'kit_variant_id', ka.kit_variant_id, 'variant_label', kv.label, 'status', ka.status,
          'kit_pickup_id', kp.kit_pickup_id) end)
      order by coalesce(cp.display_name, g.full_name))
    from app.registration r
    join app.modality m on m.modality_id = r.modality_id
    left join app.participant_pass pp on pp.registration_id = r.registration_id and pp.status = 'ACTIVE'
    left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
    left join app.community_profile cp on cp.runner_profile_id = r.runner_profile_id
    left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
    left join app.guardian_event_verification gv on gv.registration_id = r.registration_id
    left join app.kit_allocation ka on ka.registration_id = r.registration_id
    left join app.kit_variant kv on kv.kit_variant_id = ka.kit_variant_id
    left join app.kit_pickup kp on kp.kit_allocation_id = ka.kit_allocation_id and kp.status = 'DELIVERED'
    where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
      and (private.normalize_search_text(coalesce(cp.display_name, g.full_name)) like '%' || v_norm || '%'
        or r.registration_number ilike v_query || '%'
        or pp.public_code = v_code)
    limit 20), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- D3: Editions a scanner staff member may operate (PASS_SCAN, per Edition scope). The admin Editions
-- list is gated by EVENT_CONTENT_MANAGE, which CHECKIN does not hold, so it answers nothing for them.
-- Operable = already published or hidden-but-real (never DRAFT) and still to be run (SCHEDULED or
-- IN_PROGRESS; POSTPONED, FINISHED and CANCELED are not scannable). GLOBAL roles see every operable
-- Edition; EDITION-scoped roles only their own. Never locks; never mutates.
-- ---------------------------------------------------------------------------------------------
create function private.raceday_list_scanner_editions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  if not exists (
      select 1
      from app.staff_role_assignment sra
      join private.staff_permission sp on sp.role = sra.role and sp.action = 'PASS_SCAN'
      where sra.staff_member_id = private.current_staff_member_id() and sra.revoked_at is null) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;

  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'edition_id', s.edition_id,
        'name', s.name,
        'event_name', s.event_name,
        'date', s.local_date,
        'timezone', s.timezone,
        'state', s.execution_state,
        'publication_state', s.publication_state)
      order by s.local_date nulls last, s.created_at desc, s.edition_id)
    from (
      select e.edition_id, e.name, ev.name as event_name, e.timezone, e.execution_state, e.publication_state, e.created_at,
        (private.current_schedule(e.edition_id) ->> 'local_date') as local_date
      from app.edition e
      join app.event ev on ev.event_id = e.event_id
      where e.publication_state in ('PUBLISHED', 'HIDDEN')
        and e.execution_state in ('SCHEDULED', 'IN_PROGRESS')
        and private.has_permission('PASS_SCAN', e.edition_id)
      order by (private.current_schedule(e.edition_id) ->> 'local_date') nulls last, e.created_at desc, e.edition_id
      limit 100) s), '[]'::jsonb));
end;
$$;

create function public.raceday_list_scanner_editions()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.raceday_list_scanner_editions() $$;

revoke all on function
  private.raceday_list_scanner_editions(), public.raceday_list_scanner_editions()
from public, anon, authenticated, service_role;

grant execute on function
  private.raceday_list_scanner_editions(), public.raceday_list_scanner_editions()
to authenticated;
