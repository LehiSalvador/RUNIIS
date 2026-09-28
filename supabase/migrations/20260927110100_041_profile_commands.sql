-- Account API reads/updates (Master §166; SEC-016 mass-assignment allowlist).

create function private.get_my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_actor();
begin
  return private.build_my_profile(v_uid);
end;
$$;

-- PATCH allowlist is exactly phone + emergency fields (Master §160); full_name, DOB, sex_code and
-- account_state/profile_readiness are never writable here (those go through onboarding/staff commands).
create function private.update_my_profile(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_allowed constant text[] := array['phone_e164', 'emergency_contact_name',
    'emergency_contact_phone_e164', 'emergency_contact_relationship'];
  v_profile_id uuid := private.require_ready_profile();
  v_uid uuid := auth.uid();
  v_key text;
  v_old app.runner_profile;
  v_new app.runner_profile;
  v_changed text[];
  v_constraint text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "changes", "reason": "empty"}');
  end if;
  for v_key in select k from jsonb_object_keys(p_changes) k order by k loop
    if not v_key = any (c_allowed) then
      perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "changes", "reason": "not_allowed"}');
    end if;
    if jsonb_typeof(p_changes -> v_key) <> 'string' then
      perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', v_key, 'reason', 'invalid'));
    end if;
  end loop;

  select * into v_old from app.runner_profile rp where rp.runner_profile_id = v_profile_id for update;
  v_new := v_old;
  if p_changes ? 'phone_e164' then
    v_new.phone_e164 := private.auth_clean_text(p_changes ->> 'phone_e164');
  end if;
  if p_changes ? 'emergency_contact_name' then
    v_new.emergency_contact_name := private.auth_clean_text(p_changes ->> 'emergency_contact_name');
  end if;
  if p_changes ? 'emergency_contact_phone_e164' then
    v_new.emergency_contact_phone_e164 := private.auth_clean_text(p_changes ->> 'emergency_contact_phone_e164');
  end if;
  if p_changes ? 'emergency_contact_relationship' then
    v_new.emergency_contact_relationship := private.auth_clean_text(p_changes ->> 'emergency_contact_relationship');
  end if;
  perform private.validate_runner_contact_fields(v_new);

  select coalesce(array_agg(o.key order by o.key), '{}') into v_changed
  from jsonb_each(to_jsonb(v_old)) o join jsonb_each(to_jsonb(v_new)) n using (key)
  where o.key = any (c_allowed) and o.value is distinct from n.value;
  if cardinality(v_changed) = 0 then
    return private.build_my_profile(v_uid);
  end if;

  update app.runner_profile set
    phone_e164 = v_new.phone_e164, emergency_contact_name = v_new.emergency_contact_name,
    emergency_contact_phone_e164 = v_new.emergency_contact_phone_e164,
    emergency_contact_relationship = v_new.emergency_contact_relationship
  where runner_profile_id = v_profile_id;

  -- Field names only: contact PII never enters the audit snapshot (SEC-112).
  perform private.audit('PROFILE_CONTACT_UPDATED', 'runner_profile', v_profile_id, null,
    null, jsonb_build_object('changed_fields', to_jsonb(v_changed)));
  return private.build_my_profile(v_uid);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

revoke all on function private.get_my_profile(), private.update_my_profile(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.get_my_profile() to authenticated;
grant execute on function private.update_my_profile(jsonb) to authenticated;

create function public.get_my_profile()
returns jsonb language sql security invoker set search_path = '' as $$ select private.get_my_profile() $$;
create function public.update_my_profile(p_changes jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.update_my_profile(p_changes) $$;
revoke all on function public.get_my_profile(), public.update_my_profile(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.update_my_profile(jsonb) to authenticated;
