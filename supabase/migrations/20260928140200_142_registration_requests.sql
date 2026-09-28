-- Registration requests (T34, Master §61-74, §124, §167; SEC-005/006/010/012/013/140/141/142).
-- Lock order (ADR-001 §3): app.edition row -> app.modality_capacity rows by modality_id -> request rows.

-- ---------------------------------------------------------------------------------------------
-- Projection. Buyer view (SEC-012): display name, modality, category, price, acceptance status; never
-- DOB/age, contact data, guardian or the raw eligibility snapshot. A Friend's pass id is never exposed.
-- ---------------------------------------------------------------------------------------------
create function private.registration_request_view(p_registration_request_id uuid, p_viewer_profile_id uuid, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registration_request_id', r.registration_request_id,
    'public_reference', r.public_reference,
    'edition', jsonb_build_object('edition_id', e.edition_id, 'name', e.name, 'slug', e.slug),
    'status', r.status,
    'effective_status', case when r.status = 'PENDING_CONFIRMATION' and r.expires_at <= pg_catalog.now() then 'EXPIRED' else r.status end,
    'registration_mode', r.registration_mode,
    'currency', r.currency,
    'total_snapshot_minor', r.total_snapshot_minor,
    'created_at', r.created_at,
    'expires_at', r.expires_at,
    'confirmed_at', r.confirmed_at,
    'canceled_at', r.canceled_at,
    'revalidated_from_expired', r.revalidated_from_expired,
    'whatsapp_phone_e164', case when r.status = 'PENDING_CONFIRMATION' and r.expires_at > pg_catalog.now() then r.whatsapp_phone_snapshot end,
    'server_time', pg_catalog.now(),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'request_participant_id', p.request_participant_id,
        'participant_kind', p.participant_kind,
        'public_profile_id', cp.public_profile_id,
        'guest_participant_id', p.guest_participant_id,
        'is_buyer', p.runner_profile_id is not distinct from r.buyer_profile_id,
        'display_name', case when p_staff then coalesce(rp.full_name, g.full_name) else coalesce(cp.display_name, g.full_name) end,
        'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
        'category', case when c.category_id is not null then jsonb_build_object('category_id', c.category_id, 'name', c.name) end,
        'price_snapshot_minor', p.price_snapshot_minor,
        'legal_acceptance_status', case
          when pg_catalog.cardinality(private.registration_missing_documents(r.edition_id, p.runner_profile_id, p.guest_participant_id,
                 coalesce((p.eligibility_snapshot ->> 'is_minor')::boolean, false))) = 0 then 'ACCEPTED'
          else 'PENDING' end,
        'kit_selection', (
          select jsonb_build_object('kit_definition_id', ks.kit_definition_id, 'kit_variant_id', ks.kit_variant_id, 'label', kv.label)
          from app.kit_selection ks join app.kit_variant kv on kv.kit_variant_id = ks.kit_variant_id
          where ks.request_participant_id = p.request_participant_id
          limit 1),
        'registration', (
          select jsonb_build_object(
            'registration_id', reg.registration_id,
            'registration_number', reg.registration_number,
            'status', reg.status,
            'participant_pass_id', case when p_staff or private.pass_viewer_allowed(reg.registration_id, p_viewer_profile_id)
                                        then pp.participant_pass_id end)
          from app.registration reg
          left join app.participant_pass pp on pp.registration_id = reg.registration_id
          where reg.request_participant_id = p.request_participant_id))
        order by p.created_at, p.request_participant_id)
      from app.registration_request_participant p
      join app.modality m on m.modality_id = p.modality_id
      left join app.category c on c.category_id = p.category_id
      left join app.runner_profile rp on rp.runner_profile_id = p.runner_profile_id
      left join app.community_profile cp on cp.runner_profile_id = p.runner_profile_id
      left join app.guest_participant g on g.guest_participant_id = p.guest_participant_id
      where p.registration_request_id = r.registration_request_id), '[]'::jsonb))
  || case when p_staff then (
      select jsonb_build_object(
        'buyer', jsonb_build_object(
          'public_profile_id', bcp.public_profile_id,
          'full_name', b.full_name,
          'phone_e164', b.phone_e164,
          -- SEC-142 hoarding signal for the queue.
          'is_new_account', b.created_at > pg_catalog.now() - interval '24 hours'),
        'cancel_reason', r.cancel_reason)
      from app.runner_profile b
      left join app.community_profile bcp on bcp.runner_profile_id = b.runner_profile_id
      where b.runner_profile_id = r.buyer_profile_id)
    else '{}'::jsonb end
  from app.registration_request r
  join app.edition e on e.edition_id = r.edition_id
  where r.registration_request_id = p_registration_request_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Confirmation (Master §75-76, §80, §87-88): shared by FREE_AUTO, staff confirm and revalidation.
