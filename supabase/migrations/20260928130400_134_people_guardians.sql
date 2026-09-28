-- GuardianAssignment commands and reads (Master §19-20, §158; ADR-001 A10; SEC-010/014/120).
-- PENDING -> ACTIVE only when the party that did not open the assignment confirms in-app:
--  * minor RunnerProfile: opened by the minor (guardian confirms) or by the adult (minor confirms);
--  * minor Guest: opened by the owner; ACTIVE at once when the owner is the guardian, otherwise the
--    designated adult Friend confirms.
-- Revocation: either party, the guest owner, or staff with GUARDIAN_ASSIGNMENT_MANAGE.
-- Each party only ever sees the counterpart's public card (guest: its name), never DOB/contact data.

create or replace function private.people_profile_age(p_runner_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select private.people_age_years(rp.date_of_birth, private.people_today())
  from app.runner_profile rp where rp.runner_profile_id = p_runner_profile_id
$$;

create or replace function private.people_guardian_confirmer(p_assignment app.guardian_assignment)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_assignment.minor_guest_participant_id is null
         and p_assignment.requested_by_profile_id = p_assignment.guardian_profile_id
      then p_assignment.minor_runner_profile_id
    else p_assignment.guardian_profile_id end
$$;

create or replace function private.people_guardian_projection(p_assignment app.guardian_assignment, p_me uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_guest_name text;
  v_roles text[] := '{}';
  v_confirmer uuid := private.people_guardian_confirmer(p_assignment);
begin
  if p_assignment.minor_guest_participant_id is not null then
    select g.owner_profile_id, g.full_name into v_owner, v_guest_name
    from app.guest_participant g where g.guest_participant_id = p_assignment.minor_guest_participant_id;
  end if;
  if p_assignment.minor_runner_profile_id = p_me then v_roles := v_roles || 'MINOR'::text; end if;
  if p_assignment.guardian_profile_id = p_me then v_roles := v_roles || 'GUARDIAN'::text; end if;
  if v_owner = p_me then v_roles := v_roles || 'GUEST_OWNER'::text; end if;

  return jsonb_build_object(
    'guardian_assignment_id', p_assignment.guardian_assignment_id,
    'minor_kind', case when p_assignment.minor_guest_participant_id is null then 'RUNNER' else 'GUEST' end,
    'my_roles', to_jsonb(v_roles),
    'status', p_assignment.status,
    'relationship_type', p_assignment.relationship_type,
    'awaiting_confirmation_by', case when p_assignment.status = 'PENDING'
      then case when v_confirmer = p_me then 'ME' else 'COUNTERPART' end end,
    'minor', case
      when p_assignment.minor_guest_participant_id is not null then jsonb_build_object(
        'guest_participant_id', case when v_owner = p_me then p_assignment.minor_guest_participant_id end,
        'full_name', v_guest_name)
      when private.people_profile_available(p_assignment.minor_runner_profile_id)
        then private.people_public_card(p_assignment.minor_runner_profile_id) end,
    'guardian', case when private.people_profile_available(p_assignment.guardian_profile_id)
      then private.people_public_card(p_assignment.guardian_profile_id) end,
    'guest_owner', case when v_owner is not null and v_owner <> p_me and private.people_profile_available(v_owner)
      then private.people_public_card(v_owner) end,
    'created_at', p_assignment.created_at,
    'activated_at', p_assignment.activated_at,
    'revoked_at', p_assignment.revoked_at);
end;
$$;

-- Party = minor runner, guardian or guest owner. Anyone else gets NOT_FOUND (SEC-010).
create or replace function private.people_lock_my_guardian_assignment(p_guardian_assignment_id uuid, p_me uuid)
returns app.guardian_assignment
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.guardian_assignment;
begin
  select ga.* into v_row from app.guardian_assignment ga
  left join app.guest_participant g on g.guest_participant_id = ga.minor_guest_participant_id
  where ga.guardian_assignment_id = p_guardian_assignment_id
    and p_me in (ga.minor_runner_profile_id, ga.guardian_profile_id, g.owner_profile_id)
  for update of ga;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  return v_row;
end;
$$;

create or replace function private.people_insert_guardian_assignment(
  p_minor_runner_profile_id uuid, p_minor_guest_participant_id uuid, p_guardian_profile_id uuid,
  p_relationship_type text, p_me uuid, p_active boolean)
returns app.guardian_assignment
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_row app.guardian_assignment;
  v_constraint text;
begin
  select ga.guardian_assignment_id into v_existing from app.guardian_assignment ga
  where ga.guardian_profile_id = p_guardian_profile_id and ga.status in ('PENDING', 'ACTIVE')
    and (ga.minor_runner_profile_id = p_minor_runner_profile_id or ga.minor_guest_participant_id = p_minor_guest_participant_id);
  if found then
    perform private.raise_domain_error('CONFLICT',
      jsonb_build_object('reason', 'ASSIGNMENT_EXISTS', 'guardian_assignment_id', v_existing));
  end if;
  perform private.consume_policy_rate_limit('guardian.request:cmd', auth.uid()::text);

  begin
    insert into app.guardian_assignment (minor_runner_profile_id, minor_guest_participant_id, guardian_profile_id,
      relationship_type, status, activated_at, requested_by_profile_id)
    values (p_minor_runner_profile_id, p_minor_guest_participant_id, p_guardian_profile_id, p_relationship_type,
      case when p_active then 'ACTIVE' else 'PENDING' end, case when p_active then pg_catalog.now() end, p_me)
    returning * into v_row;
  exception when integrity_constraint_violation or data_exception then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'guardian_assignment_relationship_type' or p_relationship_type is null then
      perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "relationship_type", "reason": "invalid"}');
    end if;
    perform private.raise_constraint_error(sqlstate, v_constraint, '{}', '{"reason": "ASSIGNMENT_EXISTS"}');
  end;

  perform private.audit('GUARDIAN_ASSIGNMENT_REQUESTED', 'guardian_assignment', v_row.guardian_assignment_id, null,
    null, jsonb_build_object('status', v_row.status, 'minor_kind',
      case when p_minor_guest_participant_id is null then 'RUNNER' else 'GUEST' end));
  return v_row;
end;
$$;

-- Minor RunnerProfile: the caller is the minor (counterpart = adult guardian) or the adult (counterpart
-- = minor); the role follows from the two dates of birth.
create or replace function private.request_runner_guardianship(p_counterpart_public_profile_id uuid, p_relationship_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_counterpart uuid := private.people_runner_id_for_public_profile(p_counterpart_public_profile_id);
  v_my_age integer := private.people_profile_age(v_me);
  v_counterpart_age integer;
  v_row app.guardian_assignment;
begin
  if v_counterpart = v_me then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "SELF_GUARDIAN"}');
  end if;
  if v_counterpart is null or not private.people_profile_available(v_counterpart) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_counterpart_age := private.people_profile_age(v_counterpart);

  if v_my_age between 15 and 17 then
    if v_counterpart_age < 18 then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "GUARDIAN_NOT_ADULT"}');
    end if;
    v_row := private.people_insert_guardian_assignment(v_me, null, v_counterpart, p_relationship_type, v_me, false);
  elsif v_my_age >= 18 then
    if v_counterpart_age not between 15 and 17 then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "COUNTERPART_NOT_MINOR"}');
    end if;
    v_row := private.people_insert_guardian_assignment(v_counterpart, null, v_me, p_relationship_type, v_me, false);
  else
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "UNDER_MIN_AGE"}');
  end if;
  return private.people_guardian_projection(v_row, v_me);
