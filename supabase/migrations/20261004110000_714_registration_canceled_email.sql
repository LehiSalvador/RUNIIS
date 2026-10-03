-- P3-C OWN-04: the participant is ALWAYS notified when staff cancel a confirmed registration (Master §77, §133).
-- Data and consumer only, no change to any P3-A command:
--   * REGISTRATION_CANCELED transactional template (Spanish, MX; no legal text, no refund promise) and its automation
--     rule on the RegistrationCanceled outbox event, same shape as REGISTRATION_CONFIRMED (migration 151);
--   * private.enqueue_registration_canceled_messages(outbox_event_id): the outbox consumer. It addresses the
--     participant (the buyer for a Guest, who has no account) exactly once per registration through
--     comms_enqueue_message (dedupe_key = REGISTRATION_CANCELED:{registration}), so the existing dispatch pipeline,
--     quota, suppression list and the staging allowlist (migration 164: non-allowlisted -> CANCELED/NOT_ALLOWLISTED,
--     no transport) apply unchanged;
--   * public.registration_edition_for_staff: lets the route invalidate the public availability cache after a
--     cancellation or a modality change without reading tables.
--
-- The message is deliberately NOT linked to the registration (registration_id = NULL, source = REGISTRATION): the send-time
-- revalidation (comms_send_block_reason) cancels any message whose registration is no longer CONFIRMED, which would cancel
-- the very notice that announces the cancellation. The free-text reason never reaches the message: only the label of the
-- closed reason_category does.

-- ---------------------------------------------------------------------------------------------
-- Template + automation rule.
-- ---------------------------------------------------------------------------------------------
insert into app.communication_template (template_key, category, active_version)
values ('REGISTRATION_CANCELED', 'TRANSACTIONAL', 1)
on conflict (template_key) do nothing;

insert into app.communication_template_version (template_id, version, subject_template, html_template, text_template, variable_schema)
select t.communication_template_id, 1,
  'Tu inscripción a {{edition_name}} fue cancelada',
  $h${{^is_guest_pass}}<p>Hola, {{participant_name}}:</p>
