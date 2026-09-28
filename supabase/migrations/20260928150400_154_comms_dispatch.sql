-- SYSTEM-only dispatch surface (service_role): outbox claim/complete (Master §147-148), message claim with
-- send-time revalidation and quota reservation (§135, §141, SEC-042), provider events (§138, SEC-080),
-- action tokens (SEC-082/084), outbox consumers for Registration/Edition events and worker runs (§150).

create function private.comms_assert_worker(p_worker text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_worker, '') !~ '^[A-Za-z0-9._:-]{3,100}$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid worker id';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Outbox (generic): FOR UPDATE SKIP LOCKED claim with a lease; expired PROCESSING rows are reclaimable.
-- FAILED means "retry scheduled at available_at". Only event types with a registered consumer are claimed.
-- ---------------------------------------------------------------------------------------------
create function private.claim_outbox_events(p_worker text, p_event_types text[], p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.comms_assert_worker(p_worker);
  if coalesce(p_limit, 0) not between 1 and 200 or coalesce(p_lease_seconds, 0) not between 10 and 900
     or coalesce(pg_catalog.cardinality(p_event_types), 0) = 0 then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid claim arguments';
  end if;

  with candidates as (
    select o.outbox_event_id
    from infra.outbox_event o
    where o.event_type = any (p_event_types)
      and ((o.status in ('PENDING', 'FAILED') and o.available_at <= pg_catalog.now())
           or (o.status = 'PROCESSING' and o.claim_expires_at < pg_catalog.now()))
    order by o.available_at, o.created_at
    limit p_limit
    for update skip locked),
  claimed as (
    update infra.outbox_event o
    set status = 'PROCESSING', attempt_count = o.attempt_count + 1, claimed_by = p_worker,
        claimed_at = pg_catalog.now(), claim_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from candidates c
    where o.outbox_event_id = c.outbox_event_id
    returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'outbox_event_id', c.outbox_event_id, 'event_type', c.event_type, 'aggregate_type', c.aggregate_type,
      'aggregate_id', c.aggregate_id, 'effect_key', c.effect_key, 'payload', c.payload, 'attempt_count', c.attempt_count)
      order by c.available_at, c.created_at), '[]'::jsonb)
  into v_result
  from claimed c;
  return v_result;
end;
$$;

