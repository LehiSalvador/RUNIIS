-- Staff role management, ADMIN GLOBAL only (Master §144-145, SEC-021/022). No self-grant, cannot
-- revoke the last GLOBAL ADMIN, every mutation audited. First-admin bootstrap is SYSTEM-only.

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('admin.mutation:cmd', 120, 60, 'ACTOR', 'Master §179 admin mutations per staff (command)')
on conflict (scope) do nothing;

create function private.list_staff_roles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('STAFF_ROLES_MANAGE', null);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'staff_member_id', sm.staff_member_id, 'auth_user_id', sm.auth_user_id, 'status', sm.status,
        'full_name', rp.full_name,
        'roles', coalesce((
          select jsonb_agg(jsonb_build_object(
              'staff_role_assignment_id', sra.staff_role_assignment_id, 'role', sra.role,
              'scope_type', sra.scope_type, 'edition_id', sra.edition_id,
              'created_at', sra.created_at, 'revoked_at', sra.revoked_at)
            order by sra.revoked_at is not null, sra.role, sra.scope_type, sra.edition_id)
          from app.staff_role_assignment sra
          where sra.staff_member_id = sm.staff_member_id), '[]'::jsonb))
      order by sm.created_at)
    from app.staff_member sm
    left join app.runner_profile rp on rp.auth_user_id = sm.auth_user_id
    limit 200), '[]'::jsonb);
end;
$$;

-- Target resolved by email (an ops tool for a small ADMIN GLOBAL audience; the runner is not required
-- to already have a RunnerProfile). staff_member is created/reactivated on first grant.
create function private.grant_staff_role(p_email text, p_role text, p_scope_type text, p_edition_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grantor_uid uuid;
  v_grantor_staff_id uuid;
  v_target_auth_user_id uuid;
  v_target_staff_id uuid;
  v_assignment_id uuid;
  v_constraint text;
begin
  v_grantor_staff_id := private.require_permission('STAFF_ROLES_MANAGE', null);
  v_grantor_uid := auth.uid();
  perform private.consume_policy_rate_limit('admin.mutation:cmd', v_grantor_uid::text);

  if coalesce(p_role, '') not in ('ADMIN', 'OPERATOR', 'CHECKIN', 'MODERATOR') then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "role", "reason": "invalid"}');
  end if;
  if coalesce(p_scope_type, '') not in ('GLOBAL', 'EDITION') or (p_scope_type = 'EDITION') <> (p_edition_id is not null) then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "scope_type", "reason": "invalid"}');
  end if;

  select u.id into v_target_auth_user_id from auth.users u
  where private.email_match_key(u.email) = private.email_match_key(p_email) and u.deleted_at is null
  limit 1;
  if v_target_auth_user_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  -- SEC-021: no self-grant, even for an ADMIN adding another scope to themselves.
  if v_target_auth_user_id = v_grantor_uid then
    perform private.raise_domain_error('FORBIDDEN', '{"reason": "SELF_GRANT"}');
  end if;

  insert into app.staff_member (auth_user_id, status) values (v_target_auth_user_id, 'ACTIVE')
  on conflict (auth_user_id) do update set status = 'ACTIVE'
  returning staff_member_id into v_target_staff_id;

  insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id, created_by_staff_id)
  values (v_target_staff_id, p_role, p_scope_type, p_edition_id, v_grantor_staff_id)
  returning staff_role_assignment_id into v_assignment_id;

  perform private.audit('STAFF_ROLE_GRANTED', 'staff_member', v_target_staff_id, p_edition_id,
    null, jsonb_build_object('role', p_role, 'scope_type', p_scope_type));
  return jsonb_build_object('staff_role_assignment_id', v_assignment_id, 'staff_member_id', v_target_staff_id,
    'role', p_role, 'scope_type', p_scope_type, 'edition_id', p_edition_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint,
    jsonb_build_object('staff_role_assignment_live_uidx', 'CONFLICT'), '{"reason": "ALREADY_GRANTED"}');
end;
$$;

