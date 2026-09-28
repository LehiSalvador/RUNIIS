-- Race Day scanner: credential validation + EVENT_CHECKIN + MANUAL_VERIFY (T40, Master §21/§85/§90,
-- ADR-001 A1-A3, SEC-024/031/032). Every attempt is logged in app.participant_pass_scan, including unknown
-- passes; the response never depends on colour alone and mirrors the outcome enum verbatim (UX S190/S228).

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('raceday.scan', 240, 60, 'ACTOR', 'Master §179 Race Day scan per staff/station pre-check'),
  ('raceday.scan:cmd', 240, 60, 'ACTOR', 'Master §179 Race Day scan per staff/station (command)'),
  ('raceday.manual_verify:cmd', 60, 60, 'ACTOR', 'SEC-032 manual verify per staff (command)')
on conflict (scope) do nothing;

-- One row per token_hash (unique), so a scan_reference resolves to at most one pass; locks the pass row
-- for the rest of the transaction so two concurrent scans of the same token serialise (SEC-031).
create function private.raceday_lock_pass_by_scan(p_scan_reference text)
returns table (
  participant_pass_id uuid, credential_id uuid, credential_status text,
  registration_id uuid, registration_status text, edition_id uuid,
  runner_profile_id uuid, guest_participant_id uuid, modality_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select p.participant_pass_id, c.participant_pass_credential_id, c.status,
    r.registration_id, r.status, r.edition_id, r.runner_profile_id, r.guest_participant_id, r.modality_id
  from app.participant_pass_credential c
  join app.participant_pass p on p.participant_pass_id = c.participant_pass_id
  join app.registration r on r.registration_id = p.registration_id
  where c.token_hash = p_scan_reference
  for update of p;
end;
$$;

-- Participant minimal + registration status + guardian state (§174 response shape). NULL guardian_state
-- for adults. avatar_object_key only for an APPROVED image (SEC-031 "approved avatar reference").
create function private.raceday_participant_view(p_registration_id uuid, p_edition_id uuid)
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
      else coalesce(gv.status, 'PENDING') end)
  from app.registration r
  join app.modality m on m.modality_id = r.modality_id
  left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
  left join app.community_profile cp on cp.runner_profile_id = r.runner_profile_id
  left join app.profile_image_asset a on a.profile_image_asset_id = cp.avatar_asset_id and a.status = 'APPROVED'
  left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
  left join app.registration_category_assignment rca on rca.registration_id = r.registration_id
  left join app.category c on c.category_id = rca.category_id
  left join app.guardian_event_verification gv on gv.registration_id = r.registration_id
  where r.registration_id = p_registration_id
$$;

