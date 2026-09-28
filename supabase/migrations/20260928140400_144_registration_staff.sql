-- Staff request queue and commands (T34, Master §70-73, §171; SEC-005/006/020/140).
-- Staff scope always comes from the target row's Edition (SEC-020).

-- Re-checks every participant of a request for the buyer (not the calling staff member). Holds of the
-- request itself are ignored for the claim check. Raises the collected issues.
create function private.registration_revalidate_participants(p_request app.registration_request)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant app.registration_request_participant%rowtype;
  v_index integer := 0;
  v_check jsonb;
  v_issues jsonb := '[]'::jsonb;
begin
  for v_participant in
    select * from app.registration_request_participant p
    where p.registration_request_id = p_request.registration_request_id
    order by p.created_at, p.request_participant_id
  loop
    v_check := private.registration_participant_eligibility(v_index, p_request.edition_id, p_request.buyer_profile_id,
      v_participant.participant_kind, v_participant.runner_profile_id, v_participant.guest_participant_id,
      v_participant.modality_id,
      case when v_participant.eligibility_snapshot ->> 'category_assignment_source' = 'USER_SELECTION'
           then v_participant.category_id end,
      p_request.registration_request_id);
    if v_check ? 'issue' then
      v_issues := v_issues || (v_check -> 'issue');
    end if;
    v_index := v_index + 1;
  end loop;
  perform private.registration_raise_issues(v_issues);
end;
$$;

-- Every participant needs their required acceptances before confirmation (Master §124, UX OQ-1).
create function private.registration_assert_legal_complete(p_request app.registration_request)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issues jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('participant_index', s.idx - 1, 'code', 'LEGAL_ACCEPTANCE_REQUIRED',
           'request_participant_id', s.request_participant_id, 'missing_document_version_ids', to_jsonb(s.missing))
           order by s.idx), '[]'::jsonb)
  into v_issues
  from (
    select p.request_participant_id, x.idx,
      private.registration_missing_documents(p_request.edition_id, p.runner_profile_id, p.guest_participant_id,
        coalesce((p.eligibility_snapshot ->> 'is_minor')::boolean, false)) as missing
    from app.registration_request_participant p
    cross join lateral (select count(*) as idx from app.registration_request_participant q
                        where q.registration_request_id = p.registration_request_id
                          and (q.created_at, q.request_participant_id) <= (p.created_at, p.request_participant_id)) x
    where p.registration_request_id = p_request.registration_request_id) s
  where pg_catalog.cardinality(s.missing) > 0;
  perform private.registration_raise_issues(v_issues);
end;
$$;

-- Locks in canonical order (Edition -> ModalityCapacity by modality_id -> request) and returns the request.
create function private.registration_lock_request(p_registration_request_id uuid)
returns app.registration_request
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request app.registration_request;
begin
  perform 1 from app.edition e
  where e.edition_id = (select r.edition_id from app.registration_request r where r.registration_request_id = p_registration_request_id)
  for update;
  perform 1 from app.modality_capacity mc
  where mc.modality_id in (select p.modality_id from app.registration_request_participant p
                           where p.registration_request_id = p_registration_request_id)
  order by mc.modality_id
  for update;
  select * into v_request from app.registration_request r where r.registration_request_id = p_registration_request_id for update;
  return v_request;
end;
$$;

create function private.registration_needs(p_registration_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.modality_id, s.needed), '{}'::jsonb)
  from (select p.modality_id, count(*) as needed from app.registration_request_participant p
        where p.registration_request_id = p_registration_request_id group by p.modality_id) s
$$;

create function private.registration_assert_edition_confirmable(p_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from app.edition e
                 where e.edition_id = p_edition_id and e.publication_state = 'PUBLISHED' and e.execution_state = 'SCHEDULED') then
    perform private.raise_domain_error('EDITION_NOT_REGISTRABLE');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ConfirmRegistrationRequest (Master §71): before expiry, price snapshot kept, idempotent.