-- The caller holds the Edition lock and has validated every precondition. Passes are created without
-- a credential: the SYSTEM issues it after commit (A1).
-- ---------------------------------------------------------------------------------------------
create function private.registration_confirm_internal(
  p_registration_request_id uuid, p_method text, p_staff_member_id uuid, p_revalidated boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request app.registration_request%rowtype;
  v_participant app.registration_request_participant%rowtype;
  v_registration_id uuid;
  v_pass_id uuid;
  v_guardian_assignment_id uuid;
  v_created jsonb := '[]'::jsonb;
begin
  update app.registration_request r
  set status = 'CONFIRMED', confirmed_at = pg_catalog.now(), revalidated_from_expired = p_revalidated
  where r.registration_request_id = p_registration_request_id
  returning * into v_request;

  insert into app.registration_confirmation (registration_request_id, confirmation_method, confirmed_by_staff_id)
  values (p_registration_request_id, p_method, p_staff_member_id);
  update app.registration_hold h set status = 'CONSUMED', consumed_at = pg_catalog.now()
  where h.registration_request_id = p_registration_request_id and h.status = 'ACTIVE';
  update app.registration_participant_claim c set status = 'CONSUMED', resolved_at = pg_catalog.now()
  where c.registration_request_id = p_registration_request_id and c.status = 'ACTIVE';

  for v_participant in
    select * from app.registration_request_participant p
    where p.registration_request_id = p_registration_request_id
    order by p.created_at, p.request_participant_id
  loop
    insert into app.registration (registration_request_id, request_participant_id, edition_id, modality_id,
      runner_profile_id, guest_participant_id, buyer_profile_id, registration_number, confirmed_at)
    values (p_registration_request_id, v_participant.request_participant_id, v_request.edition_id, v_participant.modality_id,
      v_participant.runner_profile_id, v_participant.guest_participant_id, v_request.buyer_profile_id,
      private.registration_new_number(), v_request.confirmed_at)
    returning registration_id into v_registration_id;

    if v_participant.category_id is not null then
      insert into app.registration_category_assignment (registration_id, category_id, assignment_source, eligibility_snapshot)
      values (v_registration_id, v_participant.category_id,
        coalesce(v_participant.eligibility_snapshot ->> 'category_assignment_source', 'USER_SELECTION'),
        v_participant.eligibility_snapshot);
    end if;

    -- Inventory is not reserved by pending selections (Master §88); an exhausted variant is allocated as
    -- EXCEPTION for staff follow-up instead of blocking the confirmation.
    insert into app.kit_allocation (registration_id, kit_definition_id, kit_variant_id, status, assigned_by_staff_id)
    select v_registration_id, ks.kit_definition_id, ks.kit_variant_id,
      case when kv.capacity is not null and (
             select count(*) from app.kit_allocation a
             where a.kit_variant_id = ks.kit_variant_id and a.status <> 'CANCELED') >= kv.capacity
           then 'EXCEPTION' else 'ASSIGNED' end,
      p_staff_member_id
    from app.kit_selection ks
    join app.kit_variant kv on kv.kit_variant_id = ks.kit_variant_id
    where ks.request_participant_id = v_participant.request_participant_id
    order by ks.selected_at
    limit 1;

    -- Master §21: a minor's in-person guardian verification starts PENDING at confirmation.
    if coalesce((v_participant.eligibility_snapshot ->> 'is_minor')::boolean, false) then
      select g.guardian_assignment_id into v_guardian_assignment_id
      from private.registration_active_guardian_assignments(v_participant.runner_profile_id, v_participant.guest_participant_id) g
      order by g.guardian_assignment_id = private.registration_jsonb_uuid(v_participant.eligibility_snapshot -> 'guardian_assignment_id') desc
      limit 1;
      if v_guardian_assignment_id is not null then
        insert into app.guardian_event_verification (registration_id, guardian_assignment_id)
        values (v_registration_id, v_guardian_assignment_id);
      end if;
    end if;

    insert into app.participant_pass (registration_id, public_code)
    values (v_registration_id, private.registration_new_pass_code())
    returning participant_pass_id into v_pass_id;

    perform private.enqueue_outbox('RegistrationConfirmed', 'Registration', v_registration_id,
      'RegistrationConfirmed:' || v_registration_id,
      jsonb_build_object('registration_id', v_registration_id, 'registration_request_id', p_registration_request_id,
        'edition_id', v_request.edition_id, 'participant_pass_id', v_pass_id,
        'participant_kind', v_participant.participant_kind));
    perform private.enqueue_outbox('ParticipantPassIssued', 'ParticipantPass', v_pass_id,
      'ParticipantPassIssued:' || v_pass_id,
      jsonb_build_object('participant_pass_id', v_pass_id, 'registration_id', v_registration_id,
        'edition_id', v_request.edition_id));

    v_created := v_created || jsonb_build_object('registration_id', v_registration_id,
      'request_participant_id', v_participant.request_participant_id, 'participant_pass_id', v_pass_id);
  end loop;
  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Participant validation shared by create and staff revalidation. Returns the validated row, or an
-- issue {participant_index, code, reasons[]|field_key/reason}. Caller holds the Edition lock.
-- ---------------------------------------------------------------------------------------------
create function private.registration_participant_eligibility(
  p_participant_index integer, p_edition_id uuid, p_buyer_profile_id uuid, p_kind text,
  p_runner_profile_id uuid, p_guest_participant_id uuid, p_modality_id uuid, p_category_id uuid,
  p_ignore_registration_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb;
  v_client text[];
  v_modality app.modality%rowtype;
  v_sex text;
  v_age integer;
  v_category app.category%rowtype;
  v_source text;
begin
  if p_kind = 'PROFILE' and p_runner_profile_id is null then
    return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
      'code', 'PARTICIPANT_NOT_ELIGIBLE', 'reasons', jsonb_build_array('PARTICIPANT_UNAVAILABLE')));
  end if;

  v_check := private.participant_inclusion_check(p_edition_id, p_kind, p_runner_profile_id, p_guest_participant_id,
    p_buyer_profile_id);
  if not (v_check ->> 'eligible')::boolean then
    v_client := array(select jsonb_array_elements_text(v_check -> 'client_reasons'));
    return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
      'code', case
        when v_client = array['GUARDIAN_REQUIRED'] then 'GUARDIAN_REQUIRED'
        when p_runner_profile_id = p_buyer_profile_id and 'ACCOUNT_BANNED' = any (v_client) then 'ACCOUNT_BANNED'
        when p_runner_profile_id = p_buyer_profile_id and 'IDENTITY_LOCKED' = any (v_client) then 'IDENTITY_LOCKED'
        when p_runner_profile_id = p_buyer_profile_id and 'PROFILE_NOT_READY' = any (v_client) then 'PROFILE_INCOMPLETE'
        else 'PARTICIPANT_NOT_ELIGIBLE' end,
      'reasons', to_jsonb(v_client)));
  end if;
  v_age := (v_check ->> 'age_at_event')::integer;

  select * into v_modality from app.modality m where m.modality_id = p_modality_id and m.edition_id = p_edition_id;
  if not found or v_modality.status <> 'ACTIVE' then
    return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
      'code', 'MODALITY_NOT_AVAILABLE'));
  end if;

  if p_kind = 'PROFILE' then
    select rp.sex_code into v_sex from app.runner_profile rp where rp.runner_profile_id = p_runner_profile_id;
  else
    select g.sex_code into v_sex from app.guest_participant g where g.guest_participant_id = p_guest_participant_id;
  end if;
  if not private.registration_rule_matches(v_modality.eligibility_rules, v_age, v_sex) then
    return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
      'code', 'PARTICIPANT_NOT_ELIGIBLE', 'reasons', jsonb_build_array('MODALITY_RULE')));
  end if;

  -- Master §39-40: a USER_SELECTS category is chosen (and must fit its rule); otherwise the first
  -- matching SYSTEM_DERIVES category of the Modality is derived.
  if p_category_id is not null then
    select c.* into v_category
    from app.category c
    join app.modality_category mc on mc.category_id = c.category_id and mc.modality_id = p_modality_id
    where c.category_id = p_category_id and c.edition_id = p_edition_id and c.active and c.assignment_mode = 'USER_SELECTS';
    if not found then
      return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
        'code', 'FORM_INVALID', 'field_key', 'category_id', 'reason', 'invalid_category'));
    end if;
    v_source := 'USER_SELECTION';
  elsif exists (select 1 from app.category c join app.modality_category mc on mc.category_id = c.category_id
                where mc.modality_id = p_modality_id and c.active and c.assignment_mode = 'USER_SELECTS') then
    return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
      'code', 'FORM_INVALID', 'field_key', 'category_id', 'reason', 'required'));
  elsif exists (select 1 from app.category c join app.modality_category mc on mc.category_id = c.category_id
                where mc.modality_id = p_modality_id and c.active and c.assignment_mode = 'SYSTEM_DERIVES') then
    select c.* into v_category
    from app.category c join app.modality_category mc on mc.category_id = c.category_id
    where mc.modality_id = p_modality_id and c.active and c.assignment_mode = 'SYSTEM_DERIVES'
      and private.registration_rule_matches(c.eligibility_rule, v_age, v_sex)
    order by c.sort_order, c.key
    limit 1;
    if not found then
      return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
        'code', 'PARTICIPANT_NOT_ELIGIBLE', 'reasons', jsonb_build_array('NO_CATEGORY_MATCH')));
    end if;
    v_source := 'DERIVED';
  end if;
  if v_category.category_id is not null and not private.registration_rule_matches(v_category.eligibility_rule, v_age, v_sex) then
    return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
      'code', 'PARTICIPANT_NOT_ELIGIBLE', 'reasons', jsonb_build_array('CATEGORY_RULE')));
  end if;

  if exists (select 1 from app.registration r
             where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
               and (r.runner_profile_id = p_runner_profile_id or r.guest_participant_id = p_guest_participant_id)) then
    return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
      'code', 'DUPLICATE_REGISTRATION'));
  end if;
  -- Expired claims of this Edition were materialised under the Edition lock, so ACTIVE means effective.
  if exists (select 1 from app.registration_participant_claim c
             where c.edition_id = p_edition_id and c.status = 'ACTIVE'
               and c.registration_request_id is distinct from p_ignore_registration_request_id
               and (c.runner_profile_id = p_runner_profile_id or c.guest_participant_id = p_guest_participant_id)) then
    return jsonb_build_object('issue', jsonb_build_object('participant_index', p_participant_index,
      'code', 'PARTICIPANT_ALREADY_HELD'));
  end if;

  return jsonb_build_object('row', jsonb_build_object(
    'category_id', v_category.category_id,
    'is_minor', (v_check ->> 'is_minor')::boolean,
    -- Staff-only snapshot (never projected to the buyer): basis of the eligibility decision.
    'eligibility_snapshot', jsonb_build_object(
      'is_minor', (v_check ->> 'is_minor')::boolean,
      'age_at_event', v_age,
      'age_basis', v_check ->> 'age_basis',
      'event_date', v_check ->> 'event_date',
      'sex_code', v_sex,
      'guardian_assignment_id', v_check -> 'guardian_assignment_id',
      'modality_rule_version', v_modality.eligibility_rule_version,
      'category_assignment_source', v_source,
      'evaluated_at', pg_catalog.now())));
