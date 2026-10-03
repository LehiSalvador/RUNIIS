-- P2-B OWN-05 (owner decision 2026-10-03): account-level acceptance of the current PUBLISHED
-- TERMS_OF_SERVICE and PRIVACY_NOTICE. Recorded in onboarding (as since Master §16 step 9b) and
-- re-accepted whenever a newer version is published. Event documents (SPORT_WAIVER, EVENT_RULES,
-- MINOR_TERMS) stay per registration and per participant (migrations 140/142/145, unchanged).
--
-- An account-level acceptance is an app.legal_acceptance row with no edition, no request, no
-- participant and no guardian assignment. Rows are append-only (trigger); nothing here rewrites them.
-- "Current" = for each ACTIVE TERMS_OF_SERVICE / PRIVACY_NOTICE document, its highest PUBLISHED version
-- (onboarding used to pick one document per type; per document is deterministic when several are ACTIVE).
-- A document with no PUBLISHED version requires nothing: there is nothing to accept and no legal text is
-- invented.

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('legal.account.accept', 30, 3600, 'ACTOR', 'Account legal (re)acceptance per user'),
  ('legal.account.accept:cmd', 30, 3600, 'ACTOR', 'Account legal (re)acceptance per user (command)'),
  ('registration.context', 120, 600, 'ACTOR', 'Registration context reads per user')
