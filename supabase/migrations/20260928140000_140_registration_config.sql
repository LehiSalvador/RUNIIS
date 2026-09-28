-- Registration core (T34, Master §61-84): configuration and internal helpers shared by the commands in 141-144.
-- Every helper here is definer-internal (no API grant).

-- Free-text columns this module writes get bounded values (additive CHECKs).
alter table app.registration_request
  add constraint registration_request_cancel_reason check (cancel_reason is null or char_length(btrim(cancel_reason)) between 1 and 500),
  add constraint registration_request_public_reference_format check (public_reference ~ '^R-[0-9A-Z]{4}-[0-9A-Z]{4}$');
alter table app.registration
  add constraint registration_number_format check (registration_number ~ '^I-[0-9A-Z]{4}-[0-9A-Z]{4}$');
alter table app.participant_pass
  add constraint participant_pass_public_code_format check (public_code ~ '^P-[0-9A-Z]{4}-[0-9A-Z]{4}$');
alter table app.registration_confirmation
  add constraint registration_confirmation_notes check (notes is null or char_length(notes) <= 1000);
alter table app.registration_request_participant
  add constraint registration_request_participant_eligibility_snapshot check (jsonb_typeof(eligibility_snapshot) = 'object');
alter table app.registration_category_assignment
  add constraint registration_category_assignment_snapshot check (jsonb_typeof(eligibility_snapshot) = 'object');

-- Two-layer rate limits (A6/SEC-141): Next consumes the plain scope, the command the `:cmd` scope.
insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('registration_request.create:cmd', 5, 600, 'ACTOR', 'Master §179 registration request (command success path)'),
  ('pass.render_qr', 60, 600, 'ACTOR', 'SEC-141 QR render per user'),
  ('pass.render_qr:cmd', 60, 600, 'ACTOR', 'SEC-141 QR render per user (command)'),
  ('participant.export', 10, 3600, 'ACTOR', 'SEC-141 participant export per staff'),
  ('participant.export:cmd', 10, 3600, 'ACTOR', 'SEC-141 participant export per staff (command)'),
  ('legal.accept', 30, 3600, 'ACTOR', 'Edition document acceptances per user'),
  ('legal.accept:cmd', 30, 3600, 'ACTOR', 'Edition document acceptances per user (command)'),
  ('admin.mutation:cmd', 120, 60, 'ACTOR', 'Master §179 admin mutations per staff (command)')
on conflict (scope) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Identifiers
-- ---------------------------------------------------------------------------------------------

