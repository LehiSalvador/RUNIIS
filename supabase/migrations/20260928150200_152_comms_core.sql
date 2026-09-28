-- Communications core helpers (definer, no API grant): recipients/contact points, consent derivation,
-- suppression, send-time revalidation (Master §135), subject rendering and idempotent message enqueue.

create function private.comms_format_date_es(p_date date, p_time time)
returns text
language sql
immutable
set search_path = ''
as $$
  -- UX copy rule 4: never invent a date or a start time.
  select case
    when p_date is null then 'Fecha por confirmar'
    else extract(day from p_date)::integer::text || ' de '
      || (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
                'noviembre', 'diciembre'])[extract(month from p_date)::integer]
      || ' de ' || extract(year from p_date)::integer::text
      || case when p_time is null then ' (hora por confirmar)' else ', ' || pg_catalog.to_char(p_time, 'HH24:MI') || ' h' end
  end
$$;

-- Display values of an Edition for templates. Paths are app-relative; the renderer prefixes APP_BASE_URL.
create function private.comms_edition_vars(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
      'edition_name', e.name,
      'edition_city', e.city,
      'event_path', '/eventos/' || e.slug,
      'passes_path', '/cuenta/pases',
      'events_path', '/eventos',
      'event_date_text', private.comms_format_date_es(r.local_date, r.local_start_time))
    || case when l.name is null then '{}'::jsonb
            else jsonb_build_object('venue_text', l.name || coalesce(', ' || l.address_line, '')) end
  from app.edition e
  left join lateral (
    select sr.local_date, sr.local_start_time
    from app.edition_schedule_revision sr
    where sr.edition_id = e.edition_id and sr.superseded_at is null
    order by sr.revision desc
    limit 1) r on true
  left join app.edition_location l on l.edition_id = e.edition_id and l.edition_location_id = e.primary_location_id
  where e.edition_id = p_edition_id
$$;

-- Keeps only the template's declared snapshot/campaign variables, so callers can pass a superset.
create function private.comms_pick_vars(p_template_key text, p_available jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(v.key, p_available -> v.key), '{}'::jsonb)
  from app.communication_template t
  join app.communication_template_version tv on tv.template_id = t.communication_template_id and tv.version = t.active_version
  cross join lateral jsonb_each(tv.variable_schema -> 'variables') v
  where t.template_key = p_template_key and coalesce(v.value ->> 'source', 'snapshot') <> 'system' and p_available ? v.key
$$;