on conflict (scope) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Current account-level documents and per-profile status.
-- ---------------------------------------------------------------------------------------------
create function private.account_legal_current_versions()
returns table (legal_document_id uuid, document_type text, document_key text, legal_document_version_id uuid,
  version integer, published_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (ld.legal_document_id) ld.legal_document_id, ld.document_type, ld.document_key,
    ldv.legal_document_version_id, ldv.version, ldv.published_at
  from app.legal_document ld
  join app.legal_document_version ldv on ldv.legal_document_id = ld.legal_document_id and ldv.status = 'PUBLISHED'
  where ld.document_type in ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE') and ld.status = 'ACTIVE'
  order by ld.legal_document_id, ldv.version desc
$$;

-- {needs_acceptance, needs_reacceptance, missing_document_version_ids, documents[]}.
-- status per document: ACCEPTED | NEVER_ACCEPTED | NEW_VERSION (an older version of that type was accepted).
-- needs_reacceptance is true when any document is NEW_VERSION; needs_acceptance when any is not ACCEPTED.
create function private.account_legal_status(p_runner_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with doc as (
    select c.legal_document_id, c.document_type, c.document_key, c.legal_document_version_id, c.version, c.published_at,
      (select min(la.accepted_at) from app.legal_acceptance la
       where la.runner_profile_id = p_runner_profile_id and la.legal_document_version_id = c.legal_document_version_id
         and la.edition_id is null and la.registration_request_id is null and la.participant_runner_profile_id is null
         and la.guardian_assignment_id is null) as accepted_at,
      (select max(v.version) from app.legal_acceptance la
       join app.legal_document_version v on v.legal_document_version_id = la.legal_document_version_id
       where la.runner_profile_id = p_runner_profile_id and v.legal_document_id = c.legal_document_id
         and la.edition_id is null and la.registration_request_id is null and la.participant_runner_profile_id is null
         and la.guardian_assignment_id is null) as accepted_version
    from private.account_legal_current_versions() c
  ), shaped as (
    select d.*, case when d.accepted_at is not null then 'ACCEPTED'
                     when d.accepted_version is not null then 'NEW_VERSION'
                     else 'NEVER_ACCEPTED' end as status
    from doc d
  )
  select jsonb_build_object(
    'needs_acceptance', coalesce(bool_or(s.status <> 'ACCEPTED'), false),
    'needs_reacceptance', coalesce(bool_or(s.status = 'NEW_VERSION'), false),
    'missing_document_version_ids', coalesce(jsonb_agg(s.legal_document_version_id order by s.document_type, s.document_key)
      filter (where s.status <> 'ACCEPTED'), '[]'::jsonb),
    'documents', coalesce(jsonb_agg(jsonb_build_object(
        'document_type', s.document_type, 'document_key', s.document_key,
        'legal_document_version_id', s.legal_document_version_id, 'version', s.version, 'published_at', s.published_at,
        'status', s.status, 'accepted_at', s.accepted_at, 'accepted_version', s.accepted_version)
      order by s.document_type, s.document_key), '[]'::jsonb))
  from shaped s
$$;

-- Caller's profile for account-level legal reads/commands. Unlike registration_require_viewer it does not
-- need READY (onboarding screens read it) but still refuses banned/deactivated accounts.
create function private.legal_require_profile()
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
  if v_profile.account_state = 'BANNED' then
    perform private.raise_domain_error('ACCOUNT_BANNED');
  elsif v_profile.account_state not in ('ACTIVE', 'IDENTITY_LOCKED') then
    perform private.raise_domain_error('FORBIDDEN');
  end if;
  return v_profile.runner_profile_id;
end;
$$;

create function private.get_my_legal_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.legal_require_profile();
begin
  return private.account_legal_status(v_profile_id) || jsonb_build_object('server_time', pg_catalog.now());
end;
$$;

-- Re-acceptance (and first acceptance when onboarding recorded none). Only versions that are CURRENT
-- can be accepted: a stale id fails with LEGAL_ACCEPTANCE_REQUIRED/VERSION_NOT_CURRENT and the current
-- list, so a user never accepts text newer than what they saw nor an older text.
create function private.accept_account_legal_documents(p_legal_document_version_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.legal_require_profile();
  v_ids uuid[];
  v_current uuid[];
  v_new uuid[];
begin
  if p_legal_document_version_ids is null or array_position(p_legal_document_version_ids, null) is not null
     or pg_catalog.cardinality(p_legal_document_version_ids) not between 1 and 10 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'legal_document_version_ids'));
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_legal_document_version_ids) x;
  select coalesce(array_agg(c.legal_document_version_id order by c.document_type, c.document_key), '{}') into v_current
  from private.account_legal_current_versions() c;
  if exists (select 1 from unnest(v_ids) i where not (i = any (v_current))) then
    perform private.raise_domain_error('LEGAL_ACCEPTANCE_REQUIRED', jsonb_build_object(
      'reason', 'VERSION_NOT_CURRENT', 'scope', 'ACCOUNT', 'required_legal_document_version_ids', to_jsonb(v_current)));
  end if;
  perform private.consume_policy_rate_limit('legal.account.accept:cmd', auth.uid()::text);

  -- Serialises double submits of the same profile: legal_acceptance has no natural unique key.
  perform 1 from app.runner_profile rp where rp.runner_profile_id = v_profile_id for update;
  with ins as (
    insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context)
    select v_profile_id, i, jsonb_build_object('via', 'reacceptance')
    from unnest(v_ids) i
    where not exists (
      select 1 from app.legal_acceptance la
      where la.runner_profile_id = v_profile_id and la.legal_document_version_id = i
        and la.edition_id is null and la.registration_request_id is null and la.participant_runner_profile_id is null
        and la.guardian_assignment_id is null)
    returning legal_document_version_id)
  select coalesce(array_agg(legal_document_version_id), '{}') into v_new from ins;
  if pg_catalog.cardinality(v_new) > 0 then
    perform private.audit('ACCOUNT_LEGAL_ACCEPTED', 'runner_profile', v_profile_id, null, null,
      jsonb_build_object('legal_document_version_ids', to_jsonb(v_new), 'via', 'reacceptance'));
  end if;
  return private.account_legal_status(v_profile_id) || jsonb_build_object('server_time', pg_catalog.now());
end;
$$;

create function public.get_my_legal_status()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_my_legal_status() $$;
create function public.accept_account_legal_documents(p_legal_document_version_ids uuid[])
returns jsonb language sql security invoker set search_path = ''
as $$ select private.accept_account_legal_documents(p_legal_document_version_ids) $$;

revoke all on function
  private.account_legal_current_versions(),
  private.account_legal_status(uuid),
  private.legal_require_profile(),
  private.get_my_legal_status(), public.get_my_legal_status(),
  private.accept_account_legal_documents(uuid[]), public.accept_account_legal_documents(uuid[])