-- `<prefix>-XXXX-XXXX` in Crockford base32 (no I/L/O/U): 40 random bits, readable over the phone.
-- Not a bearer credential (SEC-032): every lookup by code is still authorised.
create function private.registration_random_code(p_prefix text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  for i in 0..7 loop
    v_code := v_code || pg_catalog.substr(v_alphabet, (pg_catalog.get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return p_prefix || '-' || pg_catalog.substr(v_code, 1, 4) || '-' || pg_catalog.substr(v_code, 5, 4);
end;
$$;

create function private.registration_new_public_reference()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    v_code := private.registration_random_code('R');
    exit when not exists (select 1 from app.registration_request r where r.public_reference = v_code);
  end loop;
  return v_code;
end;
$$;

create function private.registration_new_number()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    v_code := private.registration_random_code('I');
    exit when not exists (select 1 from app.registration r where r.registration_number = v_code);
  end loop;
  return v_code;
end;
$$;

create function private.registration_new_pass_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    v_code := private.registration_random_code('P');
    exit when not exists (select 1 from app.participant_pass p where p.public_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Client-supplied uuid inside jsonb; NULL when absent or malformed (callers raise VALIDATION_ERROR).
create function private.registration_jsonb_uuid(p_value jsonb)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) = 'string'
         and (p_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (p_value #>> '{}')::uuid
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- Eligibility rules (modality.eligibility_rules, category.eligibility_rule)
-- Schema v1: {"min_age": int, "max_age": int, "sex_codes": ["F"|"M"|"X", ...]}; {} matches everyone.
-- Age is evaluated on the Edition event date. Unknown keys never match (fail closed).
-- ---------------------------------------------------------------------------------------------
create function private.registration_rule_matches(p_rule jsonb, p_age integer, p_sex_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_rule, '{}'::jsonb) = '{}'::jsonb then true
    when jsonb_typeof(p_rule) <> 'object'
         or exists (select 1 from jsonb_object_keys(p_rule) k where k not in ('min_age', 'max_age', 'sex_codes')) then false
    else coalesce(
      (case when not p_rule ? 'min_age' then true
            when jsonb_typeof(p_rule -> 'min_age') = 'number' then p_age >= (p_rule ->> 'min_age')::numeric
            else false end)
      and (case when not p_rule ? 'max_age' then true
                when jsonb_typeof(p_rule -> 'max_age') = 'number' then p_age <= (p_rule ->> 'max_age')::numeric
                else false end)
      and (case when not p_rule ? 'sex_codes' then true
                when jsonb_typeof(p_rule -> 'sex_codes') = 'array' then (p_rule -> 'sex_codes') ? p_sex_code
                else false end),
      false)
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- Form responses (Master §41-42). options_config v1: {"options": [{"value": "S", "label": "..."}]};
-- validation_config v1: min_length/max_length (TEXT, TEXTAREA), min/max/integer (NUMBER),
-- min_date/max_date (DATE, YYYY-MM-DD), min_items/max_items (MULTISELECT).
-- Returns a reason code or NULL when the value is valid.
-- ---------------------------------------------------------------------------------------------
create function private.registration_field_value_error(
  p_field_type text, p_validation jsonb, p_options jsonb, p_value jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_options text[] := array(
    select coalesce(o ->> 'value', o #>> '{}')
    from jsonb_array_elements(case when jsonb_typeof(p_options -> 'options') = 'array' then p_options -> 'options' else '[]' end) o);
  v_text text;
  v_number numeric;
  v_items text[];
begin
  case p_field_type
    when 'TEXT', 'TEXTAREA' then
      if jsonb_typeof(p_value) <> 'string' then return 'invalid_type'; end if;
      v_text := pg_catalog.btrim(p_value #>> '{}');
      if pg_catalog.char_length(v_text) < coalesce((p_validation ->> 'min_length')::integer, 0) then return 'too_short'; end if;
      if pg_catalog.char_length(v_text) > coalesce((p_validation ->> 'max_length')::integer,
           case p_field_type when 'TEXT' then 200 else 2000 end) then return 'too_long'; end if;
    when 'SELECT' then
      if jsonb_typeof(p_value) <> 'string' or not ((p_value #>> '{}') = any (v_options)) then return 'invalid_option'; end if;
    when 'MULTISELECT' then
      if jsonb_typeof(p_value) <> 'array'
         or exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string') then
        return 'invalid_type';
      end if;
      v_items := array(select e from jsonb_array_elements_text(p_value) e);
      if exists (select 1 from unnest(v_items) i where not (i = any (v_options))) then return 'invalid_option'; end if;
      if (select count(distinct i) from unnest(v_items) i) <> coalesce(pg_catalog.cardinality(v_items), 0) then return 'duplicate_option'; end if;
      if coalesce(pg_catalog.cardinality(v_items), 0) < coalesce((p_validation ->> 'min_items')::integer, 0)
         or coalesce(pg_catalog.cardinality(v_items), 0) > coalesce((p_validation ->> 'max_items')::integer, pg_catalog.cardinality(v_options), 0) then
        return 'invalid_item_count';
      end if;
    when 'BOOLEAN' then
      if jsonb_typeof(p_value) <> 'boolean' then return 'invalid_type'; end if;
    when 'DATE' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$'
         or not pg_catalog.pg_input_is_valid(p_value #>> '{}', 'date') then
        return 'invalid_date';
      end if;
      if (p_validation ? 'min_date' and (p_value #>> '{}')::date < (p_validation ->> 'min_date')::date)
         or (p_validation ? 'max_date' and (p_value #>> '{}')::date > (p_validation ->> 'max_date')::date) then
        return 'out_of_range';
      end if;
    when 'NUMBER' then
      if jsonb_typeof(p_value) <> 'number' then return 'invalid_type'; end if;
      v_number := (p_value #>> '{}')::numeric;
      if coalesce((p_validation ->> 'integer')::boolean, false) and v_number <> pg_catalog.trunc(v_number) then return 'not_integer'; end if;
      if (p_validation ? 'min' and v_number < (p_validation ->> 'min')::numeric)
         or (p_validation ? 'max' and v_number > (p_validation ->> 'max')::numeric) then
        return 'out_of_range';
      end if;
    else
      return 'unsupported_field';
  end case;
  return null;
end;
$$;

-- Validates one participant's responses against every PUBLISHED form that applies (Edition-wide and the
-- participant's Modality). Returns issues [{participant_index, code, field_key, reason}]; [] when valid.
create function private.registration_response_issues(
  p_participant_index integer, p_edition_id uuid, p_modality_id uuid, p_responses jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_responses jsonb := coalesce(p_responses, '{}'::jsonb);
  v_issues jsonb := '[]'::jsonb;
  v_field record;
  v_value jsonb;
  v_reason text;
  v_key text;
begin
  if jsonb_typeof(v_responses) <> 'object' then
    return jsonb_build_array(jsonb_build_object('participant_index', p_participant_index, 'code', 'FORM_INVALID',
      'field_key', null, 'reason', 'invalid_type'));
  end if;

  for v_field in
    select ff.field_key, ff.field_type, ff.required, ff.validation_config, ff.options_config
    from app.registration_form f
    join app.registration_form_field ff on ff.registration_form_id = f.registration_form_id
    where f.edition_id = p_edition_id and f.status = 'PUBLISHED' and (f.modality_id is null or f.modality_id = p_modality_id)
    order by f.modality_id nulls first, ff.sort_order, ff.field_key
  loop
    v_value := v_responses -> v_field.field_key;
    if v_value is null or jsonb_typeof(v_value) = 'null'
       or (jsonb_typeof(v_value) = 'string' and pg_catalog.btrim(v_value #>> '{}') = '') then
      v_reason := case when v_field.required then 'required' end;
    else
      v_reason := private.registration_field_value_error(v_field.field_type, v_field.validation_config,
        v_field.options_config, v_value);
    end if;
    if v_reason is not null then
      v_issues := v_issues || jsonb_build_object('participant_index', p_participant_index, 'code', 'FORM_INVALID',
        'field_key', v_field.field_key, 'reason', v_reason);
    end if;
  end loop;

  for v_key in select jsonb_object_keys(v_responses) loop
    if not exists (
      select 1 from app.registration_form f
      join app.registration_form_field ff on ff.registration_form_id = f.registration_form_id
      where f.edition_id = p_edition_id and f.status = 'PUBLISHED'
        and (f.modality_id is null or f.modality_id = p_modality_id) and ff.field_key = v_key) then
      v_issues := v_issues || jsonb_build_object('participant_index', p_participant_index, 'code', 'FORM_INVALID',
        'field_key', case when v_key ~ '^[A-Za-z0-9_.-]{1,64}$' then v_key end, 'reason', 'unknown_field');
    end if;
  end loop;
  return v_issues;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Legal acceptance (Master §124, SEC-013). Applicable documents come from the events kernel
-- (private.edition_required_legal_documents: SPORT_WAIVER and this Edition's EVENT_RULES for everyone,
-- MINOR_TERMS for 15-17), current PUBLISHED version only. Acceptances are recorded per Edition.
-- Acceptor: the adult PROFILE participant themself; the owner (buyer) for an adult GUEST; an ACTIVE
-- guardian for a minor. Nobody accepts for another adult.
-- ---------------------------------------------------------------------------------------------
create function private.registration_required_documents(p_edition_id uuid, p_is_minor boolean)
returns table (legal_document_version_id uuid, document_type text, version integer)
language sql
stable
security definer
set search_path = ''
as $$
  select (d -> 'current_version' ->> 'legal_document_version_id')::uuid, d ->> 'document_type',
    (d -> 'current_version' ->> 'version')::integer
  from jsonb_array_elements(coalesce(private.edition_required_legal_documents(p_edition_id), '[]'::jsonb)) d
  where jsonb_typeof(d -> 'current_version') = 'object'
    and (d ->> 'applies_to' = 'ALL' or (p_is_minor and d ->> 'applies_to' = 'MINOR'))
$$;

-- Guardian assignments that may accept for a minor participant (same rule as participant_inclusion_check).
create function private.registration_active_guardian_assignments(p_runner_profile_id uuid, p_guest_participant_id uuid)
returns table (guardian_assignment_id uuid, guardian_profile_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select ga.guardian_assignment_id, ga.guardian_profile_id
  from app.guardian_assignment ga
  where ga.status = 'ACTIVE'
    and ((p_runner_profile_id is not null and ga.minor_runner_profile_id = p_runner_profile_id)
      or (p_guest_participant_id is not null and ga.minor_guest_participant_id = p_guest_participant_id))
    and private.people_profile_available(ga.guardian_profile_id)
    and private.people_profile_age(ga.guardian_profile_id) >= 18
$$;

-- Is p_acceptor_profile_id a valid acceptor for this participant (Master §124)? For a minor also returns
-- the guardian assignment to record with the acceptance.
create function private.registration_acceptor_assignment(
  p_acceptor_profile_id uuid, p_runner_profile_id uuid, p_guest_participant_id uuid, p_is_minor boolean,
  out allowed boolean, out guardian_assignment_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  allowed := false;
  if p_is_minor then
    select g.guardian_assignment_id into guardian_assignment_id
    from private.registration_active_guardian_assignments(p_runner_profile_id, p_guest_participant_id) g
    where g.guardian_profile_id = p_acceptor_profile_id
    limit 1;
    allowed := guardian_assignment_id is not null;
  elsif p_runner_profile_id is not null then
    allowed := p_runner_profile_id = p_acceptor_profile_id;
  else
    allowed := exists (select 1 from app.guest_participant g
                         where g.guest_participant_id = p_guest_participant_id and g.owner_profile_id = p_acceptor_profile_id);
  end if;
end;
$$;

-- Required document versions this participant still lacks for the Edition (valid acceptor only).
create function private.registration_missing_documents(
  p_edition_id uuid, p_runner_profile_id uuid, p_guest_participant_id uuid, p_is_minor boolean)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(req.legal_document_version_id order by req.document_type), '{}')
  from private.registration_required_documents(p_edition_id, p_is_minor) req
  where not exists (
    select 1
    from app.legal_acceptance la
    cross join lateral private.registration_acceptor_assignment(la.runner_profile_id, p_runner_profile_id,
      p_guest_participant_id, p_is_minor) acc
    where la.legal_document_version_id = req.legal_document_version_id
      and la.edition_id = p_edition_id
      and acc.allowed
      and (not p_is_minor or la.guardian_assignment_id = acc.guardian_assignment_id)
      and ((p_runner_profile_id is not null and la.participant_runner_profile_id = p_runner_profile_id)
        or (p_guest_participant_id is not null and la.acceptance_context ->> 'guest_participant_id' = p_guest_participant_id::text)))
$$;

-- Records p_acceptor's acceptance of the given versions for one participant; skips versions already accepted.
create function private.registration_record_acceptances(
  p_acceptor_profile_id uuid, p_edition_id uuid, p_registration_request_id uuid, p_runner_profile_id uuid,
  p_guest_participant_id uuid, p_guardian_assignment_id uuid, p_version_ids uuid[], p_source text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, edition_id, registration_request_id,
    participant_runner_profile_id, guardian_assignment_id, acceptance_context)
  select p_acceptor_profile_id, v.id, p_edition_id, p_registration_request_id, p_runner_profile_id, p_guardian_assignment_id,
    jsonb_strip_nulls(jsonb_build_object('source', p_source, 'guest_participant_id', p_guest_participant_id))
  from (select distinct unnest(p_version_ids) as id) v
  where not exists (
    select 1 from app.legal_acceptance la
    where la.runner_profile_id = p_acceptor_profile_id and la.legal_document_version_id = v.id
      and la.edition_id = p_edition_id
      and la.participant_runner_profile_id is not distinct from p_runner_profile_id
      and la.guardian_assignment_id is not distinct from p_guardian_assignment_id
      and (la.acceptance_context ->> 'guest_participant_id') is not distinct from p_guest_participant_id::text);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Expiry (Master §63/§64/§72/§152). expires_at is the authority; this only materialises it.
-- Caller holds the Edition lock (ADR-001 §3) when p_edition_id is given.
-- ---------------------------------------------------------------------------------------------
create function private.registration_materialise_expired(p_edition_id uuid, p_registration_request_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
  v_count integer := 0;
begin
  for v_request in
    update app.registration_request r
    set status = 'EXPIRED'
    where r.edition_id = p_edition_id
      and r.status = 'PENDING_CONFIRMATION'
      and r.expires_at <= pg_catalog.now()
      and (p_registration_request_id is null or r.registration_request_id = p_registration_request_id)
    returning r.registration_request_id, r.edition_id
  loop
    update app.registration_hold h set status = 'EXPIRED'
    where h.registration_request_id = v_request.registration_request_id and h.status = 'ACTIVE';
    update app.registration_participant_claim c set status = 'EXPIRED', resolved_at = pg_catalog.now()
    where c.registration_request_id = v_request.registration_request_id and c.status = 'ACTIVE';
    perform private.enqueue_outbox('RegistrationRequestExpired', 'RegistrationRequest', v_request.registration_request_id,
      'RegistrationRequestExpired:' || v_request.registration_request_id,
      jsonb_build_object('registration_request_id', v_request.registration_request_id, 'edition_id', v_request.edition_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Caller's runner profile for reads of their own registration data. IDENTITY_LOCKED keeps read access
-- to passes/requests (the lock freezes identity changes, not participation); BANNED/DEACTIVATED do not.
create function private.registration_require_viewer()
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
  if not found or v_profile.profile_readiness <> 'READY' then
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

-- Master §84: the titular sees their own pass; the buyer sees a GUEST pass they own; never a Friend's pass.
create function private.pass_viewer_allowed(p_registration_id uuid, p_viewer_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.registration r
    left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
    where r.registration_id = p_registration_id
      and (r.runner_profile_id = p_viewer_profile_id
        or (r.guest_participant_id is not null and r.buyer_profile_id = p_viewer_profile_id
            and g.owner_profile_id = p_viewer_profile_id)))
$$;

revoke all on function
  private.registration_random_code(text),
  private.registration_new_public_reference(),
  private.registration_new_number(),
  private.registration_new_pass_code(),
  private.registration_jsonb_uuid(jsonb),
  private.registration_rule_matches(jsonb, integer, text),
  private.registration_field_value_error(text, jsonb, jsonb, jsonb),
  private.registration_response_issues(integer, uuid, uuid, jsonb),
  private.registration_required_documents(uuid, boolean),
  private.registration_active_guardian_assignments(uuid, uuid),
  private.registration_acceptor_assignment(uuid, uuid, uuid, boolean),
  private.registration_missing_documents(uuid, uuid, uuid, boolean),
  private.registration_record_acceptances(uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text),
  private.registration_materialise_expired(uuid, uuid),
  private.registration_require_viewer(),
  private.pass_viewer_allowed(uuid, uuid)
from public, anon, authenticated, service_role;