-- ---------------------------------------------------------------------------------------------
create function private.confirm_registration_request(p_registration_request_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_idem jsonb;
  v_request app.registration_request;
  v_own_holds jsonb;
  v_result jsonb;
  v_constraint text;
begin
  select r.edition_id into v_edition_id from app.registration_request r where r.registration_request_id = p_registration_request_id;
  if v_edition_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff_id := private.require_permission('REGISTRATION_REQUEST_MANAGE', v_edition_id);
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('registration_request.confirm', p_registration_request_id::text, p_idempotency_key,
      jsonb_build_object('registration_request_id', p_registration_request_id));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  v_request := private.registration_lock_request(p_registration_request_id);
  if v_request.status = 'CONFIRMED' then
    -- Confirm is idempotent (Master §171): a repeated confirm returns the existing outcome.
    v_result := private.registration_request_view(p_registration_request_id, null, true);
  elsif v_request.status in ('CANCELED_BY_BUYER', 'CANCELED_BY_STAFF') then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'REQUEST_CANCELED', 'status', v_request.status));
  elsif v_request.status = 'EXPIRED' or v_request.expires_at <= pg_catalog.now() then
    -- Master §72: now >= expires_at is expired whatever the worker did; use revalidate-and-confirm.
    perform private.raise_domain_error('REQUEST_EXPIRED');
  else
    perform private.registration_assert_edition_confirmable(v_request.edition_id);
    if exists (select 1 from app.registration_participant_claim c
               where c.registration_request_id = p_registration_request_id and c.status <> 'ACTIVE') then
      perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'CLAIMS_RELEASED'));
    end if;
    perform private.registration_revalidate_participants(v_request);
    select coalesce(jsonb_object_agg(h.modality_id, h.quantity), '{}'::jsonb) into v_own_holds
    from app.registration_hold h
    where h.registration_request_id = p_registration_request_id and h.status = 'ACTIVE' and h.expires_at > pg_catalog.now();
    perform private.registration_assert_capacity(v_request.edition_id, private.registration_needs(p_registration_request_id), v_own_holds);
    perform private.registration_assert_legal_complete(v_request);

    perform private.registration_confirm_internal(p_registration_request_id, 'EXTERNAL_WHATSAPP', v_staff_id, false);
    perform private.audit('REGISTRATION_REQUEST_CONFIRMED', 'registration_request', p_registration_request_id, v_edition_id,
      jsonb_build_object('status', v_request.status),
      jsonb_build_object('status', 'CONFIRMED', 'total_snapshot_minor', v_request.total_snapshot_minor));
    v_result := private.registration_request_view(p_registration_request_id, null, true);
  end if;

  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint, jsonb_build_object(
    'registration_confirmed_profile_uidx', 'DUPLICATE_REGISTRATION',
    'registration_confirmed_guest_uidx', 'DUPLICATE_REGISTRATION',
    'registration_confirmation_registration_request_id_key', 'CONFLICT'));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- RevalidateExpiredRegistrationRequestAndConfirm (Master §72). The old hold is not counted. A changed