-- Ensures a PENDING guardian_event_verification row exists for a minor once required; picks the first
-- (oldest) live guardian assignment deterministically. Returns true when a row now exists to work with.
create function private.raceday_ensure_guardian_pending(p_registration_id uuid, p_runner_profile_id uuid, p_guest_participant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
begin
  if exists (select 1 from app.guardian_event_verification gv where gv.registration_id = p_registration_id) then
    return true;
  end if;
  select ga.guardian_assignment_id into v_assignment_id
  from private.registration_active_guardian_assignments(p_runner_profile_id, p_guest_participant_id) ga
  order by ga.guardian_assignment_id
  limit 1;
  if v_assignment_id is null then
    return false;
  end if;
  insert into app.guardian_event_verification (registration_id, guardian_assignment_id, status)
  values (p_registration_id, v_assignment_id, 'PENDING')
  on conflict (registration_id) do nothing;
  return true;
end;
$$;

-- SEC-032: repeated UNKNOWN_PASS from the same staff/station is an integrity signal, not just noise.
-- Deterministic daily task_key so a burst produces one AdminTask, updated in place.
create function private.raceday_flag_unknown_pass_burst(p_edition_id uuid, p_staff_member_id uuid, p_station_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_task_key text;
begin
  select count(*) into v_count
  from app.participant_pass_scan s
  where s.edition_id = p_edition_id and s.staff_member_id = p_staff_member_id and s.outcome = 'UNKNOWN_PASS'
    and s.scanned_at > pg_catalog.now() - interval '5 minutes';
  if v_count < 5 then
    return;
  end if;
  v_task_key := 'raceday_unknown_pass_burst:' || p_edition_id || ':' || coalesce(p_station_key, p_staff_member_id::text)
    || ':' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD');
  insert into app.admin_task (task_key, category, scope_type, scope_id, edition_id, related_entity_type, related_entity_id,
    title, description, priority, blocking_level, status, source_rule, metadata)
  values (v_task_key, 'RACE_DAY', 'EDITION', p_edition_id, p_edition_id, 'staff_member', p_staff_member_id,
    'Ráfaga de códigos no reconocidos',
    'Múltiples escaneos UNKNOWN_PASS de la misma estación en pocos minutos: posible intento de acceso indebido.',
    'HIGH', 'ACTION_REQUIRED', 'OPEN', 'raceday_unknown_pass_burst',
    jsonb_build_object('station_key', p_station_key, 'staff_member_id', p_staff_member_id, 'count', v_count))
  on conflict (task_key) do update
    set metadata = jsonb_set(app.admin_task.metadata, '{count}', to_jsonb(v_count)), updated_at = pg_catalog.now()
    where app.admin_task.status not in ('RESOLVED', 'WAIVED');
end;
$$;

-- EVENT_CHECKIN via QR scan (Master §85/§21/§90). p_scan_reference = sha256 hex of the token text
-- (lib/server/crypto/pass-credential.ts hashPassToken); the plaintext token never reaches Postgres.
-- Always returns 200 with an `outcome`: one full-screen state per Master §85, never a thrown error for a
-- scan-shaped rejection (UNKNOWN_PASS, WRONG_EVENT, ...). Real errors (auth/permission/rate limit/malformed
-- input) still raise, since there is nothing safe to log in those cases.
create function private.raceday_check_in_scan(p_edition_id uuid, p_scan_reference text, p_station_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_tz text;
  v_lock record;
  v_outcome text;
  v_scan_id uuid;
  v_is_minor boolean;
  v_guardian_status text;
  v_sport_date date;
  v_result jsonb;
begin
  v_staff := private.require_permission('PASS_SCAN', p_edition_id);
  perform private.consume_policy_rate_limit('raceday.scan:cmd', auth.uid()::text);

  select e.timezone into v_tz from app.edition e where e.edition_id = p_edition_id;
  if v_tz is null then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'edition_id'));
  end if;
  if coalesce(p_scan_reference, '') !~ '^[0-9a-f]{64}$' then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'credential_token'));
  end if;
  if p_station_key is not null and pg_catalog.char_length(p_station_key) > 100 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'station_key'));
  end if;

  select * into v_lock from private.raceday_lock_pass_by_scan(p_scan_reference);

  if v_lock.participant_pass_id is null then
    v_outcome := 'UNKNOWN_PASS';
  elsif v_lock.credential_status = 'REVOKED' then
    v_outcome := 'REVOKED_CREDENTIAL';
  elsif v_lock.credential_status = 'REPLACED' then
    v_outcome := 'REPLACED_CREDENTIAL';
  elsif v_lock.registration_status = 'CANCELED' then
    v_outcome := 'CANCELED_REGISTRATION';
  elsif v_lock.registration_status <> 'CONFIRMED' then
    v_outcome := 'REGISTRATION_NOT_CONFIRMED';
  elsif v_lock.edition_id <> p_edition_id then
    v_outcome := 'WRONG_EVENT';
  else
    v_sport_date := private.people_edition_event_date(p_edition_id);
    v_is_minor := private.people_age_years(
      coalesce((select rp.date_of_birth from app.runner_profile rp where rp.runner_profile_id = v_lock.runner_profile_id),
               (select g.date_of_birth from app.guest_participant g where g.guest_participant_id = v_lock.guest_participant_id)),
      coalesce(v_sport_date, private.people_today())) < 18;

    if v_is_minor then
      if not private.raceday_ensure_guardian_pending(v_lock.registration_id, v_lock.runner_profile_id, v_lock.guest_participant_id) then
        v_outcome := 'OTHER_REVIEW';
      else
        select gv.status into v_guardian_status from app.guardian_event_verification gv where gv.registration_id = v_lock.registration_id;
        if v_guardian_status = 'REJECTED' then
          v_outcome := 'OTHER_REVIEW';
        elsif v_guardian_status <> 'VERIFIED' then
          v_outcome := 'GUARDIAN_VERIFICATION_REQUIRED';
        end if;
      end if;
    end if;

    -- NOT_YET_ALLOWED window: opens the day before the sport date, edition-local midnight (Master doesn't
    -- pin a magnitude; documented default). Unknown date fails open (no restriction) rather than blocking
    -- every station because the schedule is not yet set.
    if v_outcome is null and v_sport_date is not null
       and pg_catalog.now() < ((v_sport_date - 1)::timestamp at time zone v_tz) then
      v_outcome := 'NOT_YET_ALLOWED';
    end if;

    if v_outcome is null and exists (
        select 1 from app.attendance_checkin ac
        where ac.registration_id = v_lock.registration_id and ac.status = 'VERIFIED_PRESENT') then
      v_outcome := 'ALREADY_CHECKED_IN';
    end if;

    if v_outcome is null then
      v_outcome := 'VALID';
      insert into app.attendance_checkin
        (edition_id, registration_id, participant_pass_credential_id, status, verification_method, checked_in_by_staff_id, station_key)
      values (p_edition_id, v_lock.registration_id, v_lock.credential_id, 'VERIFIED_PRESENT', 'QR_SCAN', v_staff, p_station_key);
      perform private.audit('EVENT_CHECKIN_RECORDED', 'registration', v_lock.registration_id, p_edition_id,
        null, jsonb_build_object('attendance_status', 'VERIFIED_PRESENT', 'verification_method', 'QR_SCAN'));
      perform private.enqueue_outbox('AttendanceCheckedIn', 'Registration', v_lock.registration_id,
        'AttendanceCheckedIn:' || v_lock.registration_id,
        jsonb_build_object('registration_id', v_lock.registration_id, 'edition_id', p_edition_id));
    end if;
  end if;

  insert into app.participant_pass_scan
    (participant_pass_id, participant_pass_credential_id, edition_id, operation_type, outcome, staff_member_id, station_key)
  values (v_lock.participant_pass_id, v_lock.credential_id, p_edition_id, 'EVENT_CHECKIN', v_outcome, v_staff, p_station_key)
  returning participant_pass_scan_id into v_scan_id;

  if v_outcome = 'UNKNOWN_PASS' then
    perform private.raceday_flag_unknown_pass_burst(p_edition_id, v_staff, p_station_key);
  end if;

  v_result := jsonb_build_object(
    'participant_pass_scan_id', v_scan_id, 'outcome', v_outcome, 'scanned_at', pg_catalog.now(),
    'participant', case when v_lock.registration_id is not null
      then private.raceday_participant_view(v_lock.registration_id, p_edition_id) end);
  return v_result;
