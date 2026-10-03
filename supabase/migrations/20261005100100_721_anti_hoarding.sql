-- P3-D anti-hoarding (owner decision OD-P2-01, PHASE_3_PACKET section 2). A single OTP account could hold up to 20 places
-- for 24 h through Guests. Three measures, none of which auto-cancels anything:
--
--   1. ALTCHA proof of work, required ONLY when the request is EXTERNAL_WHATSAPP and the buyer account is younger than
--      the policy window (default 24 h) by SERVER time (auth.users.created_at). The challenge is verified in Next
--      (HMAC + proof of work + single use, lib/server/domain/communications/captcha.ts) which then mints a short-lived,
--      single-use CLEARANCE row for (auth user, Edition). create_registration_request consumes that clearance inside its
--      own transaction, BEFORE any capacity, hold or lock work. The RPC is callable by `authenticated`, so the rule has to
--      live here: a caller that skips the HTTP route has no clearance and is refused; a stored idempotent replay is
--      returned before the gate (nothing new is created); a failed command rolls the consumption back with everything else.
--   2. An edition-level alert (one admin task `hold-concentration:{edition}`, ACTION_REQUIRED) when PENDING holds look like
--      hoarding. Thresholds are rows of private.anti_hoarding_policy (defaults and rationale: evidence policy.md).
--   3. Staff bulk cancellation of PENDING requests (migration 722).
--
-- auth.users.created_at is NULL only for rows inserted by raw SQL fixtures (GoTrue always stamps it on every real account,
-- and a user cannot write it); a NULL age is therefore treated as "not new" so the pre-existing pgTAP fixtures keep
-- representing established accounts.

create table private.anti_hoarding_policy (
  settings_id smallint primary key check (settings_id = 1),
  -- OD-P2-01: accounts younger than this need the ALTCHA challenge for an EXTERNAL_WHATSAPP request.
  captcha_new_account_hours integer not null default 24 check (captcha_new_account_hours between 1 and 168),
  -- A PENDING request from a new account holding at least this many places counts as a "large new-account hold".
  large_hold_min_places integer not null default 5 check (large_hold_min_places between 2 and 20),
  -- Alert when large new-account holds reach this share of the Edition capacity AND at least the absolute floor.
  new_account_hold_share_percent numeric(5, 2) not null default 10 check (new_account_hold_share_percent > 0 and new_account_hold_share_percent <= 100),
  new_account_hold_min_places integer not null default 10 check (new_account_hold_min_places >= 1),
  -- Alert when ONE account holds at least this many places, whatever its age.
  single_buyer_hold_places integer not null default 10 check (single_buyer_hold_places between 2 and 20),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict
);
alter table private.anti_hoarding_policy enable row level security;
insert into private.anti_hoarding_policy (settings_id) values (1);
create trigger touch_updated_at before update on private.anti_hoarding_policy
  for each row execute function private.touch_updated_at();

-- Single-use clearance minted by the server after it verified an ALTCHA solution (SYSTEM only).
create table private.registration_captcha_clearance (
  -- No foreign keys: every FK of the schema is ON DELETE RESTRICT (010) and a clearance is a 10-minute token that must never block
  -- deleting a user or an Edition; the mint prunes expired rows.
  auth_user_id uuid not null,
  edition_id uuid not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (auth_user_id, edition_id),
  check (expires_at > granted_at)
);
alter table private.registration_captcha_clearance enable row level security;
create index registration_captcha_clearance_expires_idx on private.registration_captcha_clearance (expires_at);

-- ---------------------------------------------------------------------------------------------
-- Account age and clearance
-- ---------------------------------------------------------------------------------------------
create function private.registration_account_is_new(p_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.created_at > pg_catalog.now() - pg_catalog.make_interval(hours => p.captcha_new_account_hours)
    from auth.users u
    cross join private.anti_hoarding_policy p
    where u.id = p_auth_user_id and p.settings_id = 1), false)
$$;

