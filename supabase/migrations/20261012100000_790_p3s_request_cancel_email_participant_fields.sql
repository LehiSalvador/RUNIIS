-- P3-S (P3-AC-08, P3-AC-09, P3-AC-13): the buyer is notified when STAFF cancel a pending registration request, and the participants
-- list carries the sporting eligibility, final attendance and incident summary fields of T13 4.13.
--
--   1. UX J2 step 4 ("Cancel ... notifies buyer"): the shared cancel transition (single staff cancel and every request of a bulk cancel)
--      now writes ONE RegistrationRequestCanceledByStaff outbox event per canceled request. A dedicated event type keeps the buyer's own
--      cancel and the worker's expiry silent: only staff cancel emails. The consumer addresses the BUYER exactly once per request (dedupe
--      key REGISTRATION_REQUEST_CANCELED:{request}) through the normal comms pipeline, so suppression and the staging allowlist
--      (migration 164: non-allowlisted -> CANCELED/NOT_ALLOWLISTED, no transport) apply unchanged. Only the closed reason CATEGORY label
--      reaches the message, never the free-text reason.
--   2. The cancel commands accept an optional closed reason_category (default OTHER). The 3/4-argument signatures of migrations 144/722 are
--      kept as thin wrappers (same grants), so existing callers and tests are unaffected; the new 4/5-argument overloads carry the category.
--   3. Notification outcome for the response (same contract as P3-R's registration cancel): queued | suppressed | no_contact, and for the
--      last two ONE ACTION_REQUIRED follow-up task `registration-request-cancel-notice:{request}`.
--   4. registration_participant_row (admin participants list / export) gains, additively: attendance.finalized + attendance.final_status,
--      sporting_eligibility, incidents and credited_distance_m. Same RBAC (PARTICIPANT_LIST_READ), read-only.

-- ---------------------------------------------------------------------------------------------
-- 1. Template + automation rule.
-- ---------------------------------------------------------------------------------------------
insert into app.communication_template (template_key, category, active_version)
values ('REGISTRATION_REQUEST_CANCELED', 'TRANSACTIONAL', 1)
on conflict (template_key) do nothing;

insert into app.communication_template_version (template_id, version, subject_template, html_template, text_template, variable_schema)
select t.communication_template_id, 1,
  'Tu solicitud de inscripción a {{edition_name}} fue cancelada',
  $h$<p>Hola, {{buyer_name}}:</p>
<p>Tu solicitud de inscripción <strong>{{request_reference}}</strong> a <strong>{{edition_name}}</strong> fue cancelada por el equipo de RUNIIS y los lugares que tenías apartados fueron liberados.</p>
<ul>
<li>Motivo: {{reason_label}}</li>
<li>Fecha del evento: {{event_date_text}}</li>
<li>Lugares liberados: {{places_count}}</li>
</ul>
<p>RUNIIS no procesa pagos dentro de la plataforma, por lo que esta cancelación no genera ningún cargo ni movimiento de dinero en ella. Si coordinaste un pago por otro medio o tienes dudas, responde por el mismo medio por el que enviaste tu solicitud o contacta al equipo de RUNIIS.</p>
<p><a href="{{events_path}}">Ver otros eventos</a></p>$h$,
  $t$Hola, {{buyer_name}}:

Tu solicitud de inscripción {{request_reference}} a {{edition_name}} fue cancelada por el equipo de RUNIIS y los lugares que tenías apartados fueron liberados.

- Motivo: {{reason_label}}
- Fecha del evento: {{event_date_text}}
- Lugares liberados: {{places_count}}

RUNIIS no procesa pagos dentro de la plataforma, por lo que esta cancelación no genera ningún cargo ni movimiento de dinero en ella. Si coordinaste un pago por otro medio o tienes dudas, responde por el mismo medio por el que enviaste tu solicitud o contacta al equipo de RUNIIS.

Ver otros eventos: {{events_path}}$t$,
  '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "events_path": {"type": "path", "source": "snapshot"}, "buyer_name": {"type": "text", "max": 160, "source": "snapshot"}, "request_reference": {"type": "text", "max": 40, "source": "snapshot"}, "places_count": {"type": "text", "max": 8, "source": "snapshot"}, "reason_label": {"type": "text", "max": 120, "source": "snapshot"}}}'::jsonb
from app.communication_template t
where t.template_key = 'REGISTRATION_REQUEST_CANCELED'
on conflict (template_id, version) do nothing;

insert into app.communication_automation_rule (rule_key, trigger_event, template_key, category, priority,
  recipient_policy, consent_policy, scheduling_policy, dedupe_policy, active)
values ('REGISTRATION_REQUEST_CANCELED', 'RegistrationRequestCanceledByStaff', 'REGISTRATION_REQUEST_CANCELED', 'TRANSACTIONAL', 1,
  'REQUEST_BUYER', 'NONE_REQUIRED', '{"send": "immediate"}', '{"key": "REGISTRATION_REQUEST_CANCELED:{request}"}', true)
on conflict (rule_key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. Staff follow-up task for the cases where no email can go out (stable key: one per request).
-- ---------------------------------------------------------------------------------------------
create function private.registration_request_cancel_notice_task(
  p_registration_request_id uuid, p_edition_id uuid, p_public_reference text, p_outcome text)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.admin_task_sync_open('registration-request-cancel-notice:' || p_registration_request_id::text, 'COMMUNICATIONS', p_edition_id,
    'registration_request', p_registration_request_id, 'Avisa al comprador de la cancelación de su solicitud',
    pg_catalog.format('La solicitud %s fue cancelada y los lugares se liberaron, pero el aviso por correo %s. Contacta al comprador por otro medio (por ejemplo, el WhatsApp con el que hizo la solicitud) y resuelve esta tarea.',
      p_public_reference,
      case p_outcome when 'no_contact' then 'no tiene un correo al cual enviarse' else 'quedó suprimido por la lista de supresión del destinatario' end),
    'HIGH', 'ACTION_REQUIRED', 'OPERATOR',
    jsonb_build_object('registration_request_id', p_registration_request_id, 'public_reference', p_public_reference, 'notification_outcome', p_outcome))
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Outbox consumer: one email to the buyer per staff-canceled request (service_role, called with the claimed event id).
-- ---------------------------------------------------------------------------------------------
create function private.enqueue_registration_request_canceled_messages(p_outbox_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event infra.outbox_event%rowtype;
  v_request_id uuid;
  v_req record;
  v_recipient record;
  v_label text;
  v_vars jsonb;
begin
  select * into v_event from infra.outbox_event o where o.outbox_event_id = p_outbox_event_id;
  if not found or v_event.event_type <> 'RegistrationRequestCanceledByStaff' then
    raise exception using errcode = 'invalid_parameter_value', message = 'not a RegistrationRequestCanceledByStaff event';
  end if;

  v_request_id := coalesce((v_event.payload ->> 'registration_request_id')::uuid,
    case when v_event.aggregate_type = 'RegistrationRequest' then v_event.aggregate_id end);
  select r.registration_request_id, r.edition_id, r.buyer_profile_id, r.public_reference, r.status, b.full_name as buyer_name,
         (select count(*) from app.registration_request_participant p where p.registration_request_id = r.registration_request_id) as places
    into v_req
  from app.registration_request r
  join app.runner_profile b on b.runner_profile_id = r.buyer_profile_id
  where r.registration_request_id = v_request_id;
  if not found then
    return jsonb_build_object('enqueued', 0, 'skipped_no_request', 1);
  end if;
  -- Only a request that is still canceled by staff is announced (the status cannot move back, this is defence in depth).
  if v_req.status <> 'CANCELED_BY_STAFF' then
    return jsonb_build_object('enqueued', 0, 'skipped_not_canceled', 1);
  end if;

  select * into v_recipient from private.comms_ensure_runner_recipient(v_req.buyer_profile_id);
  if v_recipient.o_contact_point_id is null then
    perform private.registration_request_cancel_notice_task(v_req.registration_request_id, v_req.edition_id, v_req.public_reference, 'no_contact');
    return jsonb_build_object('enqueued', 0, 'skipped_no_contact', 1);
  end if;
  if private.comms_recipient_block_reason(v_recipient.o_recipient_id, v_recipient.o_contact_point_id, 'TRANSACTIONAL', false) is not null then
    perform private.registration_request_cancel_notice_task(v_req.registration_request_id, v_req.edition_id, v_req.public_reference, 'suppressed');
  end if;

  -- Closed set: only the label travels, never the free-text reason (same wording as the registration cancel email, migration 714).
  v_label := case v_event.payload ->> 'reason_category'
    when 'PARTICIPANT_REQUEST' then 'Cancelación solicitada por el participante'
    when 'DUPLICATE_REGISTRATION' then 'Inscripción duplicada'
    when 'ELIGIBILITY' then 'Requisitos de participación'
    when 'EVENT_CHANGE' then 'Cambio en el evento'
    when 'ADMINISTRATIVE' then 'Motivo administrativo'
    else 'Otro motivo'
  end;

  v_vars := private.comms_pick_vars('REGISTRATION_REQUEST_CANCELED', private.comms_edition_vars(v_req.edition_id))
    || jsonb_build_object('buyer_name', coalesce(v_req.buyer_name, 'Comprador'), 'request_reference', v_req.public_reference,
         'places_count', v_req.places::text, 'reason_label', v_label);

  -- registration_id stays NULL: the send-time revalidation only concerns CONFIRMED registrations.
  return jsonb_build_object('enqueued',
    case when private.comms_enqueue_message('REGISTRATION_REQUEST_CANCELED', v_recipient.o_recipient_id, v_recipient.o_contact_point_id,
           'REGISTRATION_REQUEST_CANCELED:' || v_req.registration_request_id, 'REGISTRATION_REQUEST', v_req.registration_request_id, v_vars,
           v_req.edition_id, null, null) is not null then 1 else 0 end);
end;
$$;

create function public.enqueue_registration_request_canceled_messages(p_outbox_event_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.enqueue_registration_request_canceled_messages(p_outbox_event_id) $$;

revoke all on function
  private.registration_request_cancel_notice_task(uuid, uuid, text, text),
  private.enqueue_registration_request_canceled_messages(uuid), public.enqueue_registration_request_canceled_messages(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.enqueue_registration_request_canceled_messages(uuid), public.enqueue_registration_request_canceled_messages(uuid)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Cancel transition (single and bulk share it): body of migration 722 plus the buyer-notification event and the closed reason category.
-- ---------------------------------------------------------------------------------------------
drop function private.registration_request_cancel_core(uuid, uuid, text, uuid);

create function private.registration_request_cancel_core(
  p_registration_request_id uuid, p_staff_id uuid, p_reason text, p_correlation_id uuid, p_reason_category text)
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
  -- UX J2 step 4: the buyer is notified. A distinct event type (not RegistrationRequestCanceled, which the buyer's own cancel also writes), one
  -- per request (effect key), carrying only ids and the closed category: never the free-text reason.
  perform private.enqueue_outbox('RegistrationRequestCanceledByStaff', 'RegistrationRequest', p_registration_request_id,
    'RegistrationRequestCanceledByStaff:' || p_registration_request_id,
    jsonb_build_object('registration_request_id', p_registration_request_id, 'edition_id', v_request.edition_id,
      'reason_category', p_reason_category));
  perform private.audit('REGISTRATION_REQUEST_CANCELED', 'registration_request', p_registration_request_id, v_request.edition_id,
    jsonb_build_object('status', v_request.status),
    jsonb_build_object('status', 'CANCELED_BY_STAFF', 'reason_category', p_reason_category)
      || case when p_correlation_id is not null then jsonb_build_object('bulk', true) else '{}'::jsonb end,
    p_reason, p_correlation_id);
  return jsonb_build_object('outcome', 'CANCELED', 'status', 'CANCELED_BY_STAFF');
end;
$$;

-- Single staff cancel with the reason category. Contract of migration 722 otherwise (permission, validation, rate limit, idempotency).
create function private.staff_cancel_registration_request(
  p_registration_request_id uuid, p_reason text, p_reason_category text, p_idempotency_key text)
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
  v_category text := coalesce(nullif(pg_catalog.btrim(p_reason_category), ''), 'OTHER');
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
  if v_category not in ('PARTICIPANT_REQUEST', 'DUPLICATE_REGISTRATION', 'ELIGIBILITY', 'EVENT_CHANGE', 'ADMINISTRATIVE', 'OTHER') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason_category'));
  end if;
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  if p_idempotency_key is not null then
    -- The category joins the fingerprint only when it is not the default, so a retry that predates this migration still replays.
    v_idem := private.idempotency_begin('registration_request.staff_cancel', p_registration_request_id::text, p_idempotency_key,
      jsonb_build_object('registration_request_id', p_registration_request_id, 'reason', v_reason)
        || case when v_category <> 'OTHER' then jsonb_build_object('reason_category', v_category) else '{}'::jsonb end);
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  v_outcome := private.registration_request_cancel_core(p_registration_request_id, v_staff_id, v_reason, null, v_category);
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

-- Migration 722 / 144 signature kept: same behaviour with the default category.
create or replace function private.staff_cancel_registration_request(
  p_registration_request_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.staff_cancel_registration_request(p_registration_request_id, p_reason, 'OTHER', p_idempotency_key) $$;

create function private.staff_bulk_cancel_registration_requests(
  p_edition_id uuid, p_request_ids uuid[], p_reason text, p_reason_category text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_category text := coalesce(nullif(pg_catalog.btrim(p_reason_category), ''), 'OTHER');
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
  if v_category not in ('PARTICIPANT_REQUEST', 'DUPLICATE_REGISTRATION', 'ELIGIBILITY', 'EVENT_CHANGE', 'ADMINISTRATIVE', 'OTHER') then
    perform private.cfg_fail('reason_category', 'invalid_value');
  end if;
  if p_request_ids is null or pg_catalog.cardinality(p_request_ids) = 0 then perform private.cfg_fail('request_ids', 'required'); end if;
  if pg_catalog.cardinality(p_request_ids) > 100 then perform private.cfg_fail('request_ids', 'too_many', jsonb_build_object('max', 100)); end if;
  if array_position(p_request_ids, null) is not null then perform private.cfg_fail('request_ids', 'invalid_value'); end if;
  if (select count(distinct x) from unnest(p_request_ids) x) <> pg_catalog.cardinality(p_request_ids) then
    perform private.cfg_fail('request_ids', 'duplicates');
  end if;

  v_idem := private.cfg_idempotency_begin('registration_request.bulk_cancel', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id, 'request_ids', to_jsonb(p_request_ids), 'reason', v_reason)
      || case when v_category <> 'OTHER' then jsonb_build_object('reason_category', v_category) else '{}'::jsonb end);
  if v_idem is not null and (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  -- One Edition lock for the whole batch (Edition first, then each request's capacity rows): creates and other commands wait.
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;

  for v_id in select x from unnest(p_request_ids) x order by x loop
    begin
      if not exists (select 1 from app.registration_request r where r.registration_request_id = v_id and r.edition_id = p_edition_id) then
        -- Another Edition's request is indistinguishable from a missing one.
        v_outcome := jsonb_build_object('outcome', 'NOT_FOUND');
      else
        v_outcome := private.registration_request_cancel_core(v_id, v_staff_id, v_reason, v_correlation, v_category);
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
      'canceled_request_ids', to_jsonb(v_canceled), 'reason_category', v_category),
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

-- Migration 722 signature kept: same behaviour with the default category.
create or replace function private.staff_bulk_cancel_registration_requests(
  p_edition_id uuid, p_request_ids uuid[], p_reason text, p_idempotency_key text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.staff_bulk_cancel_registration_requests(p_edition_id, p_request_ids, p_reason, 'OTHER', p_idempotency_key) $$;

-- The new overloads have NO defaults: a call that omits the category still resolves to the 722 signatures only (PostgREST included).
create function public.staff_cancel_registration_request(
  p_registration_request_id uuid, p_reason text, p_reason_category text, p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_cancel_registration_request(p_registration_request_id, p_reason, p_reason_category, p_idempotency_key) $$;

create function public.staff_bulk_cancel_registration_requests(
  p_edition_id uuid, p_request_ids uuid[], p_reason text, p_reason_category text, p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_bulk_cancel_registration_requests(p_edition_id, p_request_ids, p_reason, p_reason_category, p_idempotency_key) $$;

revoke all on function
  private.registration_request_cancel_core(uuid, uuid, text, uuid, text),
  private.staff_cancel_registration_request(uuid, text, text, text), public.staff_cancel_registration_request(uuid, text, text, text),
  private.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text),
  public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text)
from public, anon, authenticated, service_role;
grant execute on function
  private.staff_cancel_registration_request(uuid, text, text, text), public.staff_cancel_registration_request(uuid, text, text, text),
  private.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text),
  public.staff_bulk_cancel_registration_requests(uuid, uuid[], text, text, text)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Notification outcome for the cancel responses (P3-R contract: queued | suppressed | no_contact + follow-up task).
-- ---------------------------------------------------------------------------------------------
-- No authorisation here: both callers below authorise REGISTRATION_REQUEST_MANAGE on the request's Edition first.
create function private.registration_request_cancel_outcome(p_registration_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
  v_recipient record;
  v_status text;
  v_task_id uuid;
begin
  select r.registration_request_id, r.edition_id, r.buyer_profile_id, r.public_reference
    into v_req from app.registration_request r where r.registration_request_id = p_registration_request_id;
  -- Same recipient the outbox consumer resolves: the buyer.
  select * into v_recipient from private.comms_ensure_runner_recipient(v_req.buyer_profile_id);
  if v_recipient.o_contact_point_id is null then
    v_status := 'no_contact';
  elsif private.comms_recipient_block_reason(v_recipient.o_recipient_id, v_recipient.o_contact_point_id, 'TRANSACTIONAL', false) is not null then
    v_status := 'suppressed';
  else
    v_status := 'queued';
  end if;
  if v_status <> 'queued' then
    perform private.registration_request_cancel_notice_task(v_req.registration_request_id, v_req.edition_id, v_req.public_reference, v_status);
    select t.admin_task_id into v_task_id from app.admin_task t
    where t.task_key = 'registration-request-cancel-notice:' || v_req.registration_request_id::text;
  end if;
  return jsonb_build_object('status', v_status, 'follow_up_task_id', v_task_id);
end;
$$;

-- One request. Only a request canceled by staff has an outcome.
create function private.registration_request_cancel_notification(p_registration_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_status text;
begin
  select r.edition_id, r.status into v_edition_id, v_status from app.registration_request r
  where r.registration_request_id = p_registration_request_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.require_permission('REGISTRATION_REQUEST_MANAGE', v_edition_id);
  if v_status <> 'CANCELED_BY_STAFF' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'not_canceled_by_staff'));
  end if;
  return private.registration_request_cancel_outcome(p_registration_request_id);
end;
$$;

-- A batch (<= 100 ids of one Edition): one entry per request that is canceled by staff in that Edition, others are skipped.
create function private.registration_request_cancel_notifications(p_edition_id uuid, p_request_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
begin
  if p_edition_id is null or not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_permission('REGISTRATION_REQUEST_MANAGE', p_edition_id);
  if p_request_ids is null or pg_catalog.cardinality(p_request_ids) > 100 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'request_ids'));
  end if;
  for v_id in
    select r.registration_request_id from app.registration_request r
    where r.edition_id = p_edition_id and r.status = 'CANCELED_BY_STAFF' and r.registration_request_id = any (p_request_ids)
    order by r.registration_request_id
  loop
    v_out := v_out || jsonb_build_array(jsonb_build_object('registration_request_id', v_id) || private.registration_request_cancel_outcome(v_id));
  end loop;
  return v_out;
end;
$$;

create function public.registration_request_cancel_notification(p_registration_request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.registration_request_cancel_notification(p_registration_request_id) $$;

create function public.registration_request_cancel_notifications(p_edition_id uuid, p_request_ids uuid[])
returns jsonb language sql security invoker set search_path = ''
as $$ select private.registration_request_cancel_notifications(p_edition_id, p_request_ids) $$;

revoke all on function
  private.registration_request_cancel_outcome(uuid),
  private.registration_request_cancel_notification(uuid), public.registration_request_cancel_notification(uuid),
  private.registration_request_cancel_notifications(uuid, uuid[]), public.registration_request_cancel_notifications(uuid, uuid[])
from public, anon, authenticated, service_role;
grant execute on function
  private.registration_request_cancel_notification(uuid), public.registration_request_cancel_notification(uuid),
  private.registration_request_cancel_notifications(uuid, uuid[]), public.registration_request_cancel_notifications(uuid, uuid[])
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Participants: sporting eligibility, final attendance, incidents and credited distance (T12 section 4, T13 4.13). Read-only.
-- ---------------------------------------------------------------------------------------------
-- Body of migration 770 plus, all additive:
--   attendance.finalized        true while the Edition's attendance has a current FINALIZED finalization
--   attendance.final_status     the resolution status once finalized, else null (resolution_status keeps meaning "current")
--   sporting_eligibility        {status, distance_credit_disposition, reason_code} of the current resolution, null before any
--   incidents                   {count, highest_severity, total_count}: count/highest = OPEN integrity cases of the registration
--                               (highest_severity null when none open), total_count = every case ever raised; no free text
--   credited_distance_m         the ACTIVE DistanceCredit's credited distance (set by the closure), null otherwise
create or replace function private.registration_participant_row(p_registration_id uuid, p_include_contact boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registration_id', r.registration_id,
    'registration_number', r.registration_number,
    'status', r.status,
    'confirmed_at', r.confirmed_at,
    'participant_kind', case when r.runner_profile_id is not null then 'PROFILE' else 'GUEST' end,
    'full_name', coalesce(rp.full_name, g.full_name),
    'public_profile_id', cp.public_profile_id,
    'buyer_full_name', b.full_name,
    'registration_request_id', r.registration_request_id,
    'modality', jsonb_build_object('modality_id', m.modality_id, 'name', m.name),
    'category', case when c.category_id is not null then jsonb_build_object('category_id', c.category_id, 'name', c.name) end,
    'is_minor', coalesce((rq.eligibility_snapshot ->> 'is_minor')::boolean, false),
    'guardian_verification_status', gev.status,
    'pass', case when pp.participant_pass_id is not null then jsonb_build_object(
      'participant_pass_id', pp.participant_pass_id, 'public_code', pp.public_code, 'status', pp.status,
      'has_active_credential', pp.current_credential_id is not null) end,
    'kit', case when ka.kit_allocation_id is not null then jsonb_build_object(
      'status', ka.status, 'kit_variant_id', ka.kit_variant_id, 'variant_label', kv.label,
      'kit_allocation_id', ka.kit_allocation_id, 'kit_definition_id', ka.kit_definition_id,
      'kit_pickup_id', kp.kit_pickup_id) end,
    'attendance', jsonb_build_object(
      'checked_in', exists (select 1 from app.attendance_checkin ac
                            where ac.registration_id = r.registration_id and ac.status = 'VERIFIED_PRESENT'),
      'resolution_status', ar.status,
      'finalized', fin.finalized,
      'final_status', case when fin.finalized then ar.status end),
    'sporting_eligibility', case when se.sporting_eligibility_resolution_id is not null then jsonb_build_object(
      'status', se.status, 'distance_credit_disposition', se.distance_credit_disposition, 'reason_code', se.reason_code) end,
    'incidents', jsonb_build_object('count', inc.open_count, 'highest_severity', inc.highest_open_severity, 'total_count', inc.total_count),
    'credited_distance_m', dc.credited_distance_m,
    'contact', case when p_include_contact then jsonb_build_object(
      'phone_e164', coalesce(rp.phone_e164, g.phone_e164),
      'emergency_contact_name', coalesce(rp.emergency_contact_name, g.emergency_contact_name),
      'emergency_contact_phone_e164', coalesce(rp.emergency_contact_phone_e164, g.emergency_contact_phone_e164)) end)
  from app.registration r
  join app.registration_request_participant rq on rq.request_participant_id = r.request_participant_id
  join app.modality m on m.modality_id = r.modality_id
  join app.runner_profile b on b.runner_profile_id = r.buyer_profile_id
  left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
  left join app.community_profile cp on cp.runner_profile_id = r.runner_profile_id
  left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
  left join app.registration_category_assignment rca on rca.registration_id = r.registration_id
  left join app.category c on c.category_id = rca.category_id
  left join app.participant_pass pp on pp.registration_id = r.registration_id
  left join app.kit_allocation ka on ka.registration_id = r.registration_id
  left join app.kit_variant kv on kv.kit_variant_id = ka.kit_variant_id
  left join app.kit_pickup kp on kp.kit_allocation_id = ka.kit_allocation_id and kp.status = 'DELIVERED'
  left join app.guardian_event_verification gev on gev.registration_id = r.registration_id
  left join app.attendance_resolution ar on ar.registration_id = r.registration_id and ar.superseded_at is null
  left join app.sporting_eligibility_resolution se on se.registration_id = r.registration_id and se.superseded_at is null
  left join app.distance_credit dc on dc.registration_id = r.registration_id and dc.status = 'ACTIVE'
  cross join lateral (
    select exists (select 1 from app.attendance_finalization f
                   where f.edition_id = r.edition_id and f.superseded_at is null and f.status = 'FINALIZED') as finalized) fin
  cross join lateral (
    select count(*) filter (where ic.status = 'OPEN') as open_count,
           (array_agg(ic.severity order by case ic.severity when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end desc)
              filter (where ic.status = 'OPEN'))[1] as highest_open_severity,
           count(*) as total_count
    from app.community_integrity_case ic where ic.registration_id = r.registration_id) inc
  where r.registration_id = p_registration_id
$$;
