-- T30 Event/Edition commands (Master §27-33, §59, §155, §169): create/update, schedule revisions and
-- every Edition transition. Staff scope always comes from the target row (SEC-020); inputs are
-- validated here, not only in Next (A4); constraint errors leave as domain codes (SEC-005).

-- ---------------------------------------------------------------------------------------------
-- Shared command plumbing.
-- ---------------------------------------------------------------------------------------------

-- Permission on the target's Edition + success-path admin rate limit (A6). Returns staff_member_id.
create or replace function private.cfg_authorize(p_action text, p_edition_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := private.require_permission(p_action, p_edition_id);
begin
  perform private.consume_policy_rate_limit('admin.mutation:cmd', auth.uid()::text);
  return v_staff_id;
end;
$$;

-- NULL when no key was sent; otherwise the idempotency_begin result (call after authorising).
create or replace function private.cfg_idempotency_begin(p_operation text, p_scope text, p_key text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is null then return null; end if;
  return private.idempotency_begin(p_operation, p_scope, p_key, p_args);
end;
$$;

create or replace function private.cfg_idempotency_complete(p_idem jsonb, p_status integer, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_idem is not null then
    perform private.idempotency_complete((p_idem ->> 'record_id')::uuid, p_status, p_result);
  end if;
  return p_result;
end;
$$;

-- Unique keys the client chose map to CONFLICT {field, reason: taken}; everything else follows the
-- generic SQLSTATE mapping. Only field names leave (SEC-005).
create or replace function private.cfg_raise_constraint(p_sqlstate text, p_constraint text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_field text := jsonb_build_object(
    'event_canonical_key_key', 'canonical_key',
    'edition_slug_key', 'slug',
    'edition_slug_history_old_slug_key', 'slug',
    'modality_edition_id_key_key', 'key',
    'category_edition_id_key_key', 'key',
    'kit_variant_kit_definition_id_variant_key_key', 'variant_key',
    'registration_form_field_registration_form_id_field_key_key', 'field_key',
    'registration_form_version_uidx', 'version',
    'registration_form_published_uidx', 'status',
    'legal_document_document_key_key', 'document_key',
    'legal_document_version_legal_document_id_version_key', 'version',
    'edition_location_primary_uidx', 'is_primary') ->> coalesce(p_constraint, '');
begin
  if v_field is not null and p_sqlstate in ('23505', '23P01') then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('field', v_field, 'reason', 'taken'));
  end if;
  perform private.raise_constraint_error(p_sqlstate, p_constraint);
end;
$$;

create or replace function private.cfg_invalid_transition(p_field text, p_current text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.raise_domain_error('CONFLICT',
    jsonb_build_object('reason', 'invalid_transition', 'field', p_field, 'current', p_current));
end;
$$;

-- Structural configuration (modalities, prices, capacity, categories, forms) is frozen once the
-- Edition is finished or canceled; editorial content stays editable (the page is kept, Master §33).
create or replace function private.cfg_assert_configurable(p_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from app.edition e where e.edition_id = p_edition_id and e.execution_state in ('FINISHED', 'CANCELED')) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'edition_not_configurable'));
  end if;
end;
$$;

create or replace function private.event_projection(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('event_id', ev.event_id, 'name', ev.name, 'canonical_key', ev.canonical_key,
    'status', ev.status, 'event_type_key', et.key, 'event_type_name', et.name,
    'created_at', ev.created_at, 'updated_at', ev.updated_at)
  from app.event ev
  join app.event_type et on et.event_type_id = ev.event_type_id
  where ev.event_id = p_event_id
$$;

create or replace function private.edition_projection(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('edition_id', e.edition_id, 'event_id', e.event_id, 'slug', e.slug, 'name', e.name,
    'publication_state', e.publication_state, 'registration_state', e.registration_state,
    'execution_state', e.execution_state, 'closure_state', e.closure_state,
    'registration_mode', e.registration_mode, 'timezone', e.timezone,
    'registration_open_at', e.registration_open_at, 'registration_close_at', e.registration_close_at,
    'global_capacity', e.global_capacity, 'city', e.city, 'state_region', e.state_region,
    'country_code', e.country_code, 'primary_location_id', e.primary_location_id,
    'whatsapp_phone_e164', e.whatsapp_phone_e164, 'is_benefit_event', e.is_benefit_event,
    'published_at', e.published_at, 'created_at', e.created_at, 'updated_at', e.updated_at,
    'schedule', private.current_schedule(e.edition_id))
  from app.edition e
  where e.edition_id = p_edition_id
$$;

-- A slug is free when no other Edition uses it now or redirects from it (redirects are never hijacked).
create or replace function private.cfg_assert_slug_free(p_slug text, p_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from app.edition e where e.slug = p_slug and e.edition_id is distinct from p_edition_id)
     or exists (select 1 from app.edition_slug_history h where h.old_slug = p_slug and h.edition_id is distinct from p_edition_id) then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('field', 'slug', 'reason', 'taken'));
  end if;
end;
$$;

-- {local_date (required), local_start_time?, local_end_time? (needs a start, after it)}.
create or replace function private.cfg_schedule_input(p_input jsonb, p_prefix text default '')
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_date date := private.cfg_date(p_input, 'local_date', true, p_prefix || 'local_date');
  v_start time := private.cfg_time(p_input, 'local_start_time', false, p_prefix || 'local_start_time');
  v_end time := private.cfg_time(p_input, 'local_end_time', false, p_prefix || 'local_end_time');
begin
  if v_end is not null and (v_start is null or v_end <= v_start) then
    perform private.cfg_fail(p_prefix || 'local_end_time', 'must_follow_start');
  end if;
  return jsonb_build_object('local_date', v_date, 'local_start_time', v_start, 'local_end_time', v_end);
end;
$$;

-- Appends a revision and supersedes the current one (one current revision per Edition, Master §29).
create or replace function private.insert_schedule_revision(
  p_edition_id uuid, p_schedule jsonb, p_reason text, p_staff_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_date date := (p_schedule ->> 'local_date')::date;
  v_start time := (p_schedule ->> 'local_start_time')::time;
  v_end time := (p_schedule ->> 'local_end_time')::time;
  v_revision integer;
  v_id uuid;
begin
  select e.timezone into v_timezone from app.edition e where e.edition_id = p_edition_id;
  select coalesce(max(r.revision), 0) + 1 into v_revision
  from app.edition_schedule_revision r where r.edition_id = p_edition_id;

  update app.edition_schedule_revision r set superseded_at = now()
  where r.edition_id = p_edition_id and r.superseded_at is null;

  insert into app.edition_schedule_revision (edition_id, revision, schedule_state, local_date, local_start_time,
    local_end_time, timezone, effective_start_at, effective_end_at, reason, created_by_staff_id)
  values (p_edition_id, v_revision,
    case when v_date is null then 'POSTPONED_NO_NEW_DATE'
         when v_start is null then 'DATE_CONFIRMED_TIME_PENDING'
         else 'DATE_TIME_CONFIRMED' end,
    v_date, v_start, v_end, v_timezone,
    case when v_start is not null then (v_date + v_start) at time zone v_timezone end,
    case when v_end is not null then (v_date + v_end) at time zone v_timezone end,
    p_reason, p_staff_id)
  returning edition_schedule_revision_id into v_id;
  return v_id;
end;
$$;

-- Default close (Master §155): reference start minus the platform offset at the time of the command.
create or replace function private.default_registration_close_at(p_schedule jsonb, p_timezone text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select private.schedule_close_reference((p_schedule ->> 'local_date')::date, (p_schedule ->> 'local_start_time')::time, p_timezone)
         - make_interval(mins => s.registration_close_offset_minutes)
  from app.platform_settings s
  where s.settings_id = 1 and p_schedule ->> 'local_date' is not null
$$;

-- ---------------------------------------------------------------------------------------------
-- Event commands.
-- ---------------------------------------------------------------------------------------------

create or replace function private.create_event(p_input jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_type_id uuid;
  v_name text;
  v_key text;
  v_idem jsonb;
  v_event_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  perform private.cfg_authorize('EVENT_CREATE');
  v_input := private.cfg_object(p_input, array['event_type_key', 'name', 'canonical_key']);
  v_name := private.cfg_text(v_input, 'name', true, 160);
  v_key := private.cfg_slug(v_input, 'canonical_key', true);
  select et.event_type_id into v_type_id from app.event_type et
  where et.key = private.cfg_text(v_input, 'event_type_key', true, 64) and et.active;
  if v_type_id is null then perform private.cfg_fail('event_type_key', 'unknown'); end if;

  v_idem := private.cfg_idempotency_begin('event.create', 'event', p_idempotency_key, jsonb_build_object('input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  insert into app.event (event_type_id, name, canonical_key) values (v_type_id, v_name, v_key)
  returning event_id into v_event_id;
  perform private.audit('EVENT_CREATED', 'event', v_event_id, null, null,
    jsonb_build_object('name', v_name, 'canonical_key', v_key, 'event_type_id', v_type_id));

  v_result := private.event_projection(v_event_id);
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- Name and type only: canonical_key is the Event identity (Master §27).
create or replace function private.update_event(p_event_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_event app.event%rowtype;
  v_name text;
  v_type_id uuid;
  v_constraint text;
begin
  if not exists (select 1 from app.event ev where ev.event_id = p_event_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('EVENT_CREATE');
  v_input := private.cfg_object(p_input, array['name', 'event_type_key']);
  select * into v_event from app.event ev where ev.event_id = p_event_id for update;

  v_name := coalesce(private.cfg_text(v_input, 'name', v_input ? 'name', 160), v_event.name);
  v_type_id := v_event.event_type_id;
  if v_input ? 'event_type_key' then
    select et.event_type_id into v_type_id from app.event_type et
    where et.key = private.cfg_text(v_input, 'event_type_key', true, 64) and et.active;
    if v_type_id is null then perform private.cfg_fail('event_type_key', 'unknown'); end if;
  end if;

  update app.event set name = v_name, event_type_id = v_type_id where event_id = p_event_id;
  perform private.audit('EVENT_UPDATED', 'event', p_event_id, null,
    jsonb_build_object('name', v_event.name, 'event_type_id', v_event.event_type_id),
    jsonb_build_object('name', v_name, 'event_type_id', v_type_id));
  return private.event_projection(p_event_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Edition create/update.
-- ---------------------------------------------------------------------------------------------

create or replace function private.create_edition(p_event_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_input jsonb;
  v_event app.event%rowtype;
  v_settings app.platform_settings%rowtype;
  v_slug text;
  v_timezone text;
  v_country text;
  v_schedule jsonb;
  v_open_at timestamptz;
  v_close_at timestamptz;
  v_idem jsonb;
  v_edition_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  select * into v_event from app.event ev where ev.event_id = p_event_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('EDITION_CREATE');
  if v_event.status <> 'ACTIVE' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'event_archived'));
  end if;

  v_input := private.cfg_object(p_input, array['slug', 'name', 'registration_mode', 'timezone', 'city', 'state_region',
    'country_code', 'registration_open_at', 'registration_close_at', 'global_capacity', 'whatsapp_phone_e164',
    'is_benefit_event', 'schedule']);
  select * into v_settings from app.platform_settings s where s.settings_id = 1;

  v_slug := private.cfg_slug(v_input, 'slug', true);
  v_timezone := coalesce(private.cfg_text(v_input, 'timezone', false, 64), v_settings.timezone, 'America/Monterrey');
  if not private.is_iana_timezone(v_timezone) then perform private.cfg_fail('timezone', 'invalid_timezone'); end if;
  v_country := coalesce(private.cfg_text(v_input, 'country_code', false, 2, 2), 'MX');
  if v_country !~ '^[A-Z]{2}$' then perform private.cfg_fail('country_code', 'invalid_country_code'); end if;
  if private.cfg_present(v_input, 'schedule') then
    v_schedule := private.cfg_schedule_input(private.cfg_object(v_input -> 'schedule',
      array['local_date', 'local_start_time', 'local_end_time'], 'schedule'), 'schedule.');
  end if;

  v_open_at := private.cfg_timestamptz(v_input, 'registration_open_at', false);
  -- Explicit value wins; otherwise materialised from the schedule and the platform offset (§155).
  v_close_at := coalesce(private.cfg_timestamptz(v_input, 'registration_close_at', false),
                         private.default_registration_close_at(v_schedule, v_timezone));
  if v_close_at is null then perform private.cfg_fail('registration_close_at', 'required_without_schedule_date'); end if;
  if v_open_at is not null and v_open_at >= v_close_at then
    perform private.cfg_fail('registration_open_at', 'must_precede_close');
  end if;

  v_idem := private.cfg_idempotency_begin('edition.create', p_event_id::text, p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform private.cfg_assert_slug_free(v_slug, null);
  insert into app.edition (event_id, slug, name, registration_mode, timezone, registration_open_at, registration_close_at,
    global_capacity, city, state_region, country_code, whatsapp_phone_e164, is_benefit_event)
  values (p_event_id, v_slug, private.cfg_text(v_input, 'name', true, 160),
    private.cfg_enum(v_input, 'registration_mode', true, array['FREE', 'EXTERNAL_WHATSAPP']),
    v_timezone, v_open_at, v_close_at,
    private.cfg_int(v_input, 'global_capacity', false, 0, 1000000),
    private.cfg_text(v_input, 'city', true, 120), private.cfg_text(v_input, 'state_region', true, 120), v_country,
    private.cfg_e164(v_input, 'whatsapp_phone_e164', false),
    coalesce(private.cfg_bool(v_input, 'is_benefit_event', false), false))
  returning edition_id into v_edition_id;

  if v_schedule is not null then
    perform private.insert_schedule_revision(v_edition_id, v_schedule, null, v_staff_id);
  end if;

  perform private.audit('EDITION_CREATED', 'edition', v_edition_id, v_edition_id, null,
    jsonb_build_object('event_id', p_event_id, 'slug', v_slug, 'registration_close_at', v_close_at));
  v_result := private.edition_projection(v_edition_id);
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- Non-state fields only (Master §32: states move through commands). Registration mode/window need
-- EDITION_LIFECYCLE_MANAGE; everything else EVENT_CONTENT_MANAGE on the target Edition.
create or replace function private.update_edition(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_staff_id uuid;
  v_e app.edition%rowtype;
  v_n app.edition%rowtype;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_key text;
  v_schedule jsonb;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_input := private.cfg_object(p_input, array['name', 'slug', 'timezone', 'city', 'state_region', 'country_code',
    'registration_mode', 'registration_open_at', 'registration_close_at', 'whatsapp_phone_e164', 'is_benefit_event',
    'primary_location_id']);
  v_staff_id := private.cfg_authorize(
    case when v_input ?| array['registration_mode', 'registration_open_at', 'registration_close_at']
         then 'EDITION_LIFECYCLE_MANAGE' else 'EVENT_CONTENT_MANAGE' end, p_edition_id);

  select * into v_e from app.edition e where e.edition_id = p_edition_id for update;
  v_n := v_e;
  if v_input ? 'name' then v_n.name := private.cfg_text(v_input, 'name', true, 160); end if;
  if v_input ? 'slug' then v_n.slug := private.cfg_slug(v_input, 'slug', true); end if;
  if v_input ? 'timezone' then
    v_n.timezone := private.cfg_text(v_input, 'timezone', true, 64);
    if not private.is_iana_timezone(v_n.timezone) then perform private.cfg_fail('timezone', 'invalid_timezone'); end if;
  end if;
  if v_input ? 'city' then v_n.city := private.cfg_text(v_input, 'city', true, 120); end if;
  if v_input ? 'state_region' then v_n.state_region := private.cfg_text(v_input, 'state_region', true, 120); end if;
  if v_input ? 'country_code' then
    v_n.country_code := private.cfg_text(v_input, 'country_code', true, 2, 2);
    if v_n.country_code !~ '^[A-Z]{2}$' then perform private.cfg_fail('country_code', 'invalid_country_code'); end if;
  end if;
  if v_input ? 'registration_mode' then
    v_n.registration_mode := private.cfg_enum(v_input, 'registration_mode', true, array['FREE', 'EXTERNAL_WHATSAPP']);
  end if;
  if v_input ? 'registration_open_at' then v_n.registration_open_at := private.cfg_timestamptz(v_input, 'registration_open_at', false); end if;
  if v_input ? 'registration_close_at' then v_n.registration_close_at := private.cfg_timestamptz(v_input, 'registration_close_at', true); end if;
  if v_input ? 'whatsapp_phone_e164' then v_n.whatsapp_phone_e164 := private.cfg_e164(v_input, 'whatsapp_phone_e164', false); end if;
  if v_input ? 'is_benefit_event' then v_n.is_benefit_event := private.cfg_bool(v_input, 'is_benefit_event', true); end if;
  if v_input ? 'primary_location_id' then
    v_n.primary_location_id := private.cfg_uuid(v_input, 'primary_location_id', false);
    if v_n.primary_location_id is not null and not exists (
         select 1 from app.edition_location l
         where l.edition_location_id = v_n.primary_location_id and l.edition_id = p_edition_id) then
      perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'primary_location_id'));
    end if;
  end if;

  if v_n.registration_open_at is not null and v_n.registration_open_at >= v_n.registration_close_at then
    perform private.cfg_fail('registration_open_at', 'must_precede_close');
  end if;
  if v_n.timezone <> v_e.timezone and v_e.publication_state <> 'DRAFT' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('field', 'timezone', 'reason', 'locked_after_publication'));
  end if;
  if v_n.registration_mode <> v_e.registration_mode
     and (v_e.registration_state <> 'NOT_OPEN'
          or exists (select 1 from app.registration_request r where r.edition_id = p_edition_id)) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('field', 'registration_mode', 'reason', 'locked_after_registration_opened'));
  end if;
  if v_n.slug <> v_e.slug then
    perform private.cfg_assert_slug_free(v_n.slug, p_edition_id);
  end if;

  update app.edition set name = v_n.name, slug = v_n.slug, timezone = v_n.timezone, city = v_n.city,
    state_region = v_n.state_region, country_code = v_n.country_code, registration_mode = v_n.registration_mode,
    registration_open_at = v_n.registration_open_at, registration_close_at = v_n.registration_close_at,
    whatsapp_phone_e164 = v_n.whatsapp_phone_e164, is_benefit_event = v_n.is_benefit_event,
    primary_location_id = v_n.primary_location_id
  where edition_id = p_edition_id;

  if v_n.slug <> v_e.slug then
    -- Permanent redirects (Master §59): every old slug points straight at the current one.
    insert into app.edition_slug_history as h (edition_id, old_slug, new_slug)
    values (p_edition_id, v_e.slug, v_n.slug)
    on conflict (old_slug) do update set new_slug = excluded.new_slug, changed_at = now()
      where h.edition_id = excluded.edition_id;
    update app.edition_slug_history h set new_slug = v_n.slug, changed_at = now()
    where h.edition_id = p_edition_id and h.new_slug <> v_n.slug and h.old_slug <> v_n.slug;
  end if;

  if v_n.timezone <> v_e.timezone then
    v_schedule := private.current_schedule(p_edition_id);
    if v_schedule is not null then
      perform private.insert_schedule_revision(p_edition_id, v_schedule, 'timezone changed', v_staff_id);
    end if;
  end if;

  if v_input ? 'primary_location_id' then
    update app.edition_location l set is_primary = false
    where l.edition_id = p_edition_id and l.is_primary and l.edition_location_id is distinct from v_n.primary_location_id;
    update app.edition_location l set is_primary = true
    where l.edition_location_id = v_n.primary_location_id and not l.is_primary;
  end if;

  for v_key in select jsonb_object_keys(v_input) loop
    if to_jsonb(v_e) -> v_key is distinct from to_jsonb(v_n) -> v_key then
      v_before := v_before || jsonb_build_object(v_key, to_jsonb(v_e) -> v_key);
      v_after := v_after || jsonb_build_object(v_key, to_jsonb(v_n) -> v_key);
    end if;
  end loop;
  if v_after <> '{}'::jsonb then
    perform private.audit('EDITION_UPDATED', 'edition', p_edition_id, p_edition_id, v_before, v_after);
  end if;
  return private.edition_projection(p_edition_id) || jsonb_build_object('changed_fields',
    coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(v_after) k), '[]'::jsonb));
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Schedule (Master §29): drafts may change freely; after publication only the time on the same
-- date may change here (date moves go through postpone/reschedule) and the change is announced.
-- ---------------------------------------------------------------------------------------------

create or replace function private.set_edition_schedule(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publication text;
  v_staff_id uuid;
  v_input jsonb;
  v_schedule jsonb;
  v_current jsonb;
  v_e app.edition%rowtype;
  v_reason text;
  v_revision_id uuid;
  v_constraint text;
begin
  select e.publication_state into v_publication from app.edition e where e.edition_id = p_edition_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize(
    case when v_publication = 'DRAFT' then 'EVENT_CONTENT_MANAGE' else 'EDITION_LIFECYCLE_MANAGE' end, p_edition_id);
  v_input := private.cfg_object(p_input, array['local_date', 'local_start_time', 'local_end_time', 'reason']);
  v_schedule := private.cfg_schedule_input(v_input);
  v_reason := private.cfg_text(v_input, 'reason', false, 500);

  select * into v_e from app.edition e where e.edition_id = p_edition_id for update;
  if v_e.execution_state <> 'SCHEDULED' then
    perform private.cfg_invalid_transition('execution_state', v_e.execution_state);
  end if;
  v_current := private.current_schedule(p_edition_id);
  if v_current is not null
     and v_current -> 'local_date' = v_schedule -> 'local_date'
     and v_current -> 'local_start_time' = v_schedule -> 'local_start_time'
     and v_current -> 'local_end_time' = v_schedule -> 'local_end_time' then
    return jsonb_build_object('edition', private.edition_projection(p_edition_id), 'changed', false);
  end if;
  if v_e.publication_state <> 'DRAFT' and v_current ->> 'local_date' is not null
     and v_current -> 'local_date' <> v_schedule -> 'local_date' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'date_change_requires_reschedule'));
  end if;

  v_revision_id := private.insert_schedule_revision(p_edition_id, v_schedule, v_reason, v_staff_id);
  perform private.audit('EDITION_SCHEDULE_SET', 'edition', p_edition_id, p_edition_id,
    v_current - array['edition_schedule_revision_id', 'created_at', 'effective_start_at', 'effective_end_at', 'revision'],
    v_schedule, v_reason);
  if v_e.publication_state <> 'DRAFT' then
    perform private.enqueue_outbox('EditionRescheduled', 'Edition', p_edition_id,
      'EditionRescheduled:' || p_edition_id || ':' || v_revision_id,
      jsonb_build_object('edition_id', p_edition_id, 'edition_schedule_revision_id', v_revision_id));
  end if;
  return jsonb_build_object('edition', private.edition_projection(p_edition_id), 'changed', true,
    'announced', v_e.publication_state <> 'DRAFT');
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Edition transitions (Master §32-33). One engine, one public command per transition.
-- ---------------------------------------------------------------------------------------------

create or replace function private.cfg_edition_transition(
  p_edition_id uuid, p_command text, p_input jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_staff_id uuid;
  v_reason text;
  v_idem jsonb;
  v_e app.edition%rowtype;
  v_n app.edition%rowtype;
  v_readiness jsonb;
  v_schedule jsonb;
  v_revision_id uuid;
  v_action text;
  v_event text;
  v_extra jsonb := '{}'::jsonb;
  v_count integer;
  v_result jsonb;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff_id := private.cfg_authorize(
    case when p_command in ('PUBLISH', 'HIDE') then 'EDITION_PUBLISH' else 'EDITION_LIFECYCLE_MANAGE' end, p_edition_id);
  v_input := private.cfg_object(coalesce(p_input, '{}'::jsonb),
    case p_command
      when 'POSTPONE' then array['reason', 'registration_action']
      when 'RESCHEDULE' then array['reason', 'local_date', 'local_start_time', 'local_end_time', 'registration_close_at']
      when 'HIDE' then array['reason']
      when 'CANCEL' then array['reason']
      when 'PAUSE_REGISTRATION' then array['reason']
      when 'CLOSE_REGISTRATION' then array['reason']
      else array[]::text[]
    end);
  v_reason := private.cfg_text(v_input, 'reason', p_command in ('HIDE', 'POSTPONE', 'RESCHEDULE', 'CANCEL'), 500);
  if p_command = 'RESCHEDULE' then
    v_schedule := private.cfg_schedule_input(v_input);
  end if;

  v_idem := private.cfg_idempotency_begin('edition.' || lower(p_command), p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  select * into v_e from app.edition e where e.edition_id = p_edition_id for update;
  v_n := v_e;

  case p_command
    when 'PUBLISH' then
      if v_e.publication_state <> 'DRAFT' then perform private.cfg_invalid_transition('publication_state', v_e.publication_state); end if;
      v_readiness := private.publication_readiness(p_edition_id);
      v_n.publication_state := 'PUBLISHED';
      v_n.published_at := now();
      v_action := 'EDITION_PUBLISHED';
      v_event := 'EditionPublished';
    when 'HIDE' then
      if v_e.publication_state <> 'PUBLISHED' then perform private.cfg_invalid_transition('publication_state', v_e.publication_state); end if;
      v_n.publication_state := 'HIDDEN';
      v_action := 'EDITION_HIDDEN';
    when 'OPEN_REGISTRATION' then
      if v_e.registration_state <> 'NOT_OPEN' then perform private.cfg_invalid_transition('registration_state', v_e.registration_state); end if;
      v_readiness := private.registration_readiness(p_edition_id);
      v_n.registration_state := 'OPEN';
      v_action := 'EDITION_REGISTRATION_OPENED';
      v_event := 'EditionRegistrationOpened';
    when 'PAUSE_REGISTRATION' then
      if v_e.registration_state <> 'OPEN' then perform private.cfg_invalid_transition('registration_state', v_e.registration_state); end if;
      v_n.registration_state := 'PAUSED';
      v_action := 'EDITION_REGISTRATION_PAUSED';
    when 'RESUME_REGISTRATION' then
      if v_e.registration_state <> 'PAUSED' then perform private.cfg_invalid_transition('registration_state', v_e.registration_state); end if;
      v_readiness := private.registration_readiness(p_edition_id);
      v_n.registration_state := 'OPEN';
      v_action := 'EDITION_REGISTRATION_RESUMED';
    when 'CLOSE_REGISTRATION' then
      if v_e.registration_state not in ('NOT_OPEN', 'OPEN', 'PAUSED') then
        perform private.cfg_invalid_transition('registration_state', v_e.registration_state);
      end if;
      v_n.registration_state := 'CLOSED';
      v_action := 'EDITION_REGISTRATION_CLOSED';
    when 'POSTPONE' then
      if v_e.execution_state <> 'SCHEDULED' then perform private.cfg_invalid_transition('execution_state', v_e.execution_state); end if;
      v_n.execution_state := 'POSTPONED';
      -- Master §33: new registrations stop (PAUSE by default, or CLOSE) while the date is unknown.
      if private.cfg_enum(v_input, 'registration_action', false, array['PAUSE', 'CLOSE']) = 'CLOSE' then
        if v_e.registration_state <> 'CLOSED' then v_n.registration_state := 'CLOSED'; end if;
      elsif v_e.registration_state = 'OPEN' then
        v_n.registration_state := 'PAUSED';
      end if;
      v_revision_id := private.insert_schedule_revision(p_edition_id, jsonb_build_object('local_date', null), v_reason, v_staff_id);
      v_action := 'EDITION_POSTPONED';
      v_event := 'EditionPostponed';
    when 'RESCHEDULE' then
      if v_e.execution_state not in ('SCHEDULED', 'POSTPONED') then
        perform private.cfg_invalid_transition('execution_state', v_e.execution_state);
      end if;
      if v_e.execution_state = 'SCHEDULED'
         and private.current_schedule(p_edition_id) -> 'local_date' = v_schedule -> 'local_date'
         and private.current_schedule(p_edition_id) -> 'local_start_time' = v_schedule -> 'local_start_time'
         and private.current_schedule(p_edition_id) -> 'local_end_time' = v_schedule -> 'local_end_time' then
        perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'schedule_unchanged'));
      end if;
      v_n.execution_state := 'SCHEDULED';
      -- A moved date re-materialises the default close unless an explicit one is given.
      v_n.registration_close_at := coalesce(private.cfg_timestamptz(v_input, 'registration_close_at', false),
                                            private.default_registration_close_at(v_schedule, v_e.timezone));
      if v_n.registration_open_at is not null and v_n.registration_open_at >= v_n.registration_close_at then
        perform private.cfg_fail('registration_close_at', 'must_follow_open');
      end if;
      v_revision_id := private.insert_schedule_revision(p_edition_id, v_schedule, v_reason, v_staff_id);
      v_action := 'EDITION_RESCHEDULED';
      v_event := 'EditionRescheduled';
    when 'CANCEL' then
      if v_e.execution_state not in ('SCHEDULED', 'POSTPONED') then
        perform private.cfg_invalid_transition('execution_state', v_e.execution_state);
      end if;
      v_n.execution_state := 'CANCELED';
      v_n.registration_state := 'CLOSED';
      -- Master §33: pending capacity is released now; the page stays; no refund is processed here.
      with released as (
        update app.registration_hold h set status = 'RELEASED', released_at = now()
        from app.registration_request r
        where r.registration_request_id = h.registration_request_id and r.edition_id = p_edition_id and h.status = 'ACTIVE'
        returning 1)
      select count(*) into v_count from released;
      v_extra := v_extra || jsonb_build_object('released_holds', v_count);
      with released as (
        update app.registration_participant_claim c set status = 'RELEASED', resolved_at = now()
        where c.edition_id = p_edition_id and c.status = 'ACTIVE'
        returning 1)
      select count(*) into v_count from released;
      v_extra := v_extra || jsonb_build_object('released_claims', v_count);
      v_action := 'EDITION_CANCELED';
      v_event := 'EditionCanceled';
    when 'START' then
      if v_e.execution_state <> 'SCHEDULED' then perform private.cfg_invalid_transition('execution_state', v_e.execution_state); end if;
      if v_e.publication_state = 'DRAFT' then perform private.cfg_invalid_transition('publication_state', v_e.publication_state); end if;
      v_n.execution_state := 'IN_PROGRESS';
      v_action := 'EDITION_STARTED';
    when 'FINISH' then
      if v_e.execution_state not in ('SCHEDULED', 'IN_PROGRESS') then
        perform private.cfg_invalid_transition('execution_state', v_e.execution_state);
      end if;
      if v_e.publication_state = 'DRAFT' then perform private.cfg_invalid_transition('publication_state', v_e.publication_state); end if;
      v_n.execution_state := 'FINISHED';
      -- A finished race takes no registrations; closure starts pending (Master §32).
      v_n.registration_state := 'CLOSED';
      if v_e.closure_state = 'OPEN' then v_n.closure_state := 'PENDING'; end if;
      v_action := 'EDITION_FINISHED';
    else
      raise exception using errcode = 'invalid_parameter_value', message = 'unknown edition command';
  end case;

  if v_readiness is not null and not (v_readiness ->> 'ready')::boolean then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'not_ready',
      'readiness', case when p_command = 'PUBLISH' then 'publication' else 'registration' end,
      'failed_checks', (select jsonb_agg(c ->> 'code') from jsonb_array_elements(v_readiness -> 'checks') c
                        where not (c ->> 'ok')::boolean)));
  end if;

  update app.edition set publication_state = v_n.publication_state, registration_state = v_n.registration_state,
    execution_state = v_n.execution_state, closure_state = v_n.closure_state, published_at = v_n.published_at,
    registration_close_at = v_n.registration_close_at
  where edition_id = p_edition_id;

  perform private.audit(v_action, 'edition', p_edition_id, p_edition_id,
    jsonb_build_object('publication_state', v_e.publication_state, 'registration_state', v_e.registration_state,
      'execution_state', v_e.execution_state, 'closure_state', v_e.closure_state),
    jsonb_build_object('publication_state', v_n.publication_state, 'registration_state', v_n.registration_state,
      'execution_state', v_n.execution_state, 'closure_state', v_n.closure_state)
      || case when v_revision_id is not null then jsonb_build_object('edition_schedule_revision_id', v_revision_id) else '{}'::jsonb end
      || v_extra,
    v_reason);
  if v_event is not null then
    perform private.enqueue_outbox(v_event, 'Edition', p_edition_id,
      v_event || ':' || p_edition_id || coalesce(':' || v_revision_id, ''),
      jsonb_build_object('edition_id', p_edition_id)
        || case when v_revision_id is not null then jsonb_build_object('edition_schedule_revision_id', v_revision_id) else '{}'::jsonb end);
  end if;

  v_result := jsonb_build_object('edition', private.edition_projection(p_edition_id)) || v_extra;
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.publish_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'PUBLISH', p_input, p_idempotency_key) $$;
create or replace function private.hide_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'HIDE', p_input, p_idempotency_key) $$;
create or replace function private.open_edition_registration(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'OPEN_REGISTRATION', p_input, p_idempotency_key) $$;
create or replace function private.pause_edition_registration(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'PAUSE_REGISTRATION', p_input, p_idempotency_key) $$;
create or replace function private.resume_edition_registration(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'RESUME_REGISTRATION', p_input, p_idempotency_key) $$;
create or replace function private.close_edition_registration(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'CLOSE_REGISTRATION', p_input, p_idempotency_key) $$;
create or replace function private.postpone_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'POSTPONE', p_input, p_idempotency_key) $$;
create or replace function private.reschedule_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'RESCHEDULE', p_input, p_idempotency_key) $$;
create or replace function private.cancel_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'CANCEL', p_input, p_idempotency_key) $$;
create or replace function private.start_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'START', p_input, p_idempotency_key) $$;
create or replace function private.finish_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select private.cfg_edition_transition(p_edition_id, 'FINISH', p_input, p_idempotency_key) $$;

