-- Onboarding commands (Master §15-16, §18-19, ADR-001 A7). Self-contained: no dependency on other
-- domains' migrations even where a later one runs first alphabetically inside the same day.

-- ---------------------------------------------------------------------------------------------
-- Field validation (shared by onboarding and profile updates).
-- ---------------------------------------------------------------------------------------------

-- Collapses internal whitespace and trims; NULL/blank stays NULL so "required" checks catch it.
create function private.auth_clean_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(pg_catalog.regexp_replace(p_value, '\s+', ' ', 'g')), '')
$$;

-- Phone + emergency contact fields only (Master §160; shared by onboarding and update_my_profile).
create function private.validate_runner_contact_fields(p_row app.runner_profile)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_invalid text;
begin
  v_invalid := case
    when p_row.phone_e164 is null or p_row.phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then 'phone_e164'
    when p_row.emergency_contact_name is null or char_length(p_row.emergency_contact_name) not between 2 and 120
      or p_row.emergency_contact_name ~ '[[:cntrl:]]' then 'emergency_contact_name'
    when p_row.emergency_contact_phone_e164 is null or p_row.emergency_contact_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
      then 'emergency_contact_phone_e164'
    when p_row.emergency_contact_relationship is null or char_length(p_row.emergency_contact_relationship) > 60
      or p_row.emergency_contact_relationship ~ '[[:cntrl:]]' then 'emergency_contact_relationship'
  end;
  if v_invalid is not null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', v_invalid, 'reason', 'invalid'));
  end if;
end;
$$;

-- Every universal READY field (Master §15). Ages 15-17 are admitted as minors; under 15 is out (§19).
create function private.validate_runner_onboarding_fields(p_row app.runner_profile)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_invalid text;
  v_age integer;
begin
  v_invalid := case
    when p_row.full_name is null or char_length(p_row.full_name) not between 2 and 120
      or p_row.full_name ~ '[[:cntrl:]]' then 'full_name'
    when p_row.date_of_birth is null or p_row.date_of_birth > (pg_catalog.now() at time zone 'America/Monterrey')::date
      then 'date_of_birth'
    when p_row.sex_code is null or p_row.sex_code not in ('F', 'M', 'X') then 'sex_code'
  end;
  if v_invalid is not null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', v_invalid, 'reason', 'invalid'));
  end if;
  perform private.validate_runner_contact_fields(p_row);

  v_age := extract(year from age((pg_catalog.now() at time zone 'America/Monterrey')::date, p_row.date_of_birth))::integer;
  if v_age < 15 then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "date_of_birth", "reason": "UNDER_MIN_AGE"}');
  end if;
  if v_age > 120 then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "date_of_birth", "reason": "invalid"}');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Projection (Account API, Master §166). Never includes another user's data (definer, scoped by uid).
-- ---------------------------------------------------------------------------------------------

create function private.build_my_profile(p_auth_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'runner_profile_id', rp.runner_profile_id,
    'profile_readiness', rp.profile_readiness,
    'account_state', rp.account_state,
    'full_name', rp.full_name,
    'date_of_birth', rp.date_of_birth,
    'sex_code', rp.sex_code,
    'phone_e164', rp.phone_e164,
    'emergency_contact_name', rp.emergency_contact_name,
    'emergency_contact_phone_e164', rp.emergency_contact_phone_e164,
    'emergency_contact_relationship', rp.emergency_contact_relationship,
    'ready_at', rp.ready_at,
    'community', case when cp.runner_profile_id is null then null else jsonb_build_object(
      'public_profile_id', cp.public_profile_id,
      'display_name', cp.display_name,
      'competition_status', cp.competition_status,
      'is_visible', cp.is_visible,
      'is_searchable', cp.is_searchable) end)
  from app.runner_profile rp
  left join app.community_profile cp on cp.runner_profile_id = rp.runner_profile_id
  where rp.auth_user_id = p_auth_user_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Commands.
-- ---------------------------------------------------------------------------------------------

-- Idempotent: creates PROFILE_INCOMPLETE the first time, otherwise a no-op read. Called right after
-- sign-in so a profile row always exists before the client asks (Master §16 steps 1-3).
create function private.ensure_runner_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_actor();
begin
  if private.is_current_identity_blocked() then
    perform private.raise_domain_error('IDENTITY_LOCKED');
  end if;
  insert into app.runner_profile (auth_user_id) values (v_uid)
  on conflict (auth_user_id) do nothing;
  return private.build_my_profile(v_uid);
exception when integrity_constraint_violation or data_exception then
  perform private.raise_constraint_error(sqlstate, null);
end;
$$;

