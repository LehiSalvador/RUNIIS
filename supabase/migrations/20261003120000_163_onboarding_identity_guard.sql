-- 163: onboarding identity guard (AppSec H2P2-01, H2P2-05). Create-or-replace of private.complete_onboarding only:
-- same signature, so the public wrapper, its default and every grant from 160 stay as they are.
--   H2P2-01  a READY profile can no longer be rewritten through onboarding (full_name, date_of_birth, sex_code, the
--            minor / is_searchable derivation). 409 CONFLICT with detail.reason PROFILE_ALREADY_READY; an idempotent
--            replay of the request that made the profile READY still returns its stored response.
--   H2P2-05  legal_document_version_ids is required (omitted = 400 VALIDATION_ERROR, detail.field/reason); acceptance
--            is recorded only for the versions the client confirmed (client_confirmed is always true now).
-- PATCH /me/profile (update_my_profile) is untouched.

create or replace function private.complete_onboarding(
  p_full_name text, p_date_of_birth date, p_sex_code text, p_phone_e164 text,
  p_emergency_contact_name text, p_emergency_contact_phone_e164 text, p_emergency_contact_relationship text,
  p_idempotency_key text default null, p_legal_document_version_ids uuid[] default null)
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
  v_current uuid[];
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

  -- OWN-05 / H2P2-05: acceptance is never implied. The client must say which versions it displayed; omitting the
  -- list (the pre-160 "record whatever is current" form) is a validation error, not a silent acceptance.
  if p_legal_document_version_ids is null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'legal_document_version_ids', 'reason', 'REQUIRED'));
  end if;

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
        'emergency_contact_relationship', v_row.emergency_contact_relationship,
        'legal_document_version_ids', to_jsonb(p_legal_document_version_ids)));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  -- H2P2-01 (SEC-016, Master 3223-3240): onboarding is the PROFILE_INCOMPLETE -> READY transition and nothing else.
  -- Once READY, full_name / date_of_birth / sex_code (and the minor / is_searchable derivation from them) are fixed;
  -- a date of birth correction goes through the support workflow. Placed after the idempotent replay so a retry of the
  -- request that made the profile READY still returns its stored response. The row is locked above, so two concurrent
  -- first-time calls serialize and the second one lands here.
  if v_row.profile_readiness = 'READY' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'PROFILE_ALREADY_READY'));
  end if;

  -- OWN-05: the versions the client showed must be exactly the current ones (the user never accepts text that is
  -- not what is published now).
  select coalesce(array_agg(c.legal_document_version_id order by c.document_type, c.document_key), '{}') into v_current
  from private.account_legal_current_versions() c;
  if array_position(p_legal_document_version_ids, null) is not null
     or exists (select 1 from unnest(p_legal_document_version_ids) i where not (i = any (v_current))) then
    perform private.raise_domain_error('LEGAL_ACCEPTANCE_REQUIRED', jsonb_build_object(
      'reason', 'VERSION_NOT_CURRENT', 'scope', 'ACCOUNT', 'required_legal_document_version_ids', to_jsonb(v_current)));
  end if;
  if exists (select 1 from unnest(v_current) c where not (c = any (p_legal_document_version_ids))) then
    perform private.raise_domain_error('LEGAL_ACCEPTANCE_REQUIRED', jsonb_build_object(
      'reason', 'MISSING_DOCUMENTS', 'scope', 'ACCOUNT', 'required_legal_document_version_ids', to_jsonb(v_current)));
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

  -- Master §16 step 9b: record acceptance of the TERMS_OF_SERVICE/PRIVACY_NOTICE versions that were just verified to
  -- be exactly the current PUBLISHED ones (resolved server-side, never client-chosen); already-accepted versions
  -- are skipped so a resumed onboarding call never double-inserts (legal_acceptance is append-only).
  for v_doc in
    select c.legal_document_version_id from private.account_legal_current_versions() c
  loop
    insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context)
    select v_row.runner_profile_id, v_doc.legal_document_version_id, jsonb_build_object('via', 'onboarding', 'client_confirmed', true)
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