from public, anon, authenticated, service_role;
grant execute on function
  private.get_my_legal_status(), public.get_my_legal_status(),
  private.accept_account_legal_documents(uuid[]), public.accept_account_legal_documents(uuid[])
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- complete_onboarding: optional p_legal_document_version_ids (the versions the client displayed). The
-- 8-argument form keeps working (records the current versions, Master §16 step 9b). Adding a parameter
-- changes the signature, so the old function is dropped and recreated with the same grants.
-- ---------------------------------------------------------------------------------------------
drop function public.complete_onboarding(text, date, text, text, text, text, text, text);
drop function private.complete_onboarding(text, date, text, text, text, text, text, text);

create function private.complete_onboarding(
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

  -- OWN-05: when the client says which versions it showed, they must be exactly the current ones (the
  -- user never accepts text that is not what is published now). Omitted = legacy behaviour below.
  if p_legal_document_version_ids is not null then
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
    select c.legal_document_version_id from private.account_legal_current_versions() c
  loop
    insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context)
    select v_row.runner_profile_id, v_doc.legal_document_version_id, jsonb_build_object('via', 'onboarding', 'client_confirmed', p_legal_document_version_ids is not null)
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

create function public.complete_onboarding(
  p_full_name text, p_date_of_birth date, p_sex_code text, p_phone_e164 text,
  p_emergency_contact_name text, p_emergency_contact_phone_e164 text, p_emergency_contact_relationship text,
  p_idempotency_key text default null, p_legal_document_version_ids uuid[] default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.complete_onboarding(p_full_name, p_date_of_birth, p_sex_code, p_phone_e164,
    p_emergency_contact_name, p_emergency_contact_phone_e164, p_emergency_contact_relationship, p_idempotency_key,
    p_legal_document_version_ids)
$$;
revoke all on function
  private.complete_onboarding(text, date, text, text, text, text, text, text, uuid[]),
  public.complete_onboarding(text, date, text, text, text, text, text, text, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function
  private.complete_onboarding(text, date, text, text, text, text, text, text, uuid[]),
  public.complete_onboarding(text, date, text, text, text, text, text, text, uuid[])
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- create_registration_request: same body as migration 142 plus the account-level legal gate (step 0).
-- create or replace keeps the existing grants.
-- ---------------------------------------------------------------------------------------------
create or replace function private.create_registration_request(
  p_edition_id uuid, p_participants jsonb, p_legal_acceptances jsonb default '[]'::jsonb,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := private.require_ready_profile();
  v_acceptances jsonb := coalesce(p_legal_acceptances, '[]'::jsonb);
  v_edition app.edition%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_idem jsonb;
  v_count integer;
  v_index integer;
  v_item jsonb;
  v_kind text;
  v_runner uuid;
  v_guest uuid;
  v_modality_id uuid;
  v_category_id uuid;
  v_kit_definition_id uuid;
  v_kit_variant_id uuid;
  v_seen text[] := '{}';
  v_result jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_price jsonb;
  v_currency text;
  v_total bigint := 0;
  v_needs jsonb := '{}'::jsonb;
  v_whatsapp text;
  v_existing uuid;
  v_acceptance jsonb;
  v_version_id uuid;
  v_acceptor record;
  v_missing uuid[];
  v_expires_at timestamptz;
  v_request_id uuid;
  v_request_participant_id uuid;
  v_constraint text;
  v_account_legal jsonb;
begin
  if p_edition_id is null or jsonb_typeof(p_participants) is distinct from 'array' then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'participants'));
  end if;
  v_count := jsonb_array_length(p_participants);
  if v_count not between 1 and 20 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'participants', 'reason', 'count'));
  end if;
  if jsonb_typeof(v_acceptances) <> 'array' or jsonb_array_length(v_acceptances) > 100 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'legal_acceptances'));
  end if;

  select * into v_edition from app.edition e where e.edition_id = p_edition_id;
  if not found or v_edition.publication_state <> 'PUBLISHED' then
    perform private.raise_domain_error('NOT_FOUND');
  end if;

  perform private.consume_policy_rate_limit('registration_request.create:cmd', auth.uid()::text);
  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('registration_request.create', p_edition_id::text, p_idempotency_key,
      jsonb_build_object('edition_id', p_edition_id, 'participants', p_participants, 'legal_acceptances', v_acceptances));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  -- 0. OWN-05 account-level legal gate: the buyer must have accepted the CURRENT TERMS_OF_SERVICE and
  -- PRIVACY_NOTICE (when published). After the idempotency replay so a stored success is still returned.
  v_account_legal := private.account_legal_status(v_buyer);
  if (v_account_legal ->> 'needs_acceptance')::boolean then
    perform private.raise_domain_error('LEGAL_ACCEPTANCE_REQUIRED', jsonb_build_object(
      'reason', 'ACCOUNT_DOCUMENTS', 'scope', 'ACCOUNT',
      'needs_reacceptance', (v_account_legal ->> 'needs_reacceptance')::boolean,
      'missing_document_version_ids', v_account_legal -> 'missing_document_version_ids'));
  end if;

  -- 1. Edition lock, then preconditions on the locked row (Master §65).
  select * into v_edition from app.edition e where e.edition_id = p_edition_id for update;
  if v_edition.execution_state <> 'SCHEDULED' then
    perform private.raise_domain_error('EDITION_NOT_REGISTRABLE');
  end if;
  if v_edition.registration_state = 'CLOSED' or v_now >= v_edition.registration_close_at then
    perform private.raise_domain_error('REGISTRATION_CLOSED');
  end if;
  if v_edition.registration_state <> 'OPEN' or v_now < coalesce(v_edition.registration_open_at, '-infinity') then
    perform private.raise_domain_error('REGISTRATION_NOT_OPEN');
  end if;
  if v_edition.registration_mode = 'EXTERNAL_WHATSAPP' then
    v_whatsapp := private.effective_whatsapp(p_edition_id) ->> 'phone_e164';
    if v_whatsapp is null then
      perform private.raise_domain_error('EDITION_NOT_REGISTRABLE');
    end if;
  end if;
  perform private.registration_materialise_expired(p_edition_id);

  -- 2. ModalityCapacity locks in modality_id order.
  perform 1 from app.modality_capacity mc
  where mc.modality_id in (select private.registration_jsonb_uuid(e -> 'modality_id') from jsonb_array_elements(p_participants) e)
  order by mc.modality_id
  for update;

  -- 3. Participants: shape, identity, inclusion, eligibility, category, price, duplicates, form, kit.
  for v_index in 0 .. v_count - 1 loop
    v_item := p_participants -> v_index;
    if jsonb_typeof(v_item) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_item) k
                  where k not in ('kind', 'public_profile_id', 'guest_participant_id', 'modality_id', 'category_id',
                                  'responses', 'kit_selection')) then
      perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('participant_index', v_index, 'field', 'participant'));
    end if;
    v_kind := v_item ->> 'kind';
    v_modality_id := private.registration_jsonb_uuid(v_item -> 'modality_id');
    v_category_id := private.registration_jsonb_uuid(v_item -> 'category_id');
    v_runner := null;
    v_guest := null;
    if v_kind = 'PROFILE' and v_item ? 'public_profile_id' and not v_item ? 'guest_participant_id'
       and private.registration_jsonb_uuid(v_item -> 'public_profile_id') is not null then
      v_runner := private.people_runner_id_for_public_profile(private.registration_jsonb_uuid(v_item -> 'public_profile_id'));
    elsif v_kind = 'GUEST' and v_item ? 'guest_participant_id' and not v_item ? 'public_profile_id'
       and private.registration_jsonb_uuid(v_item -> 'guest_participant_id') is not null then
      v_guest := private.registration_jsonb_uuid(v_item -> 'guest_participant_id');
    else
      perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('participant_index', v_index, 'field', 'kind'));
    end if;
    if v_modality_id is null or (v_item ? 'category_id' and v_category_id is null)
       or (v_item ? 'responses' and jsonb_typeof(v_item -> 'responses') not in ('object', 'null')) then
      perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('participant_index', v_index, 'field', 'participant'));
    end if;
    v_kit_definition_id := null;
    v_kit_variant_id := null;
    if v_item ? 'kit_selection' and jsonb_typeof(v_item -> 'kit_selection') <> 'null' then
      v_kit_definition_id := private.registration_jsonb_uuid(v_item -> 'kit_selection' -> 'kit_definition_id');
      v_kit_variant_id := private.registration_jsonb_uuid(v_item -> 'kit_selection' -> 'kit_variant_id');
      if v_kit_definition_id is null or v_kit_variant_id is null then
        perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('participant_index', v_index, 'field', 'kit_selection'));
      end if;
    end if;

    if coalesce(v_runner::text, v_guest::text) is not null then
      if (coalesce('P' || v_runner::text, 'G' || v_guest::text)) = any (v_seen) then
        perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('participant_index', v_index, 'reason', 'duplicate_participant'));
      end if;
      v_seen := v_seen || coalesce('P' || v_runner::text, 'G' || v_guest::text);
    end if;

    v_row := private.registration_participant_eligibility(v_index, p_edition_id, v_buyer, v_kind, v_runner, v_guest,
      v_modality_id, v_category_id);
    if v_row ? 'issue' then
      v_issues := v_issues || (v_row -> 'issue');
      continue;
    end if;
    v_row := v_row -> 'row';

    -- Master §38: FREE is explicit (amount 0), never inferred from a missing offer (events kernel).
    v_price := private.resolve_modality_price(v_modality_id, v_now);
    if v_price is null then
      v_issues := v_issues || jsonb_build_object('participant_index', v_index, 'code', 'MODALITY_NOT_AVAILABLE',
        'reasons', jsonb_build_array('NO_PRICE'));
      continue;
    end if;
    v_row := v_row || jsonb_build_object('price_offer_id', v_price -> 'price_offer_id',
      'amount_minor', (v_price ->> 'amount_minor')::bigint, 'currency', v_price ->> 'currency');
    if v_currency is null then
      v_currency := v_row ->> 'currency';
    elsif v_currency <> v_row ->> 'currency' then
      v_issues := v_issues || jsonb_build_object('participant_index', v_index, 'code', 'MODALITY_NOT_AVAILABLE',
        'reasons', jsonb_build_array('MIXED_CURRENCY'));
      continue;
    end if;

    v_issues := v_issues || private.registration_response_issues(v_index, p_edition_id, v_modality_id, v_item -> 'responses');

    if v_kit_definition_id is not null then
      if not exists (
        select 1 from app.kit_definition kd
        join app.kit_variant kv on kv.kit_definition_id = kd.kit_definition_id
        where kd.kit_definition_id = v_kit_definition_id and kv.kit_variant_id = v_kit_variant_id
          and kd.edition_id = p_edition_id and kd.status = 'ACTIVE' and kv.status = 'ACTIVE') then
        v_issues := v_issues || jsonb_build_object('participant_index', v_index, 'code', 'FORM_INVALID',
          'field_key', 'kit_selection', 'reason', 'invalid_kit');
      elsif exists (
        select 1 from app.kit_variant kv
        where kv.kit_variant_id = v_kit_variant_id and kv.capacity is not null
          and kv.capacity <= (select count(*) from app.kit_allocation a
                              where a.kit_variant_id = kv.kit_variant_id and a.status <> 'CANCELED')) then
        v_issues := v_issues || jsonb_build_object('participant_index', v_index, 'code', 'FORM_INVALID',
          'field_key', 'kit_selection', 'reason', 'kit_variant_unavailable');
      end if;
    end if;

    v_rows := v_rows || (v_row || jsonb_build_object('index', v_index, 'kind', v_kind, 'runner_profile_id', v_runner,
      'guest_participant_id', v_guest, 'modality_id', v_modality_id, 'responses', coalesce(v_item -> 'responses', '{}'::jsonb),
      'kit_definition_id', v_kit_definition_id, 'kit_variant_id', v_kit_variant_id));
    v_total := v_total + (v_row ->> 'amount_minor')::bigint;
    v_needs := v_needs || jsonb_build_object(v_modality_id::text, coalesce((v_needs ->> v_modality_id::text)::integer, 0) + 1);
  end loop;
  perform private.registration_raise_issues(v_issues);

  -- 4. One effective PENDING request per buyer and Edition (Master §179).
  if v_edition.registration_mode = 'EXTERNAL_WHATSAPP' then
    select r.registration_request_id into v_existing
    from app.registration_request r
    where r.buyer_profile_id = v_buyer and r.edition_id = p_edition_id and r.status = 'PENDING_CONFIRMATION';
    if v_existing is not null then
      perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'PENDING_REQUEST_EXISTS',
        'registration_request_id', v_existing));
    end if;
  end if;

  -- 5. Capacity recomputed under the locks (Master §37).
  perform private.registration_assert_capacity(p_edition_id, v_needs);

  -- 6. Legal acceptance (Master §124, SEC-013): the buyer may accept only where the buyer is the valid acceptor.
  for v_acceptance in select a from jsonb_array_elements(v_acceptances) a loop
    v_index := case when jsonb_typeof(v_acceptance -> 'participant_index') = 'number'
                         and (v_acceptance ->> 'participant_index') ~ '^\d{1,2}$'
                    then (v_acceptance ->> 'participant_index')::integer end;
    v_version_id := private.registration_jsonb_uuid(v_acceptance -> 'legal_document_version_id');
    if jsonb_typeof(v_acceptance) <> 'object' or v_index is null or v_index >= v_count or v_version_id is null
       or exists (select 1 from jsonb_object_keys(v_acceptance) k where k not in ('participant_index', 'legal_document_version_id')) then
      perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'legal_acceptances'));
    end if;
    select r into v_row from jsonb_array_elements(v_rows) r where (r ->> 'index')::integer = v_index;
    select * into v_acceptor from private.registration_acceptor_assignment(v_buyer,
      (v_row ->> 'runner_profile_id')::uuid, (v_row ->> 'guest_participant_id')::uuid, (v_row ->> 'is_minor')::boolean);
    if not v_acceptor.allowed then
      perform private.raise_domain_error('LEGAL_ACCEPTANCE_REQUIRED', jsonb_build_object('participant_index', v_index,
        'reason', 'ACCEPTOR_NOT_ALLOWED'));
    end if;
    if not exists (select 1 from private.registration_required_documents(p_edition_id, (v_row ->> 'is_minor')::boolean) d
                   where d.legal_document_version_id = v_version_id) then
      perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'legal_acceptances',
        'participant_index', v_index, 'reason', 'document_not_applicable'));
    end if;
  end loop;

  for v_row in select r from jsonb_array_elements(v_rows) r loop
    v_index := (v_row ->> 'index')::integer;
    v_missing := array(
      select m from unnest(private.registration_missing_documents(p_edition_id, (v_row ->> 'runner_profile_id')::uuid,
        (v_row ->> 'guest_participant_id')::uuid, (v_row ->> 'is_minor')::boolean)) m
      where not exists (select 1 from jsonb_array_elements(v_acceptances) a
                        where (a ->> 'participant_index')::integer = v_index
                          and private.registration_jsonb_uuid(a -> 'legal_document_version_id') = m));
    if pg_catalog.cardinality(v_missing) > 0 then
      select * into v_acceptor from private.registration_acceptor_assignment(v_buyer,
        (v_row ->> 'runner_profile_id')::uuid, (v_row ->> 'guest_participant_id')::uuid, (v_row ->> 'is_minor')::boolean);
      -- EXTERNAL_WHATSAPP may wait for another acceptor until staff confirmation; FREE confirms now.
      if v_acceptor.allowed or v_edition.registration_mode = 'FREE' then
        v_issues := v_issues || jsonb_build_object('participant_index', v_index, 'code', 'LEGAL_ACCEPTANCE_REQUIRED',
          'reason', case when v_acceptor.allowed then 'BUYER_ACCEPTANCE_MISSING' else 'PARTICIPANT_ACCEPTANCE_PENDING' end,
          'missing_document_version_ids', to_jsonb(v_missing));
      end if;
    end if;
  end loop;
  perform private.registration_raise_issues(v_issues);

  -- 7. Mutations.
  if v_edition.registration_mode = 'EXTERNAL_WHATSAPP' then
    v_expires_at := least(v_now + interval '24 hours', v_edition.registration_close_at);
  end if;
  insert into app.registration_request (public_reference, buyer_profile_id, edition_id, registration_mode, currency,
    total_snapshot_minor, whatsapp_phone_snapshot, expires_at)
  values (private.registration_new_public_reference(), v_buyer, p_edition_id, v_edition.registration_mode, v_currency,
    v_total, v_whatsapp, v_expires_at)
  returning registration_request_id into v_request_id;

  for v_row in select r from jsonb_array_elements(v_rows) r order by (r ->> 'index')::integer loop
    v_index := (v_row ->> 'index')::integer;
    insert into app.registration_request_participant (registration_request_id, participant_kind, runner_profile_id,
      guest_participant_id, modality_id, category_id, price_offer_id, price_snapshot_minor, currency, eligibility_snapshot,
      created_at)
    values (v_request_id, v_row ->> 'kind', (v_row ->> 'runner_profile_id')::uuid, (v_row ->> 'guest_participant_id')::uuid,
      (v_row ->> 'modality_id')::uuid, (v_row ->> 'category_id')::uuid, (v_row ->> 'price_offer_id')::uuid,
      (v_row ->> 'amount_minor')::bigint, v_row ->> 'currency', v_row -> 'eligibility_snapshot',
      v_now + make_interval(secs => v_index / 1000.0))
    returning request_participant_id into v_request_participant_id;

    insert into app.registration_field_response (request_participant_id, registration_form_field_id, value_json, field_snapshot)
    select v_request_participant_id, ff.registration_form_field_id, v_row -> 'responses' -> ff.field_key,
      jsonb_build_object('field_key', ff.field_key, 'label', ff.label, 'field_type', ff.field_type,
        'registration_form_id', f.registration_form_id, 'form_version', f.version)
    from app.registration_form f
    join app.registration_form_field ff on ff.registration_form_id = f.registration_form_id
    where f.edition_id = p_edition_id and f.status = 'PUBLISHED'
      and (f.modality_id is null or f.modality_id = (v_row ->> 'modality_id')::uuid)
      and jsonb_typeof(v_row -> 'responses' -> ff.field_key) is not null
      and jsonb_typeof(v_row -> 'responses' -> ff.field_key) <> 'null'
      and not (jsonb_typeof(v_row -> 'responses' -> ff.field_key) = 'string'
               and pg_catalog.btrim(v_row -> 'responses' ->> ff.field_key) = '');

    if v_row ->> 'kit_definition_id' is not null then
      insert into app.kit_selection (request_participant_id, kit_definition_id, kit_variant_id)
      values (v_request_participant_id, (v_row ->> 'kit_definition_id')::uuid, (v_row ->> 'kit_variant_id')::uuid);
    end if;

    insert into app.registration_participant_claim (edition_id, registration_request_id, request_participant_id,
      runner_profile_id, guest_participant_id, expires_at)
    values (p_edition_id, v_request_id, v_request_participant_id, (v_row ->> 'runner_profile_id')::uuid,
      (v_row ->> 'guest_participant_id')::uuid, v_expires_at);

    select * into v_acceptor from private.registration_acceptor_assignment(v_buyer,
      (v_row ->> 'runner_profile_id')::uuid, (v_row ->> 'guest_participant_id')::uuid, (v_row ->> 'is_minor')::boolean);
    if v_acceptor.allowed then
      perform private.registration_record_acceptances(v_buyer, p_edition_id, v_request_id,
        (v_row ->> 'runner_profile_id')::uuid, (v_row ->> 'guest_participant_id')::uuid, v_acceptor.guardian_assignment_id,
        array(select private.registration_jsonb_uuid(a -> 'legal_document_version_id')
              from jsonb_array_elements(v_acceptances) a where (a ->> 'participant_index')::integer = v_index),
        'REGISTRATION_REQUEST');
    end if;
  end loop;

  if v_edition.registration_mode = 'EXTERNAL_WHATSAPP' then
    insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at)
    select v_request_id, (n.key)::uuid, (n.value)::integer, v_expires_at from jsonb_each_text(v_needs) n;
  end if;

  perform private.enqueue_outbox('RegistrationRequestCreated', 'RegistrationRequest', v_request_id,
    'RegistrationRequestCreated:' || v_request_id,
    jsonb_build_object('registration_request_id', v_request_id, 'edition_id', p_edition_id,
      'registration_mode', v_edition.registration_mode));

  if v_edition.registration_mode = 'FREE' then
    perform private.registration_confirm_internal(v_request_id, 'FREE_AUTO', null, false);
  end if;

  v_result := private.registration_request_view(v_request_id, v_buyer, false);
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 201, v_result);
  end if;
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint, jsonb_build_object(
    'registration_participant_claim_active_profile_uidx', 'PARTICIPANT_ALREADY_HELD',
    'registration_participant_claim_active_guest_uidx', 'PARTICIPANT_ALREADY_HELD',
    'registration_confirmed_profile_uidx', 'DUPLICATE_REGISTRATION',
    'registration_confirmed_guest_uidx', 'DUPLICATE_REGISTRATION',
    'registration_request_buyer_pending_uidx', 'CONFLICT'));
end;
$$;