create function private.revoke_staff_role(p_role_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grantor_staff_id uuid;
  v_row app.staff_role_assignment;
  v_other_admins integer;
begin
  v_grantor_staff_id := private.require_permission('STAFF_ROLES_MANAGE', null);
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);

  select * into v_row from app.staff_role_assignment sra
  where sra.staff_role_assignment_id = p_role_assignment_id for update;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if v_row.revoked_at is not null then
    return jsonb_build_object('staff_role_assignment_id', v_row.staff_role_assignment_id,
      'status', 'REVOKED', 'revoked_at', v_row.revoked_at);
  end if;

  if v_row.role = 'ADMIN' and v_row.scope_type = 'GLOBAL' then
    select count(*) into v_other_admins
    from app.staff_role_assignment sra
    join app.staff_member sm on sm.staff_member_id = sra.staff_member_id
    where sra.role = 'ADMIN' and sra.scope_type = 'GLOBAL' and sra.revoked_at is null
      and sra.staff_role_assignment_id <> v_row.staff_role_assignment_id and sm.status = 'ACTIVE';
    if v_other_admins = 0 then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', '{"reason": "LAST_GLOBAL_ADMIN"}');
    end if;
  end if;

  update app.staff_role_assignment
  set revoked_at = pg_catalog.now(), revoked_by_staff_id = v_grantor_staff_id
  where staff_role_assignment_id = v_row.staff_role_assignment_id
  returning * into v_row;

  perform private.audit('STAFF_ROLE_REVOKED', 'staff_member', v_row.staff_member_id, v_row.edition_id,
    jsonb_build_object('role', v_row.role, 'scope_type', v_row.scope_type), jsonb_build_object('revoked', true));
  return jsonb_build_object('staff_role_assignment_id', v_row.staff_role_assignment_id,
    'status', 'REVOKED', 'revoked_at', v_row.revoked_at);
end;
$$;

revoke all on function
  private.list_staff_roles(), private.grant_staff_role(text, text, text, uuid), private.revoke_staff_role(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.list_staff_roles() to authenticated;
grant execute on function private.grant_staff_role(text, text, text, uuid) to authenticated;
grant execute on function private.revoke_staff_role(uuid) to authenticated;

create function public.list_staff_roles()
returns jsonb language sql security invoker set search_path = '' as $$ select private.list_staff_roles() $$;
create function public.grant_staff_role(p_email text, p_role text, p_scope_type text, p_edition_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.grant_staff_role(p_email, p_role, p_scope_type, p_edition_id) $$;
create function public.revoke_staff_role(p_role_assignment_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select private.revoke_staff_role(p_role_assignment_id) $$;
revoke all on function
  public.list_staff_roles(), public.grant_staff_role(text, text, text, uuid), public.revoke_staff_role(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_staff_roles() to authenticated;
grant execute on function public.grant_staff_role(text, text, text, uuid) to authenticated;
grant execute on function public.revoke_staff_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- First-admin bootstrap (SEC-021): SYSTEM-only (service_role), only when no ACTIVE GLOBAL ADMIN
-- exists yet. Never reachable from a user JWT; run once via scripts/ops/bootstrap-admin.mjs.
-- ---------------------------------------------------------------------------------------------

create function private.bootstrap_first_admin(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_auth_user_id uuid;
  v_staff_id uuid;
  v_assignment_id uuid;
begin
  if exists (
      select 1 from app.staff_role_assignment sra
      join app.staff_member sm on sm.staff_member_id = sra.staff_member_id
      where sra.role = 'ADMIN' and sra.scope_type = 'GLOBAL' and sra.revoked_at is null and sm.status = 'ACTIVE') then
    perform private.raise_domain_error('CONFLICT', '{"reason": "ADMIN_ALREADY_BOOTSTRAPPED"}');
  end if;

  select u.id into v_target_auth_user_id from auth.users u
  where private.email_match_key(u.email) = private.email_match_key(p_email) and u.deleted_at is null
  limit 1;
  if v_target_auth_user_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;

  insert into app.staff_member (auth_user_id, status) values (v_target_auth_user_id, 'ACTIVE')
  on conflict (auth_user_id) do update set status = 'ACTIVE'
  returning staff_member_id into v_staff_id;

  insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id)
  values (v_staff_id, 'ADMIN', 'GLOBAL', null)
  on conflict (staff_member_id, role, edition_id) where revoked_at is null do nothing
  returning staff_role_assignment_id into v_assignment_id;
  if v_assignment_id is null then
    select sra.staff_role_assignment_id into v_assignment_id from app.staff_role_assignment sra
    where sra.staff_member_id = v_staff_id and sra.role = 'ADMIN' and sra.scope_type = 'GLOBAL' and sra.revoked_at is null;
  end if;

  perform private.audit('STAFF_BOOTSTRAP_FIRST_ADMIN', 'staff_member', v_staff_id, null,
    null, jsonb_build_object('role', 'ADMIN', 'scope_type', 'GLOBAL'));
  return jsonb_build_object('staff_member_id', v_staff_id, 'staff_role_assignment_id', v_assignment_id);
end;
$$;

revoke all on function private.bootstrap_first_admin(text) from public, anon, authenticated, service_role;
grant execute on function private.bootstrap_first_admin(text) to service_role;

create function public.bootstrap_first_admin(p_email text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.bootstrap_first_admin(p_email) $$;
revoke all on function public.bootstrap_first_admin(text) from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_first_admin(text) to service_role;