-- ---------------------------------------------------------------------------------------------
-- Public facades (security invoker, same signature/name, ADR-001 §2) and grants.
-- ---------------------------------------------------------------------------------------------

create or replace function public.create_event(p_input jsonb, p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_event(p_input, p_idempotency_key) $$;
create or replace function public.update_event(p_event_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_event(p_event_id, p_input) $$;
create or replace function public.create_edition(p_event_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_edition(p_event_id, p_input, p_idempotency_key) $$;
create or replace function public.update_edition(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_edition(p_edition_id, p_input) $$;
create or replace function public.set_edition_schedule(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.set_edition_schedule(p_edition_id, p_input) $$;
create or replace function public.publish_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.publish_edition(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.hide_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.hide_edition(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.open_edition_registration(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.open_edition_registration(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.pause_edition_registration(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.pause_edition_registration(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.resume_edition_registration(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.resume_edition_registration(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.close_edition_registration(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.close_edition_registration(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.postpone_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.postpone_edition(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.reschedule_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.reschedule_edition(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.cancel_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.cancel_edition(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.start_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.start_edition(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.finish_edition(p_edition_id uuid, p_input jsonb default '{}', p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.finish_edition(p_edition_id, p_input, p_idempotency_key) $$;

revoke all on function
  private.create_event(jsonb, text), public.create_event(jsonb, text),
  private.update_event(uuid, jsonb), public.update_event(uuid, jsonb),
  private.create_edition(uuid, jsonb, text), public.create_edition(uuid, jsonb, text),
  private.update_edition(uuid, jsonb), public.update_edition(uuid, jsonb),
  private.set_edition_schedule(uuid, jsonb), public.set_edition_schedule(uuid, jsonb),
  private.publish_edition(uuid, jsonb, text), public.publish_edition(uuid, jsonb, text),
  private.hide_edition(uuid, jsonb, text), public.hide_edition(uuid, jsonb, text),
  private.open_edition_registration(uuid, jsonb, text), public.open_edition_registration(uuid, jsonb, text),
  private.pause_edition_registration(uuid, jsonb, text), public.pause_edition_registration(uuid, jsonb, text),
  private.resume_edition_registration(uuid, jsonb, text), public.resume_edition_registration(uuid, jsonb, text),
  private.close_edition_registration(uuid, jsonb, text), public.close_edition_registration(uuid, jsonb, text),
  private.postpone_edition(uuid, jsonb, text), public.postpone_edition(uuid, jsonb, text),
  private.reschedule_edition(uuid, jsonb, text), public.reschedule_edition(uuid, jsonb, text),
  private.cancel_edition(uuid, jsonb, text), public.cancel_edition(uuid, jsonb, text),
  private.start_edition(uuid, jsonb, text), public.start_edition(uuid, jsonb, text),
  private.finish_edition(uuid, jsonb, text), public.finish_edition(uuid, jsonb, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.create_event(jsonb, text), public.create_event(jsonb, text),
  private.update_event(uuid, jsonb), public.update_event(uuid, jsonb),
  private.create_edition(uuid, jsonb, text), public.create_edition(uuid, jsonb, text),
  private.update_edition(uuid, jsonb), public.update_edition(uuid, jsonb),
  private.set_edition_schedule(uuid, jsonb), public.set_edition_schedule(uuid, jsonb),
  private.publish_edition(uuid, jsonb, text), public.publish_edition(uuid, jsonb, text),
  private.hide_edition(uuid, jsonb, text), public.hide_edition(uuid, jsonb, text),
  private.open_edition_registration(uuid, jsonb, text), public.open_edition_registration(uuid, jsonb, text),
  private.pause_edition_registration(uuid, jsonb, text), public.pause_edition_registration(uuid, jsonb, text),
  private.resume_edition_registration(uuid, jsonb, text), public.resume_edition_registration(uuid, jsonb, text),
  private.close_edition_registration(uuid, jsonb, text), public.close_edition_registration(uuid, jsonb, text),
  private.postpone_edition(uuid, jsonb, text), public.postpone_edition(uuid, jsonb, text),
  private.reschedule_edition(uuid, jsonb, text), public.reschedule_edition(uuid, jsonb, text),
  private.cancel_edition(uuid, jsonb, text), public.cancel_edition(uuid, jsonb, text),
  private.start_edition(uuid, jsonb, text), public.start_edition(uuid, jsonb, text),
  private.finish_edition(uuid, jsonb, text), public.finish_edition(uuid, jsonb, text)
to authenticated;
