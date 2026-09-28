-- Campaign lifecycle (Master §134-135, §176), admin reads, metrics (§197) and reconcile workers (§152).
-- Campaign snapshots record candidates; every message is revalidated again at claim time, so consent
-- withdrawn after the snapshot is never sent (COMM-001, §206).

create function private.comms_require_campaign_permission(p_campaign_type text, p_edition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.require_permission(
    case p_campaign_type when 'MARKETING' then 'CAMPAIGN_MANAGE' else 'COMMUNICATION_OPERATIONAL_SEND' end, p_edition_id);
end;
$$;

-- Read access to the communications console: either comms permission for the Edition (NULL = global).
create function private.comms_require_console(p_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  if not (private.has_permission('COMMUNICATION_OPERATIONAL_SEND', p_edition_id)
          or private.has_permission('CAMPAIGN_MANAGE', p_edition_id)) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;
end;
$$;

create function private.comms_campaign_projection(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'campaign_id', c.communication_campaign_id, 'campaign_type', c.campaign_type, 'edition_id', c.edition_id,
    'template_key', c.template_key, 'status', c.status, 'purpose', c.purpose,
    'audience_definition', c.audience_definition, 'template_variables', c.template_variables,
    'estimated_recipient_count', c.estimated_recipient_count, 'scheduled_for', c.scheduled_for,
    'created_at', c.created_at, 'started_at', c.started_at, 'completed_at', c.completed_at, 'canceled_at', c.canceled_at,
    'message_counts', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                       from (select m.status, count(*) as n from app.communication_message m
                             where m.campaign_id = c.communication_campaign_id group by m.status) s))
  from app.communication_campaign c
  where c.communication_campaign_id = p_campaign_id
$$;

-- Candidate set with exclusion reasons (the same recipient-level rules as send-time revalidation).
create function private.comms_campaign_candidates(p_campaign_id uuid)
returns table (recipient_id uuid, contact_point_id uuid, exclusion_reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign app.communication_campaign%rowtype;
  v_category text;
  v_row record;
begin
  select * into v_campaign from app.communication_campaign c where c.communication_campaign_id = p_campaign_id;
  select r.category into v_category from app.communication_automation_rule r where r.rule_key = v_campaign.template_key;

  if v_campaign.audience_definition ->> 'segment' = 'MARKETING_OPT_IN' then
    for v_row in
      select distinct r.communication_recipient_id as rid
      from app.communication_recipient r
      join app.communication_consent c on c.communication_recipient_id = r.communication_recipient_id
      where r.recipient_type = 'RUNNER' and c.purpose = 'GENERAL_MARKETING'
    loop
      recipient_id := v_row.rid;
      contact_point_id := private.comms_primary_contact(v_row.rid);
      exclusion_reason := case when contact_point_id is null then 'NO_CONTACT'
        else private.comms_recipient_block_reason(v_row.rid, contact_point_id, v_category, true) end;
      return next;
    end loop;
  else
    for v_row in
      select * from private.comms_edition_participant_recipients(v_campaign.edition_id,
        case when v_campaign.audience_definition ? 'modality_ids'
             then array(select jsonb_array_elements_text(v_campaign.audience_definition -> 'modality_ids')::uuid) end)
    loop
      recipient_id := v_row.recipient_id;
      contact_point_id := v_row.contact_point_id;
      exclusion_reason := case when contact_point_id is null then 'NO_CONTACT'
        else private.comms_recipient_block_reason(v_row.recipient_id, contact_point_id, v_category, v_category = 'MARKETING') end;
      return next;
    end loop;
  end if;
end;
$$;

create function private.create_communication_campaign(
  p_campaign_type text, p_template_key text, p_edition_id uuid, p_audience jsonb, p_template_variables jsonb,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idem jsonb;
  v_rule app.communication_automation_rule%rowtype;
  v_schema jsonb;
  v_segment text;
  v_id uuid;
  v_result jsonb;
  v_vars jsonb := coalesce(p_template_variables, '{}'::jsonb);
begin
  if p_campaign_type not in ('MARKETING', 'OPERATIONAL') then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "campaign_type"}');
  end if;
  if p_edition_id is null or not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.comms_require_campaign_permission(p_campaign_type, p_edition_id);
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('communication_campaign.create', p_edition_id::text, p_idempotency_key,
      jsonb_build_object('campaign_type', p_campaign_type, 'template_key', p_template_key, 'edition_id', p_edition_id,
        'audience', p_audience, 'template_variables', v_vars));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  select * into v_rule from app.communication_automation_rule r
  where r.rule_key = p_template_key and r.trigger_event = 'CampaignSend' and r.active
    and r.scheduling_policy ->> 'campaign_type' = p_campaign_type;
  if not found then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "template_key"}');
  end if;

  v_segment := p_audience ->> 'segment';
  if jsonb_typeof(p_audience) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_audience) k where k not in ('segment', 'modality_ids'))
     or v_segment is null
     or v_segment not in (case p_campaign_type when 'MARKETING' then 'MARKETING_OPT_IN' else 'EDITION_PARTICIPANTS' end,
                          'EDITION_PARTICIPANTS')
     or (p_audience ? 'modality_ids' and (
           v_segment <> 'EDITION_PARTICIPANTS' or jsonb_typeof(p_audience -> 'modality_ids') <> 'array'
           or jsonb_array_length(p_audience -> 'modality_ids') not between 1 and 50
           or exists (select 1 from jsonb_array_elements(p_audience -> 'modality_ids') x
                      where jsonb_typeof(x) <> 'string'
                         or (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         or not exists (select 1 from app.modality m
                                        where m.modality_id = (x #>> '{}')::uuid and m.edition_id = p_edition_id)))) then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "audience_definition"}');
  end if;

  select tv.variable_schema -> 'variables' into v_schema
  from app.communication_template t
  join app.communication_template_version tv on tv.template_id = t.communication_template_id and tv.version = t.active_version
  where t.template_key = p_template_key;
  if jsonb_typeof(v_vars) <> 'object'
     or exists (select 1 from jsonb_each(v_vars) v
                where coalesce(v_schema -> v.key ->> 'source', '') <> 'campaign' or jsonb_typeof(v.value) <> 'string'
                   or pg_catalog.btrim(v.value #>> '{}') = ''
                   or pg_catalog.length(v.value #>> '{}') > coalesce((v_schema -> v.key ->> 'max')::integer, 1000))
     or exists (select 1 from jsonb_each(v_schema) s
                where s.value ->> 'source' = 'campaign' and not coalesce((s.value ->> 'optional')::boolean, false)
                  and not v_vars ? s.key) then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "template_variables"}');
  end if;

  insert into app.communication_campaign (campaign_type, edition_id, template_key, purpose, created_by_staff_id,
    audience_definition, template_variables)
  values (p_campaign_type, p_edition_id, p_template_key,
    case p_campaign_type when 'MARKETING' then 'GENERAL_MARKETING' else 'OPERATIONAL' end,
    private.current_staff_member_id(), p_audience, v_vars)
  returning communication_campaign_id into v_id;
  perform private.audit('COMMUNICATION_CAMPAIGN_CREATED', 'communication_campaign', v_id, p_edition_id, null,
    jsonb_build_object('status', 'DRAFT', 'campaign_type', p_campaign_type, 'template_key', p_template_key));

  v_result := private.comms_campaign_projection(v_id);
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 201, v_result);
  end if;
  return v_result;
end;
$$;

create function private.comms_lock_campaign(p_campaign_id uuid)
returns app.communication_campaign
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign app.communication_campaign%rowtype;
begin
  select * into v_campaign from app.communication_campaign c where c.communication_campaign_id = p_campaign_id;
  if not found then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.comms_require_campaign_permission(v_campaign.campaign_type, v_campaign.edition_id);
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  select * into v_campaign from app.communication_campaign c where c.communication_campaign_id = p_campaign_id for update;
  return v_campaign;
end;
$$;

-- Returns the template and sample variables; Next renders the preview with the production renderer.
create function private.preview_communication_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign app.communication_campaign%rowtype := private.comms_lock_campaign(p_campaign_id);
  v_candidates integer;
  v_version app.communication_template_version%rowtype;
  v_vars jsonb;
begin
  if v_campaign.status not in ('DRAFT', 'READY', 'SCHEDULED') then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('status', v_campaign.status));
  end if;
  select count(*) filter (where c.exclusion_reason is null) into v_candidates
  from private.comms_campaign_candidates(p_campaign_id) c;
  update app.communication_campaign
  set estimated_recipient_count = v_candidates, status = case when status = 'DRAFT' then 'READY' else status end
  where communication_campaign_id = p_campaign_id;
  if v_campaign.status = 'DRAFT' then
    perform private.audit('COMMUNICATION_CAMPAIGN_PREVIEWED', 'communication_campaign', p_campaign_id, v_campaign.edition_id,
      jsonb_build_object('status', 'DRAFT'), jsonb_build_object('status', 'READY', 'estimated_recipient_count', v_candidates));
  end if;

  select tv.* into v_version from app.communication_template t
  join app.communication_template_version tv on tv.template_id = t.communication_template_id and tv.version = t.active_version
  where t.template_key = v_campaign.template_key;
  v_vars := private.comms_pick_vars(v_campaign.template_key,
    private.comms_edition_vars(v_campaign.edition_id) || v_campaign.template_variables);
  return jsonb_build_object(
    'campaign', private.comms_campaign_projection(p_campaign_id),
    'template', jsonb_build_object('template_key', v_campaign.template_key, 'version', v_version.version,
      'category', (select r.category from app.communication_automation_rule r where r.rule_key = v_campaign.template_key),
      'subject', private.comms_render_subject(v_version.subject_template, v_vars),
      'html_template', v_version.html_template, 'text_template', v_version.text_template,
      'variable_schema', v_version.variable_schema),
    'sample_variables', v_vars);
end;
$$;

create function private.schedule_communication_campaign(p_campaign_id uuid, p_scheduled_for timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign app.communication_campaign%rowtype := private.comms_lock_campaign(p_campaign_id);
begin
  if v_campaign.status not in ('READY', 'SCHEDULED') then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('status', v_campaign.status));
  end if;
  if p_scheduled_for is null or p_scheduled_for < pg_catalog.now() + interval '1 minute'
     or p_scheduled_for > pg_catalog.now() + interval '180 days' then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "scheduled_for"}');
  end if;
  update app.communication_campaign set status = 'SCHEDULED', scheduled_for = p_scheduled_for
  where communication_campaign_id = p_campaign_id;
  perform private.audit('COMMUNICATION_CAMPAIGN_SCHEDULED', 'communication_campaign', p_campaign_id, v_campaign.edition_id,
    jsonb_build_object('status', v_campaign.status, 'scheduled_for', v_campaign.scheduled_for),
    jsonb_build_object('status', 'SCHEDULED', 'scheduled_for', p_scheduled_for));
  return private.comms_campaign_projection(p_campaign_id);
end;
$$;

-- Snapshot + message creation. Called by the send command (staff) or the reconcile worker (SYSTEM).
create function private.comms_materialize_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign app.communication_campaign%rowtype;
  v_candidate record;
  v_vars jsonb;
  v_candidates integer := 0;
  v_excluded integer := 0;
begin
  select * into v_campaign from app.communication_campaign c where c.communication_campaign_id = p_campaign_id for update;
  if v_campaign.status not in ('READY', 'SCHEDULED') then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('status', v_campaign.status));
  end if;
  update app.communication_campaign set status = 'SENDING', started_at = pg_catalog.now()
  where communication_campaign_id = p_campaign_id;
  v_vars := private.comms_pick_vars(v_campaign.template_key,
    private.comms_edition_vars(v_campaign.edition_id) || v_campaign.template_variables);

  for v_candidate in select * from private.comms_campaign_candidates(p_campaign_id) loop
    insert into app.communication_campaign_recipient (campaign_id, communication_recipient_id, snapshot_status, exclusion_reason)
    values (p_campaign_id, v_candidate.recipient_id,
      case when v_candidate.exclusion_reason is null then 'CANDIDATE' else 'EXCLUDED' end, v_candidate.exclusion_reason)
    on conflict (campaign_id, communication_recipient_id) do nothing;
    if v_candidate.exclusion_reason is null then
      v_candidates := v_candidates + 1;
      perform private.comms_enqueue_message(v_campaign.template_key, v_candidate.recipient_id, v_candidate.contact_point_id,
        'CAMPAIGN:' || p_campaign_id || ':' || v_candidate.recipient_id, 'CAMPAIGN', p_campaign_id, v_vars,
        v_campaign.edition_id, null, null, p_campaign_id);
    else
      v_excluded := v_excluded + 1;
    end if;
  end loop;

  update app.communication_campaign
  set estimated_recipient_count = v_candidates,
      status = case when v_candidates = 0 then 'COMPLETED' else 'SENDING' end,
      completed_at = case when v_candidates = 0 then pg_catalog.now() end
  where communication_campaign_id = p_campaign_id;
  return jsonb_build_object('candidates', v_candidates, 'excluded', v_excluded);
end;
$$;

create function private.send_communication_campaign(p_campaign_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign app.communication_campaign%rowtype := private.comms_lock_campaign(p_campaign_id);
  v_idem jsonb;
  v_snapshot jsonb;
  v_result jsonb;
begin
  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('communication_campaign.send', p_campaign_id::text, p_idempotency_key,
      jsonb_build_object('campaign_id', p_campaign_id));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;
  v_snapshot := private.comms_materialize_campaign(p_campaign_id);
  perform private.audit('COMMUNICATION_CAMPAIGN_SENT', 'communication_campaign', p_campaign_id, v_campaign.edition_id,
    jsonb_build_object('status', v_campaign.status), jsonb_build_object('status', 'SENDING') || v_snapshot);
  v_result := private.comms_campaign_projection(p_campaign_id) || jsonb_build_object('snapshot', v_snapshot);
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

create function private.cancel_communication_campaign(p_campaign_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign app.communication_campaign%rowtype := private.comms_lock_campaign(p_campaign_id);
  v_canceled integer;
begin
  if v_campaign.status not in ('DRAFT', 'READY', 'SCHEDULED', 'SENDING') then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('status', v_campaign.status));
  end if;
  if p_reason is not null and pg_catalog.length(p_reason) > 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', '{"field": "reason"}');
  end if;
  update app.communication_campaign set status = 'CANCELED', canceled_at = pg_catalog.now()
  where communication_campaign_id = p_campaign_id;
  update app.communication_message set status = 'CANCELED', last_error = 'CAMPAIGN_CANCELED'
  where campaign_id = p_campaign_id and status in ('QUEUED', 'WAITING_FOR_QUOTA');
  get diagnostics v_canceled = row_count;
  perform private.audit('COMMUNICATION_CAMPAIGN_CANCELED', 'communication_campaign', p_campaign_id, v_campaign.edition_id,
    jsonb_build_object('status', v_campaign.status),
    jsonb_build_object('status', 'CANCELED', 'canceled_messages', v_canceled), p_reason);
  return private.comms_campaign_projection(p_campaign_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin reads (keyset pagination: created_at desc, id desc). Emails are masked.
-- ---------------------------------------------------------------------------------------------
create function private.list_communication_campaigns(p_edition_id uuid, p_status text, p_before_created_at timestamptz,
  p_before_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_items jsonb;
begin
  perform private.comms_require_console(p_edition_id);
  select coalesce(jsonb_agg(private.comms_campaign_projection(x.communication_campaign_id) order by x.created_at desc,
           x.communication_campaign_id desc), '[]'::jsonb)
  into v_items
  from (select c.communication_campaign_id, c.created_at from app.communication_campaign c
        where (p_edition_id is null or c.edition_id = p_edition_id)
          and (p_status is null or c.status = p_status)
          and (p_before_created_at is null or (c.created_at, c.communication_campaign_id) < (p_before_created_at, p_before_id))
        order by c.created_at desc, c.communication_campaign_id desc
        limit v_limit + 1) x;
  return jsonb_build_object('items', coalesce((select jsonb_agg(i) from (select i from jsonb_array_elements(v_items) with ordinality e(i, n)
                                                                         where n <= v_limit order by n) s), '[]'::jsonb),
    'has_more', jsonb_array_length(v_items) > v_limit);
end;
$$;

create function private.list_communication_messages(p_edition_id uuid, p_campaign_id uuid, p_status text,
  p_template_key text, p_before_created_at timestamptz, p_before_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_edition_id uuid := p_edition_id;
  v_items jsonb;
begin
  if p_campaign_id is not null then
    select c.edition_id into v_edition_id from app.communication_campaign c where c.communication_campaign_id = p_campaign_id;
    if not found or (p_edition_id is not null and v_edition_id is distinct from p_edition_id) then
      perform private.require_actor();
      perform private.raise_domain_error('NOT_FOUND');
    end if;
  end if;
  perform private.comms_require_console(v_edition_id);

  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb) into v_items
  from (select m.created_at, m.communication_message_id as id, jsonb_build_object(
          'message_id', m.communication_message_id, 'template_key', m.template_key, 'category', m.category,
          'priority', m.priority, 'status', m.status, 'recipient_type', r.recipient_type,
          'email_masked', private.comms_mask_email(cp.value_normalized), 'edition_id', m.edition_id,
          'campaign_id', m.campaign_id, 'registration_id', m.registration_id, 'subject', m.rendered_subject_snapshot,
          'scheduled_for', m.scheduled_for, 'sent_at', m.sent_at, 'attempt_count', m.attempt_count,
          'last_error', m.last_error, 'provider', m.provider, 'provider_status_at', m.provider_status_at,
          'escalated', m.escalated_at is not null, 'created_at', m.created_at) as item
        from app.communication_message m
        join app.communication_recipient r on r.communication_recipient_id = m.recipient_id
        join app.communication_contact_point cp on cp.communication_contact_point_id = m.contact_point_id
        where (v_edition_id is null or m.edition_id = v_edition_id)
          and (p_campaign_id is null or m.campaign_id = p_campaign_id)
          and (p_status is null or m.status = p_status)
          and (p_template_key is null or m.template_key = p_template_key)
          and (p_before_created_at is null or (m.created_at, m.communication_message_id) < (p_before_created_at, p_before_id))
        order by m.created_at desc, m.communication_message_id desc
        limit v_limit + 1) x;
  return jsonb_build_object('items', coalesce((select jsonb_agg(i) from (select i from jsonb_array_elements(v_items) with ordinality e(i, n)
                                                                         where n <= v_limit order by n) s), '[]'::jsonb),
    'has_more', jsonb_array_length(v_items) > v_limit);
end;
$$;

-- Master §197 metrics for the communications console (global comms permission).
create function private.get_communication_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  perform private.comms_require_console(null);
  return jsonb_build_object(
    'outbox_pending_count', (select count(*) from infra.outbox_event o where o.status in ('PENDING', 'FAILED', 'PROCESSING')),
    'outbox_oldest_age_seconds', (select coalesce(extract(epoch from pg_catalog.now() - min(o.created_at))::integer, 0)
                                  from infra.outbox_event o where o.status in ('PENDING', 'FAILED', 'PROCESSING')),
    'outbox_escalated_count', (select count(*) from infra.outbox_event o where o.status = 'ESCALATED'),
    'communication_critical_backlog', (select count(*) from app.communication_message m
                                       where m.priority <= 1 and m.status in ('QUEUED', 'WAITING_FOR_QUOTA', 'SENDING')),
    'communication_critical_failed_24h', (select count(*) from app.communication_message m
                                          where m.priority <= 1 and m.status in ('FAILED', 'BOUNCED')
                                            and m.created_at > pg_catalog.now() - interval '24 hours'),
    'waiting_for_quota_count', (select count(*) from app.communication_message m where m.status = 'WAITING_FOR_QUOTA'),
    'active_suppressions', (select count(*) from app.communication_suppression s where s.active),
    'worker_failed_count_24h', (select count(*) from infra.worker_run w
                                where w.status in ('FAILED', 'PARTIAL') and w.started_at > pg_catalog.now() - interval '24 hours'),
    'provider_quota', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider', p.provider, 'usage_date', v_today,
        'daily_limit', coalesce(u.daily_limit_snapshot, p.daily_limit),
        'used', coalesce(u.sent_total, 0)
                + case when p.counts_auth_otp then greatest(coalesce(u.sent_security, 0), private.comms_auth_otp_count(v_today)) else 0 end,
        'remaining', greatest(coalesce(u.daily_limit_snapshot, p.daily_limit) - coalesce(u.sent_total, 0)
                - case when p.counts_auth_otp then greatest(coalesce(u.sent_security, 0), private.comms_auth_otp_count(v_today)) else 0 end, 0),
        'critical_reserve', p.critical_reserve) order by p.provider), '[]'::jsonb)
      from infra.communication_provider_policy p
      left join app.communication_provider_usage u on u.provider = p.provider and u.usage_date = v_today));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reconcile workers (SYSTEM)
-- ---------------------------------------------------------------------------------------------
create function private.reconcile_communications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_target record;
  v_template text;
  v_campaigns_started integer := 0;
  v_campaigns_closed integer := 0;
  v_scheduled integer := 0;
  v_birthdays integer := 0;
  v_escalated integer := 0;
  v_expired integer := 0;
  v_local_today date := (pg_catalog.now() at time zone 'America/Monterrey')::date;
begin
  for v_row in
    select c.communication_campaign_id from app.communication_campaign c
    where c.status = 'SCHEDULED' and c.scheduled_for <= pg_catalog.now()
    for update skip locked
  loop
    perform private.comms_materialize_campaign(v_row.communication_campaign_id);
    perform private.audit('COMMUNICATION_CAMPAIGN_SENT', 'communication_campaign', v_row.communication_campaign_id, null,
      jsonb_build_object('status', 'SCHEDULED'), jsonb_build_object('status', 'SENDING'));
    v_campaigns_started := v_campaigns_started + 1;
  end loop;

  update app.communication_campaign c
  set status = case when exists (select 1 from app.communication_message m where m.campaign_id = c.communication_campaign_id
                                   and m.status in ('SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED'))
                          or not exists (select 1 from app.communication_message m where m.campaign_id = c.communication_campaign_id
                                           and m.status = 'FAILED')
                     then 'COMPLETED' else 'FAILED' end,
      completed_at = pg_catalog.now()
  where c.status = 'SENDING'
    and not exists (select 1 from app.communication_message m where m.campaign_id = c.communication_campaign_id
                      and m.status in ('QUEUED', 'WAITING_FOR_QUOTA', 'SENDING'));
  get diagnostics v_campaigns_closed = row_count;

  -- T-7 / T-24 for confirmed participants, bound to the current schedule revision (reprogrammable).
  for v_row in
    select e.edition_id, sr.edition_schedule_revision_id,
           coalesce(sr.effective_start_at,
                    ((sr.local_date + coalesce(sr.local_start_time, time '00:00'))::timestamp at time zone sr.timezone)) as starts_at
    from app.edition e
    join lateral (select s.* from app.edition_schedule_revision s
                  where s.edition_id = e.edition_id and s.superseded_at is null
                  order by s.revision desc limit 1) sr on true
    where e.publication_state = 'PUBLISHED' and e.execution_state = 'SCHEDULED'
      and sr.schedule_state <> 'POSTPONED_NO_NEW_DATE' and sr.local_date is not null
  loop
    v_template := case
      when pg_catalog.now() >= v_row.starts_at - interval '7 days' and pg_catalog.now() < v_row.starts_at - interval '6 days' then 'T_MINUS_7'
      when pg_catalog.now() >= v_row.starts_at - interval '24 hours' and pg_catalog.now() < v_row.starts_at - interval '12 hours' then 'T_MINUS_24'
    end;
    continue when v_template is null;
    for v_target in select * from private.comms_edition_participant_recipients(v_row.edition_id) loop
      if private.comms_enqueue_message(v_template, v_target.recipient_id, v_target.contact_point_id,
           v_template || ':' || v_row.edition_id || ':' || v_row.edition_schedule_revision_id || ':' || v_target.recipient_id,
           'EDITION_SCHEDULE_REVISION', v_row.edition_schedule_revision_id,
           private.comms_pick_vars(v_template, private.comms_edition_vars(v_row.edition_id)), v_row.edition_id) is not null then
        v_scheduled := v_scheduled + 1;
      end if;
    end loop;
  end loop;

  if exists (select 1 from app.communication_automation_rule r where r.rule_key = 'BIRTHDAY' and r.active) then
    for v_target in
      select rp.runner_profile_id, pg_catalog.split_part(rp.full_name, ' ', 1) as first_name
      from app.runner_profile rp
      join app.communication_recipient r on r.runner_profile_id = rp.runner_profile_id
      where rp.profile_readiness = 'READY' and rp.account_state = 'ACTIVE'
        and extract(month from rp.date_of_birth) = extract(month from v_local_today)
        and extract(day from rp.date_of_birth) = extract(day from v_local_today)
        and private.comms_consent_granted(r.communication_recipient_id, 'GENERAL_MARKETING')
    loop
      select * into v_row from private.comms_ensure_runner_recipient(v_target.runner_profile_id);
      -- Adults-only and suppression checks run again at claim time (SEC-120).
      if v_row.o_contact_point_id is not null
         and private.comms_recipient_block_reason(v_row.o_recipient_id, v_row.o_contact_point_id, 'MARKETING', true) is null
         and private.comms_enqueue_message('BIRTHDAY', v_row.o_recipient_id, v_row.o_contact_point_id,
               'BIRTHDAY:' || v_row.o_recipient_id || ':' || extract(year from v_local_today)::integer, 'RUNNER_PROFILE',
               v_target.runner_profile_id, jsonb_build_object('first_name', v_target.first_name, 'events_path', '/eventos')) is not null then
        v_birthdays := v_birthdays + 1;
      end if;
    end loop;
  end if;

  for v_row in
    select m.communication_message_id from app.communication_message m
    where m.priority <= 1 and m.status in ('QUEUED', 'WAITING_FOR_QUOTA') and m.escalated_at is null
      and m.created_at < pg_catalog.now() - interval '1 hour'
  loop
    perform private.comms_escalate_message(v_row.communication_message_id);
    v_escalated := v_escalated + 1;
  end loop;

  update app.event_reminder_subscription s set status = 'CANCELED', canceled_at = pg_catalog.now()
  where s.status = 'PENDING_CONFIRMATION' and s.created_at < pg_catalog.now() - interval '7 days';
  get diagnostics v_expired = row_count;

  return jsonb_build_object('campaigns_started', v_campaigns_started, 'campaigns_closed', v_campaigns_closed,
    'schedule_messages', v_scheduled, 'birthday_messages', v_birthdays, 'escalated', v_escalated,
    'expired_pending_reminders', v_expired);
end;
$$;

-- Daily snapshot of the provider's limit plus the OTP count; usage is never lowered (in-flight claims).
create function private.reconcile_provider_usage(p_provider text, p_daily_limit integer, p_remaining integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := (pg_catalog.now() at time zone 'UTC')::date;
  v_policy infra.communication_provider_policy%rowtype;
  v_otp integer;
  v_usage app.communication_provider_usage%rowtype;
begin
  select * into v_policy from infra.communication_provider_policy p where p.provider = p_provider;
  if not found or (p_daily_limit is not null and p_daily_limit < 0) or (p_remaining is not null and p_remaining < 0) then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid usage reconcile arguments';
  end if;
  v_otp := case when v_policy.counts_auth_otp then private.comms_auth_otp_count(v_date) else 0 end;
  insert into app.communication_provider_usage (provider, usage_date, daily_limit_snapshot)
  values (p_provider, v_date, coalesce(p_daily_limit, v_policy.daily_limit))
  on conflict (provider, usage_date) do nothing;
  update app.communication_provider_usage u
  set daily_limit_snapshot = coalesce(p_daily_limit, u.daily_limit_snapshot, v_policy.daily_limit),
      sent_security = greatest(u.sent_security, v_otp),
      -- Usage the provider saw that we did not dispatch (other senders on the account) is counted too.
      sent_total = greatest(u.sent_total, case when p_daily_limit is not null and p_remaining is not null
                                               then p_daily_limit - p_remaining - greatest(u.sent_security, v_otp) else 0 end)
  where u.provider = p_provider and u.usage_date = v_date
  returning * into v_usage;
  return jsonb_build_object('provider', p_provider, 'usage_date', v_date, 'sent_total', v_usage.sent_total,
    'auth_otp', v_usage.sent_security, 'daily_limit', v_usage.daily_limit_snapshot);
end;
$$;

-- SENT messages without a terminal provider event after 2 h (webhook lost): polled by communication-reconcile.
create function private.list_messages_awaiting_provider_status(p_provider text, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('message_id', x.communication_message_id,
           'provider_message_id', x.provider_message_id) order by x.sent_at), '[]'::jsonb)
  from (select m.communication_message_id, m.provider_message_id, m.sent_at
        from app.communication_message m
        where m.status = 'SENT' and m.provider = p_provider and m.provider_message_id is not null
          and m.sent_at < pg_catalog.now() - interval '2 hours' and m.sent_at > pg_catalog.now() - interval '7 days'
        order by m.sent_at
        limit least(greatest(coalesce(p_limit, 20), 1), 100)) x
$$;