<p>Tu inscripción a <strong>{{edition_name}}</strong> fue cancelada por el equipo de RUNIIS.</p>{{/is_guest_pass}}
{{#is_guest_pass}}<p>Hola:</p>
<p>La inscripción de tu invitado <strong>{{participant_name}}</strong> a <strong>{{edition_name}}</strong> fue cancelada por el equipo de RUNIIS.</p>{{/is_guest_pass}}
<ul>
<li>Motivo: {{reason_label}}</li>
<li>Fecha del evento: {{event_date_text}}</li>
<li>Modalidad: {{modality_name}}</li>
<li>Número de inscripción: {{registration_number}}</li>
</ul>
<p>El pase de esta inscripción ya no es válido. Si tienes dudas, responde por el mismo medio por el que te inscribiste o contacta al equipo de RUNIIS.</p>
<p><a href="{{events_path}}">Ver otros eventos</a></p>$h$,
  $t${{^is_guest_pass}}Hola, {{participant_name}}:

Tu inscripción a {{edition_name}} fue cancelada por el equipo de RUNIIS.{{/is_guest_pass}}{{#is_guest_pass}}Hola:

La inscripción de tu invitado {{participant_name}} a {{edition_name}} fue cancelada por el equipo de RUNIIS.{{/is_guest_pass}}

- Motivo: {{reason_label}}
- Fecha del evento: {{event_date_text}}
- Modalidad: {{modality_name}}
- Número de inscripción: {{registration_number}}

El pase de esta inscripción ya no es válido. Si tienes dudas, responde por el mismo medio por el que te inscribiste o contacta al equipo de RUNIIS.

Ver otros eventos: {{events_path}}$t$,
  '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "events_path": {"type": "path", "source": "snapshot"}, "participant_name": {"type": "text", "max": 160, "source": "snapshot"}, "modality_name": {"type": "text", "max": 120, "source": "snapshot"}, "registration_number": {"type": "text", "max": 40, "source": "snapshot"}, "reason_label": {"type": "text", "max": 120, "source": "snapshot"}, "is_guest_pass": {"type": "flag", "source": "snapshot"}}}'::jsonb
from app.communication_template t
where t.template_key = 'REGISTRATION_CANCELED'
on conflict (template_id, version) do nothing;

insert into app.communication_automation_rule (rule_key, trigger_event, template_key, category, priority,
  recipient_policy, consent_policy, scheduling_policy, dedupe_policy, active)
values ('REGISTRATION_CANCELED', 'RegistrationCanceled', 'REGISTRATION_CANCELED', 'TRANSACTIONAL', 1,
  'PARTICIPANT_OR_GUEST_BUYER', 'NONE_REQUIRED', '{"send": "immediate"}', '{"key": "REGISTRATION_CANCELED:{registration}"}', true)
on conflict (rule_key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Outbox consumer. Called by the TS consumer registry with the claimed event id (service_role).
-- ---------------------------------------------------------------------------------------------
create function private.enqueue_registration_canceled_messages(p_outbox_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event infra.outbox_event%rowtype;
  v_registration_id uuid;
  v_reg record;
  v_recipient record;
  v_label text;
  v_vars jsonb;
begin
  select * into v_event from infra.outbox_event o where o.outbox_event_id = p_outbox_event_id;
  if not found or v_event.event_type <> 'RegistrationCanceled' then
    raise exception using errcode = 'invalid_parameter_value', message = 'not a RegistrationCanceled event';
  end if;

  v_registration_id := coalesce((v_event.payload ->> 'registration_id')::uuid,
    case when v_event.aggregate_type = 'Registration' then v_event.aggregate_id end);
  select r.registration_id, r.edition_id, r.runner_profile_id, r.guest_participant_id, r.buyer_profile_id,
         r.registration_number, m.name as modality_name, coalesce(rp.full_name, g.full_name) as participant_name
    into v_reg
  from app.registration r
  join app.modality m on m.modality_id = r.modality_id
  left join app.runner_profile rp on rp.runner_profile_id = r.runner_profile_id
  left join app.guest_participant g on g.guest_participant_id = r.guest_participant_id
  where r.registration_id = v_registration_id;
  if not found then
    return jsonb_build_object('enqueued', 0, 'skipped_no_registration', 1);
  end if;

  -- The participant's own profile, or the buyer's for a Guest (who has no account): the event carries it, the
  -- registration row is the fallback for events written before the recipient reference existed.
  select * into v_recipient from private.comms_ensure_runner_recipient(
    coalesce((v_event.payload ->> 'recipient_profile_id')::uuid, v_reg.runner_profile_id, v_reg.buyer_profile_id));
  if v_recipient.o_contact_point_id is null then
    return jsonb_build_object('enqueued', 0, 'skipped_no_contact', 1);
  end if;

  -- Closed set (migration 713): only the label travels, never the free-text reason.
  v_label := case v_event.payload ->> 'reason_category'
    when 'PARTICIPANT_REQUEST' then 'Cancelación solicitada por el participante'
    when 'DUPLICATE_REGISTRATION' then 'Inscripción duplicada'
    when 'ELIGIBILITY' then 'Requisitos de participación'
    when 'EVENT_CHANGE' then 'Cambio en el evento'
    when 'ADMINISTRATIVE' then 'Motivo administrativo'
    else 'Otro motivo'
  end;

  v_vars := private.comms_pick_vars('REGISTRATION_CANCELED', private.comms_edition_vars(v_reg.edition_id))
    || jsonb_build_object('participant_name', coalesce(v_reg.participant_name, 'Participante'),
         'modality_name', v_reg.modality_name, 'registration_number', v_reg.registration_number,
         'reason_label', v_label, 'is_guest_pass', v_reg.guest_participant_id is not null);

  return jsonb_build_object('enqueued',
    case when private.comms_enqueue_message('REGISTRATION_CANCELED', v_recipient.o_recipient_id, v_recipient.o_contact_point_id,
           'REGISTRATION_CANCELED:' || v_reg.registration_id, 'REGISTRATION', v_reg.registration_id, v_vars,
           v_reg.edition_id, null, null) is not null then 1 else 0 end);
end;
$$;

create function public.enqueue_registration_canceled_messages(p_outbox_event_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.enqueue_registration_canceled_messages(p_outbox_event_id) $$;

revoke all on function private.enqueue_registration_canceled_messages(uuid), public.enqueue_registration_canceled_messages(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.enqueue_registration_canceled_messages(uuid), public.enqueue_registration_canceled_messages(uuid)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- Edition of a registration for staff with REGISTRATION_MANAGE (post-commit cache invalidation only).
-- ---------------------------------------------------------------------------------------------
create function private.registration_edition_for_staff(p_registration_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
begin
  select r.edition_id into v_edition_id from app.registration r where r.registration_id = p_registration_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.require_permission('REGISTRATION_MANAGE', v_edition_id);
  return v_edition_id;
end;
$$;

create function public.registration_edition_for_staff(p_registration_id uuid)
returns uuid language sql stable security invoker set search_path = ''
as $$ select private.registration_edition_for_staff(p_registration_id) $$;

revoke all on function private.registration_edition_for_staff(uuid), public.registration_edition_for_staff(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.registration_edition_for_staff(uuid), public.registration_edition_for_staff(uuid) to authenticated;