-- price blocks with PRICE_CHANGED until staff repeats the call with p_expected_total_minor equal to the
-- current total (explicit acknowledgement; the request total snapshot is then updated and audited).
-- ---------------------------------------------------------------------------------------------
create function private.revalidate_and_confirm_registration_request(
  p_registration_request_id uuid, p_expected_total_minor bigint default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_idem jsonb;
  v_request app.registration_request;
  v_prices jsonb;
  v_current_total bigint;
  v_changed boolean;
  v_result jsonb;
  v_constraint text;
begin
  select r.edition_id into v_edition_id from app.registration_request r where r.registration_request_id = p_registration_request_id;
  if v_edition_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff_id := private.require_permission('REGISTRATION_REQUEST_MANAGE', v_edition_id);
  if p_expected_total_minor is not null and p_expected_total_minor < 0 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'expected_total_minor'));
  end if;
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('registration_request.revalidate_confirm', p_registration_request_id::text,
      p_idempotency_key, jsonb_build_object('registration_request_id', p_registration_request_id,
        'expected_total_minor', p_expected_total_minor));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  v_request := private.registration_lock_request(p_registration_request_id);
  if v_request.status = 'CONFIRMED' then
    v_result := private.registration_request_view(p_registration_request_id, null, true);
  elsif v_request.status in ('CANCELED_BY_BUYER', 'CANCELED_BY_STAFF') then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'REQUEST_CANCELED', 'status', v_request.status));
  elsif v_request.status = 'PENDING_CONFIRMATION' and v_request.expires_at > pg_catalog.now() then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'REQUEST_NOT_EXPIRED'));
  else
    -- Expiry is materialised for the whole Edition so claims reflect only effective holds.
    perform private.registration_materialise_expired(v_request.edition_id);
    perform private.registration_assert_edition_confirmable(v_request.edition_id);
    perform private.registration_revalidate_participants(v_request);

    select jsonb_agg(jsonb_build_object('request_participant_id', p.request_participant_id,
             'price_offer_id', q.quote -> 'price_offer_id', 'amount_minor', (q.quote ->> 'amount_minor')::bigint,
             'currency', q.quote ->> 'currency', 'snapshot_minor', p.price_snapshot_minor, 'snapshot_currency', p.currency)
             order by p.created_at, p.request_participant_id)
    into v_prices
    from app.registration_request_participant p
    cross join lateral (select private.resolve_modality_price(p.modality_id, pg_catalog.now()) as quote) q
    where p.registration_request_id = p_registration_request_id;
    if exists (select 1 from jsonb_array_elements(v_prices) x where x -> 'amount_minor' is null or jsonb_typeof(x -> 'amount_minor') = 'null') then
      perform private.raise_domain_error('MODALITY_NOT_AVAILABLE', jsonb_build_object('reason', 'NO_PRICE'));
    end if;
    select sum((x ->> 'amount_minor')::bigint),
      bool_or((x ->> 'amount_minor')::bigint <> (x ->> 'snapshot_minor')::bigint or x ->> 'currency' <> x ->> 'snapshot_currency')
    into v_current_total, v_changed
    from jsonb_array_elements(v_prices) x;
    if v_changed and p_expected_total_minor is distinct from v_current_total then
      perform private.raise_domain_error('PRICE_CHANGED', jsonb_build_object(
        'snapshot_total_minor', v_request.total_snapshot_minor, 'current_total_minor', v_current_total,
        'currency', v_prices -> 0 ->> 'currency'));
    end if;

    perform private.registration_assert_capacity(v_request.edition_id, private.registration_needs(p_registration_request_id));
    perform private.registration_assert_legal_complete(v_request);

    if v_changed then
      update app.registration_request r set total_snapshot_minor = v_current_total, currency = v_prices -> 0 ->> 'currency'
      where r.registration_request_id = p_registration_request_id;
    end if;
    perform private.registration_confirm_internal(p_registration_request_id, 'EXTERNAL_WHATSAPP', v_staff_id, true);
    perform private.audit('REGISTRATION_REQUEST_REVALIDATED_CONFIRMED', 'registration_request', p_registration_request_id,
      v_edition_id,
      jsonb_build_object('status', 'EXPIRED', 'total_snapshot_minor', v_request.total_snapshot_minor),
      jsonb_build_object('status', 'CONFIRMED', 'revalidated_from_expired', true, 'total_snapshot_minor', v_current_total,
        'price_changed', v_changed,
        'prices', (select jsonb_agg(x - 'snapshot_currency') from jsonb_array_elements(v_prices) x)));
    v_result := private.registration_request_view(p_registration_request_id, null, true);
  end if;

  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint, jsonb_build_object(
    'registration_confirmed_profile_uidx', 'DUPLICATE_REGISTRATION',
    'registration_confirmed_guest_uidx', 'DUPLICATE_REGISTRATION'));
end;
$$;

-- Staff cancel (Master §73): PENDING or EXPIRED, never CONFIRMED. Audited.
create function private.staff_cancel_registration_request(
  p_registration_request_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_idem jsonb;
  v_request app.registration_request;
  v_reason text := pg_catalog.btrim(p_reason);
  v_result jsonb;
begin
  select r.edition_id into v_edition_id from app.registration_request r where r.registration_request_id = p_registration_request_id;
  if v_edition_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff_id := private.require_permission('REGISTRATION_REQUEST_MANAGE', v_edition_id);
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('registration_request.staff_cancel', p_registration_request_id::text, p_idempotency_key,
      jsonb_build_object('registration_request_id', p_registration_request_id, 'reason', v_reason));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  v_request := private.registration_lock_request(p_registration_request_id);
  if v_request.status = 'CANCELED_BY_STAFF' then
    v_result := private.registration_request_view(p_registration_request_id, null, true);
  elsif v_request.status not in ('PENDING_CONFIRMATION', 'EXPIRED') then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'REQUEST_NOT_CANCELABLE', 'status', v_request.status));
  else
    update app.registration_request r
    set status = 'CANCELED_BY_STAFF', canceled_at = pg_catalog.now(), canceled_by_staff_id = v_staff_id, cancel_reason = v_reason
    where r.registration_request_id = p_registration_request_id;
    perform private.registration_release_request(p_registration_request_id);
    perform private.audit('REGISTRATION_REQUEST_CANCELED', 'registration_request', p_registration_request_id, v_edition_id,
      jsonb_build_object('status', v_request.status), jsonb_build_object('status', 'CANCELED_BY_STAFF'), v_reason);
    v_result := private.registration_request_view(p_registration_request_id, null, true);
  end if;

  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