-- Runner recipient + current auth email as contact point (VERIFIED when GoTrue confirmed it). An email
-- change retires the previous contact point instead of rewriting it (Master §126).
create function private.comms_ensure_runner_recipient(p_runner_profile_id uuid, out o_recipient_id uuid, out o_contact_point_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_verified boolean;
  v_cp app.communication_contact_point%rowtype;
begin
  insert into app.communication_recipient (recipient_type, runner_profile_id) values ('RUNNER', p_runner_profile_id)
  on conflict (runner_profile_id) do nothing;
  select r.communication_recipient_id into o_recipient_id
  from app.communication_recipient r where r.runner_profile_id = p_runner_profile_id
  for update;

  select private.normalize_email(u.email), u.email_confirmed_at is not null into v_email, v_verified
  from app.runner_profile rp join auth.users u on u.id = rp.auth_user_id
  where rp.runner_profile_id = p_runner_profile_id;
  if coalesce(v_email, '') = '' then
    return;
  end if;

  select * into v_cp from app.communication_contact_point cp
  where cp.communication_recipient_id = o_recipient_id and cp.channel = 'EMAIL' and cp.status = 'ACTIVE'
    and cp.value_normalized = v_email;
  if found then
    if v_verified and v_cp.verification_status = 'UNVERIFIED' then
      update app.communication_contact_point set verification_status = 'VERIFIED', verified_at = pg_catalog.now()
      where communication_contact_point_id = v_cp.communication_contact_point_id;
    end if;
    o_contact_point_id := v_cp.communication_contact_point_id;
    return;
  end if;

  update app.communication_contact_point set status = 'RETIRED', is_primary = false
  where communication_recipient_id = o_recipient_id and channel = 'EMAIL' and status = 'ACTIVE';
  insert into app.communication_contact_point (communication_recipient_id, channel, value_normalized,
    verification_status, verified_at, is_primary)
  values (o_recipient_id, 'EMAIL', v_email, case when v_verified then 'VERIFIED' else 'UNVERIFIED' end,
    case when v_verified then pg_catalog.now() end, true)
  returning communication_contact_point_id into o_contact_point_id;
end;
$$;

-- Current primary contact for any recipient; runner contacts are refreshed from the auth email.
create function private.comms_primary_contact(p_recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_contact_id uuid;
begin
  select r.runner_profile_id into v_profile_id from app.communication_recipient r where r.communication_recipient_id = p_recipient_id;
  if v_profile_id is not null then
    select o_contact_point_id into v_contact_id from private.comms_ensure_runner_recipient(v_profile_id);
    return v_contact_id;
  end if;
  select cp.communication_contact_point_id into v_contact_id from app.communication_contact_point cp
  where cp.communication_recipient_id = p_recipient_id and cp.channel = 'EMAIL' and cp.status = 'ACTIVE' and cp.is_primary;
  return v_contact_id;
end;
$$;

create function private.comms_is_suppressed(p_contact_point_id uuid, p_category text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.communication_suppression s
    where s.contact_point_id = p_contact_point_id and s.active
      and (s.scope = 'ALL_EMAIL'
           or (s.scope = 'OPTIONAL_ONLY' and p_category in ('REMINDER', 'MARKETING'))
           or (s.scope = 'MARKETING_ONLY' and p_category = 'MARKETING')))
$$;

-- Latest fact wins (Master §127). Facts are written with clock_timestamp() so order is total per recipient.
create function private.comms_consent_granted(p_recipient_id uuid, p_purpose text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.action = 'GRANTED' from app.communication_consent c
    where c.communication_recipient_id = p_recipient_id and c.purpose = p_purpose
    order by c.occurred_at desc
    limit 1), false)
$$;

-- Appends a consent fact only when it changes the derived state; returns whether a fact was written.
create function private.comms_record_consent(
  p_recipient_id uuid, p_purpose text, p_action text, p_source text, p_metadata jsonb default '{}')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_facts boolean;
  v_legal_version_id uuid;
begin
  perform 1 from app.communication_recipient r where r.communication_recipient_id = p_recipient_id for update;
  v_has_facts := exists (select 1 from app.communication_consent c
                         where c.communication_recipient_id = p_recipient_id and c.purpose = p_purpose);
  if private.comms_consent_granted(p_recipient_id, p_purpose) = (p_action = 'GRANTED')
     and (v_has_facts or p_action = 'WITHDRAWN') then
    return false;
  end if;

  select v.legal_document_version_id into v_legal_version_id
  from app.legal_document d join app.legal_document_version v on v.legal_document_id = d.legal_document_id
  where d.document_type = 'PRIVACY_NOTICE' and d.status = 'ACTIVE' and v.status = 'PUBLISHED'
  order by v.version desc limit 1;

  insert into app.communication_consent (communication_recipient_id, purpose, action, legal_document_version_id,
    source, occurred_at, metadata)
  values (p_recipient_id, p_purpose, p_action, v_legal_version_id, p_source, pg_catalog.clock_timestamp(),
    coalesce(p_metadata, '{}'));

  if p_purpose = 'GENERAL_MARKETING' then
    insert into app.communication_preference (communication_recipient_id, marketing_allowed)
    values (p_recipient_id, p_action = 'GRANTED')
    on conflict (communication_recipient_id) do update set marketing_allowed = excluded.marketing_allowed;
  end if;
  return true;
end;
$$;

create function private.comms_purpose_category(p_purpose text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_purpose when 'GENERAL_MARKETING' then 'MARKETING' else 'REMINDER' end
$$;

-- Recipient-level eligibility shared by campaign snapshots and send-time revalidation (Master §135):
-- contact active/verified, suppression, account policy, adults only for marketing (SEC-120), consent.
create function private.comms_recipient_block_reason(p_recipient_id uuid, p_contact_point_id uuid, p_category text,
  p_requires_verified boolean)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cp app.communication_contact_point%rowtype;
  v_recipient app.communication_recipient%rowtype;
  v_profile app.runner_profile%rowtype;
begin
  select * into v_cp from app.communication_contact_point cp where cp.communication_contact_point_id = p_contact_point_id;
  if not found or v_cp.communication_recipient_id <> p_recipient_id or v_cp.status <> 'ACTIVE' then
    return 'CONTACT_RETIRED';
  end if;
  if private.comms_is_suppressed(p_contact_point_id, p_category) then
    return 'SUPPRESSED';
  end if;
  if p_requires_verified and v_cp.verification_status <> 'VERIFIED' then
    return 'CONTACT_UNVERIFIED';
  end if;

  select * into v_recipient from app.communication_recipient r where r.communication_recipient_id = p_recipient_id;
  if v_recipient.runner_profile_id is not null then
    select * into v_profile from app.runner_profile rp where rp.runner_profile_id = v_recipient.runner_profile_id;
  end if;

  if p_category = 'MARKETING' then
    if v_recipient.recipient_type <> 'RUNNER' or v_profile.account_state <> 'ACTIVE' or v_profile.profile_readiness <> 'READY' then
      return 'ACCOUNT_POLICY';
    end if;
    if v_profile.date_of_birth is null
       or v_profile.date_of_birth > ((pg_catalog.now() at time zone 'America/Monterrey')::date - interval '18 years')::date then
      return 'MINOR_EXCLUDED';
    end if;
    if not private.comms_consent_granted(p_recipient_id, 'GENERAL_MARKETING') then
      return 'CONSENT_WITHDRAWN';
    end if;
  elsif p_category = 'REMINDER' and v_profile.account_state in ('BANNED', 'DEACTIVATED') then
    return 'ACCOUNT_POLICY';
  end if;
  return null;
end;
$$;

-- Send-time revalidation of a queued message. NULL = may be sent now; otherwise the cancel reason.
create function private.comms_send_block_reason(p_message_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_msg app.communication_message%rowtype;
  v_reason text;
  v_status text;
  v_is_confirmation boolean;
begin
  select * into v_msg from app.communication_message m where m.communication_message_id = p_message_id;
  v_is_confirmation := v_msg.template_key = 'ANONYMOUS_REMINDER_CONFIRMATION';

  v_reason := private.comms_recipient_block_reason(v_msg.recipient_id, v_msg.contact_point_id, v_msg.category,
    v_msg.category in ('REMINDER', 'MARKETING') and not v_is_confirmation);
  if v_reason is not null then
    return v_reason;
  end if;

  if v_msg.campaign_id is not null
     and not exists (select 1 from app.communication_campaign c
                     where c.communication_campaign_id = v_msg.campaign_id and c.status = 'SENDING') then
    return 'CAMPAIGN_NOT_SENDING';
  end if;

  if v_msg.category = 'REMINDER' then
    if v_msg.source_type = 'EVENT_REMINDER_SUBSCRIPTION' then
      select s.status into v_status from app.event_reminder_subscription s
      where s.event_reminder_subscription_id = v_msg.source_id;
      if v_is_confirmation and v_status is distinct from 'PENDING_CONFIRMATION' then
        return 'SUBSCRIPTION_INACTIVE';
      elsif not v_is_confirmation and v_status not in ('ACTIVE', 'COMPLETED') then
        return 'SUBSCRIPTION_INACTIVE';
      end if;
    end if;
    if not v_is_confirmation and not private.comms_consent_granted(v_msg.recipient_id, 'EVENT_REMINDER') then
      return 'CONSENT_WITHDRAWN';
    end if;
  end if;

  if v_msg.registration_id is not null
     and not exists (select 1 from app.registration r where r.registration_id = v_msg.registration_id and r.status = 'CONFIRMED') then
    return 'REGISTRATION_CANCELED';
  end if;

  if v_msg.template_key in ('T_MINUS_7', 'T_MINUS_24')
     and not exists (select 1 from app.edition_schedule_revision sr join app.edition e on e.edition_id = sr.edition_id
                     where sr.edition_schedule_revision_id = v_msg.source_id and sr.superseded_at is null
                       and sr.schedule_state <> 'POSTPONED_NO_NEW_DATE' and e.execution_state = 'SCHEDULED') then
    return 'SCHEDULE_CHANGED';
  end if;

  if v_msg.edition_id is not null and v_msg.template_key not in ('CANCELED', 'POSTPONED', 'RESCHEDULED')
     and v_msg.category in ('REMINDER', 'MARKETING', 'OPERATIONAL')
     and exists (select 1 from app.edition e where e.edition_id = v_msg.edition_id and e.execution_state = 'CANCELED') then
    return 'EDITION_CANCELED';
  end if;
  return null;
end;
$$;

-- Subjects are rendered once at enqueue as evidence (Master §136): single pass, so values containing
-- "{{...}}" are never re-expanded; control characters (CR/LF header injection) collapse to spaces (SEC-081).
create function private.comms_render_subject(p_template text, p_vars jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := '';
  v_rest text := p_template;
  v_match text[];
  v_pos integer;
  v_value text;
begin
  loop
    v_match := pg_catalog.regexp_match(v_rest, '\{\{([a-z_]+)\}\}');
    exit when v_match is null;
    v_pos := pg_catalog.strpos(v_rest, '{{' || v_match[1] || '}}');
    if jsonb_typeof(p_vars -> v_match[1]) is distinct from 'string' then
      raise exception using errcode = 'invalid_parameter_value', message = 'subject variable missing';
    end if;
    v_value := pg_catalog.regexp_replace(p_vars ->> v_match[1], '[[:cntrl:]]+', ' ', 'g');
    v_out := v_out || pg_catalog.left(v_rest, v_pos - 1) || v_value;
    v_rest := pg_catalog.substr(v_rest, v_pos + pg_catalog.length(v_match[1]) + 4);
  end loop;
  return pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(v_out || v_rest, '\s+', ' ', 'g')), 200);
end;
$$;

-- Idempotent on dedupe_key. Returns the new message id, or NULL when the rule is inactive, there is no
-- contact point, or the message already exists. The variables must match the template's schema
-- exactly (required present, nothing undeclared): a mismatch is a programming error.
create function private.comms_enqueue_message(
  p_rule_key text, p_recipient_id uuid, p_contact_point_id uuid, p_dedupe_key text, p_source_type text,
  p_source_id uuid, p_vars jsonb, p_edition_id uuid default null, p_registration_id uuid default null,
  p_participant_pass_id uuid default null, p_campaign_id uuid default null,
  p_scheduled_for timestamptz default pg_catalog.now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule app.communication_automation_rule%rowtype;
  v_version app.communication_template_version%rowtype;
  v_template app.communication_template%rowtype;
  v_declared text[];
  v_id uuid;
begin
  if p_contact_point_id is null then
    return null;
  end if;
  select * into v_rule from app.communication_automation_rule r where r.rule_key = p_rule_key;
  if not found or coalesce(pg_catalog.length(p_dedupe_key), 0) not between 3 and 200 or p_source_type !~ '^[A-Z][A-Z_]{2,63}$'
     or jsonb_typeof(p_vars) is distinct from 'object' then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid message arguments';
  end if;
  if not v_rule.active then
    return null;
  end if;

  select * into v_template from app.communication_template t where t.template_key = v_rule.template_key;
  select * into v_version from app.communication_template_version tv
  where tv.template_id = v_template.communication_template_id and tv.version = v_template.active_version;

  select array_agg(v.key) into v_declared
  from jsonb_each(v_version.variable_schema -> 'variables') v
  where coalesce(v.value ->> 'source', 'snapshot') <> 'system';
  if exists (select 1 from jsonb_object_keys(p_vars) k where k <> all (coalesce(v_declared, '{}')))
     or exists (select 1 from jsonb_each(v_version.variable_schema -> 'variables') v
                where coalesce(v.value ->> 'source', 'snapshot') <> 'system'
                  and not coalesce((v.value ->> 'optional')::boolean, false) and not p_vars ? v.key) then
    raise exception using errcode = 'invalid_parameter_value', message = 'render context does not match the template schema';
  end if;

  insert into app.communication_message (dedupe_key, recipient_id, contact_point_id, template_key, template_version,
    category, priority, purpose, source_type, source_id, edition_id, registration_id, participant_pass_id, campaign_id,
    render_context_snapshot, rendered_subject_snapshot, scheduled_for, automation_rule_key)
  values (p_dedupe_key, p_recipient_id, p_contact_point_id, v_template.template_key, v_version.version,
    v_rule.category, v_rule.priority, v_rule.consent_policy, p_source_type, p_source_id, p_edition_id, p_registration_id,
    p_participant_pass_id, p_campaign_id, p_vars, private.comms_render_subject(v_version.subject_template, p_vars),
    coalesce(p_scheduled_for, pg_catalog.now()), v_rule.rule_key)
  on conflict (dedupe_key) do nothing
  returning communication_message_id into v_id;
  return v_id;
end;
$$;

-- Task Center projection (Master §142-143). Recurrence reopens a RESOLVED task; WAIVED stays waived.
create function private.comms_open_admin_task(
  p_task_key text, p_scope_type text, p_scope_id uuid, p_edition_id uuid, p_entity_type text, p_entity_id uuid,
  p_title text, p_description text, p_blocking_level text, p_metadata jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.admin_task (task_key, category, scope_type, scope_id, edition_id, related_entity_type,
    related_entity_id, title, description, priority, blocking_level, assigned_role, source_rule, metadata)
  values (p_task_key, 'COMMUNICATIONS', p_scope_type, p_scope_id, p_edition_id, p_entity_type, p_entity_id, p_title,
    p_description, 'HIGH', p_blocking_level, 'ADMIN', pg_catalog.split_part(p_task_key, ':', 1), coalesce(p_metadata, '{}'))
  on conflict (task_key) do update
    set status = 'OPEN', resolved_at = null, resolution_type = null, resolution_reason = null,
        detected_at = pg_catalog.now(), metadata = excluded.metadata
    where app.admin_task.status = 'RESOLVED';
end;
$$;

-- P0/P1 failures become 'communication-critical-failure:{message}' tasks (Master §143, §197).
create function private.comms_escalate_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg app.communication_message%rowtype;
begin
  select * into v_msg from app.communication_message m where m.communication_message_id = p_message_id;
  if v_msg.priority > 1 or v_msg.escalated_at is not null then
    return;
  end if;
  update app.communication_message set escalated_at = pg_catalog.now() where communication_message_id = p_message_id;
  perform private.comms_open_admin_task('communication-critical-failure:' || p_message_id, 'COMMUNICATION_MESSAGE',
    p_message_id, v_msg.edition_id, 'communication_message', p_message_id, 'Falla crítica de comunicación',
    pg_catalog.format('El mensaje %s (P%s) quedó en %s (%s). Revisa el contacto y reintenta o avisa por otro medio.',
      v_msg.template_key, v_msg.priority, v_msg.status, coalesce(v_msg.last_error, 'sin detalle')),
    case when v_msg.priority = 0 then 'EVENT_DAY_BLOCKER' else 'ACTION_REQUIRED' end,
    jsonb_build_object('template_key', v_msg.template_key, 'priority', v_msg.priority, 'status', v_msg.status));
end;
$$;

create function private.comms_mask_email(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.left(pg_catalog.split_part(p_value, '@', 1), 1) || '***@' || pg_catalog.split_part(p_value, '@', 2)
$$;

create function private.comms_max_attempts(p_priority integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_priority when 0 then 10 when 1 then 8 when 2 then 6 else 4 end
$$;

create function private.comms_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- Provider truth only moves forward: an older event never degrades a newer state (Master §138).
  select case p_status when 'SENT' then 1 when 'DELIVERED' then 2 when 'BOUNCED' then 3 when 'FAILED' then 3
                       when 'COMPLAINED' then 4 else 0 end
$$;