end;
$$;

-- Raises the first issue's code with every issue in the detail (the builder shows all rows at once).
create function private.registration_raise_issues(p_issues jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_array_length(p_issues) > 0 then
    perform private.raise_domain_error(p_issues -> 0 ->> 'code', jsonb_build_object(
      'participant_index', p_issues -> 0 -> 'participant_index',
      'issues', (select jsonb_agg(i) from (select i from jsonb_array_elements(p_issues) i limit 50) s)));
  end if;
end;
$$;

-- Capacity (Master §35-37) from the events kernel's live counts (CONFIRMED Registrations + effective holds),
-- evaluated under the caller's locks. p_needs/p_own_holds: {modality_id: quantity}. p_own_holds are ACTIVE
-- holds the operation itself consumes (confirming a still-valid request), so they are given back first.
-- Modality and global limits are checked on their own terms so the error names the binding limit.
create function private.registration_assert_capacity(p_edition_id uuid, p_needs jsonb, p_own_holds jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_availability jsonb := private.edition_availability(p_edition_id);
  v_need record;
  v_modality jsonb;
  v_total_needed integer := 0;
  v_total_own integer := 0;
begin
  for v_need in
    select (n.key)::uuid as modality_id, (n.value)::integer as needed,
      coalesce((p_own_holds ->> n.key)::integer, 0) as own
    from jsonb_each_text(p_needs) n
    order by 1
  loop
    v_total_needed := v_total_needed + v_need.needed;
    v_total_own := v_total_own + v_need.own;
    select m into v_modality from jsonb_array_elements(v_availability -> 'modalities') m
    where (m ->> 'modality_id')::uuid = v_need.modality_id;
    if v_modality ->> 'effective_capacity' is not null
       and (v_modality ->> 'effective_capacity')::integer - (v_modality ->> 'confirmed')::integer
           - (v_modality ->> 'active_holds')::integer + v_need.own < v_need.needed then
      perform private.raise_domain_error('CAPACITY_UNAVAILABLE', jsonb_build_object('modality_id', v_need.modality_id));
    end if;
  end loop;
  if v_availability -> 'global' ->> 'capacity' is not null
     and (v_availability -> 'global' ->> 'capacity')::integer - (v_availability -> 'global' ->> 'confirmed')::integer
         - (v_availability -> 'global' ->> 'active_holds')::integer + v_total_own < v_total_needed then
    perform private.raise_domain_error('GLOBAL_CAPACITY_UNAVAILABLE');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- CreateRegistrationRequest (Master §65-68, §74). FREE confirms in the same transaction.
-- ---------------------------------------------------------------------------------------------
create function private.create_registration_request(
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

-- ---------------------------------------------------------------------------------------------
-- Buyer reads and cancel (Master §69, §73). Foreign ids -> NOT_FOUND (SEC-010).
-- ---------------------------------------------------------------------------------------------
create function private.get_registration_request(p_registration_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := private.registration_require_viewer();
begin
  if not exists (select 1 from app.registration_request r
                 where r.registration_request_id = p_registration_request_id and r.buyer_profile_id = v_viewer) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  return private.registration_request_view(p_registration_request_id, v_viewer, false);
end;
$$;

-- Keyset page by (created_at desc, id desc). p_status filters on the effective status.
create function private.list_my_registration_requests(
  p_status text default null, p_cursor_created_at timestamptz default null, p_cursor_id uuid default null,
  p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := private.registration_require_viewer();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_page jsonb;
begin
  if p_status is not null and p_status not in ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELED_BY_BUYER', 'CANCELED_BY_STAFF', 'EXPIRED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'status'));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.registration_request_id, 'created_at', s.created_at)
                  order by s.created_at desc, s.registration_request_id desc), '[]'::jsonb)
  into v_page
  from (
    select r.registration_request_id, r.created_at
    from app.registration_request r
    where r.buyer_profile_id = v_viewer
      and (p_cursor_created_at is null or (r.created_at, r.registration_request_id) < (p_cursor_created_at, p_cursor_id))
      and (p_status is null or (case when r.status = 'PENDING_CONFIRMATION' and r.expires_at <= pg_catalog.now()
                                     then 'EXPIRED' else r.status end) = p_status)
    order by r.created_at desc, r.registration_request_id desc
    limit v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(private.registration_request_view((e ->> 'id')::uuid, v_viewer, false) order by o)
                       from jsonb_array_elements(v_page) with ordinality x(e, o) where o <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_page) > v_limit then jsonb_build_object(
      'created_at', v_page -> (v_limit - 1) -> 'created_at', 'registration_request_id', v_page -> (v_limit - 1) -> 'id') end);