end;
$$;

-- Minor Guest (15-17) owned by the caller. Guardian = the owner (ACTIVE at once) or an adult with an
-- ACCEPTED Friendship with the owner (PENDING until that Friend confirms).
create or replace function private.assign_guest_guardian(
  p_guest_participant_id uuid, p_relationship_type text, p_guardian_public_profile_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_guest app.guest_participant;
  v_guardian uuid;
  v_age integer;
  v_row app.guardian_assignment;
begin
  v_guest := private.people_lock_my_guest(p_guest_participant_id, v_me);
  if v_guest.status <> 'ACTIVE' then
    perform private.raise_domain_error('CONFLICT', '{"reason": "GUEST_ARCHIVED"}');
  end if;
  v_age := private.people_age_years(v_guest.date_of_birth, private.people_today());
  if v_age >= 18 then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "GUEST_NOT_MINOR"}');
  end if;

  if p_guardian_public_profile_id is null then
    v_guardian := v_me;
  else
    v_guardian := private.people_runner_id_for_public_profile(p_guardian_public_profile_id);
    if v_guardian is null or not private.people_profile_available(v_guardian) then
      perform private.raise_domain_error('NOT_FOUND');
    end if;
    if v_guardian <> v_me and not private.friendship_accepted(v_guardian) then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "GUARDIAN_NOT_FRIEND"}');
    end if;
  end if;
  if private.people_profile_age(v_guardian) < 18 then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "GUARDIAN_NOT_ADULT"}');
  end if;

  v_row := private.people_insert_guardian_assignment(null, v_guest.guest_participant_id, v_guardian,
    p_relationship_type, v_me, v_guardian = v_me);
  if v_row.status = 'ACTIVE' then
    perform private.audit('GUARDIAN_ASSIGNMENT_ACTIVATED', 'guardian_assignment', v_row.guardian_assignment_id, null,
      null, jsonb_build_object('status', 'ACTIVE'));
  end if;
  return private.people_guardian_projection(v_row, v_me);