-- What the participant UI needs before submitting: does the challenge apply to the caller on this Edition?
-- `applies` = EXTERNAL_WHATSAPP and a new account; `required` = applies and no valid clearance is already held.
create function private.registration_captcha_status(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_actor();
  v_mode text;
  v_applies boolean;
  v_clearance boolean;
begin
  select e.registration_mode into v_mode from app.edition e where e.edition_id = p_edition_id and e.publication_state = 'PUBLISHED';
  if v_mode is null then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_applies := v_mode = 'EXTERNAL_WHATSAPP' and private.registration_account_is_new(v_uid);
  v_clearance := exists (select 1 from private.registration_captcha_clearance c
                         where c.auth_user_id = v_uid and c.edition_id = p_edition_id and c.expires_at > pg_catalog.now());
  return jsonb_build_object('applies', v_applies, 'required', v_applies and not v_clearance, 'has_clearance', v_clearance,
    'new_account_hours', (select p.captcha_new_account_hours from private.anti_hoarding_policy p where p.settings_id = 1));
end;
$$;

-- SYSTEM only (Next, after verifying the ALTCHA payload). One live clearance per (user, Edition); minting again refreshes it.
create function private.grant_registration_captcha_clearance(p_auth_user_id uuid, p_edition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz := pg_catalog.now() + interval '10 minutes';
begin
  if p_auth_user_id is null or p_edition_id is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid captcha clearance arguments';
  end if;
  delete from private.registration_captcha_clearance where expires_at < pg_catalog.now() - interval '1 hour';
  insert into private.registration_captcha_clearance (auth_user_id, edition_id, granted_at, expires_at)
  values (p_auth_user_id, p_edition_id, pg_catalog.now(), v_expires_at)
  on conflict (auth_user_id, edition_id) do update set granted_at = excluded.granted_at, expires_at = excluded.expires_at;
  return jsonb_build_object('granted', true, 'expires_at', v_expires_at);
end;
$$;

create function private.registration_consume_captcha_clearance(p_auth_user_id uuid, p_edition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from private.registration_captcha_clearance c
  where c.auth_user_id = p_auth_user_id and c.edition_id = p_edition_id and c.expires_at > pg_catalog.now();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Edition alert: suspicious concentration of PENDING holds. Never cancels; opens/refreshes/clears ONE admin task.
-- ---------------------------------------------------------------------------------------------
create function private.registration_evaluate_hold_concentration(p_edition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.anti_hoarding_policy%rowtype;
  v_edition app.edition%rowtype;
  v_capacity bigint;
  v_agg jsonb;
  v_flagged_places bigint;
  v_top_places integer;
  v_by_share boolean;
  v_by_buyer boolean;
  v_triggers jsonb;
  v_key text := 'hold-concentration:' || p_edition_id::text;
  v_metadata jsonb;
  v_task_result text;
begin
  select * into v_edition from app.edition e where e.edition_id = p_edition_id;
  if not found or v_edition.registration_mode <> 'EXTERNAL_WHATSAPP' then return null; end if;
  select * into v_policy from private.anti_hoarding_policy p where p.settings_id = 1;

  -- Capacity base: the Edition limit, else the sum of the ACTIVE modality limits when every one has a limit.
  v_capacity := coalesce(v_edition.global_capacity::bigint, (
    select case when count(*) filter (where mc.effective_capacity is null) = 0 and count(*) > 0 then sum(mc.effective_capacity) end
    from app.modality m
    left join app.modality_capacity mc on mc.modality_id = m.modality_id
    where m.edition_id = p_edition_id and m.status = 'ACTIVE'));

  with pending as (
    select r.registration_request_id, r.public_reference,
      coalesce((select sum(h.quantity) from app.registration_hold h
                where h.registration_request_id = r.registration_request_id and h.status = 'ACTIVE'
                  and h.expires_at > pg_catalog.now()), 0)::integer as places,
      -- Age at the moment the request was made: stable while the request stays pending.
      coalesce(u.created_at > r.created_at - pg_catalog.make_interval(hours => v_policy.captcha_new_account_hours), false) as new_account
    from app.registration_request r
    join app.runner_profile rp on rp.runner_profile_id = r.buyer_profile_id
    left join auth.users u on u.id = rp.auth_user_id
    where r.edition_id = p_edition_id and r.status = 'PENDING_CONFIRMATION' and r.expires_at > pg_catalog.now()
  )
  select jsonb_build_object(
    'pending_requests', count(*) filter (where places > 0),
    'pending_places', coalesce(sum(places), 0),
    'new_account_large_requests', count(*) filter (where new_account and places >= v_policy.large_hold_min_places),
    'new_account_large_places', coalesce(sum(places) filter (where new_account and places >= v_policy.large_hold_min_places), 0),
    'top_buyer_places', coalesce(max(places), 0),
    'top_requests', coalesce((select jsonb_agg(jsonb_build_object('registration_request_id', t.registration_request_id,
        'public_reference', t.public_reference, 'places', t.places, 'new_account', t.new_account)
        order by t.places desc, t.registration_request_id)
      from (select * from pending where places > 0 order by places desc, registration_request_id limit 5) t), '[]'::jsonb))
  into v_agg
  from pending;

  v_flagged_places := (v_agg ->> 'new_account_large_places')::bigint;
  v_top_places := (v_agg ->> 'top_buyer_places')::integer;
  v_by_share := v_capacity is not null and v_capacity > 0 and v_flagged_places >= v_policy.new_account_hold_min_places
    and v_flagged_places * 100 >= v_capacity * v_policy.new_account_hold_share_percent;
  v_by_buyer := v_top_places >= v_policy.single_buyer_hold_places;
  v_triggers := (case when v_by_share then '["NEW_ACCOUNT_SHARE"]'::jsonb else '[]'::jsonb end)
    || (case when v_by_buyer then '["SINGLE_BUYER"]'::jsonb else '[]'::jsonb end);

  v_metadata := v_agg || jsonb_build_object('capacity', v_capacity, 'triggers', v_triggers,
    'policy', jsonb_build_object('captcha_new_account_hours', v_policy.captcha_new_account_hours,
      'large_hold_min_places', v_policy.large_hold_min_places,
      'new_account_hold_share_percent', v_policy.new_account_hold_share_percent,
      'new_account_hold_min_places', v_policy.new_account_hold_min_places,
      'single_buyer_hold_places', v_policy.single_buyer_hold_places));

  if v_by_share or v_by_buyer then
    v_task_result := private.admin_task_sync_open(v_key, 'ANTI_HOARDING', p_edition_id, 'edition', p_edition_id,
      'Posible acaparamiento de cupo en solicitudes pendientes',
      pg_catalog.format('Hay %s lugares retenidos por solicitudes pendientes; %s por cuentas nuevas con retenciones grandes y hasta %s por una sola cuenta. Revisa las solicitudes y cancela las sospechosas; nada se cancela automáticamente.',
        v_agg ->> 'pending_places', v_agg ->> 'new_account_large_places', v_agg ->> 'top_buyer_places'),
      'HIGH', 'ACTION_REQUIRED', 'OPERATOR', v_metadata);
  else
    v_task_result := private.admin_task_sync_clear(v_key);
  end if;
  return jsonb_build_object('triggered', v_by_share or v_by_buyer, 'task', v_task_result, 'metrics', v_agg);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Policy read / update (ADMIN global, audited)
-- ---------------------------------------------------------------------------------------------
create function private.anti_hoarding_policy_projection()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('captcha_new_account_hours', p.captcha_new_account_hours,
    'large_hold_min_places', p.large_hold_min_places, 'new_account_hold_share_percent', p.new_account_hold_share_percent,
    'new_account_hold_min_places', p.new_account_hold_min_places, 'single_buyer_hold_places', p.single_buyer_hold_places,
    'updated_at', p.updated_at)
  from private.anti_hoarding_policy p where p.settings_id = 1
$$;

create function private.admin_get_anti_hoarding_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('PLATFORM_SETTINGS_MANAGE');
  return private.anti_hoarding_policy_projection();
end;
$$;

create function private.update_anti_hoarding_policy(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_input jsonb;
  v_before jsonb;
  v_after jsonb;
  v_s private.anti_hoarding_policy%rowtype;
  v_constraint text;
begin
  v_staff_id := private.cfg_authorize('PLATFORM_SETTINGS_MANAGE');
  v_input := private.cfg_object(p_input, array['captcha_new_account_hours', 'large_hold_min_places',
    'new_account_hold_share_percent', 'new_account_hold_min_places', 'single_buyer_hold_places']);
  select * into v_s from private.anti_hoarding_policy p where p.settings_id = 1 for update;
  v_before := private.anti_hoarding_policy_projection();
  update private.anti_hoarding_policy set
    captcha_new_account_hours = coalesce(private.cfg_int(v_input, 'captcha_new_account_hours', false, 1, 168), v_s.captcha_new_account_hours),
    large_hold_min_places = coalesce(private.cfg_int(v_input, 'large_hold_min_places', false, 2, 20), v_s.large_hold_min_places),
    new_account_hold_share_percent = coalesce(private.cfg_numeric(v_input, 'new_account_hold_share_percent', false, 0.01, 100, false),
      v_s.new_account_hold_share_percent),
    new_account_hold_min_places = coalesce(private.cfg_int(v_input, 'new_account_hold_min_places', false, 1, 100000), v_s.new_account_hold_min_places),
    single_buyer_hold_places = coalesce(private.cfg_int(v_input, 'single_buyer_hold_places', false, 2, 20), v_s.single_buyer_hold_places),
    updated_by_staff_id = v_staff_id
  where settings_id = 1;
  v_after := private.anti_hoarding_policy_projection();
  perform private.audit('ANTI_HOARDING_POLICY_UPDATED', 'anti_hoarding_policy', null, null,
    v_before - 'updated_at', v_after - 'updated_at');
  return v_after;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_registration_request: body of migration 160 plus (0b) the ALTCHA clearance gate and the post-commit-state alert.
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

  -- 0b. OD-P2-01 anti-hoarding: an EXTERNAL_WHATSAPP request from an account younger than the policy window needs the
  -- single-use ALTCHA clearance Next mints after verifying the proof of work. After the idempotency replay (a stored
  -- success creates nothing) and before the Edition lock, capacity and holds. The consumption is part of this
  -- transaction, so any later failure leaves the clearance usable for the corrected retry.
  if v_edition.registration_mode = 'EXTERNAL_WHATSAPP' and private.registration_account_is_new(auth.uid()) then
    if not private.registration_consume_captcha_clearance(auth.uid(), p_edition_id) then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'captcha_required',
        'captcha', jsonb_build_object('purpose', 'registration_request', 'edition_id', p_edition_id,
          'new_account_hours', (select p.captcha_new_account_hours from private.anti_hoarding_policy p where p.settings_id = 1))));
    end if;
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

  if v_edition.registration_mode = 'EXTERNAL_WHATSAPP' then
    begin
      perform private.registration_evaluate_hold_concentration(p_edition_id);
    exception when others then
      raise warning 'hold concentration evaluation failed: %', sqlstate;
    end;
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


-- ---------------------------------------------------------------------------------------------
-- Public wrappers and grants
-- ---------------------------------------------------------------------------------------------
create function public.registration_captcha_status(p_edition_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.registration_captcha_status(p_edition_id) $$;
create function public.grant_registration_captcha_clearance(p_auth_user_id uuid, p_edition_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.grant_registration_captcha_clearance(p_auth_user_id, p_edition_id) $$;
create function public.admin_get_anti_hoarding_policy()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_get_anti_hoarding_policy() $$;
create function public.update_anti_hoarding_policy(p_input jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.update_anti_hoarding_policy(p_input) $$;

revoke all on function
  private.registration_account_is_new(uuid), private.registration_consume_captcha_clearance(uuid, uuid),
  private.registration_evaluate_hold_concentration(uuid), private.anti_hoarding_policy_projection(),
  private.registration_captcha_status(uuid), public.registration_captcha_status(uuid),
  private.grant_registration_captcha_clearance(uuid, uuid), public.grant_registration_captcha_clearance(uuid, uuid),
  private.admin_get_anti_hoarding_policy(), public.admin_get_anti_hoarding_policy(),
  private.update_anti_hoarding_policy(jsonb), public.update_anti_hoarding_policy(jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  private.registration_captcha_status(uuid), public.registration_captcha_status(uuid),
  private.admin_get_anti_hoarding_policy(), public.admin_get_anti_hoarding_policy(),
  private.update_anti_hoarding_policy(jsonb), public.update_anti_hoarding_policy(jsonb)
to authenticated;

-- Minting a clearance is SYSTEM only: an authenticated caller must never be able to grant itself one.
grant execute on function
  private.grant_registration_captcha_clearance(uuid, uuid), public.grant_registration_captcha_clearance(uuid, uuid)
to service_role;