end;
$$;

-- MANUAL_VERIFY (SEC-032): staff already resolved the participant via participant_search and records a
-- reasoned manual check-in when the QR is unavailable. Shares every check but the credential lookup.
create function private.raceday_manual_verify(
  p_edition_id uuid, p_participant_pass_id uuid, p_reason text, p_station_key text default null,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_tz text;
  v_idem jsonb;
  v_reason text := pg_catalog.btrim(p_reason);
  v_pass record;
  v_outcome text;
  v_scan_id uuid;
  v_is_minor boolean;
  v_guardian_status text;
  v_sport_date date;
  v_result jsonb;
begin
  v_staff := private.require_permission('PASS_SCAN', p_edition_id);
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  select e.timezone into v_tz from app.edition e where e.edition_id = p_edition_id;
  if v_tz is null then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'edition_id'));
  end if;
  perform private.consume_policy_rate_limit('raceday.manual_verify:cmd', auth.uid()::text);

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('raceday.manual_verify', p_participant_pass_id::text, p_idempotency_key,
      jsonb_build_object('participant_pass_id', p_participant_pass_id, 'edition_id', p_edition_id, 'reason', v_reason));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  select p.participant_pass_id, c.participant_pass_credential_id as credential_id, r.registration_id,
    r.status as registration_status, r.edition_id, r.runner_profile_id, r.guest_participant_id
  into v_pass
  from app.participant_pass p
  join app.registration r on r.registration_id = p.registration_id
  left join app.participant_pass_credential c on c.participant_pass_id = p.participant_pass_id and c.status = 'ACTIVE'
  where p.participant_pass_id = p_participant_pass_id
  for update of p;

  if v_pass.participant_pass_id is null then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'participant_pass_id'));
  end if;

  if v_pass.registration_status = 'CANCELED' then
    v_outcome := 'CANCELED_REGISTRATION';
  elsif v_pass.registration_status <> 'CONFIRMED' then
    v_outcome := 'REGISTRATION_NOT_CONFIRMED';
  elsif v_pass.edition_id <> p_edition_id then
    v_outcome := 'WRONG_EVENT';
  else
    v_sport_date := private.people_edition_event_date(p_edition_id);
    v_is_minor := private.people_age_years(
      coalesce((select rp.date_of_birth from app.runner_profile rp where rp.runner_profile_id = v_pass.runner_profile_id),
               (select g.date_of_birth from app.guest_participant g where g.guest_participant_id = v_pass.guest_participant_id)),
      coalesce(v_sport_date, private.people_today())) < 18;

    if v_is_minor then
      if not private.raceday_ensure_guardian_pending(v_pass.registration_id, v_pass.runner_profile_id, v_pass.guest_participant_id) then
        v_outcome := 'OTHER_REVIEW';
      else
        select gv.status into v_guardian_status from app.guardian_event_verification gv where gv.registration_id = v_pass.registration_id;
        if v_guardian_status = 'REJECTED' then
          v_outcome := 'OTHER_REVIEW';
        elsif v_guardian_status <> 'VERIFIED' then
          v_outcome := 'GUARDIAN_VERIFICATION_REQUIRED';
        end if;
      end if;
    end if;

    if v_outcome is null and v_sport_date is not null
       and pg_catalog.now() < ((v_sport_date - 1)::timestamp at time zone v_tz) then
      v_outcome := 'NOT_YET_ALLOWED';
    end if;
    if v_outcome is null and exists (
        select 1 from app.attendance_checkin ac
        where ac.registration_id = v_pass.registration_id and ac.status = 'VERIFIED_PRESENT') then
      v_outcome := 'ALREADY_CHECKED_IN';
    end if;
    if v_outcome is null then
      v_outcome := 'VALID';
      insert into app.attendance_checkin
        (edition_id, registration_id, participant_pass_credential_id, status, verification_method, checked_in_by_staff_id, station_key)
      values (p_edition_id, v_pass.registration_id, v_pass.credential_id, 'VERIFIED_PRESENT', 'MANUAL', v_staff, p_station_key);
      perform private.audit('EVENT_CHECKIN_RECORDED', 'registration', v_pass.registration_id, p_edition_id,
        null, jsonb_build_object('attendance_status', 'VERIFIED_PRESENT', 'verification_method', 'MANUAL'), v_reason);
      perform private.enqueue_outbox('AttendanceCheckedIn', 'Registration', v_pass.registration_id,
        'AttendanceCheckedIn:' || v_pass.registration_id,
        jsonb_build_object('registration_id', v_pass.registration_id, 'edition_id', p_edition_id));
    end if;
  end if;

  insert into app.participant_pass_scan
    (participant_pass_id, participant_pass_credential_id, edition_id, operation_type, outcome, staff_member_id, station_key)
  values (v_pass.participant_pass_id, v_pass.credential_id, p_edition_id, 'MANUAL_VERIFY', v_outcome, v_staff, p_station_key)
  returning participant_pass_scan_id into v_scan_id;

  v_result := jsonb_build_object(
    'participant_pass_scan_id', v_scan_id, 'outcome', v_outcome, 'scanned_at', pg_catalog.now(),
    'participant', private.raceday_participant_view(v_pass.registration_id, p_edition_id));
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

create function public.raceday_check_in_scan(p_edition_id uuid, p_scan_reference text, p_station_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.raceday_check_in_scan(p_edition_id, p_scan_reference, p_station_key) $$;
create function public.raceday_manual_verify(
  p_edition_id uuid, p_participant_pass_id uuid, p_reason text, p_station_key text default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.raceday_manual_verify(p_edition_id, p_participant_pass_id, p_reason, p_station_key, p_idempotency_key) $$;

revoke all on function
  private.raceday_lock_pass_by_scan(text), private.raceday_participant_view(uuid, uuid),
  private.raceday_ensure_guardian_pending(uuid, uuid, uuid), private.raceday_flag_unknown_pass_burst(uuid, uuid, text),
  private.raceday_check_in_scan(uuid, text, text), public.raceday_check_in_scan(uuid, text, text),
  private.raceday_manual_verify(uuid, uuid, text, text, text), public.raceday_manual_verify(uuid, uuid, text, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.raceday_check_in_scan(uuid, text, text), public.raceday_check_in_scan(uuid, text, text),
  private.raceday_manual_verify(uuid, uuid, text, text, text), public.raceday_manual_verify(uuid, uuid, text, text, text)
to authenticated;