end;
$$;

-- Releases holds and claims of a PENDING request (shared by buyer and staff cancel).
create function private.registration_release_request(p_registration_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app.registration_hold h set status = 'RELEASED', released_at = pg_catalog.now()
  where h.registration_request_id = p_registration_request_id and h.status = 'ACTIVE';
  update app.registration_participant_claim c set status = 'RELEASED', resolved_at = pg_catalog.now()
  where c.registration_request_id = p_registration_request_id and c.status = 'ACTIVE';
  perform private.enqueue_outbox('RegistrationRequestCanceled', 'RegistrationRequest', p_registration_request_id,
    'RegistrationRequestCanceled:' || p_registration_request_id,
    jsonb_build_object('registration_request_id', p_registration_request_id,
      'edition_id', (select r.edition_id from app.registration_request r where r.registration_request_id = p_registration_request_id)));
end;
$$;

create function private.cancel_registration_request(
  p_registration_request_id uuid, p_reason text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := private.require_ready_profile();
  v_edition_id uuid;
  v_request app.registration_request%rowtype;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_idem jsonb;
  v_result jsonb;
begin
  select r.edition_id into v_edition_id from app.registration_request r
  where r.registration_request_id = p_registration_request_id and r.buyer_profile_id = v_buyer;
  if v_edition_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  if pg_catalog.char_length(v_reason) > 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('registration_request.cancel', p_registration_request_id::text, p_idempotency_key,
      jsonb_build_object('registration_request_id', p_registration_request_id, 'reason', v_reason));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  select * into v_request from app.registration_request r where r.registration_request_id = p_registration_request_id for update;
  if v_request.status = 'CANCELED_BY_BUYER' then
    v_result := private.registration_request_view(p_registration_request_id, v_buyer, false);
  elsif v_request.status = 'EXPIRED' or (v_request.status = 'PENDING_CONFIRMATION' and v_request.expires_at <= pg_catalog.now()) then
    perform private.raise_domain_error('REQUEST_EXPIRED');
  elsif v_request.status <> 'PENDING_CONFIRMATION' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'REQUEST_NOT_PENDING', 'status', v_request.status));
  else
    update app.registration_request r
    set status = 'CANCELED_BY_BUYER', canceled_at = pg_catalog.now(), canceled_by_profile_id = v_buyer, cancel_reason = v_reason
    where r.registration_request_id = p_registration_request_id;
    perform private.registration_release_request(p_registration_request_id);
    v_result := private.registration_request_view(p_registration_request_id, v_buyer, false);
  end if;

  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

