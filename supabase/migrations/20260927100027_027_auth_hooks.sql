-- Auth hardening in the database (ADR-001 A7, SEC-040/047). These hold even where the remote Auth
-- configuration (hook enablement, confirmations, OTP timings) cannot be changed through SalvaOps.

-- GoTrue before-user-created hook: rejects active blocked identities by email alias key and by OAuth
-- subject. Any failure rejects (fail closed); the message is generic (no enumeration, SEC-043).
create function private.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user jsonb := event -> 'user';
  v_provider text := v_user -> 'app_metadata' ->> 'provider';
  v_rejected constant jsonb := '{"error": {"http_code": 403, "message": "Sign-up is not allowed."}}';
begin
  if jsonb_typeof(v_user) <> 'object' then
    return v_rejected;
  end if;
  if private.is_identity_blocked(nullif(v_user ->> 'email', ''))
     or exists (
       select 1 from jsonb_array_elements(coalesce(v_user -> 'identities', '[]'::jsonb)) i
       where private.is_identity_blocked(null, i ->> 'provider',
               coalesce(i ->> 'provider_id', i -> 'identity_data' ->> 'sub')))
     or (coalesce(v_provider, 'email') <> 'email'
         and private.is_identity_blocked(null, v_provider,
               coalesce(v_user -> 'user_metadata' ->> 'provider_id', v_user -> 'user_metadata' ->> 'sub'))) then
    return v_rejected;
  end if;
  return '{}'::jsonb;
exception when others then
  return v_rejected;
end;
$$;

revoke all on function private.hook_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.hook_before_user_created(jsonb) to supabase_auth_admin;

-- OTP/Google only: no usable password credential ever exists (pre-account takeover, SEC-040), and an
-- active blocked email cannot be created or adopted through an email change.
create function private.guard_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- GoTrue stores a random hash for OTP sign-ups and the chosen one for password sign-ups; the two
    -- are indistinguishable here, so every new user starts without a password.
    new.encrypted_password := '';
  elsif coalesce(new.encrypted_password, '') <> '' and new.encrypted_password is distinct from old.encrypted_password then
    raise exception using errcode = 'insufficient_privilege', message = 'password credentials are disabled';
  end if;
  if (tg_op = 'INSERT' or new.email is distinct from old.email) and private.is_identity_blocked(new.email) then
    raise exception using errcode = 'insufficient_privilege', message = 'identity is not allowed';
  end if;
  return new;
end;
$$;

create trigger guard_identity before insert or update of encrypted_password, email on auth.users
  for each row execute function private.guard_auth_user();

-- Blocked OAuth subjects cannot be linked to any account (new or existing).
create function private.guard_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider <> 'email' and private.is_identity_blocked(null, new.provider, new.provider_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'identity is not allowed';
  end if;
  return new;
end;
$$;

create trigger guard_identity before insert or update of provider, provider_id on auth.identities
  for each row execute function private.guard_auth_identity();

revoke all on function private.guard_auth_user(), private.guard_auth_identity() from public, anon, authenticated, service_role;
