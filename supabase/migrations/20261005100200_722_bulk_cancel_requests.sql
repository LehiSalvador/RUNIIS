-- P3-D staff bulk cancellation of PENDING registration requests (owner decision OD-P2-01, measure 3). Staff-only, edition-scoped,
-- idempotent, audited (one record per request plus one for the batch) and capacity is released through the SAME transition as the
-- single cancel: request status -> holds and claims RELEASED -> live capacity counts. There is no counter to decrement.
--
-- The transition body of staff_cancel_registration_request (migration 144) is extracted unchanged into
-- private.registration_request_cancel_core so the single and the bulk command cannot drift. It never touches a CONFIRMED
-- request or any registration: a request whose status is not PENDING_CONFIRMATION/EXPIRED is reported, not changed.

create function private.registration_request_cancel_core(
  p_registration_request_id uuid, p_staff_id uuid, p_reason text, p_correlation_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request app.registration_request;
begin
  -- Edition -> ModalityCapacity -> request lock order (ADR-001 section 3).
  v_request := private.registration_lock_request(p_registration_request_id);
  if v_request.status = 'CANCELED_BY_STAFF' then
    return jsonb_build_object('outcome', 'ALREADY_CANCELED', 'status', v_request.status);
  elsif v_request.status not in ('PENDING_CONFIRMATION', 'EXPIRED') then
    return jsonb_build_object('outcome', 'NOT_CANCELABLE', 'status', v_request.status);
  end if;
  update app.registration_request r
  set status = 'CANCELED_BY_STAFF', canceled_at = pg_catalog.now(), canceled_by_staff_id = p_staff_id, cancel_reason = p_reason
  where r.registration_request_id = p_registration_request_id;
  perform private.registration_release_request(p_registration_request_id);
  perform private.audit('REGISTRATION_REQUEST_CANCELED', 'registration_request', p_registration_request_id, v_request.edition_id,
    jsonb_build_object('status', v_request.status),
    jsonb_build_object('status', 'CANCELED_BY_STAFF') || case when p_correlation_id is not null then jsonb_build_object('bulk', true) else '{}'::jsonb end,
    p_reason, p_correlation_id);
  return jsonb_build_object('outcome', 'CANCELED', 'status', 'CANCELED_BY_STAFF');
end;
$$;

-- Same contract as migration 144 (permission, validation, rate limit, idempotency, responses), now over the shared core.
create or replace function private.staff_cancel_registration_request(
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
  v_outcome jsonb;
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

  v_outcome := private.registration_request_cancel_core(p_registration_request_id, v_staff_id, v_reason);
  if v_outcome ->> 'outcome' = 'NOT_CANCELABLE' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'REQUEST_NOT_CANCELABLE', 'status', v_outcome ->> 'status'));
  end if;
  v_result := private.registration_request_view(p_registration_request_id, null, true);

  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

create function private.staff_bulk_cancel_registration_requests(
  p_edition_id uuid, p_request_ids uuid[], p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_idem jsonb;
  v_correlation uuid := gen_random_uuid();
  v_id uuid;
  v_outcome jsonb;
  v_code text;
  v_results jsonb := '[]'::jsonb;
  v_canceled uuid[] := '{}';
  v_already integer := 0;
  v_rejected integer := 0;
  v_failed integer := 0;
  v_result jsonb;
begin
  if p_edition_id is null or not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff_id := private.cfg_authorize('REGISTRATION_REQUEST_MANAGE', p_edition_id);
  if v_reason is null then perform private.cfg_fail('reason', 'required'); end if;
  if pg_catalog.char_length(v_reason) > 500 then perform private.cfg_fail('reason', 'too_long'); end if;
  if p_request_ids is null or pg_catalog.cardinality(p_request_ids) = 0 then perform private.cfg_fail('request_ids', 'required'); end if;
  if pg_catalog.cardinality(p_request_ids) > 100 then perform private.cfg_fail('request_ids', 'too_many', jsonb_build_object('max', 100)); end if;
  if array_position(p_request_ids, null) is not null then perform private.cfg_fail('request_ids', 'invalid_value'); end if;
  if (select count(distinct x) from unnest(p_request_ids) x) <> pg_catalog.cardinality(p_request_ids) then
    perform private.cfg_fail('request_ids', 'duplicates');
  end if;

  v_idem := private.cfg_idempotency_begin('registration_request.bulk_cancel', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id, 'request_ids', to_jsonb(p_request_ids), 'reason', v_reason));
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  -- One Edition lock for the whole batch (Edition first, then each request's capacity rows): creates and other commands wait.
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;

  for v_id in select x from unnest(p_request_ids) x order by x loop
    begin
      if not exists (select 1 from app.registration_request r where r.registration_request_id = v_id and r.edition_id = p_edition_id) then
        -- Another Edition's request is indistinguishable from a missing one.
        v_outcome := jsonb_build_object('outcome', 'NOT_FOUND');
      else
        v_outcome := private.registration_request_cancel_core(v_id, v_staff_id, v_reason, v_correlation);
      end if;
    exception when others then
      get stacked diagnostics v_code = message_text;
      v_outcome := jsonb_build_object('outcome', 'FAILED',
        'code', case when v_code ~ '^[A-Z][A-Z0-9_]{2,63}$' then v_code else 'INTERNAL_ERROR' end);
    end;
    case v_outcome ->> 'outcome'
      when 'CANCELED' then v_canceled := v_canceled || v_id;
      when 'ALREADY_CANCELED' then v_already := v_already + 1;
      when 'FAILED' then v_failed := v_failed + 1;
      else v_rejected := v_rejected + 1;
    end case;
    v_results := v_results || jsonb_build_array(jsonb_build_object('registration_request_id', v_id) || v_outcome);
  end loop;

  perform private.audit('REGISTRATION_REQUESTS_BULK_CANCELED', 'edition', p_edition_id, p_edition_id, null,
    jsonb_build_object('requested_count', pg_catalog.cardinality(p_request_ids), 'canceled_count', pg_catalog.cardinality(v_canceled),
      'already_canceled_count', v_already, 'rejected_count', v_rejected, 'failed_count', v_failed,
      'canceled_request_ids', to_jsonb(v_canceled)),
    v_reason, v_correlation);

  -- The holds are gone: refresh the hoarding alert (clears it when the concentration is no longer there).
  begin
    perform private.registration_evaluate_hold_concentration(p_edition_id);
  exception when others then
    raise warning 'hold concentration evaluation failed: %', sqlstate;
  end;

  v_result := jsonb_build_object('edition_id', p_edition_id, 'correlation_id', v_correlation,
    'requested_count', pg_catalog.cardinality(p_request_ids), 'canceled_count', pg_catalog.cardinality(v_canceled),
    'already_canceled_count', v_already, 'rejected_count', v_rejected, 'failed_count', v_failed, 'results', v_results);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
end;
$$;

create function public.staff_bulk_cancel_registration_requests(
  p_edition_id uuid, p_request_ids uuid[], p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_bulk_cancel_registration_requests(p_edition_id, p_request_ids, p_reason, p_idempotency_key) $$;

revoke all on function
  private.registration_request_cancel_core(uuid, uuid, text, uuid),
  private.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text),
  public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text),
  public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text)
to authenticated;
