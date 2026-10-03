-- 164: staging allowlist suppression (P2-G9). EMAIL_DELIVERY_MODE=allowlist on a deployed host has no capture sink, so a
-- non-allowlisted recipient used to be sent to an unreachable capture transport, retried 8 times, ended FAILED and was
-- counted against the Brevo daily budget at claim time. claim_communication_messages gains p_allowlist (default NULL =
-- unchanged behaviour): when given, a message whose contact point is not in it becomes CANCELED / NOT_ALLOWLISTED before the
-- quota is reserved. Messages are never deleted and no schema object changes; only the claim signature does, so the old
-- 4-argument functions are dropped and re-created with the same grants (service_role only).

drop function public.claim_communication_messages(text, text, integer, integer);
drop function private.claim_communication_messages(text, text, integer, integer);

create function private.claim_communication_messages(
  p_worker text, p_provider text, p_limit integer, p_lease_seconds integer, p_allowlist text[] default null)
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
  v_allow text[];
begin
  perform private.comms_assert_worker(p_worker);
  if p_provider not in ('brevo', 'capture') or coalesce(p_limit, 0) not between 1 and 100
     or coalesce(p_lease_seconds, 0) not between 30 and 900 then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid claim arguments';
  end if;
  -- NULL = no allowlist restriction. A non-NULL array (even empty) restricts delivery to those addresses.
  v_allow := case when p_allowlist is null then null
    else coalesce((select pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(a)))
                   from pg_catalog.unnest(p_allowlist) as a where pg_catalog.btrim(a) <> ''), '{}'::text[]) end;

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

    -- Allowlist suppression (P2-G9): a recipient outside the allowlist is terminally CANCELED here, before the
    -- quota reservation, so nothing is transported, retried or counted against the provider's daily usage.
    if v_allow is not null and not exists (
         select 1 from app.communication_contact_point cp
         where cp.communication_contact_point_id = v_msg.contact_point_id and cp.value_normalized = any (v_allow)) then
      update app.communication_message set status = 'CANCELED', last_error = 'NOT_ALLOWLISTED', claimed_by = null, claim_expires_at = null
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

create function public.claim_communication_messages(
  p_worker text, p_provider text, p_limit integer, p_lease_seconds integer, p_allowlist text[] default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.claim_communication_messages(p_worker, p_provider, p_limit, p_lease_seconds, p_allowlist) $$;

revoke all on function
  private.claim_communication_messages(text, text, integer, integer, text[]),
  public.claim_communication_messages(text, text, integer, integer, text[])
from public, anon, authenticated, service_role;

grant execute on function
  private.claim_communication_messages(text, text, integer, integer, text[]),
  public.claim_communication_messages(text, text, integer, integer, text[])
to service_role;