-- Public invoker wrappers.
create function public.create_registration_request(
  p_edition_id uuid, p_participants jsonb, p_legal_acceptances jsonb default '[]'::jsonb, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_registration_request(p_edition_id, p_participants, p_legal_acceptances, p_idempotency_key) $$;
create function public.get_registration_request(p_registration_request_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_registration_request(p_registration_request_id) $$;
create function public.list_my_registration_requests(
  p_status text default null, p_cursor_created_at timestamptz default null, p_cursor_id uuid default null,
  p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_my_registration_requests(p_status, p_cursor_created_at, p_cursor_id, p_limit) $$;
create function public.cancel_registration_request(
  p_registration_request_id uuid, p_reason text default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_registration_request(p_registration_request_id, p_reason, p_idempotency_key) $$;

revoke all on function
  private.registration_request_view(uuid, uuid, boolean),
  private.registration_confirm_internal(uuid, text, uuid, boolean),
  private.registration_participant_eligibility(integer, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid),
  private.registration_raise_issues(jsonb),
  private.registration_assert_capacity(uuid, jsonb, jsonb),
  private.registration_release_request(uuid),
  private.create_registration_request(uuid, jsonb, jsonb, text), public.create_registration_request(uuid, jsonb, jsonb, text),
  private.get_registration_request(uuid), public.get_registration_request(uuid),
  private.list_my_registration_requests(text, timestamptz, uuid, integer), public.list_my_registration_requests(text, timestamptz, uuid, integer),
  private.cancel_registration_request(uuid, text, text), public.cancel_registration_request(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.create_registration_request(uuid, jsonb, jsonb, text), public.create_registration_request(uuid, jsonb, jsonb, text),
  private.get_registration_request(uuid), public.get_registration_request(uuid),
  private.list_my_registration_requests(text, timestamptz, uuid, integer), public.list_my_registration_requests(text, timestamptz, uuid, integer),
  private.cancel_registration_request(uuid, text, text), public.cancel_registration_request(uuid, text, text)
to authenticated;