end;
$$;

create or replace function private.confirm_guardian_assignment(p_guardian_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_row app.guardian_assignment;
  v_guest app.guest_participant;
begin
  v_row := private.people_lock_my_guardian_assignment(p_guardian_assignment_id, v_me);
  if v_row.status = 'ACTIVE' then
    return private.people_guardian_projection(v_row, v_me);
  end if;
  if v_row.status <> 'PENDING' then
    perform private.raise_domain_error('CONFLICT', '{"reason": "ASSIGNMENT_REVOKED"}');
  end if;
  if private.people_guardian_confirmer(v_row) <> v_me then
    perform private.raise_domain_error('FORBIDDEN', '{"reason": "AWAITING_COUNTERPART"}');
  end if;

  -- Re-validate every party at activation time.
  if not private.people_profile_available(v_row.guardian_profile_id) or private.people_profile_age(v_row.guardian_profile_id) < 18 then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "GUARDIAN_UNAVAILABLE"}');
  end if;
  if v_row.minor_runner_profile_id is not null then
    if not private.people_profile_available(v_row.minor_runner_profile_id) then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "COUNTERPART_UNAVAILABLE"}');
    end if;
    if private.people_profile_age(v_row.minor_runner_profile_id) >= 18 then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "NOT_A_MINOR"}');
    end if;
  else
    select * into v_guest from app.guest_participant g
    where g.guest_participant_id = v_row.minor_guest_participant_id for share;
    if v_guest.status <> 'ACTIVE' then
      perform private.raise_domain_error('CONFLICT', '{"reason": "GUEST_ARCHIVED"}');
    end if;
    if not private.people_profile_available(v_guest.owner_profile_id) then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "COUNTERPART_UNAVAILABLE"}');
    end if;
    if not private.friendship_accepted(v_guest.owner_profile_id) then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "GUARDIAN_NOT_FRIEND"}');
    end if;
  end if;

  update app.guardian_assignment ga set status = 'ACTIVE', activated_at = pg_catalog.now()
  where ga.guardian_assignment_id = v_row.guardian_assignment_id
  returning * into v_row;
  perform private.audit('GUARDIAN_ASSIGNMENT_ACTIVATED', 'guardian_assignment', v_row.guardian_assignment_id, null,
    jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'ACTIVE'));
  return private.people_guardian_projection(v_row, v_me);
end;
$$;

create or replace function private.people_revoke_guardian_row(p_row app.guardian_assignment, p_reason text)
returns app.guardian_assignment
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.guardian_assignment;
begin
  update app.guardian_assignment ga set status = 'REVOKED', revoked_at = pg_catalog.now()
  where ga.guardian_assignment_id = p_row.guardian_assignment_id
  returning * into v_row;
  perform private.audit('GUARDIAN_ASSIGNMENT_REVOKED', 'guardian_assignment', v_row.guardian_assignment_id, null,
    jsonb_build_object('status', p_row.status), jsonb_build_object('status', 'REVOKED'), p_reason);
  return v_row;
end;
$$;

