-- Master §133 catalogue as data (Master §132: no executable code in the DB). Templates use a
-- logic-less syntax rendered by lib/server/domain/communications/render.ts: {{var}} (always escaped),
-- {{#var}}...{{/var}} (flag / non-empty text / list items), {{^var}}...{{/var}} (inverted).
-- variable_schema.variables.<name> = {type: text|multiline|path|url|flag|list, max?, optional?,
-- source: snapshot|campaign|system, fields? (list)}. `path` values are app-relative and become
-- APP_BASE_URL links; `url` values are system-built APP_BASE_URL links (SEC-081). Copy is provisional
-- Spanish (MX) and never promises refunds (UX copy rule 6).

create temp table comms_catalogue (
  template_key text primary key,
  category text not null,
  priority integer not null,
  trigger_event text not null,
  recipient_policy text not null,
  consent_policy text not null,
  scheduling_policy jsonb not null,
  dedupe_policy jsonb not null,
  active boolean not null,
  subject_template text not null,
  html_template text not null,
  text_template text not null,
  variable_schema jsonb not null
) on commit drop;

insert into comms_catalogue values
('AUTH_OTP', 'SECURITY', 0, 'SupabaseAuthOtpRequested', 'AUTH_EMAIL', 'NONE_REQUIRED',
 '{"delivery": "SUPABASE_AUTH_SMTP", "counted_in_quota": true}', '{"owner": "supabase_auth"}', false,
 'Tu código de acceso a RUNIIS',
 '<p>Supabase Auth envía este correo con su propia plantilla. RUNIIS solo lo contabiliza en la cuota diaria.</p>',
 'Supabase Auth envía este correo con su propia plantilla. RUNIIS solo lo contabiliza en la cuota diaria.',
 '{"variables": {}}'),

('ANONYMOUS_REMINDER_CONFIRMATION', 'REMINDER', 2, 'AnonymousReminderRequested', 'ANONYMOUS_SUBSCRIBER', 'EMAIL_VERIFICATION',
 '{"send": "immediate", "token_ttl_hours": 24}', '{"key": "ANONYMOUS_REMINDER_CONFIRMATION:{subscription}:{hour}"}', true,
 'Confirma tu recordatorio para {{edition_name}}',
 $h$<p>Hola:</p>
<p>Recibimos una solicitud para avisarte cuando abran las inscripciones de <strong>{{edition_name}}</strong> ({{event_date_text}}).</p>
<p>Para activar el recordatorio, abre este enlace y pulsa «Confirmar»:</p>
<p><a href="{{confirm_url}}">Confirmar mi recordatorio</a></p>
<p>El enlace vence en 24 horas. Si no lo solicitaste, ignora este correo: no te enviaremos nada más.</p>$h$,
 $t$Hola:

Recibimos una solicitud para avisarte cuando abran las inscripciones de {{edition_name}} ({{event_date_text}}).

Para activar el recordatorio, abre este enlace y pulsa «Confirmar»:
{{confirm_url}}

El enlace vence en 24 horas. Si no lo solicitaste, ignora este correo: no te enviaremos nada más.$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "confirm_url": {"type": "url", "source": "system"}}}'),

('NEW_EDITION', 'MARKETING', 3, 'CampaignSend', 'CAMPAIGN_AUDIENCE', 'GENERAL_MARKETING',
 '{"campaign_type": "MARKETING", "automatic_on_publish": false}', '{"key": "CAMPAIGN:{campaign}:{recipient}"}', true,
 'Nueva edición: {{edition_name}}',
 $h$<p>Hola:</p>
<p>Ya publicamos <strong>{{edition_name}}</strong> en {{edition_city}}. Fecha: {{event_date_text}}.</p>
{{#staff_note}}<p>{{staff_note}}</p>{{/staff_note}}
<p><a href="{{event_path}}">Ver el evento</a></p>$h$,
 $t$Hola:

Ya publicamos {{edition_name}} en {{edition_city}}. Fecha: {{event_date_text}}.
{{#staff_note}}
{{staff_note}}
{{/staff_note}}
Ver el evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "edition_city": {"type": "text", "max": 120, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}, "staff_note": {"type": "multiline", "max": 1000, "source": "campaign", "optional": true}, "unsubscribe_url": {"type": "url", "source": "system"}}}'),

('REGISTRATION_OPENED', 'REMINDER', 2, 'EditionRegistrationOpened', 'REMINDER_SUBSCRIBERS', 'EVENT_REMINDER',
 '{"send": "immediate", "cancel_on": ["EditionCanceled", "EditionPostponed"]}', '{"key": "REGISTRATION_OPENED:{subscription}"}', true,
 'Ya puedes inscribirte a {{edition_name}}',
 $h$<p>Hola:</p>
<p>Abrieron las inscripciones de <strong>{{edition_name}}</strong> ({{event_date_text}}). Te avisamos porque activaste un recordatorio para este evento.</p>
<p><a href="{{event_path}}">Ver el evento e inscribirme</a></p>$h$,
 $t$Hola:

Abrieron las inscripciones de {{edition_name}} ({{event_date_text}}). Te avisamos porque activaste un recordatorio para este evento.

Ver el evento e inscribirme: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}, "unsubscribe_url": {"type": "url", "source": "system"}}}'),

('REGISTRATION_CONFIRMED', 'TRANSACTIONAL', 1, 'RegistrationConfirmed', 'PARTICIPANT_OR_GUEST_BUYER', 'NONE_REQUIRED',
 '{"send": "immediate", "attach_pass_qr": true}', '{"key": "REGISTRATION_CONFIRMED:{registration}"}', true,
 'Inscripción confirmada: {{edition_name}}',
 $h${{^is_guest_pass}}<p>Hola, {{participant_name}}:</p>
<p>Tu inscripción a <strong>{{edition_name}}</strong> está confirmada.</p>{{/is_guest_pass}}
{{#is_guest_pass}}<p>Hola:</p>
<p>La inscripción de tu invitado <strong>{{participant_name}}</strong> a <strong>{{edition_name}}</strong> está confirmada. Este pase es de {{participant_name}}: compártelo solo con esa persona.</p>{{/is_guest_pass}}
<ul>
<li>Fecha: {{event_date_text}}</li>
<li>Modalidad: {{modality_name}}</li>
<li>Número de inscripción: {{registration_number}}</li>
{{#pass_public_code}}<li>Código del pase: {{pass_public_code}}</li>{{/pass_public_code}}
</ul>
{{#has_pass_qr}}<p>El código QR del pase va adjunto a este correo. Muéstralo el día del evento.</p>{{/has_pass_qr}}
<p>Puedes volver a ver el pase cuando quieras en <a href="{{passes_path}}">Mis pases</a>.</p>
<p><a href="{{event_path}}">Detalles del evento</a></p>$h$,
 $t${{^is_guest_pass}}Hola, {{participant_name}}:

Tu inscripción a {{edition_name}} está confirmada.{{/is_guest_pass}}{{#is_guest_pass}}Hola:

La inscripción de tu invitado {{participant_name}} a {{edition_name}} está confirmada. Este pase es de {{participant_name}}: compártelo solo con esa persona.{{/is_guest_pass}}

- Fecha: {{event_date_text}}
- Modalidad: {{modality_name}}
- Número de inscripción: {{registration_number}}
{{#pass_public_code}}- Código del pase: {{pass_public_code}}
{{/pass_public_code}}
{{#has_pass_qr}}El código QR del pase va adjunto a este correo. Muéstralo el día del evento.
{{/has_pass_qr}}
Puedes volver a ver el pase cuando quieras en Mis pases: {{passes_path}}
Detalles del evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}, "passes_path": {"type": "path", "source": "snapshot"}, "participant_name": {"type": "text", "max": 160, "source": "snapshot"}, "modality_name": {"type": "text", "max": 120, "source": "snapshot"}, "registration_number": {"type": "text", "max": 40, "source": "snapshot"}, "pass_public_code": {"type": "text", "max": 40, "source": "snapshot", "optional": true}, "is_guest_pass": {"type": "flag", "source": "snapshot"}, "has_pass_qr": {"type": "flag", "source": "system"}}}'),

('MULTI_REGISTRATION_BUYER_SUMMARY', 'TRANSACTIONAL', 1, 'RegistrationConfirmed', 'REQUEST_BUYER', 'NONE_REQUIRED',
 '{"send": "immediate", "attach_pass_qr": false, "min_registrations": 2}', '{"key": "MULTI_REGISTRATION_BUYER_SUMMARY:{registration_request}"}', true,
 'Resumen de tu solicitud para {{edition_name}}',
 $h$<p>Hola:</p>
<p>Se confirmaron estas inscripciones a <strong>{{edition_name}}</strong> ({{event_date_text}}) de tu solicitud {{request_reference}}:</p>
<ul>{{#participants}}<li>{{name}}: {{modality_name}}</li>{{/participants}}</ul>
<p>Cada participante con cuenta recibe su propio pase en su correo. Los pases de tus invitados te llegan en correos separados.</p>
<p><a href="{{passes_path}}">Ver mis pases</a></p>$h$,
 $t$Hola:

Se confirmaron estas inscripciones a {{edition_name}} ({{event_date_text}}) de tu solicitud {{request_reference}}:
{{#participants}}- {{name}}: {{modality_name}}
{{/participants}}
Cada participante con cuenta recibe su propio pase en su correo. Los pases de tus invitados te llegan en correos separados.

Ver mis pases: {{passes_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "request_reference": {"type": "text", "max": 40, "source": "snapshot"}, "passes_path": {"type": "path", "source": "snapshot"}, "participants": {"type": "list", "max": 20, "source": "snapshot", "fields": {"name": {"type": "text", "max": 160}, "modality_name": {"type": "text", "max": 120}}}}}'),

('GUARDIAN_REQUIRED', 'OPERATIONAL', 1, 'GuardianActionRequired', 'GUARDIAN', 'NONE_REQUIRED',
 '{"send": "immediate"}', '{"key": "GUARDIAN_REQUIRED:{guardian_assignment}:{edition}"}', true,
 'Acción requerida: tutoría de {{participant_name}}',
 $h$<p>Hola:</p>
<p>Para que <strong>{{participant_name}}</strong> pueda participar en <strong>{{edition_name}}</strong> necesitamos que confirmes la tutoría en tu cuenta.</p>
<p><a href="{{account_path}}">Revisar tutoría</a></p>$h$,
 $t$Hola:

Para que {{participant_name}} pueda participar en {{edition_name}} necesitamos que confirmes la tutoría en tu cuenta.

Revisar tutoría: {{account_path}}$t$,
 '{"variables": {"participant_name": {"type": "text", "max": 160, "source": "snapshot"}, "edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "account_path": {"type": "path", "source": "snapshot"}}}'),

('T_MINUS_7', 'OPERATIONAL', 2, 'Schedule:T-7d', 'CONFIRMED_PARTICIPANTS', 'NONE_REQUIRED',
 '{"offset": "-P7D", "reschedule_on": ["EditionRescheduled"], "cancel_on": ["EditionPostponed", "EditionCanceled"]}',
 '{"key": "T_MINUS_7:{edition}:{schedule_revision}:{recipient}"}', true,
 'Falta una semana para {{edition_name}}',
 $h$<p>Hola:</p>
<p>Falta una semana para <strong>{{edition_name}}</strong>.</p>
<ul><li>Fecha: {{event_date_text}}</li>{{#venue_text}}<li>Lugar: {{venue_text}}</li>{{/venue_text}}</ul>
<p>Tus pases están en <a href="{{passes_path}}">Mis pases</a>.</p>
<p><a href="{{event_path}}">Detalles del evento</a></p>$h$,
 $t$Hola:

Falta una semana para {{edition_name}}.
- Fecha: {{event_date_text}}
{{#venue_text}}- Lugar: {{venue_text}}
{{/venue_text}}
Tus pases están en Mis pases: {{passes_path}}
Detalles del evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "venue_text": {"type": "text", "max": 200, "source": "snapshot", "optional": true}, "event_path": {"type": "path", "source": "snapshot"}, "passes_path": {"type": "path", "source": "snapshot"}}}'),

('T_MINUS_24', 'OPERATIONAL', 2, 'Schedule:T-24h', 'CONFIRMED_PARTICIPANTS', 'NONE_REQUIRED',
 '{"offset": "-PT24H", "reschedule_on": ["EditionRescheduled"], "cancel_on": ["EditionPostponed", "EditionCanceled"]}',
 '{"key": "T_MINUS_24:{edition}:{schedule_revision}:{recipient}"}', true,
 'Mañana es {{edition_name}}',
 $h$<p>Hola:</p>
<p>¡Mañana es <strong>{{edition_name}}</strong>!</p>
<ul><li>Fecha: {{event_date_text}}</li>{{#venue_text}}<li>Lugar: {{venue_text}}</li>{{/venue_text}}</ul>
<p>Ten a la mano tu pase en <a href="{{passes_path}}">Mis pases</a>.</p>
<p><a href="{{event_path}}">Detalles del evento</a></p>$h$,
 $t$Hola:

¡Mañana es {{edition_name}}!
- Fecha: {{event_date_text}}
{{#venue_text}}- Lugar: {{venue_text}}
{{/venue_text}}
Ten a la mano tu pase en Mis pases: {{passes_path}}
Detalles del evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "venue_text": {"type": "text", "max": 200, "source": "snapshot", "optional": true}, "event_path": {"type": "path", "source": "snapshot"}, "passes_path": {"type": "path", "source": "snapshot"}}}'),

('KIT_INFORMATION', 'OPERATIONAL', 2, 'CampaignSend', 'CAMPAIGN_AUDIENCE', 'NONE_REQUIRED',
 '{"campaign_type": "OPERATIONAL"}', '{"key": "CAMPAIGN:{campaign}:{recipient}"}', true,
 'Entrega de kit: {{edition_name}}',
 $h$<p>Hola:</p>
<p>Información sobre la entrega de kit de <strong>{{edition_name}}</strong>:</p>
<p>{{staff_note}}</p>
<p><a href="{{event_path}}">Detalles del evento</a></p>$h$,
 $t$Hola:

Información sobre la entrega de kit de {{edition_name}}:

{{staff_note}}

Detalles del evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}, "staff_note": {"type": "multiline", "max": 1000, "source": "campaign"}}}'),

('MATERIAL_EVENT_CHANGE', 'OPERATIONAL', 1, 'CampaignSend', 'CAMPAIGN_AUDIENCE', 'NONE_REQUIRED',
 '{"campaign_type": "OPERATIONAL"}', '{"key": "CAMPAIGN:{campaign}:{recipient}"}', true,
 'Cambio importante en {{edition_name}}',
 $h$<p>Hola:</p>
<p>Hay un cambio importante en <strong>{{edition_name}}</strong>:</p>
<p>{{staff_note}}</p>
<p><a href="{{event_path}}">Detalles del evento</a></p>$h$,
 $t$Hola:

Hay un cambio importante en {{edition_name}}:

{{staff_note}}

Detalles del evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}, "staff_note": {"type": "multiline", "max": 1000, "source": "campaign"}}}'),

('POSTPONED', 'OPERATIONAL', 1, 'EditionPostponed', 'CONFIRMED_AND_REMINDER_SUBSCRIBERS', 'NONE_REQUIRED',
 '{"send": "immediate"}', '{"key": "POSTPONED:{outbox_event}:{recipient}"}', true,
 '{{edition_name}} se pospone',
 $h$<p>Hola:</p>
<p><strong>{{edition_name}}</strong> se pospone. La nueva fecha aún no está confirmada; te avisaremos en cuanto la tengamos.</p>
{{#is_participant}}<p>Tu inscripción se conserva.</p>{{/is_participant}}
<p><a href="{{event_path}}">Ver el evento</a></p>$h$,
 $t$Hola:

{{edition_name}} se pospone. La nueva fecha aún no está confirmada; te avisaremos en cuanto la tengamos.
{{#is_participant}}Tu inscripción se conserva.
{{/is_participant}}
Ver el evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}, "is_participant": {"type": "flag", "source": "snapshot"}}}'),

('RESCHEDULED', 'OPERATIONAL', 1, 'EditionRescheduled', 'CONFIRMED_PARTICIPANTS', 'NONE_REQUIRED',
 '{"send": "immediate"}', '{"key": "RESCHEDULED:{outbox_event}:{recipient}"}', true,
 'Nueva fecha para {{edition_name}}',
 $h$<p>Hola:</p>
<p><strong>{{edition_name}}</strong> tiene nueva fecha: {{event_date_text}}.</p>
<p>Tu inscripción se conserva.</p>
<p><a href="{{event_path}}">Detalles del evento</a></p>$h$,
 $t$Hola:

{{edition_name}} tiene nueva fecha: {{event_date_text}}.
Tu inscripción se conserva.

Detalles del evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_date_text": {"type": "text", "max": 80, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}}}'),

('CANCELED', 'OPERATIONAL', 0, 'EditionCanceled', 'CONFIRMED_PARTICIPANTS', 'NONE_REQUIRED',
 '{"send": "immediate"}', '{"key": "CANCELED:{edition}:{recipient}"}', true,
 '{{edition_name}} fue cancelado',
 $h$<p>Hola:</p>
<p>Lamentamos informarte que <strong>{{edition_name}}</strong> fue cancelado.</p>
<p>Si tienes dudas sobre tu inscripción, contacta al organizador.</p>
<p><a href="{{event_path}}">Ver el evento</a></p>$h$,
 $t$Hola:

Lamentamos informarte que {{edition_name}} fue cancelado.
Si tienes dudas sobre tu inscripción, contacta al organizador.

Ver el evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}}}'),

-- Automatic marketing stays off until the owner enables it (copy and consent evidence are provisional).
('BIRTHDAY', 'MARKETING', 3, 'Schedule:Birthday', 'ADULT_MARKETING_OPT_IN', 'GENERAL_MARKETING',
 '{"local_time_zone": "America/Monterrey", "adults_only": true}', '{"key": "BIRTHDAY:{recipient}:{year}"}', false,
 '¡Feliz cumpleaños, {{first_name}}!',
 $h$<p>¡Feliz cumpleaños, {{first_name}}!</p>
<p>Todo el equipo de RUNIIS te desea un gran año de kilómetros.</p>
<p><a href="{{events_path}}">Ver próximos eventos</a></p>$h$,
 $t$¡Feliz cumpleaños, {{first_name}}!

Todo el equipo de RUNIIS te desea un gran año de kilómetros.
Ver próximos eventos: {{events_path}}$t$,
 '{"variables": {"first_name": {"type": "text", "max": 80, "source": "snapshot"}, "events_path": {"type": "path", "source": "snapshot"}, "unsubscribe_url": {"type": "url", "source": "system"}}}'),

('POST_EVENT', 'MARKETING', 3, 'CampaignSend', 'CAMPAIGN_AUDIENCE', 'GENERAL_MARKETING',
 '{"campaign_type": "MARKETING"}', '{"key": "CAMPAIGN:{campaign}:{recipient}"}', true,
 'Gracias por participar en {{edition_name}}',
 $h$<p>Hola:</p>
<p>Gracias por ser parte de <strong>{{edition_name}}</strong>.</p>
{{#staff_note}}<p>{{staff_note}}</p>{{/staff_note}}
<p><a href="{{event_path}}">Ver el evento</a></p>$h$,
 $t$Hola:

Gracias por ser parte de {{edition_name}}.
{{#staff_note}}
{{staff_note}}
{{/staff_note}}
Ver el evento: {{event_path}}$t$,
 '{"variables": {"edition_name": {"type": "text", "max": 160, "source": "snapshot"}, "event_path": {"type": "path", "source": "snapshot"}, "staff_note": {"type": "multiline", "max": 1000, "source": "campaign", "optional": true}, "unsubscribe_url": {"type": "url", "source": "system"}}}');

insert into app.communication_template (template_key, category, active_version)
select c.template_key, c.category, 1 from comms_catalogue c
on conflict (template_key) do nothing;

insert into app.communication_template_version (template_id, version, subject_template, html_template, text_template, variable_schema)
select t.communication_template_id, 1, c.subject_template, c.html_template, c.text_template, c.variable_schema
from comms_catalogue c join app.communication_template t on t.template_key = c.template_key
on conflict (template_id, version) do nothing;

insert into app.communication_automation_rule (rule_key, trigger_event, template_key, category, priority,
  recipient_policy, consent_policy, scheduling_policy, dedupe_policy, active)
select c.template_key, c.trigger_event, c.template_key, c.category, c.priority, c.recipient_policy, c.consent_policy,
  c.scheduling_policy, c.dedupe_policy, c.active
from comms_catalogue c
on conflict (rule_key) do nothing;