-- Admin queue (Master §70): effective status is derived from expires_at, not from the stored status.
create function private.admin_list_registration_requests(
  p_edition_id uuid, p_status text default null, p_search text default null,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_search text := nullif(private.normalize_search_text(coalesce(p_search, '')), '');
  v_page jsonb;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_permission('REGISTRATION_REQUEST_MANAGE', p_edition_id);
  if p_status is not null and p_status not in ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELED_BY_BUYER', 'CANCELED_BY_STAFF', 'EXPIRED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'status'));
  end if;
  if pg_catalog.char_length(v_search) > 100 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'search'));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.registration_request_id, 'created_at', s.created_at)
                  order by s.created_at desc, s.registration_request_id desc), '[]'::jsonb)
  into v_page
  from (
    select r.registration_request_id, r.created_at
    from app.registration_request r
    join app.runner_profile b on b.runner_profile_id = r.buyer_profile_id
    where r.edition_id = p_edition_id
      and (p_cursor_created_at is null or (r.created_at, r.registration_request_id) < (p_cursor_created_at, p_cursor_id))
      and (p_status is null or (case when r.status = 'PENDING_CONFIRMATION' and r.expires_at <= pg_catalog.now()
                                     then 'EXPIRED' else r.status end) = p_status)
      and (v_search is null or pg_catalog.strpos(pg_catalog.lower(r.public_reference), v_search) > 0
           or pg_catalog.strpos(b.search_name, v_search) > 0)
    order by r.created_at desc, r.registration_request_id desc
    limit v_limit + 1) s;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(private.registration_request_view((e ->> 'id')::uuid, null, true) order by o)
                       from jsonb_array_elements(v_page) with ordinality x(e, o) where o <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_page) > v_limit then jsonb_build_object(
      'created_at', v_page -> (v_limit - 1) -> 'created_at', 'registration_request_id', v_page -> (v_limit - 1) -> 'id') end,
    'counts', (
      select jsonb_object_agg(s.effective_status, s.n)
      from (select case when r.status = 'PENDING_CONFIRMATION' and r.expires_at <= pg_catalog.now() then 'EXPIRED' else r.status end
                     as effective_status, count(*) as n
            from app.registration_request r where r.edition_id = p_edition_id group by 1) s));
end;
$$;

create function public.confirm_registration_request(p_registration_request_id uuid, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.confirm_registration_request(p_registration_request_id, p_idempotency_key) $$;
create function public.revalidate_and_confirm_registration_request(
  p_registration_request_id uuid, p_expected_total_minor bigint default null, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.revalidate_and_confirm_registration_request(p_registration_request_id, p_expected_total_minor, p_idempotency_key) $$;
create function public.staff_cancel_registration_request(p_registration_request_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_cancel_registration_request(p_registration_request_id, p_reason, p_idempotency_key) $$;
create function public.admin_list_registration_requests(
  p_edition_id uuid, p_status text default null, p_search text default null,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_list_registration_requests(p_edition_id, p_status, p_search, p_cursor_created_at, p_cursor_id, p_limit) $$;

revoke all on function
  private.registration_revalidate_participants(app.registration_request),
  private.registration_assert_legal_complete(app.registration_request),
  private.registration_lock_request(uuid),
  private.registration_needs(uuid),
  private.registration_assert_edition_confirmable(uuid),
  private.confirm_registration_request(uuid, text), public.confirm_registration_request(uuid, text),
  private.revalidate_and_confirm_registration_request(uuid, bigint, text), public.revalidate_and_confirm_registration_request(uuid, bigint, text),
  private.staff_cancel_registration_request(uuid, text, text), public.staff_cancel_registration_request(uuid, text, text),
  private.admin_list_registration_requests(uuid, text, text, timestamptz, uuid, integer),
  public.admin_list_registration_requests(uuid, text, text, timestamptz, uuid, integer)
from public, anon, authenticated, service_role;

grant execute on function
  private.confirm_registration_request(uuid, text), public.confirm_registration_request(uuid, text),
  private.revalidate_and_confirm_registration_request(uuid, bigint, text), public.revalidate_and_confirm_registration_request(uuid, bigint, text),
  private.staff_cancel_registration_request(uuid, text, text), public.staff_cancel_registration_request(uuid, text, text),
  private.admin_list_registration_requests(uuid, text, text, timestamptz, uuid, integer),
  public.admin_list_registration_requests(uuid, text, text, timestamptz, uuid, integer)
to authenticated;
