-- Shared authorization helpers (Master §157) and the command toolkit every domain command uses
-- (ADR-001 §2/§4/§5/§9, Amendment 1 A4-A6). Signatures are a published contract: change additively only.

-- Value sets for free-text columns that auth/RLS logic reads (additive; widen by migration).
alter table infra.idempotency_record
  add constraint idempotency_record_state check (state in ('IN_PROGRESS', 'COMPLETED'));
alter table app.runner_profile
  add constraint runner_profile_sex_code check (sex_code in ('F', 'M', 'X')),
  add constraint runner_profile_emergency_relationship
    check (btrim(emergency_contact_relationship) <> '' and char_length(emergency_contact_relationship) <= 60);
alter table app.guest_participant
  add constraint guest_participant_sex_code check (sex_code in ('F', 'M', 'X'));
alter table app.guardian_assignment
  add constraint guardian_assignment_relationship_type check (relationship_type in ('PARENT', 'LEGAL_GUARDIAN'));
alter table app.legal_document
  add constraint legal_document_status check (status in ('ACTIVE', 'ARCHIVED'));
alter table app.legal_document_version
  add constraint legal_document_version_status check (status in ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  add constraint legal_document_version_published_at check (status = 'DRAFT' or published_at is not null);
alter table app.event_content_block
  add constraint event_content_block_status check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED'));

-- Rate-limit configuration (Master §179 values). Domain migrations add their scopes here.
-- ACTOR scopes count per auth.uid(); SUPPLIED scopes count a server-supplied subject (IP, email)
-- and are reachable only by the SYSTEM client.
create table infra.rate_limit_policy (
  scope text primary key check (scope ~ '^[a-z][a-z0-9_.:]{2,63}$'),
  max_hits integer not null check (max_hits > 0),
  window_seconds integer not null check (window_seconds > 0),
  subject_kind text not null check (subject_kind in ('ACTOR', 'SUPPLIED')),
  description text not null
);
alter table infra.rate_limit_policy enable row level security;

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('people.search', 60, 600, 'ACTOR', 'Master §179 people search'),
  ('friendship.request.minute', 5, 60, 'ACTOR', 'Master §179 friend request per minute'),
  ('friendship.request.day', 30, 86400, 'ACTOR', 'Master §179 friend request per day'),
  ('registration_request.create', 5, 600, 'ACTOR', 'Master §179 registration request'),
  ('avatar.upload', 5, 86400, 'ACTOR', 'Master §179 avatar upload'),
  ('admin.mutation', 120, 60, 'ACTOR', 'Master §179 admin mutations per staff'),
  ('auth.otp.email', 1, 60, 'SUPPLIED', 'Master §179 OTP cooldown per email'),
  ('auth.otp.email.hour', 5, 3600, 'SUPPLIED', 'OTP requests per email per hour'),
  ('auth.otp.ip', 20, 3600, 'SUPPLIED', 'OTP requests per client IP per hour'),
  ('auth.verify.email', 10, 600, 'SUPPLIED', 'OTP verification attempts per email'),
  ('auth.verify.ip', 30, 600, 'SUPPLIED', 'OTP verification attempts per client IP');

-- Master §145 RBAC encoded once as data (SEC-022). global_only actions need a GLOBAL assignment
-- even when an Edition is given; the rest also match EDITION assignments of that Edition.
create table private.staff_action (
  action text primary key check (action ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  global_only boolean not null
);
alter table private.staff_action enable row level security;

create table private.staff_permission (
  role text not null check (role in ('ADMIN', 'OPERATOR', 'CHECKIN', 'MODERATOR')),
  action text not null references private.staff_action (action) on delete restrict,
  primary key (role, action)
);
alter table private.staff_permission enable row level security;

insert into private.staff_action (action, global_only) values
  ('STAFF_ROLES_MANAGE', true), ('PLATFORM_SETTINGS_MANAGE', true), ('LEGAL_DOCUMENTS_PUBLISH', true),
  ('PLATFORM_BAN_MANAGE', true), ('IDENTITY_LOCK_MANAGE', true), ('PROFILE_NAME_CORRECT', true),
  ('PII_EXPORT', true), ('EVENT_CREATE', true), ('EDITION_CREATE', true), ('RANKING_MANAGE', true),
  ('INTEGRITY_CASE_MANAGE', true), ('AVATAR_MODERATE', true), ('AVATAR_SUSPEND', true),
  ('AUDIT_LOG_READ', false), ('EDITION_PUBLISH', false), ('EDITION_LIFECYCLE_MANAGE', false),
  ('EDITION_CLOSURE_MANAGE', false), ('CAMPAIGN_MANAGE', false), ('EVENT_CONTENT_MANAGE', false),
  ('MODALITY_MANAGE', false), ('PRICE_MANAGE', false), ('CAPACITY_MANAGE', false),
  ('REGISTRATION_REQUEST_MANAGE', false), ('REGISTRATION_MANAGE', false), ('PASS_CREDENTIAL_REPLACE', false),
  ('PARTICIPANT_LIST_READ', false), ('KIT_MANAGE', false), ('ATTENDANCE_MANAGE', false),
  ('COMMUNICATION_OPERATIONAL_SEND', false), ('PARTICIPANT_LOOKUP', false), ('PASS_SCAN', false),
  ('GUARDIAN_VERIFY', false), ('KIT_PICKUP_RECORD', false), ('ADMIN_TASK_READ', false);

insert into private.staff_permission (role, action)
select 'ADMIN', action from private.staff_action
union all
select 'OPERATOR', unnest(array[
  'EVENT_CONTENT_MANAGE', 'MODALITY_MANAGE', 'PRICE_MANAGE', 'CAPACITY_MANAGE', 'REGISTRATION_REQUEST_MANAGE',
  'REGISTRATION_MANAGE', 'PASS_CREDENTIAL_REPLACE', 'PARTICIPANT_LIST_READ', 'KIT_MANAGE', 'ATTENDANCE_MANAGE',
  'COMMUNICATION_OPERATIONAL_SEND', 'PARTICIPANT_LOOKUP', 'PASS_SCAN', 'GUARDIAN_VERIFY', 'KIT_PICKUP_RECORD',
  'ADMIN_TASK_READ'])
union all
select 'CHECKIN', unnest(array['PARTICIPANT_LOOKUP', 'PASS_SCAN', 'GUARDIAN_VERIFY', 'KIT_PICKUP_RECORD', 'ADMIN_TASK_READ'])
union all
select 'MODERATOR', unnest(array['AVATAR_MODERATE', 'AVATAR_SUSPEND', 'ADMIN_TASK_READ']);

-- ---------------------------------------------------------------------------------------------
-- Errors (ADR-001 §4). The detail JSON reaches the client verbatim: callers pass only safe data.
-- ---------------------------------------------------------------------------------------------

create function private.raise_domain_error(p_code text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    -- A malformed code could carry interpolated data; it never leaves as a message.
    message = case when p_code ~ '^[A-Z][A-Z0-9_]{2,63}$' then p_code else 'INTERNAL_ERROR' end,
    detail = coalesce(p_detail, '{}'::jsonb)::text;
end;
$$;

-- Re-raises a caught integrity/data error as a domain code (SEC-005): the mapped constraint name
-- wins, otherwise the SQLSTATE class decides. Constraint names, values and relations never leak.
create function private.raise_constraint_error(
  p_sqlstate text, p_constraint text default null, p_map jsonb default '{}', p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text := coalesce(p_map, '{}'::jsonb) ->> coalesce(p_constraint, '');
begin
  if v_code is null then
    v_code := case
      when p_sqlstate in ('23505', '23P01') then 'CONFLICT'
      when p_sqlstate = '23503' then 'NOT_FOUND'
      when p_sqlstate = '23001' then 'BUSINESS_RULE_VIOLATION'
      when p_sqlstate in ('23502', '23514') or p_sqlstate like '22%' then 'VALIDATION_ERROR'
      when p_sqlstate like '23%' then 'CONFLICT'
      else 'INTERNAL_ERROR'
    end;
  end if;
  perform private.raise_domain_error(v_code, p_detail);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Identity helpers (Master §157). Definer so RLS policies can call them without recursion; they
-- only ever describe auth.uid() and read live table state, never JWT claims (SEC-046/048).
-- ---------------------------------------------------------------------------------------------

create function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select rp.runner_profile_id from app.runner_profile rp where rp.auth_user_id = auth.uid()
$$;

-- ACTIVE staff only; a BANNED runner identity holds no staff privilege.
create function private.current_staff_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.staff_member_id
  from app.staff_member sm
  where sm.auth_user_id = auth.uid()
    and sm.status = 'ACTIVE'
    and not exists (
      select 1 from app.runner_profile rp where rp.auth_user_id = sm.auth_user_id and rp.account_state = 'BANNED')
$$;

create function private.is_profile_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.runner_profile rp where rp.auth_user_id = auth.uid() and rp.profile_readiness = 'READY')
$$;

create function private.is_profile_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.runner_profile rp where rp.auth_user_id = auth.uid() and rp.account_state = 'ACTIVE')
$$;

-- GLOBAL assignments match any Edition (including NULL); a NULL Edition never matches an
-- EDITION-scoped assignment (SEC-020).
create function private.has_staff_role(p_role text, p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.staff_role_assignment sra
    where sra.staff_member_id = private.current_staff_member_id()
      and sra.revoked_at is null
      and sra.role = p_role
      and (sra.scope_type = 'GLOBAL' or sra.edition_id = p_edition_id))
$$;

create function private.is_admin_global()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_staff_role('ADMIN', null)
$$;

-- Any live role on the Edition (or GLOBAL): read access to that Edition's drafts.
create function private.is_edition_staff(p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.staff_role_assignment sra
    where sra.staff_member_id = private.current_staff_member_id()
      and sra.revoked_at is null
      and (sra.scope_type = 'GLOBAL' or sra.edition_id = p_edition_id))
$$;

-- Unknown actions are denied (fail closed).
create function private.has_permission(p_action text, p_edition_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.staff_role_assignment sra
    join private.staff_permission sp on sp.role = sra.role and sp.action = p_action
    join private.staff_action sa on sa.action = sp.action
    where sra.staff_member_id = private.current_staff_member_id()
      and sra.revoked_at is null
      and (sra.scope_type = 'GLOBAL' or (not sa.global_only and sra.edition_id = p_edition_id)))
$$;

create function private.owns_guest(p_guest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.guest_participant g
    where g.guest_participant_id = p_guest_id and g.owner_profile_id = private.current_profile_id())
$$;

create function private.friendship_accepted(p_other_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.friendship f
    where f.status = 'ACCEPTED'
      and ((f.requester_profile_id = private.current_profile_id() and f.addressee_profile_id = p_other_profile_id)
        or (f.addressee_profile_id = private.current_profile_id() and f.requester_profile_id = p_other_profile_id)))
$$;

-- Publicly displayable community profile: READY, ACTIVE and visible (banned/locked names are hidden).
create function private.is_public_profile(p_runner_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.community_profile cp
    join app.runner_profile rp on rp.runner_profile_id = cp.runner_profile_id
    where cp.runner_profile_id = p_runner_profile_id
      and cp.is_visible
      and rp.profile_readiness = 'READY'
      and rp.account_state = 'ACTIVE')
$$;

-- Blocked identities (Master §122, SEC-047). Alias policy: case/whitespace-insensitive, "+tag"
-- ignored for every domain, dots ignored for gmail.com/googlemail.com.
create function private.normalize_email(p_email text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.btrim(p_email))
$$;

create function private.email_match_key(p_email text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.strpos(e, '@') = 0 then e
    else pg_catalog.regexp_replace(
           case when dom in ('gmail.com', 'googlemail.com') then pg_catalog.replace(loc, '.', '') else loc end,
           '\+.*$', '')
         || '@' || case when dom = 'googlemail.com' then 'gmail.com' else dom end
  end
  from (select private.normalize_email(p_email) as e) n
  cross join lateral (
    select pg_catalog.split_part(n.e, '@', 1) as loc,
           pg_catalog.substr(n.e, pg_catalog.strpos(n.e, '@') + 1) as dom) parts
$$;

create function private.is_identity_blocked(
  p_email text, p_oauth_provider text default null, p_oauth_subject text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.blocked_identity bi
    where bi.active
      and ((p_email is not null and bi.normalized_email is not null
            and private.email_match_key(bi.normalized_email) = private.email_match_key(p_email))
        or (p_oauth_subject is not null and bi.oauth_provider = p_oauth_provider and bi.oauth_subject = p_oauth_subject)))
$$;

-- The caller's email and every linked OAuth identity are checked.
create function private.is_current_identity_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and private.is_identity_blocked(u.email))
      or exists (
        select 1 from auth.identities i
        where i.user_id = auth.uid() and i.provider <> 'email'
          and private.is_identity_blocked(null, i.provider, i.provider_id))
$$;

-- ---------------------------------------------------------------------------------------------
-- Actor projection: exact contract of lib/server/auth/actor.ts (actorSchema).
-- ---------------------------------------------------------------------------------------------

create function private.current_actor()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with staff as (select private.current_staff_member_id() as staff_member_id)
  select jsonb_build_object(
    'auth_user_id', auth.uid(),
    'runner_profile_id', rp.runner_profile_id,
    'profile_readiness', rp.profile_readiness,
    'account_state', rp.account_state,
    'staff_member_id', staff.staff_member_id,
    'staff_roles', coalesce((
      select jsonb_agg(jsonb_build_object('role', sra.role, 'scope_type', sra.scope_type, 'edition_id', sra.edition_id)
                       order by sra.role, sra.scope_type, sra.edition_id)
      from app.staff_role_assignment sra
      where sra.staff_member_id = staff.staff_member_id and sra.revoked_at is null), '[]'::jsonb))
  from staff
  left join app.runner_profile rp on rp.auth_user_id = auth.uid()
$$;

create function public.current_actor()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.current_actor()
$$;

-- ---------------------------------------------------------------------------------------------
-- Command preconditions. Each raises the Master §178 code from live table state.
-- ---------------------------------------------------------------------------------------------

-- The SYSTEM secret key has no uid, so user commands fail closed for it too.
create function private.require_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_banned_until timestamptz;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    perform private.raise_domain_error('AUTH_REQUIRED');
  end if;
  select u.banned_until into v_banned_until from auth.users u where u.id = v_uid and u.deleted_at is null;
  if not found then
    perform private.raise_domain_error('AUTH_REQUIRED');
  end if;
  if v_banned_until > pg_catalog.now() then
    perform private.raise_domain_error('ACCOUNT_BANNED');
  end if;
  return v_uid;
end;
$$;

-- Returns the caller's runner_profile_id when READY and ACTIVE.
create function private.require_ready_profile()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile app.runner_profile%rowtype;
begin
  select * into v_profile from app.runner_profile rp where rp.auth_user_id = private.require_actor();
  if not found then
    perform private.raise_domain_error('PROFILE_INCOMPLETE');
  end if;
  case v_profile.account_state
    when 'ACTIVE' then null;
    when 'BANNED' then perform private.raise_domain_error('ACCOUNT_BANNED');
    when 'IDENTITY_LOCKED' then perform private.raise_domain_error('IDENTITY_LOCKED');
    else perform private.raise_domain_error('FORBIDDEN');
  end case;
  if v_profile.profile_readiness <> 'READY' then
    perform private.raise_domain_error('PROFILE_INCOMPLETE');
  end if;
  return v_profile.runner_profile_id;
end;
$$;

-- Returns the caller's staff_member_id when they hold any of p_roles for p_edition_id.
create function private.require_staff(p_roles text[], p_edition_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  if not exists (select 1 from unnest(p_roles) r(role) where private.has_staff_role(r.role, p_edition_id)) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;
  return private.current_staff_member_id();
end;
$$;

create function private.require_permission(p_action text, p_edition_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  if not private.has_permission(p_action, p_edition_id) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;
  return private.current_staff_member_id();
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Audit and outbox.
-- ---------------------------------------------------------------------------------------------

-- Actor, staff and role are resolved here, never passed by callers. Snapshots must carry ids and
-- changed fields only (SEC-112).
create function private.audit(
  p_action text, p_entity_type text, p_entity_id uuid, p_edition_id uuid,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null,
  p_correlation_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_staff_id uuid := private.current_staff_member_id();
  v_role text;
  -- Pooled sessions leave the GUC as '' after a request, hence nullif.
  v_request_id text := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-request-id';
  v_id uuid;
begin
  if p_action !~ '^[A-Z][A-Z0-9_]{2,63}$' or coalesce(p_entity_type, '') !~ '^[a-z][a-z0-9_]{2,63}$'
     or (p_before is not null and jsonb_typeof(p_before) <> 'object')
     or (p_after is not null and jsonb_typeof(p_after) <> 'object') then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid audit arguments';
  end if;

  if v_staff_id is not null then
    select sra.role into v_role
    from app.staff_role_assignment sra
    where sra.staff_member_id = v_staff_id and sra.revoked_at is null
      and (sra.scope_type = 'GLOBAL' or sra.edition_id = p_edition_id)
    order by pg_catalog.array_position(array['ADMIN', 'OPERATOR', 'CHECKIN', 'MODERATOR'], sra.role),
             sra.scope_type = 'GLOBAL' desc
    limit 1;
  end if;

  insert into audit.audit_log (actor_auth_user_id, actor_staff_member_id, actor_role, action, entity_type,
    entity_id, edition_id, before_snapshot, after_snapshot, reason, correlation_id, request_id)
  values (v_uid, case when v_role is not null then v_staff_id end,
    coalesce(v_role, case when v_uid is null then 'SYSTEM' else 'RUNNER' end),
    p_action, p_entity_type, p_entity_id, p_edition_id, p_before, p_after, p_reason, p_correlation_id,
    case when v_request_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_request_id::uuid end)
  returning audit_log_id into v_id;
  return v_id;
end;
$$;

-- SEC-072: payloads carry ids, never PII, tokens or credential material.
create function private.assert_outbox_payload_safe(p_payload jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'invalid_parameter_value', message = 'outbox payload must be a json object';
  end if;
  if exists (
       with recursive nodes(value) as (
         select p_payload
         union all
         select child.value
         from nodes
         cross join lateral (
           select e.value from jsonb_each(case when jsonb_typeof(nodes.value) = 'object' then nodes.value end) e
           union all
           select a.value from jsonb_array_elements(case when jsonb_typeof(nodes.value) = 'array' then nodes.value end) a
         ) child)
       select 1
       from nodes
       where (jsonb_typeof(nodes.value) = 'object' and exists (
                select 1 from jsonb_object_keys(nodes.value) k
                where k ~* '(^|_)(e?mail|phone|full_name|display_name|name|birth|dob|address|emergency|token|hash|cipher|ciphertext|secret|password|otp)(_|$)'))
          or (jsonb_typeof(nodes.value) = 'string' and (nodes.value #>> '{}') ~ 'RN1\.')) then
    raise exception using errcode = 'invalid_parameter_value', message = 'outbox payload may only carry identifiers';
  end if;
end;
$$;

-- Idempotent on effect_key: returns the id of the new or already existing event.
create function private.enqueue_outbox(
  p_event_type text, p_aggregate_type text, p_aggregate_id uuid, p_effect_key text, p_payload jsonb,
  p_available_at timestamptz default pg_catalog.now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_event_type !~ '^[A-Z][A-Za-z0-9]{2,63}$' or p_aggregate_type !~ '^[A-Z][A-Za-z0-9]{2,63}$'
     or p_aggregate_id is null or coalesce(pg_catalog.length(p_effect_key), 0) not between 3 and 200
     or p_available_at is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid outbox arguments';
  end if;
  perform private.assert_outbox_payload_safe(p_payload);

  insert into infra.outbox_event (event_type, aggregate_type, aggregate_id, effect_key, payload, available_at)
  values (p_event_type, p_aggregate_type, p_aggregate_id, p_effect_key, p_payload, p_available_at)
  on conflict (effect_key) do nothing
  returning outbox_event_id into v_id;

  if v_id is null then
    select o.outbox_event_id into v_id from infra.outbox_event o where o.effect_key = p_effect_key;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Rate limits (ADR-001 §9, A6, SEC-141). Fixed windows; subjects are stored hashed.
-- ---------------------------------------------------------------------------------------------

create function private.consume_rate_limit(
  p_scope text, p_subject text, p_max_hits integer, p_window interval, p_raise boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if coalesce(p_scope, '') !~ '^[a-z][a-z0-9_.:]{2,63}$' or coalesce(p_subject, '') = ''
     or coalesce(p_max_hits, 0) < 1 or coalesce(p_window, interval '0') <= interval '0' then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid rate limit arguments';
  end if;

  v_window_start := pg_catalog.date_bin(p_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00');
  insert into infra.rate_limit_counter as c (scope, subject, window_start, hit_count)
  values (p_scope, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_subject, 'UTF8')), 'hex'), v_window_start, 1)
  on conflict (scope, subject, window_start) do update set hit_count = c.hit_count + 1
  returning c.hit_count into v_hits;

  if v_hits <= p_max_hits then
    return true;
  end if;
  if p_raise then
    perform private.raise_domain_error('RATE_LIMITED', jsonb_build_object('retry_after_seconds',
      greatest(1, ceil(extract(epoch from (v_window_start + p_window - pg_catalog.now())))::integer)));
  end if;
  return false;
end;
$$;

create function private.consume_policy_rate_limit(p_scope text, p_subject text, p_raise boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy infra.rate_limit_policy%rowtype;
begin
  select * into v_policy from infra.rate_limit_policy p where p.scope = p_scope;
  if not found then
    raise exception using errcode = 'invalid_parameter_value', message = 'unknown rate limit scope';
  end if;
  return private.consume_rate_limit(p_scope, p_subject, v_policy.max_hits,
    pg_catalog.make_interval(secs => v_policy.window_seconds), p_raise);
end;
$$;

-- Committed pre-check called by Next before a command (its own transaction, so failed attempts count).
create function private.consume_actor_rate_limit(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_actor();
begin
  if not exists (select 1 from infra.rate_limit_policy p where p.scope = p_scope and p.subject_kind = 'ACTOR') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'scope'));
  end if;
  perform private.consume_policy_rate_limit(p_scope, v_uid::text);
  return jsonb_build_object('allowed', true);
end;
$$;

create function public.consume_actor_rate_limit(p_scope text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.consume_actor_rate_limit(p_scope)
$$;

-- SYSTEM-only (IP/email subjects chosen by the server).
create function private.consume_subject_rate_limit(p_scope text, p_subject text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from infra.rate_limit_policy p where p.scope = p_scope and p.subject_kind = 'SUPPLIED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'scope'));
  end if;
  perform private.consume_policy_rate_limit(p_scope, p_subject);
  return jsonb_build_object('allowed', true);
end;
$$;

create function public.consume_subject_rate_limit(p_scope text, p_subject text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.consume_subject_rate_limit(p_scope, p_subject)
$$;

-- ---------------------------------------------------------------------------------------------
-- Idempotency (ADR-001 §5, A5, SEC-140). The hash is computed here from the command's own
-- canonical arguments (jsonb text is canonical); actor = auth.uid(), NULL = SYSTEM namespace.
-- Call after authorising the caller so a replay is re-authorised.
-- ---------------------------------------------------------------------------------------------

create function private.idempotency_begin(
  p_operation_key text, p_resource_scope text, p_idempotency_key text, p_args jsonb,
  p_ttl interval default interval '24 hours')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_args, 'null'::jsonb)::text, 'UTF8')), 'hex');
  v_record infra.idempotency_record%rowtype;
begin
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9._:-]{8,128}$' then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('header', 'Idempotency-Key', 'reason', 'invalid_format'));
  end if;
  if coalesce(p_operation_key, '') !~ '^[a-z][a-z0-9_.]{2,63}$' or coalesce(p_resource_scope, '') = ''
     or p_ttl is null or p_ttl < interval '24 hours' then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid idempotency arguments';
  end if;

  insert into infra.idempotency_record (actor_auth_user_id, operation_key, resource_scope, idempotency_key,
    request_hash, state, expires_at)
  values (v_uid, p_operation_key, p_resource_scope, p_idempotency_key, v_hash, 'IN_PROGRESS', pg_catalog.now() + p_ttl)
  on conflict on constraint idempotency_record_key_uq do nothing
  returning * into v_record;
  if v_record.idempotency_record_id is not null then
    return jsonb_build_object('record_id', v_record.idempotency_record_id, 'replay', false);
  end if;

  -- Two branches keep the unique index usable for both the user and the SYSTEM (NULL) namespace.
  if v_uid is null then
    select * into v_record from infra.idempotency_record r
    where r.actor_auth_user_id is null and r.operation_key = p_operation_key
      and r.resource_scope = p_resource_scope and r.idempotency_key = p_idempotency_key
    for update;
  else
    select * into v_record from infra.idempotency_record r
    where r.actor_auth_user_id = v_uid and r.operation_key = p_operation_key
      and r.resource_scope = p_resource_scope and r.idempotency_key = p_idempotency_key
    for update;
  end if;

  if v_record.expires_at <= pg_catalog.now() then
    update infra.idempotency_record
    set request_hash = v_hash, state = 'IN_PROGRESS', response_status = null, response_body = null,
        created_at = pg_catalog.now(), expires_at = pg_catalog.now() + p_ttl
    where idempotency_record_id = v_record.idempotency_record_id;
    return jsonb_build_object('record_id', v_record.idempotency_record_id, 'replay', false);
  end if;
  if v_record.request_hash <> v_hash then
    perform private.raise_domain_error('IDEMPOTENCY_CONFLICT');
  end if;
  if v_record.state <> 'COMPLETED' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('retryable', true));
  end if;
  return jsonb_build_object('record_id', v_record.idempotency_record_id, 'replay', true,
    'response_status', v_record.response_status, 'response_body', v_record.response_body);
end;
$$;

create function private.idempotency_complete(p_record_id uuid, p_status integer, p_response jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Stored responses are replayed later: never persist credential material (SEC-011/033).
  if p_response::text ~ 'RN1\.' then
    raise exception using errcode = 'invalid_parameter_value', message = 'idempotent responses must not contain credentials';
  end if;
  update infra.idempotency_record
  set state = 'COMPLETED', response_status = p_status, response_body = p_response
  where idempotency_record_id = p_record_id and state = 'IN_PROGRESS';
  if not found then
    raise exception using errcode = 'invalid_parameter_value', message = 'idempotency record is not in progress';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Closed by default; API-role grants live in 029 (after the 026 privilege sweep).
-- ---------------------------------------------------------------------------------------------

revoke all on function
  private.raise_domain_error(text, jsonb),
  private.raise_constraint_error(text, text, jsonb, jsonb),
  private.current_profile_id(),
  private.current_staff_member_id(),
  private.is_profile_ready(),
  private.is_profile_active(),
  private.has_staff_role(text, uuid),
  private.is_admin_global(),
  private.is_edition_staff(uuid),
  private.has_permission(text, uuid),
  private.owns_guest(uuid),
  private.friendship_accepted(uuid),
  private.is_public_profile(uuid),
  private.normalize_email(text),
  private.email_match_key(text),
  private.is_identity_blocked(text, text, text),
  private.is_current_identity_blocked(),
  private.current_actor(),
  public.current_actor(),
  private.require_actor(),
  private.require_ready_profile(),
  private.require_staff(text[], uuid),
  private.require_permission(text, uuid),
  private.audit(text, text, uuid, uuid, jsonb, jsonb, text, uuid),
  private.assert_outbox_payload_safe(jsonb),
  private.enqueue_outbox(text, text, uuid, text, jsonb, timestamptz),
  private.consume_rate_limit(text, text, integer, interval, boolean),
  private.consume_policy_rate_limit(text, text, boolean),
  private.consume_actor_rate_limit(text),
  public.consume_actor_rate_limit(text),
  private.consume_subject_rate_limit(text, text),
  public.consume_subject_rate_limit(text, text),
  private.idempotency_begin(text, text, text, jsonb, interval),
  private.idempotency_complete(uuid, integer, jsonb)
from public, anon, authenticated, service_role;