-- A worker that lost its lease (claimed_by changed) cannot complete the event.
create function private.complete_outbox_event(
  p_outbox_event_id uuid, p_worker text, p_outcome text, p_error_code text, p_retry_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event infra.outbox_event%rowtype;
begin
  perform private.comms_assert_worker(p_worker);
  if p_outcome not in ('PROCESSED', 'RETRY', 'ESCALATE') or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$')
     or (p_outcome = 'RETRY' and p_retry_at is null) then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid outbox completion';
  end if;
  select * into v_event from infra.outbox_event o where o.outbox_event_id = p_outbox_event_id for update;
  if not found or v_event.status <> 'PROCESSING' or v_event.claimed_by is distinct from p_worker then
    return jsonb_build_object('applied', false);
  end if;

  update infra.outbox_event
  set status = case p_outcome when 'PROCESSED' then 'PROCESSED' when 'RETRY' then 'FAILED' else 'ESCALATED' end,
      processed_at = case when p_outcome = 'PROCESSED' then pg_catalog.now() end,
      available_at = case when p_outcome = 'RETRY'
                          then least(greatest(p_retry_at, pg_catalog.now()), pg_catalog.now() + interval '1 day')
                          else available_at end,
      claimed_by = null, claimed_at = null, claim_expires_at = null,
      last_error = case when p_outcome = 'PROCESSED' then null else p_error_code end
  where outbox_event_id = p_outbox_event_id;

  if p_outcome = 'ESCALATE' then
    perform private.comms_open_admin_task('outbox-escalated:' || p_outbox_event_id, 'OUTBOX_EVENT', p_outbox_event_id, null,
      'outbox_event', p_outbox_event_id, 'Efecto pendiente escalado',
      pg_catalog.format('El evento %s agotó sus reintentos (%s). Revisa la causa y reprocesa.', v_event.event_type,
        coalesce(p_error_code, 'sin detalle')),
      'ACTION_REQUIRED', jsonb_build_object('event_type', v_event.event_type, 'attempt_count', v_event.attempt_count));
  end if;
  return jsonb_build_object('applied', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Quota (Master §140-141, SEC-042). Supabase Auth OTP uses the same Brevo account; T20 records each
-- OTP request in the auth.otp.email rate-limit windows (max 1 accepted per window), counted here.
-- ---------------------------------------------------------------------------------------------
create function private.comms_auth_otp_count(p_date date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(least(c.hit_count, p.max_hits)), 0)::integer
  from infra.rate_limit_counter c join infra.rate_limit_policy p on p.scope = c.scope
  where c.scope = 'auth.otp.email'
    and c.window_start >= (p_date::timestamp at time zone 'UTC') and c.window_start < ((p_date + 1)::timestamp at time zone 'UTC')
$$;

create function private.comms_reserve_quota(p_provider text, p_priority integer, p_category text, p_optional boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := (pg_catalog.now() at time zone 'UTC')::date;
  v_policy infra.communication_provider_policy%rowtype;
  v_usage app.communication_provider_usage%rowtype;
  v_limit integer;
  v_used integer;
  v_cap integer;
  v_ratio numeric;
  v_threshold integer;
begin
  select * into v_policy from infra.communication_provider_policy p where p.provider = p_provider;
  if not found then
    raise exception using errcode = 'invalid_parameter_value', message = 'unknown provider';
  end if;
  insert into app.communication_provider_usage (provider, usage_date, daily_limit_snapshot)
  values (p_provider, v_date, v_policy.daily_limit)
  on conflict (provider, usage_date) do nothing;
  select * into v_usage from app.communication_provider_usage u where u.provider = p_provider and u.usage_date = v_date for update;

  v_limit := coalesce(v_usage.daily_limit_snapshot, v_policy.daily_limit);
  v_used := v_usage.sent_total
    + case when v_policy.counts_auth_otp then greatest(v_usage.sent_security, private.comms_auth_otp_count(v_date)) else 0 end;
  -- P3 never eats the P0/P1 reserve; P0/P1 may use the whole limit.
  v_cap := case
    when p_priority <= 1 then v_limit
    when p_optional then least(floor(v_limit * v_policy.optional_stop_ratio)::integer, v_limit - v_policy.critical_reserve)
    else v_limit - v_policy.critical_reserve end;
  if v_used >= v_cap then
    return false;
  end if;

  update app.communication_provider_usage
  set sent_total = sent_total + 1,
      sent_operational = sent_operational + case when p_category in ('SECURITY', 'TRANSACTIONAL', 'OPERATIONAL') then 1 else 0 end,
      sent_reminder = sent_reminder + case when p_category = 'REMINDER' then 1 else 0 end,
      sent_marketing = sent_marketing + case when p_category = 'MARKETING' then 1 else 0 end
  where usage_id = v_usage.usage_id;

  foreach v_ratio in array v_policy.alert_ratios loop
    v_threshold := ceil(v_limit * v_ratio)::integer;
    if v_used < v_threshold and v_used + 1 >= v_threshold then
      perform private.comms_open_admin_task(
        pg_catalog.format('communication-quota:%s:%s:%s', p_provider, v_date, (v_ratio * 100)::integer),
        'COMMUNICATION_PROVIDER', null, null, 'communication_provider_usage', v_usage.usage_id,
        'Cuota de correo al ' || (v_ratio * 100)::integer || ' %',
        pg_catalog.format('Se usó el %s %% de la cuota diaria de %s (%s de %s). Campañas y recordatorios anónimos se detienen al %s %%.',
          (v_ratio * 100)::integer, p_provider, v_used + 1, v_limit, (v_policy.optional_stop_ratio * 100)::integer),
        case when v_ratio >= v_policy.optional_stop_ratio then 'ACTION_REQUIRED' else 'INFORMATION' end,
        jsonb_build_object('provider', p_provider, 'usage_date', v_date, 'ratio', v_ratio));
    end if;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Message dispatch
-- ---------------------------------------------------------------------------------------------
create function private.claim_communication_messages(p_worker text, p_provider text, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg app.communication_message%rowtype;
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_reason text;
  v_optional boolean;
  v_attempt integer;
  v_out jsonb := '[]'::jsonb;
begin
  perform private.comms_assert_worker(p_worker);
  if p_provider not in ('brevo', 'capture') or coalesce(p_limit, 0) not between 1 and 100
     or coalesce(p_lease_seconds, 0) not between 30 and 900 then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid claim arguments';
  end if;

  for v_msg in
    select m.* from app.communication_message m
    where (m.status in ('QUEUED', 'WAITING_FOR_QUOTA') and m.scheduled_for <= pg_catalog.now())
       or (m.status = 'SENDING' and m.claim_expires_at < pg_catalog.now())
    order by m.priority, m.scheduled_for, m.created_at
    limit p_limit
    for update skip locked
  loop
    if v_msg.status = 'SENDING' then
      -- The previous worker lost its lease mid-send; the provider may have accepted it (at-least-once).
      update app.communication_delivery_attempt set status = 'ABANDONED', resolved_at = pg_catalog.now(), error_code = 'LEASE_EXPIRED'
      where communication_message_id = v_msg.communication_message_id and attempt_number = v_msg.attempt_count and status = 'PENDING';
      if v_msg.attempt_count >= private.comms_max_attempts(v_msg.priority) then
        update app.communication_message set status = 'FAILED', last_error = 'LEASE_EXPIRED', claimed_by = null, claim_expires_at = null
        where communication_message_id = v_msg.communication_message_id;
        perform private.comms_escalate_message(v_msg.communication_message_id);
        continue;
      end if;
    end if;

    v_reason := private.comms_send_block_reason(v_msg.communication_message_id);
    if v_reason is not null then
      update app.communication_message set status = 'CANCELED', last_error = v_reason, claimed_by = null, claim_expires_at = null
      where communication_message_id = v_msg.communication_message_id;
      continue;
    end if;

    if v_msg.quota_usage_date is distinct from v_today then
      select v_msg.priority = 3 or r.recipient_type = 'ANONYMOUS' into v_optional
      from app.communication_recipient r where r.communication_recipient_id = v_msg.recipient_id;
      if not private.comms_reserve_quota(p_provider, v_msg.priority, v_msg.category, v_optional) then
        update app.communication_message
        set status = 'WAITING_FOR_QUOTA', last_error = 'QUOTA_EXHAUSTED', claimed_by = null, claim_expires_at = null,
            scheduled_for = case when v_msg.priority <= 1 then pg_catalog.now() + interval '15 minutes'
                                 else ((v_today + 1)::timestamp at time zone 'UTC') + interval '5 minutes' end
        where communication_message_id = v_msg.communication_message_id;
        if v_msg.priority <= 1 then
          -- Critical mail blocked by quota is a gate, never a silent multi-day delay (Master §141).
          perform private.comms_open_admin_task(pg_catalog.format('communication-quota-exhausted:%s:%s', p_provider, v_today),
            'COMMUNICATION_PROVIDER', null, null, 'communication_message', v_msg.communication_message_id,
            'Cuota de correo agotada para mensajes críticos',
            pg_catalog.format('La cuota diaria de %s se agotó con mensajes P0/P1 pendientes. Amplía el límite o avisa por otro medio.', p_provider),
            'EVENT_DAY_BLOCKER', jsonb_build_object('provider', p_provider, 'usage_date', v_today));
        end if;
        continue;
      end if;
    end if;

    v_attempt := v_msg.attempt_count + 1;
    update app.communication_message
    set status = 'SENDING', attempt_count = v_attempt, claimed_by = p_worker, quota_usage_date = v_today,
        claim_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    where communication_message_id = v_msg.communication_message_id;
    insert into app.communication_delivery_attempt (communication_message_id, provider, status, attempt_number)
    values (v_msg.communication_message_id, p_provider, 'PENDING', v_attempt);

    v_out := v_out || (
      select jsonb_build_object(
        'message_id', v_msg.communication_message_id,
        'attempt_number', v_attempt,
        'priority', v_msg.priority,
        'category', v_msg.category,
        'template_key', v_msg.template_key,
        'template_version', v_msg.template_version,
        'campaign_id', v_msg.campaign_id,
        'recipient_type', r.recipient_type,
        'to_email', cp.value_normalized,
        'subject', v_msg.rendered_subject_snapshot,
        'html_template', tv.html_template,
        'text_template', tv.text_template,
        'variable_schema', tv.variable_schema,
        'variables', v_msg.render_context_snapshot,
        -- §229/A3: the QR goes only to the pass holder, or to the buyer for a GUEST pass.
        'participant_pass_id', (
          select pp.participant_pass_id
          from app.participant_pass pp join app.registration reg on reg.registration_id = pp.registration_id
          where pp.participant_pass_id = v_msg.participant_pass_id and pp.status = 'ACTIVE' and reg.status = 'CONFIRMED'
            and r.runner_profile_id = case when reg.guest_participant_id is null then reg.runner_profile_id else reg.buyer_profile_id end))
      from app.communication_recipient r
      join app.communication_contact_point cp on cp.communication_contact_point_id = v_msg.contact_point_id
      join app.communication_template t on t.template_key = v_msg.template_key
      join app.communication_template_version tv on tv.template_id = t.communication_template_id and tv.version = v_msg.template_version
      where r.communication_recipient_id = v_msg.recipient_id);
  end loop;
  return v_out;
end;
$$;

-- Mints the recipient's action link for this attempt (SEC-082/084). Only the hash is stored; the purpose
-- is decided here from the message, never by the caller.
create function private.issue_communication_action_token(p_message_id uuid, p_worker text, p_attempt_number integer, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg app.communication_message%rowtype;
  v_purpose text;
  v_expires_at timestamptz;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid token digest';
  end if;
  select * into v_msg from app.communication_message m where m.communication_message_id = p_message_id;
  if not found or v_msg.status <> 'SENDING' or v_msg.claimed_by is distinct from p_worker or v_msg.attempt_count <> p_attempt_number then
    return jsonb_build_object('purpose', null);
  end if;
  v_purpose := case
    when v_msg.template_key = 'ANONYMOUS_REMINDER_CONFIRMATION' then 'REMINDER_CONFIRMATION'
    when v_msg.category = 'MARKETING' then 'UNSUBSCRIBE_MARKETING'
    when v_msg.category = 'REMINDER' then 'UNSUBSCRIBE_REMINDERS' end;
  if v_purpose is null then
    return jsonb_build_object('purpose', null);
  end if;
  v_expires_at := pg_catalog.now() + case when v_purpose = 'REMINDER_CONFIRMATION' then interval '24 hours' else interval '180 days' end;
  insert into private.communication_action_token (purpose, token_hash, communication_recipient_id, contact_point_id,
    event_reminder_subscription_id, communication_message_id, expires_at)
  values (v_purpose, p_token_hash, v_msg.recipient_id, v_msg.contact_point_id,
    case when v_msg.source_type = 'EVENT_REMINDER_SUBSCRIPTION' then v_msg.source_id end, p_message_id, v_expires_at);
  return jsonb_build_object('purpose', v_purpose, 'expires_at', v_expires_at);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Provider events (Master §138, SEC-080): unauthenticated → evidence only; duplicate → no-op;
-- older event never regresses a newer state; suppression only for messages RUNIIS sent.
-- ---------------------------------------------------------------------------------------------
create function private.comms_apply_provider_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event infra.communication_provider_event%rowtype;
  v_msg app.communication_message%rowtype;
  v_target text;
  v_changed boolean := false;
  v_side_effect boolean := false;
  v_suppression record;
begin
  select * into v_event from infra.communication_provider_event e where e.communication_provider_event_id = p_event_id for update;
  if v_event.processing_status not in ('RECEIVED', 'UNMATCHED') then
    return jsonb_build_object('status', v_event.processing_status);
  end if;

  select m.* into v_msg
  from app.communication_delivery_attempt a
  join app.communication_message m on m.communication_message_id = a.communication_message_id
  where a.provider = v_event.provider and a.provider_message_id = v_event.provider_message_id
  for update of m;
  if not found then
    update infra.communication_provider_event set processing_status = 'UNMATCHED'
    where communication_provider_event_id = p_event_id;
    return jsonb_build_object('status', 'UNMATCHED');
  end if;

  v_target := case v_event.event_type
    when 'delivered' then 'DELIVERED'
    when 'hard_bounce' then 'BOUNCED' when 'invalid_email' then 'BOUNCED'
    when 'blocked' then 'FAILED' when 'error' then 'FAILED'
    when 'spam' then 'COMPLAINED' end;
  if v_target is not null and v_msg.status in ('SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'COMPLAINED')
     and private.comms_status_rank(v_target) > private.comms_status_rank(v_msg.status) then
    update app.communication_message set status = v_target, provider_status_at = v_event.received_at,
      last_error = case when v_target in ('BOUNCED', 'FAILED') then 'PROVIDER_' || pg_catalog.upper(v_event.event_type) else last_error end
    where communication_message_id = v_msg.communication_message_id;
    v_changed := true;
    if v_target in ('BOUNCED', 'FAILED') then
      perform private.comms_escalate_message(v_msg.communication_message_id);
    end if;
  end if;

  select * into v_suppression from (values
    ('hard_bounce', 'HARD_BOUNCE', 'ALL_EMAIL'), ('invalid_email', 'INVALID_ADDRESS', 'ALL_EMAIL'),
    ('blocked', 'PROVIDER_SUPPRESSION', 'ALL_EMAIL'), ('spam', 'SPAM_COMPLAINT', 'OPTIONAL_ONLY')) s(event_type, reason, scope)
  where s.event_type = v_event.event_type;
  if found then
    insert into app.communication_suppression (contact_point_id, reason, scope, source, source_message_id)
    values (v_msg.contact_point_id, v_suppression.reason, v_suppression.scope, 'PROVIDER_EVENT:' || v_event.provider,
      v_msg.communication_message_id)
    on conflict (contact_point_id, reason, scope) where active do nothing;
    v_side_effect := found;
  elsif v_event.event_type = 'unsubscribed' then
    v_side_effect := private.comms_record_consent(v_msg.recipient_id, 'GENERAL_MARKETING', 'WITHDRAWN', 'PROVIDER_UNSUBSCRIBE',
      jsonb_build_object('communication_message_id', v_msg.communication_message_id));
  end if;

  update infra.communication_provider_event
  set processing_status = case when v_changed or v_side_effect then 'PROCESSED' else 'IGNORED' end, processed_at = pg_catalog.now()
  where communication_provider_event_id = p_event_id;
  return jsonb_build_object('status', case when v_changed or v_side_effect then 'PROCESSED' else 'IGNORED' end,
    'message_status_changed', v_changed);
end;
$$;

create function private.record_email_provider_event(
  p_provider text, p_provider_event_id text, p_provider_message_id text, p_event_type text, p_payload_safe jsonb,
  p_authenticated boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_provider not in ('brevo') or coalesce(pg_catalog.length(p_provider_event_id), 0) not between 8 and 200
     or pg_catalog.length(p_provider_message_id) > 300 or coalesce(p_event_type, '') !~ '^[a-z_]{2,40}$'
     or jsonb_typeof(p_payload_safe) is distinct from 'object' or pg_catalog.length(p_payload_safe::text) > 2048
     or p_authenticated is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid provider event';
  end if;
  insert into infra.communication_provider_event (provider, provider_event_id, provider_message_id, event_type,
    authenticated, payload_safe, processing_status, processed_at)
  values (p_provider, p_provider_event_id, p_provider_message_id, p_event_type, p_authenticated, p_payload_safe,
    case when p_authenticated then 'RECEIVED' else 'UNAUTHENTICATED' end,
    case when p_authenticated then null else pg_catalog.now() end)
  on conflict (provider, provider_event_id) do nothing
  returning communication_provider_event_id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'DUPLICATE');
  end if;
  if not p_authenticated then
    return jsonb_build_object('status', 'UNAUTHENTICATED');
  end if;
  return private.comms_apply_provider_event(v_id);
end;
$$;

create function private.complete_communication_attempt(
  p_message_id uuid, p_worker text, p_attempt_number integer, p_outcome text, p_provider text,
  p_provider_message_id text, p_error_code text, p_retry_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg app.communication_message%rowtype;
  v_status text;
  v_event_id uuid;
begin
  perform private.comms_assert_worker(p_worker);
  if p_outcome not in ('ACCEPTED', 'RETRYABLE', 'PERMANENT', 'BLOCKED_BY_POLICY') or p_provider not in ('brevo', 'capture')
     or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$')
     or (p_outcome = 'ACCEPTED' and coalesce(pg_catalog.length(p_provider_message_id), 0) not between 1 and 300)
     or (p_outcome = 'RETRYABLE' and p_retry_at is null) then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid attempt completion';
  end if;
  select * into v_msg from app.communication_message m where m.communication_message_id = p_message_id for update;
  if not found or v_msg.status <> 'SENDING' or v_msg.claimed_by is distinct from p_worker or v_msg.attempt_count <> p_attempt_number then
    return jsonb_build_object('applied', false);
  end if;

  v_status := case p_outcome
    when 'ACCEPTED' then 'SENT'
    when 'BLOCKED_BY_POLICY' then 'CANCELED'
    when 'PERMANENT' then 'FAILED'
    else case when p_attempt_number >= private.comms_max_attempts(v_msg.priority) then 'FAILED' else 'QUEUED' end end;

  update app.communication_delivery_attempt
  set status = case p_outcome when 'ACCEPTED' then 'ACCEPTED' when 'BLOCKED_BY_POLICY' then 'BLOCKED_BY_POLICY'
                              when 'PERMANENT' then 'PERMANENT_FAILURE' else 'RETRYABLE_FAILURE' end,
      provider = p_provider,
      provider_message_id = case when p_outcome = 'ACCEPTED' then p_provider_message_id end,
      resolved_at = pg_catalog.now(), error_code = p_error_code
  where communication_message_id = p_message_id and attempt_number = p_attempt_number;

  update app.communication_message
  set status = v_status, claimed_by = null, claim_expires_at = null,
      sent_at = case when v_status = 'SENT' then pg_catalog.now() else sent_at end,
      provider = case when v_status = 'SENT' then p_provider else provider end,
      provider_message_id = case when v_status = 'SENT' then p_provider_message_id else provider_message_id end,
      provider_status_at = case when v_status = 'SENT' then pg_catalog.now() else provider_status_at end,
      last_error = case when v_status = 'SENT' then null
                        when p_outcome = 'BLOCKED_BY_POLICY' then coalesce(p_error_code, 'DELIVERY_MODE_BLOCKED')
                        else p_error_code end,
      scheduled_for = case when v_status = 'QUEUED'
                           then least(greatest(p_retry_at, pg_catalog.now() + interval '5 seconds'), pg_catalog.now() + interval '1 day')
                           else scheduled_for end
  where communication_message_id = p_message_id;

  if v_status = 'FAILED' then
    perform private.comms_escalate_message(p_message_id);
  elsif v_status = 'SENT' then
    -- Webhooks can arrive before the provider id is known here; replay them now.
    for v_event_id in
      select e.communication_provider_event_id from infra.communication_provider_event e
      where e.provider = p_provider and e.provider_message_id = p_provider_message_id and e.processing_status = 'UNMATCHED'
      order by e.received_at
    loop
      perform private.comms_apply_provider_event(v_event_id);
    end loop;
  end if;
  return jsonb_build_object('applied', true, 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Outbox consumers (called by the TS consumer registry with the claimed event id)
-- ---------------------------------------------------------------------------------------------

-- Master §229: a PROFILE participant gets their own pass at their own verified contact; a GUEST pass goes
-- to the buyer; a multi-registration buyer summary lists participants without any QR.
create function private.enqueue_registration_confirmed_messages(p_outbox_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event infra.outbox_event%rowtype;
  v_registration_ids uuid[];
  v_request_id uuid;
  v_reg record;
  v_recipient record;
  v_vars jsonb;
  v_enqueued integer := 0;
  v_no_contact integer := 0;
begin
  select * into v_event from infra.outbox_event o where o.outbox_event_id = p_outbox_event_id;
  if not found or v_event.event_type <> 'RegistrationConfirmed' then
    raise exception using errcode = 'invalid_parameter_value', message = 'not a RegistrationConfirmed event';
  end if;

  if v_event.payload ? 'registration_id' then
    v_registration_ids := array[(v_event.payload ->> 'registration_id')::uuid];
  elsif v_event.payload ? 'registration_ids' then
    v_registration_ids := array(select jsonb_array_elements_text(v_event.payload -> 'registration_ids')::uuid);
  elsif v_event.aggregate_type = 'Registration' then
    v_registration_ids := array[v_event.aggregate_id];
  else
    v_request_id := coalesce((v_event.payload ->> 'registration_request_id')::uuid,
      case when v_event.aggregate_type = 'RegistrationRequest' then v_event.aggregate_id end);
    v_registration_ids := array(select r.registration_id from app.registration r
                                where r.registration_request_id = v_request_id and r.status = 'CONFIRMED');
  end if;

  for v_reg in
    select r.registration_id, r.registration_request_id, r.edition_id, r.runner_profile_id, r.guest_participant_id,
           r.buyer_profile_id, r.registration_number, m.name as modality_name, pp.participant_pass_id, pp.public_code,
           coalesce(rp.full_name, g.full_name) as participant_name
    from app.registration r
    join app.modality m on m.modality_id = r.modality_id
    left join app.participant_pass pp on pp.registration_id = r.registration_id and pp.status = 'ACTIVE'
    left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
    left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
    where r.registration_id = any (v_registration_ids) and r.status = 'CONFIRMED'
    order by r.registration_number
  loop
    select * into v_recipient from private.comms_ensure_runner_recipient(coalesce(v_reg.runner_profile_id, v_reg.buyer_profile_id));
    if v_recipient.o_contact_point_id is null then
      v_no_contact := v_no_contact + 1;
      continue;
    end if;
    v_vars := private.comms_pick_vars('REGISTRATION_CONFIRMED', private.comms_edition_vars(v_reg.edition_id))
      || jsonb_build_object('participant_name', v_reg.participant_name, 'modality_name', v_reg.modality_name,
           'registration_number', v_reg.registration_number, 'is_guest_pass', v_reg.guest_participant_id is not null)
      || case when v_reg.public_code is null then '{}'::jsonb else jsonb_build_object('pass_public_code', v_reg.public_code) end;
    if private.comms_enqueue_message('REGISTRATION_CONFIRMED', v_recipient.o_recipient_id, v_recipient.o_contact_point_id,
         'REGISTRATION_CONFIRMED:' || v_reg.registration_id, 'REGISTRATION', v_reg.registration_id, v_vars,
         v_reg.edition_id, v_reg.registration_id, v_reg.participant_pass_id) is not null then
      v_enqueued := v_enqueued + 1;
    end if;
  end loop;

  for v_reg in
    select rr.registration_request_id, rr.buyer_profile_id, rr.edition_id, rr.public_reference
    from app.registration_request rr
    where rr.registration_request_id in (select r.registration_request_id from app.registration r
                                         where r.registration_id = any (v_registration_ids))
      and (select count(*) from app.registration r2
           where r2.registration_request_id = rr.registration_request_id and r2.status = 'CONFIRMED') >= 2
  loop
    select * into v_recipient from private.comms_ensure_runner_recipient(v_reg.buyer_profile_id);
    -- Friends appear by their public display name (already visible through the Friendship), never with a QR.
    v_vars := private.comms_pick_vars('MULTI_REGISTRATION_BUYER_SUMMARY', private.comms_edition_vars(v_reg.edition_id))
      || jsonb_build_object('request_reference', v_reg.public_reference, 'participants', (
        select jsonb_agg(jsonb_build_object(
            'name', coalesce(g.full_name, cpr.display_name, pg_catalog.split_part(rp.full_name, ' ', 1), 'Participante'),
            'modality_name', m.name) order by r.registration_number)
        from app.registration r
        join app.modality m on m.modality_id = r.modality_id
        left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
        left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
        left join app.community_profile cpr on cpr.runner_profile_id = r.runner_profile_id
        where r.registration_request_id = v_reg.registration_request_id and r.status = 'CONFIRMED'));
    if private.comms_enqueue_message('MULTI_REGISTRATION_BUYER_SUMMARY', v_recipient.o_recipient_id,
         v_recipient.o_contact_point_id, 'MULTI_REGISTRATION_BUYER_SUMMARY:' || v_reg.registration_request_id,
         'REGISTRATION_REQUEST', v_reg.registration_request_id, v_vars, v_reg.edition_id) is not null then
      v_enqueued := v_enqueued + 1;
    end if;
  end loop;

  return jsonb_build_object('enqueued', v_enqueued, 'skipped_no_contact', v_no_contact);
end;
$$;

-- Recipients of confirmed Registrations of an Edition (Guests route to their buyer), one row per person.
create function private.comms_edition_participant_recipients(p_edition_id uuid, p_modality_ids uuid[] default null)
returns table (recipient_id uuid, contact_point_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  for v_profile_id in
    select distinct coalesce(r.runner_profile_id, r.buyer_profile_id)
    from app.registration r
    where r.edition_id = p_edition_id and r.status = 'CONFIRMED'
      and (p_modality_ids is null or r.modality_id = any (p_modality_ids))
  loop
    select o_recipient_id, o_contact_point_id into recipient_id, contact_point_id
    from private.comms_ensure_runner_recipient(v_profile_id);
    return next;
  end loop;
end;
$$;

-- Edition lifecycle (Master §33, §133): notify, cancel/reschedule dependent reminders.
create function private.enqueue_edition_event_messages(p_outbox_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event infra.outbox_event%rowtype;
  v_edition_id uuid;
  v_edition_vars jsonb;
  v_target record;
  v_enqueued integer := 0;
  v_canceled integer := 0;
  v_rule text;
begin
  select * into v_event from infra.outbox_event o where o.outbox_event_id = p_outbox_event_id;
  if not found or v_event.event_type not in ('EditionCanceled', 'EditionPostponed', 'EditionRescheduled', 'EditionRegistrationOpened') then
    raise exception using errcode = 'invalid_parameter_value', message = 'not an Edition lifecycle event';
  end if;
  v_edition_id := coalesce((v_event.payload ->> 'edition_id')::uuid, case when v_event.aggregate_type = 'Edition' then v_event.aggregate_id end);
  if not exists (select 1 from app.edition e where e.edition_id = v_edition_id) then
    raise exception using errcode = 'invalid_parameter_value', message = 'edition not found';
  end if;
  v_edition_vars := private.comms_edition_vars(v_edition_id);

  if v_event.event_type in ('EditionCanceled', 'EditionPostponed', 'EditionRescheduled') then
    update app.communication_message
    set status = 'CANCELED', last_error = 'EDITION_' || pg_catalog.upper(pg_catalog.substr(v_event.event_type, 8))
    where edition_id = v_edition_id and status in ('QUEUED', 'WAITING_FOR_QUOTA')
      and template_key in ('T_MINUS_7', 'T_MINUS_24', 'REGISTRATION_OPENED', 'ANONYMOUS_REMINDER_CONFIRMATION', 'KIT_INFORMATION')
      and (v_event.event_type <> 'EditionRescheduled' or template_key in ('T_MINUS_7', 'T_MINUS_24'));
    get diagnostics v_canceled = row_count;
  end if;

  if v_event.event_type = 'EditionCanceled' then
    update app.event_reminder_subscription set status = 'CANCELED', canceled_at = pg_catalog.now()
    where edition_id = v_edition_id and status in ('PENDING_CONFIRMATION', 'ACTIVE');
  end if;

  if v_event.event_type = 'EditionRegistrationOpened' then
    for v_target in
      select s.event_reminder_subscription_id, s.communication_recipient_id
      from app.event_reminder_subscription s
      where s.edition_id = v_edition_id and s.reminder_type = 'REGISTRATION_OPENED' and s.status = 'ACTIVE'
      for update of s
    loop
      if private.comms_enqueue_message('REGISTRATION_OPENED', v_target.communication_recipient_id,
           private.comms_primary_contact(v_target.communication_recipient_id),
           'REGISTRATION_OPENED:' || v_target.event_reminder_subscription_id, 'EVENT_REMINDER_SUBSCRIPTION',
           v_target.event_reminder_subscription_id, private.comms_pick_vars('REGISTRATION_OPENED', v_edition_vars),
           v_edition_id) is not null then
        v_enqueued := v_enqueued + 1;
      end if;
      update app.event_reminder_subscription set status = 'COMPLETED'
      where event_reminder_subscription_id = v_target.event_reminder_subscription_id;
    end loop;
    return jsonb_build_object('enqueued', v_enqueued, 'canceled', v_canceled);
  end if;

  v_rule := case v_event.event_type when 'EditionCanceled' then 'CANCELED' when 'EditionPostponed' then 'POSTPONED' else 'RESCHEDULED' end;
  for v_target in select * from private.comms_edition_participant_recipients(v_edition_id) loop
    if private.comms_enqueue_message(v_rule, v_target.recipient_id, v_target.contact_point_id,
         case when v_rule = 'CANCELED' then 'CANCELED:' || v_edition_id || ':' || v_target.recipient_id
              else v_rule || ':' || p_outbox_event_id || ':' || v_target.recipient_id end,
         'OUTBOX_EVENT', p_outbox_event_id,
         private.comms_pick_vars(v_rule, v_edition_vars || '{"is_participant": true}'::jsonb), v_edition_id) is not null then
      v_enqueued := v_enqueued + 1;
    end if;
  end loop;

  if v_rule = 'POSTPONED' then
    -- "confirmados y reminders aplicables": subscribers hear it too; participants already got it (dedupe key).
    for v_target in
      select distinct s.communication_recipient_id from app.event_reminder_subscription s
      where s.edition_id = v_edition_id and s.status = 'ACTIVE'
    loop
      if private.comms_enqueue_message('POSTPONED', v_target.communication_recipient_id,
           private.comms_primary_contact(v_target.communication_recipient_id),
           'POSTPONED:' || p_outbox_event_id || ':' || v_target.communication_recipient_id, 'OUTBOX_EVENT', p_outbox_event_id,
           private.comms_pick_vars('POSTPONED', v_edition_vars || '{"is_participant": false}'::jsonb), v_edition_id) is not null then
        v_enqueued := v_enqueued + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('enqueued', v_enqueued, 'canceled', v_canceled);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Worker runs (Master §150)
-- ---------------------------------------------------------------------------------------------
create function private.start_worker_run(p_worker_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(p_worker_key, '') !~ '^[a-z][a-z0-9-]{2,63}$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid worker key';
  end if;
  insert into infra.worker_run (worker_key) values (p_worker_key) returning worker_run_id into v_id;
  return v_id;
end;
$$;

create function private.finish_worker_run(p_worker_run_id uuid, p_status text, p_processed_count integer,
  p_error_count integer, p_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('SUCCEEDED', 'PARTIAL', 'FAILED') or jsonb_typeof(p_metadata) is distinct from 'object'
     or pg_catalog.length(p_metadata::text) > 4096 then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid worker run completion';
  end if;
  update infra.worker_run
  set status = p_status, completed_at = pg_catalog.now(), processed_count = greatest(coalesce(p_processed_count, 0), 0),
      error_count = greatest(coalesce(p_error_count, 0), 0), metadata = p_metadata
  where worker_run_id = p_worker_run_id and status = 'RUNNING';
end;
$$;