-- Either party (or the guest owner) revokes or declines. Idempotent on REVOKED.
create or replace function private.revoke_guardian_assignment(p_guardian_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
  v_row app.guardian_assignment;
begin
  v_row := private.people_lock_my_guardian_assignment(p_guardian_assignment_id, v_me);
  if v_row.status <> 'REVOKED' then
    v_row := private.people_revoke_guardian_row(v_row, null);
  end if;
  return private.people_guardian_projection(v_row, v_me);
end;
$$;

create or replace function private.staff_revoke_guardian_assignment(p_guardian_assignment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.people_clean_text(p_reason);
  v_row app.guardian_assignment;
begin
  perform private.require_permission('GUARDIAN_ASSIGNMENT_MANAGE', null);
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "reason", "reason": "invalid"}');
  end if;
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  select * into v_row from app.guardian_assignment ga where ga.guardian_assignment_id = p_guardian_assignment_id for update;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if v_row.status <> 'REVOKED' then
    v_row := private.people_revoke_guardian_row(v_row, v_reason);
  end if;
  return jsonb_build_object('guardian_assignment_id', v_row.guardian_assignment_id, 'status', v_row.status,
    'revoked_at', v_row.revoked_at);
end;
$$;

-- Every assignment the caller is party to (live by default), newest first, capped (SEC-008).
create or replace function private.list_my_guardian_assignments(p_include_revoked boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_ready_profile();
begin
  return coalesce((
    select jsonb_agg(private.people_guardian_projection(x.ga, v_me) order by (x.ga).created_at desc, (x.ga).guardian_assignment_id)
    from (
      select ga from app.guardian_assignment ga
      left join app.guest_participant g on g.guest_participant_id = ga.minor_guest_participant_id
      where v_me in (ga.minor_runner_profile_id, ga.guardian_profile_id, g.owner_profile_id)
        and (coalesce(p_include_revoked, false) or ga.status <> 'REVOKED')
      order by ga.created_at desc, ga.guardian_assignment_id
      limit 100) x), '[]'::jsonb);
end;
$$;

create or replace function public.request_runner_guardianship(p_counterpart_public_profile_id uuid, p_relationship_type text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.request_runner_guardianship(p_counterpart_public_profile_id, p_relationship_type) $$;
create or replace function public.assign_guest_guardian(
  p_guest_participant_id uuid, p_relationship_type text, p_guardian_public_profile_id uuid default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.assign_guest_guardian(p_guest_participant_id, p_relationship_type, p_guardian_public_profile_id) $$;
create or replace function public.confirm_guardian_assignment(p_guardian_assignment_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.confirm_guardian_assignment(p_guardian_assignment_id) $$;
create or replace function public.revoke_guardian_assignment(p_guardian_assignment_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.revoke_guardian_assignment(p_guardian_assignment_id) $$;
create or replace function public.staff_revoke_guardian_assignment(p_guardian_assignment_id uuid, p_reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_revoke_guardian_assignment(p_guardian_assignment_id, p_reason) $$;
create or replace function public.list_my_guardian_assignments(p_include_revoked boolean default false)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_my_guardian_assignments(p_include_revoked) $$;

revoke all on function
  private.people_profile_age(uuid),
  private.people_guardian_confirmer(app.guardian_assignment),
  private.people_guardian_projection(app.guardian_assignment, uuid),
  private.people_lock_my_guardian_assignment(uuid, uuid),
  private.people_insert_guardian_assignment(uuid, uuid, uuid, text, uuid, boolean),
  private.people_revoke_guardian_row(app.guardian_assignment, text),
  private.request_runner_guardianship(uuid, text), public.request_runner_guardianship(uuid, text),
  private.assign_guest_guardian(uuid, text, uuid), public.assign_guest_guardian(uuid, text, uuid),
  private.confirm_guardian_assignment(uuid), public.confirm_guardian_assignment(uuid),
  private.revoke_guardian_assignment(uuid), public.revoke_guardian_assignment(uuid),
  private.staff_revoke_guardian_assignment(uuid, text), public.staff_revoke_guardian_assignment(uuid, text),
  private.list_my_guardian_assignments(boolean), public.list_my_guardian_assignments(boolean)
from public, anon, authenticated, service_role;

grant execute on function
  private.request_runner_guardianship(uuid, text), public.request_runner_guardianship(uuid, text),
  private.assign_guest_guardian(uuid, text, uuid), public.assign_guest_guardian(uuid, text, uuid),
  private.confirm_guardian_assignment(uuid), public.confirm_guardian_assignment(uuid),
  private.revoke_guardian_assignment(uuid), public.revoke_guardian_assignment(uuid),
  private.staff_revoke_guardian_assignment(uuid, text), public.staff_revoke_guardian_assignment(uuid, text),
  private.list_my_guardian_assignments(boolean), public.list_my_guardian_assignments(boolean)
to authenticated;
