-- Participant inclusion inputs for registration (Master §19, §24, §65 participant rows, §121).
-- Called by T34 inside its create/confirm transaction, after its own Edition/capacity locks: the
-- rows it reads (friendship, guest, guardian assignment) are taken FOR SHARE so a concurrent
-- remove/archive/revoke waits for that transaction. Internal only: no API grant.
--
-- p_kind: 'PROFILE' (p_runner_profile_id) or 'GUEST' (p_guest_participant_id).
-- p_buyer_profile_id defaults to the caller's profile; staff-side revalidation passes the request buyer.
-- Returns {eligible, reasons[], client_reasons[], participant_kind, is_minor, age_at_event,
--          event_date, age_basis, guardian_assignment_id}.
--  reasons: exact internal codes (PARTICIPANT_NOT_FOUND, PROFILE_NOT_READY, ACCOUNT_BANNED,
--   IDENTITY_LOCKED, ACCOUNT_DEACTIVATED, NOT_SELF_OR_FRIEND, GUEST_ARCHIVED, UNDER_MIN_AGE,
--   GUARDIAN_REQUIRED, EDITION_NOT_FOUND).
--  client_reasons: the buyer-safe subset; another person's account state collapses to
--   PARTICIPANT_UNAVAILABLE (Master §121 non-disclosure). age_at_event is for category derivation
--   and must not be shown to the buyer for Friends.
create or replace function private.participant_inclusion_check(
  p_edition_id uuid, p_kind text, p_runner_profile_id uuid, p_guest_participant_id uuid,
  p_buyer_profile_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := coalesce(p_buyer_profile_id, private.current_profile_id());
  v_event_date date;
  v_age_basis text := 'EVENT_DATE';
  v_dob date;
  v_age integer;
  v_reasons text[] := '{}';
  v_client text[] := '{}';
  v_guardian_assignment_id uuid;
  v_profile app.runner_profile;
  v_guest app.guest_participant;
  v_is_self boolean := false;
begin
  if v_buyer is null then
    perform private.raise_domain_error('AUTH_REQUIRED');
  end if;
  if p_kind not in ('PROFILE', 'GUEST') or p_kind is null
     or (p_kind = 'PROFILE' and (p_runner_profile_id is null or p_guest_participant_id is not null))
     or (p_kind = 'GUEST' and (p_guest_participant_id is null or p_runner_profile_id is not null)) then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "participant", "reason": "invalid"}');
  end if;

  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    v_reasons := v_reasons || 'EDITION_NOT_FOUND'::text;
  end if;
  v_event_date := private.people_edition_event_date(p_edition_id);
  if v_event_date is null then
    v_event_date := private.people_today();
    v_age_basis := 'TODAY';
  end if;

  if p_kind = 'PROFILE' then
    select * into v_profile from app.runner_profile rp where rp.runner_profile_id = p_runner_profile_id for share;
    if not found then
      return jsonb_build_object('eligible', false, 'reasons', jsonb_build_array('PARTICIPANT_NOT_FOUND'),
        'client_reasons', jsonb_build_array('PARTICIPANT_UNAVAILABLE'), 'participant_kind', p_kind,
        'is_minor', null, 'age_at_event', null, 'event_date', v_event_date, 'age_basis', v_age_basis,
        'guardian_assignment_id', null);
    end if;
    v_is_self := v_profile.runner_profile_id = v_buyer;
    v_dob := v_profile.date_of_birth;

    if v_profile.profile_readiness <> 'READY' then
      v_reasons := v_reasons || 'PROFILE_NOT_READY'::text;
    end if;
    if v_profile.account_state = 'BANNED'
       or exists (select 1 from private.blocked_identity b where b.runner_profile_id = v_profile.runner_profile_id and b.active) then
      v_reasons := v_reasons || 'ACCOUNT_BANNED'::text;
    elsif v_profile.account_state = 'IDENTITY_LOCKED' then
      v_reasons := v_reasons || 'IDENTITY_LOCKED'::text;
    elsif v_profile.account_state = 'DEACTIVATED' then
      v_reasons := v_reasons || 'ACCOUNT_DEACTIVATED'::text;
    end if;
    if not v_is_self then
      perform 1 from app.friendship f
      where f.status = 'ACCEPTED'
        and least(f.requester_profile_id, f.addressee_profile_id) = least(v_buyer, v_profile.runner_profile_id)
        and greatest(f.requester_profile_id, f.addressee_profile_id) = greatest(v_buyer, v_profile.runner_profile_id)
      for share;
      if not found then
        v_reasons := v_reasons || 'NOT_SELF_OR_FRIEND'::text;
      end if;
    end if;
  else
    select * into v_guest from app.guest_participant g
    where g.guest_participant_id = p_guest_participant_id and g.owner_profile_id = v_buyer
    for share;
    if not found then
      return jsonb_build_object('eligible', false, 'reasons', jsonb_build_array('PARTICIPANT_NOT_FOUND'),
        'client_reasons', jsonb_build_array('PARTICIPANT_NOT_FOUND'), 'participant_kind', p_kind,
        'is_minor', null, 'age_at_event', null, 'event_date', v_event_date, 'age_basis', v_age_basis,
        'guardian_assignment_id', null);
    end if;
    v_dob := v_guest.date_of_birth;
    if v_guest.status <> 'ACTIVE' then
      v_reasons := v_reasons || 'GUEST_ARCHIVED'::text;
    end if;
  end if;

  v_age := private.people_age_years(v_dob, v_event_date);
  if v_age is null or v_age < 15 then
    v_reasons := v_reasons || 'UNDER_MIN_AGE'::text;
  elsif v_age < 18 then
    select ga.guardian_assignment_id into v_guardian_assignment_id
    from app.guardian_assignment ga
    where ga.status = 'ACTIVE'
      and (ga.minor_runner_profile_id = p_runner_profile_id or ga.minor_guest_participant_id = p_guest_participant_id)
      and private.people_profile_available(ga.guardian_profile_id)
      and private.people_profile_age(ga.guardian_profile_id) >= 18
    order by ga.activated_at, ga.guardian_assignment_id
    limit 1
    for share of ga;
    if v_guardian_assignment_id is null then
      v_reasons := v_reasons || 'GUARDIAN_REQUIRED'::text;
    end if;
  end if;

  select coalesce(array_agg(distinct case
      when r in ('PROFILE_NOT_READY', 'ACCOUNT_BANNED', 'IDENTITY_LOCKED', 'ACCOUNT_DEACTIVATED')
        then case when v_is_self then r else 'PARTICIPANT_UNAVAILABLE' end
      else r end), '{}')
  into v_client
  from unnest(v_reasons) r;

  return jsonb_build_object(
    'eligible', cardinality(v_reasons) = 0,
    'reasons', to_jsonb(v_reasons),
    'client_reasons', to_jsonb(v_client),
    'participant_kind', p_kind,
    'is_minor', v_age is not null and v_age < 18,
    'age_at_event', v_age,
    'event_date', v_event_date,
    'age_basis', v_age_basis,
    'guardian_assignment_id', v_guardian_assignment_id);
end;
$$;

revoke all on function private.participant_inclusion_check(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