-- Master §16: validates, computes minor status, creates/updates CommunityProfile, marks READY,
-- records acceptance of the current PUBLISHED legal documents (when any exist) and emits ProfileReady.
-- Resumable: re-running with corrected fields before READY is a normal retry, not a new profile.
create function private.complete_onboarding(
  p_full_name text, p_date_of_birth date, p_sex_code text, p_phone_e164 text,
  p_emergency_contact_name text, p_emergency_contact_phone_e164 text, p_emergency_contact_relationship text,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_actor();
  v_row app.runner_profile;
  v_age integer;
  v_competition_status text;
  v_is_searchable boolean;
  v_idem jsonb;
  v_result jsonb;
  v_constraint text;
  v_doc record;
begin
  if private.is_current_identity_blocked() then
    perform private.raise_domain_error('IDENTITY_LOCKED');
  end if;

  insert into app.runner_profile (auth_user_id) values (v_uid)
  on conflict (auth_user_id) do nothing;

  select * into v_row from app.runner_profile rp where rp.auth_user_id = v_uid for update;
  case v_row.account_state
    when 'ACTIVE' then null;
    when 'BANNED' then perform private.raise_domain_error('ACCOUNT_BANNED');
    when 'IDENTITY_LOCKED' then perform private.raise_domain_error('IDENTITY_LOCKED');
    else perform private.raise_domain_error('FORBIDDEN');
  end case;

  v_row.full_name := private.auth_clean_text(p_full_name);
  v_row.date_of_birth := p_date_of_birth;
  v_row.sex_code := p_sex_code;
  v_row.phone_e164 := private.auth_clean_text(p_phone_e164);
  v_row.emergency_contact_name := private.auth_clean_text(p_emergency_contact_name);
  v_row.emergency_contact_phone_e164 := private.auth_clean_text(p_emergency_contact_phone_e164);
  v_row.emergency_contact_relationship := private.auth_clean_text(p_emergency_contact_relationship);
  perform private.validate_runner_onboarding_fields(v_row);
  v_age := extract(year from age((pg_catalog.now() at time zone 'America/Monterrey')::date, v_row.date_of_birth))::integer;

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('auth.complete_onboarding', v_row.runner_profile_id::text, p_idempotency_key,
      jsonb_build_object('full_name', v_row.full_name, 'date_of_birth', v_row.date_of_birth, 'sex_code', v_row.sex_code,
        'phone_e164', v_row.phone_e164, 'emergency_contact_name', v_row.emergency_contact_name,
        'emergency_contact_phone_e164', v_row.emergency_contact_phone_e164,
        'emergency_contact_relationship', v_row.emergency_contact_relationship));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  v_competition_status := case when v_age between 15 and 17 then 'MINOR_NONCOMPETITIVE' else 'ELIGIBLE' end;
  v_is_searchable := v_age >= 18;

  update app.runner_profile set
    full_name = v_row.full_name, date_of_birth = v_row.date_of_birth, sex_code = v_row.sex_code,
    phone_e164 = v_row.phone_e164, emergency_contact_name = v_row.emergency_contact_name,
    emergency_contact_phone_e164 = v_row.emergency_contact_phone_e164,
    emergency_contact_relationship = v_row.emergency_contact_relationship,
    profile_readiness = 'READY', ready_at = coalesce(ready_at, pg_catalog.now())
  where runner_profile_id = v_row.runner_profile_id
  returning * into v_row;

  insert into app.community_profile (runner_profile_id, competition_status, is_searchable)
  values (v_row.runner_profile_id, v_competition_status, v_is_searchable)
  on conflict (runner_profile_id) do update
    set competition_status = excluded.competition_status, is_searchable = excluded.is_searchable;

  -- Master §16 step 9b: accept whatever TERMS_OF_SERVICE/PRIVACY_NOTICE is currently PUBLISHED, when
  -- any exists. The version is resolved server-side (never client-chosen); already-accepted versions
  -- are skipped so a resumed onboarding call never double-inserts (legal_acceptance is append-only).
  for v_doc in
    select distinct on (ld.document_type) ldv.legal_document_version_id
    from app.legal_document ld
    join app.legal_document_version ldv on ldv.legal_document_id = ld.legal_document_id and ldv.status = 'PUBLISHED'
    where ld.document_type in ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE') and ld.status = 'ACTIVE'
    order by ld.document_type, ldv.version desc
  loop
    insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context)
    select v_row.runner_profile_id, v_doc.legal_document_version_id, jsonb_build_object('via', 'onboarding')
    where not exists (
      select 1 from app.legal_acceptance la
      where la.runner_profile_id = v_row.runner_profile_id
        and la.legal_document_version_id = v_doc.legal_document_version_id);
  end loop;

  perform private.audit('PROFILE_READY', 'runner_profile', v_row.runner_profile_id, null,
    null, jsonb_build_object('profile_readiness', 'READY', 'competition_status', v_competition_status));
  perform private.enqueue_outbox('ProfileReady', 'RunnerProfile', v_row.runner_profile_id,
    'ProfileReady:' || v_row.runner_profile_id, jsonb_build_object('runner_profile_id', v_row.runner_profile_id));

  v_result := private.build_my_profile(v_uid);
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

revoke all on function
  private.ensure_runner_profile(), private.complete_onboarding(text, date, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.ensure_runner_profile() to authenticated;
grant execute on function private.complete_onboarding(text, date, text, text, text, text, text, text) to authenticated;

create function public.ensure_runner_profile()
returns jsonb language sql security invoker set search_path = '' as $$ select private.ensure_runner_profile() $$;
create function public.complete_onboarding(
  p_full_name text, p_date_of_birth date, p_sex_code text, p_phone_e164 text,
  p_emergency_contact_name text, p_emergency_contact_phone_e164 text, p_emergency_contact_relationship text,
  p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.complete_onboarding(p_full_name, p_date_of_birth, p_sex_code, p_phone_e164,
    p_emergency_contact_name, p_emergency_contact_phone_e164, p_emergency_contact_relationship, p_idempotency_key)
$$;
revoke all on function public.ensure_runner_profile(), public.complete_onboarding(text, date, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_runner_profile() to authenticated;
grant execute on function public.complete_onboarding(text, date, text, text, text, text, text, text) to authenticated;
