-- T30 events kernel (Master §29-31, §35-38, §100, §123, §155): value sets, history protections, input
-- validation toolkit and the read-only capacity/price/schedule/readiness functions other domains call.
-- Contract: .salvaops-agent-evidence/T30-events-admin/KERNEL_READY.md (signatures change additively only).

-- ---------------------------------------------------------------------------------------------
-- Value sets for free-text columns this domain writes (additive).
-- ---------------------------------------------------------------------------------------------

alter table app.kit_definition drop constraint if exists kit_definition_status;
alter table app.kit_definition add constraint kit_definition_status check (status in ('ACTIVE', 'INACTIVE'));
alter table app.kit_variant drop constraint if exists kit_variant_status;
alter table app.kit_variant add constraint kit_variant_status check (status in ('ACTIVE', 'INACTIVE'));
alter table app.registration_form_field drop constraint if exists registration_form_field_sensitivity;
alter table app.registration_form_field
  add constraint registration_form_field_sensitivity check (sensitivity in ('NORMAL', 'SENSITIVE'));

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description)
values ('admin.mutation:cmd', 120, 60, 'ACTOR', 'Master §179 admin mutations per staff (successful commands)')
on conflict (scope) do nothing;

-- ---------------------------------------------------------------------------------------------
-- History protections (Master §41, §59, §123): published versions and slug redirects are facts.
-- ---------------------------------------------------------------------------------------------

create or replace function private.protect_versioned_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception using errcode = 'restrict_violation', message = 'only DRAFT versions can be deleted';
    end if;
    return old;
  end if;
  v_new := to_jsonb(new);
  -- DRAFT -> PUBLISHED -> SUPERSEDED only; nothing but the status moves once a version left DRAFT.
  if not (old.status = new.status
          or (old.status = 'DRAFT' and new.status = 'PUBLISHED')
          or (old.status = 'PUBLISHED' and new.status = 'SUPERSEDED')) then
    raise exception using errcode = 'restrict_violation', message = 'invalid version status transition';
  end if;
  if old.status <> 'DRAFT' and (v_new - 'status') is distinct from (v_old - 'status') then
    raise exception using errcode = 'restrict_violation', message = 'published versions are immutable';
  end if;
  return new;
end;
$$;

create or replace trigger protect_versioned_status before update or delete on app.registration_form
  for each row execute function private.protect_versioned_status();
create or replace trigger protect_versioned_status before update or delete on app.legal_document_version
  for each row execute function private.protect_versioned_status();

-- Fields are part of the form version: they change only while the form is DRAFT.
create or replace function private.protect_form_field()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from app.registration_form f
    where f.registration_form_id in (
      case when tg_op = 'INSERT' then null else old.registration_form_id end,
      case when tg_op = 'DELETE' then null else new.registration_form_id end)
      and f.status <> 'DRAFT') then
    raise exception using errcode = 'restrict_violation', message = 'fields of a published form are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace trigger protect_form_field before insert or update or delete on app.registration_form_field
  for each row execute function private.protect_form_field();

-- Redirect rows keep their source; only the target may be re-pointed (one-hop chains).
create or replace trigger append_only before update on app.edition_slug_history
  for each row execute function private.enforce_append_only('new_slug', 'changed_at');
create or replace trigger reject_delete before delete on app.edition_slug_history
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------------------------
-- Input validation toolkit for jsonb command inputs (A4: commands validate everything themselves).
-- Failures raise VALIDATION_ERROR with {field, reason}; field names come from the allowlist only.
-- ---------------------------------------------------------------------------------------------

create or replace function private.cfg_fail(p_field text, p_reason text, p_extra jsonb default '{}')
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.raise_domain_error('VALIDATION_ERROR',
    jsonb_build_object('field', p_field, 'reason', p_reason) || coalesce(p_extra, '{}'::jsonb));
end;
$$;

create or replace function private.cfg_object(p_input jsonb, p_allowed text[], p_field text default 'body')
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_unknown text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    perform private.cfg_fail(p_field, 'must_be_object');
  end if;
  select k into v_unknown from jsonb_object_keys(p_input) k where k <> all (p_allowed) order by k limit 1;
  if v_unknown is not null then
    -- Unknown keys are echoed only when they look like identifiers.
    perform private.cfg_fail(case when v_unknown ~ '^[a-z_][a-z0-9_]{0,63}$' then p_field || '.' || v_unknown else p_field end,
      'unknown_field');
  end if;
  return p_input;
end;
$$;

create or replace function private.cfg_present(p_input jsonb, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_input ? p_key and jsonb_typeof(p_input -> p_key) <> 'null'
$$;

create or replace function private.cfg_text(
  p_input jsonb, p_key text, p_required boolean, p_max integer, p_min integer default 1, p_field text default null)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_field text := coalesce(p_field, p_key);
  v_text text;
begin
  if not private.cfg_present(p_input, p_key) then
    if p_required then perform private.cfg_fail(v_field, 'required'); end if;
    return null;
  end if;
  if jsonb_typeof(p_input -> p_key) <> 'string' then
    perform private.cfg_fail(v_field, 'must_be_string');
  end if;
  v_text := btrim(p_input ->> p_key);
  if char_length(v_text) < p_min or char_length(v_text) > p_max then
    perform private.cfg_fail(v_field, 'invalid_length', jsonb_build_object('min', p_min, 'max', p_max));
  end if;
  if v_text ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    perform private.cfg_fail(v_field, 'control_characters');
  end if;
  return nullif(v_text, '');
end;
$$;

create or replace function private.cfg_enum(p_input jsonb, p_key text, p_required boolean, p_allowed text[], p_field text default null)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := private.cfg_text(p_input, p_key, p_required, 64, 1, p_field);
begin
  if v_value is not null and v_value <> all (p_allowed) then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_value');
  end if;
  return v_value;
end;
$$;

create or replace function private.cfg_numeric(
  p_input jsonb, p_key text, p_required boolean, p_min numeric, p_max numeric, p_integer boolean, p_field text default null)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_field text := coalesce(p_field, p_key);
  v_value numeric;
begin
  if not private.cfg_present(p_input, p_key) then
    if p_required then perform private.cfg_fail(v_field, 'required'); end if;
    return null;
  end if;
  if jsonb_typeof(p_input -> p_key) <> 'number' then
    perform private.cfg_fail(v_field, 'must_be_number');
  end if;
  v_value := (p_input ->> p_key)::numeric;
  if p_integer and v_value <> trunc(v_value) then
    perform private.cfg_fail(v_field, 'must_be_integer');
  end if;
  if (p_min is not null and v_value < p_min) or (p_max is not null and v_value > p_max) then
    perform private.cfg_fail(v_field, 'out_of_range', jsonb_build_object('min', p_min, 'max', p_max));
  end if;
  return v_value;
end;
$$;

create or replace function private.cfg_int(
  p_input jsonb, p_key text, p_required boolean, p_min integer, p_max integer, p_field text default null)
returns integer
language sql
immutable
set search_path = ''
as $$
  select private.cfg_numeric(p_input, p_key, p_required, p_min, p_max, true, p_field)::integer
$$;

create or replace function private.cfg_bool(p_input jsonb, p_key text, p_required boolean, p_field text default null)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not private.cfg_present(p_input, p_key) then
    if p_required then perform private.cfg_fail(coalesce(p_field, p_key), 'required'); end if;
    return null;
  end if;
  if jsonb_typeof(p_input -> p_key) <> 'boolean' then
    perform private.cfg_fail(coalesce(p_field, p_key), 'must_be_boolean');
  end if;
  return (p_input ->> p_key)::boolean;
end;
$$;

create or replace function private.cfg_uuid(p_input jsonb, p_key text, p_required boolean, p_field text default null)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := private.cfg_text(p_input, p_key, p_required, 36, 36, p_field);
begin
  if v_text is not null and v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_uuid');
  end if;
  return v_text::uuid;
end;
$$;

create or replace function private.cfg_date(p_input jsonb, p_key text, p_required boolean, p_field text default null)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := private.cfg_text(p_input, p_key, p_required, 10, 10, p_field);
begin
  if v_text is null then return null; end if;
  if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_date');
  end if;
  begin
    return v_text::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_date');
  end;
  return null;
end;
$$;

create or replace function private.cfg_time(p_input jsonb, p_key text, p_required boolean, p_field text default null)
returns time
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := private.cfg_text(p_input, p_key, p_required, 8, 5, p_field);
begin
  if v_text is not null and v_text !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_time');
  end if;
  return v_text::time;
end;
$$;

-- ISO 8601 with an explicit offset: a bare local timestamp would be read in the session zone.
create or replace function private.cfg_timestamptz(p_input jsonb, p_key text, p_required boolean, p_field text default null)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := private.cfg_text(p_input, p_key, p_required, 40, 16, p_field);
begin
  if v_text is null then return null; end if;
  if v_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_timestamp');
  end if;
  begin
    return v_text::timestamptz;
  exception when datetime_field_overflow or invalid_datetime_format then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_timestamp');
  end;
  return null;
end;
$$;

create or replace function private.cfg_e164(p_input jsonb, p_key text, p_required boolean, p_field text default null)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := private.cfg_text(p_input, p_key, p_required, 16, 9, p_field);
begin
  if v_text is not null and v_text !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_phone_e164');
  end if;
  return v_text;
end;
$$;

create or replace function private.cfg_slug(p_input jsonb, p_key text, p_required boolean, p_field text default null)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := private.cfg_text(p_input, p_key, p_required, 120, 3, p_field);
begin
  if v_text is not null and v_text !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_slug');
  end if;
  return v_text;
end;
$$;

-- Keys of modalities, categories, form fields, kit variants: short lowercase identifiers.
create or replace function private.cfg_key(p_input jsonb, p_key text, p_required boolean, p_field text default null)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := private.cfg_text(p_input, p_key, p_required, 64, 1, p_field);
begin
  if v_text is not null and v_text !~ '^[a-z0-9]+([_-][a-z0-9]+)*$' then
    perform private.cfg_fail(coalesce(p_field, p_key), 'invalid_key');
  end if;
  return v_text;
end;
$$;

-- SEC-061 write-side rules for markdown: no raw HTML, no markdown images (IMAGE blocks carry
-- media), link destinations only https:, mailto:, tel:, same-site relative or #anchors.
create or replace function private.cfg_markdown_error(p_markdown text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_destination text;
begin
  if p_markdown is null then return null; end if;
  if p_markdown ~ '<[A-Za-z/!?]' then return 'html_not_allowed'; end if;
  if p_markdown ~ '!\[' then return 'markdown_images_not_allowed'; end if;
  for v_destination in
    select btrim(m[1], '<> ') from regexp_matches(p_markdown, '\]\(\s*(<[^>]*>|[^\s)]*)', 'g') as m
    union all
    select btrim(m[1], '<> ') from regexp_matches(p_markdown, '(?:^|\n)[ ]{0,3}\[[^\]\n]+\]:[ \t]*(<[^>]*>|\S+)', 'g') as m
  loop
    if not private.is_allowed_link(v_destination) then
      return 'link_scheme_not_allowed';
    end if;
  end loop;
  return null;
end;
$$;

create or replace function private.is_allowed_link(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Relative links: one leading "/" (never "//" or "/\") or an #anchor, and no "&" so character
  -- references cannot decode into a scheme or a protocol-relative host.
  select coalesce(p_url, '') ~* '^(https://[^\s<>"\\]+|mailto:[^\s<>"\\]+|tel:\+?[0-9() .-]{3,32}|#[A-Za-z0-9_-]*|/([^/\\&\s<>"][^\\&\s<>"]*)?)$'
$$;

-- ---------------------------------------------------------------------------------------------
-- Eligibility rules schema v1 (Modality.eligibility_rules, Category.eligibility_rule).
-- {min_age?: 15..100, max_age?: 15..100 (>= min_age), sex_codes?: non-empty unique subset of F|M|X}
-- Ages are evaluated at sport_date by the registration domain; V1 admits 15+ (Master §19).
-- ---------------------------------------------------------------------------------------------

create or replace function private.cfg_eligibility_error(p_rules jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_min numeric;
  v_max numeric;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then return 'must_be_object'; end if;
  if exists (select 1 from jsonb_object_keys(p_rules) k where k not in ('min_age', 'max_age', 'sex_codes')) then
    return 'unknown_field';
  end if;
  if p_rules ? 'min_age' then
    if jsonb_typeof(p_rules -> 'min_age') <> 'number' then return 'invalid_min_age'; end if;
    v_min := (p_rules ->> 'min_age')::numeric;
    if v_min <> trunc(v_min) or v_min < 15 or v_min > 100 then return 'invalid_min_age'; end if;
  end if;
  if p_rules ? 'max_age' then
    if jsonb_typeof(p_rules -> 'max_age') <> 'number' then return 'invalid_max_age'; end if;
    v_max := (p_rules ->> 'max_age')::numeric;
    if v_max <> trunc(v_max) or v_max < 15 or v_max > 100 or v_max < coalesce(v_min, 15) then return 'invalid_max_age'; end if;
  end if;
  if p_rules ? 'sex_codes' then
    if jsonb_typeof(p_rules -> 'sex_codes') <> 'array' or jsonb_array_length(p_rules -> 'sex_codes') = 0
       or exists (select 1 from jsonb_array_elements(p_rules -> 'sex_codes') s where s not in ('"F"', '"M"', '"X"'))
       or (select count(distinct s) from jsonb_array_elements(p_rules -> 'sex_codes') s) <> jsonb_array_length(p_rules -> 'sex_codes') then
      return 'invalid_sex_codes';
    end if;
  end if;
  return null;
end;
$$;

create or replace function private.cfg_eligibility_rules(p_input jsonb, p_key text, p_field text default null)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_error text;
begin
  if not private.cfg_present(p_input, p_key) then return null; end if;
  v_error := private.cfg_eligibility_error(p_input -> p_key);
  if v_error is not null then perform private.cfg_fail(coalesce(p_field, p_key), v_error); end if;
  return p_input -> p_key;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Kernel: price (Master §38).
-- ---------------------------------------------------------------------------------------------

-- Deterministic selection at p_at: ACTIVE, window contains p_at, priority DESC, starts_at DESC NULLS
-- LAST, created_at DESC, price_offer_id ASC. NULL when nothing is selectable. Never infers FREE.
create or replace function private.resolve_price_offer(p_modality_id uuid, p_at timestamptz)
returns jsonb
language sql
stable
strict
security definer
set search_path = ''
as $$
  select jsonb_build_object('price_offer_id', po.price_offer_id, 'modality_id', po.modality_id, 'name', po.name,
    'amount_minor', po.amount_minor, 'currency', po.currency, 'starts_at', po.starts_at, 'ends_at', po.ends_at,
    'priority', po.priority)
  from app.price_offer po
  where po.modality_id = p_modality_id
    and po.status = 'ACTIVE'
    and (po.starts_at is null or po.starts_at <= p_at)
    and (po.ends_at is null or po.ends_at > p_at)
  order by po.priority desc, po.starts_at desc nulls last, po.created_at desc, po.price_offer_id asc
  limit 1
$$;

-- Price a participant would be charged: FREE editions snapshot 0 explicitly; EXTERNAL_WHATSAPP needs
-- a selectable offer (NULL = not priceable).
create or replace function private.resolve_modality_price(p_modality_id uuid, p_at timestamptz)
returns jsonb
language sql
stable
strict
security definer
set search_path = ''
as $$
  select case e.registration_mode
    when 'FREE' then jsonb_build_object('source', 'FREE', 'price_offer_id', null, 'modality_id', m.modality_id,
      'amount_minor', 0, 'currency', 'MXN')
    else private.resolve_price_offer(m.modality_id, p_at) || jsonb_build_object('source', 'PRICE_OFFER')
  end
  from app.modality m
  join app.edition e on e.edition_id = m.edition_id
  where m.modality_id = p_modality_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Kernel: schedule (Master §29, §100).
-- ---------------------------------------------------------------------------------------------

create or replace function private.current_schedule(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('edition_schedule_revision_id', r.edition_schedule_revision_id, 'revision', r.revision,
    'schedule_state', r.schedule_state, 'local_date', r.local_date, 'local_start_time', r.local_start_time,
    'local_end_time', r.local_end_time, 'timezone', r.timezone, 'effective_start_at', r.effective_start_at,
    'effective_end_at', r.effective_end_at, 'created_at', r.created_at)
  from app.edition_schedule_revision r
  where r.edition_id = p_edition_id and r.superseded_at is null
$$;

-- Sporting start: Modality.local_start_time, else the current revision's time, on the current local
-- date, in Edition.timezone. NULL without a known date (or for a Modality of another Edition);
-- start_at stays NULL while the time is pending (never 00:00).
create or replace function private.effective_start(p_edition_id uuid, p_modality_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('edition_id', e.edition_id, 'modality_id', m.modality_id,
    'local_date', r.local_date, 'local_start_time', t.start_time, 'timezone', e.timezone,
    'start_at', case when t.start_time is not null then (r.local_date + t.start_time) at time zone e.timezone end,
    'sport_date', r.local_date, 'time_source', t.source, 'schedule_state', r.schedule_state,
    'edition_schedule_revision_id', r.edition_schedule_revision_id)
  from app.edition e
  join app.edition_schedule_revision r on r.edition_id = e.edition_id and r.superseded_at is null
  left join app.modality m on m.modality_id = p_modality_id and m.edition_id = e.edition_id
  cross join lateral (
    select coalesce(m.local_start_time, r.local_start_time) as start_time,
           case when m.local_start_time is not null then 'MODALITY'
                when r.local_start_time is not null then 'EDITION' end as source) t
  where e.edition_id = p_edition_id
    and r.local_date is not null
    and (p_modality_id is null or m.modality_id is not null)
$$;

-- Internal reference for the default registration close (Master §155): the start, or the start of the
-- local day while the time is pending, so the deadline is conservative. Never shown as a race time.
create or replace function private.schedule_close_reference(p_local_date date, p_local_start_time time, p_timezone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_local_date + coalesce(p_local_start_time, time '00:00')) at time zone p_timezone
$$;

-- ---------------------------------------------------------------------------------------------
-- Kernel: availability (Master §35-37). Pure read: callers that mutate take the locks first
-- (edition row, then modality_capacity rows by modality_id) and call this inside that transaction.
-- ---------------------------------------------------------------------------------------------

create or replace function private.availability_state(
  p_available integer, p_confirmed_exhausts boolean, p_reference_capacity integer, p_low_percent numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_available is null then 'AVAILABLE'
    when p_available <= 0 then case when p_confirmed_exhausts then 'SOLD_OUT' else 'TEMPORARILY_UNAVAILABLE' end
    when p_low_percent is not null and p_reference_capacity is not null
         and p_available * 100 <= p_low_percent * p_reference_capacity then 'LOW'
    else 'AVAILABLE'
  end
$$;

create or replace function private.edition_availability(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with edition as (
    select e.edition_id, e.global_capacity from app.edition e where e.edition_id = p_edition_id
  ),
  settings as (
    select s.availability_low_threshold_percent as low_percent from app.platform_settings s where s.settings_id = 1
  ),
  modality as (
    select m.modality_id, m.status, m.sort_order, mc.effective_capacity,
      (select count(*) from app.registration r
       where r.modality_id = m.modality_id and r.status = 'CONFIRMED')::integer as confirmed,
      -- Effective holds: expires_at governs even before the expiry worker materialises the status.
      (select coalesce(sum(h.quantity), 0) from app.registration_hold h
       where h.modality_id = m.modality_id and h.status = 'ACTIVE' and h.expires_at > now())::integer as active_holds
    from app.modality m
    join edition on edition.edition_id = m.edition_id
    left join app.modality_capacity mc on mc.modality_id = m.modality_id
  ),
  totals as (
    select edition.global_capacity as capacity,
      coalesce((select sum(confirmed) from modality), 0)::integer as confirmed,
      coalesce((select sum(active_holds) from modality), 0)::integer as active_holds
    from edition
  ),
  global_view as (
    select g.*,
      case when g.capacity is not null then greatest(g.capacity - g.confirmed - g.active_holds, 0) end as available,
      g.capacity is not null and g.confirmed >= g.capacity as confirmed_exhausts
    from totals g
  ),
  modality_view as (
    select m.*,
      case when m.effective_capacity is not null
           then greatest(m.effective_capacity - m.confirmed - m.active_holds, 0) end as own_available,
      m.effective_capacity is not null and m.confirmed >= m.effective_capacity as confirmed_exhausts
    from modality m
  )
  select jsonb_build_object(
    'edition_id', p_edition_id,
    'global', jsonb_build_object('capacity', gv.capacity, 'confirmed', gv.confirmed, 'active_holds', gv.active_holds,
      'available', gv.available,
      'state', private.availability_state(gv.available, gv.confirmed_exhausts, gv.capacity, s.low_percent)),
    'modalities', coalesce((
      select jsonb_agg(jsonb_build_object('modality_id', mv.modality_id, 'status', mv.status,
          'effective_capacity', mv.effective_capacity, 'confirmed', mv.confirmed, 'active_holds', mv.active_holds,
          'available', least(mv.own_available, gv.available),
          'state', private.availability_state(least(mv.own_available, gv.available),
            mv.confirmed_exhausts or gv.confirmed_exhausts,
            -- LOW is measured against whichever limit binds.
            case when mv.own_available is not null and (gv.available is null or mv.own_available <= gv.available)
                 then mv.effective_capacity else gv.capacity end,
            s.low_percent))
        order by mv.sort_order, mv.modality_id)
      from modality_view mv), '[]'::jsonb))
  from global_view gv
  left join settings s on true
$$;

-- Public states only (no counts) for PUBLISHED Editions; NULL otherwise. Canceled modalities omitted.
create or replace function private.get_edition_availability(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('edition_id', e.edition_id, 'registration_state', e.registration_state,
    'execution_state', e.execution_state, 'global_state', a -> 'global' ->> 'state',
    'modalities', coalesce((
      select jsonb_agg(jsonb_build_object('modality_id', x ->> 'modality_id', 'status', x ->> 'status', 'state', x ->> 'state')
        order by t.ord)
      from jsonb_array_elements(a -> 'modalities') with ordinality t(x, ord)
      where x ->> 'status' <> 'CANCELED'), '[]'::jsonb))
  from app.edition e
  cross join lateral private.edition_availability(e.edition_id) as av(a)
  where e.edition_id = p_edition_id and e.publication_state = 'PUBLISHED'
$$;

create or replace function public.get_edition_availability(p_edition_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_edition_availability(p_edition_id)
$$;

-- ---------------------------------------------------------------------------------------------
-- Kernel: legal requirements, WhatsApp and readiness (Master §30-31, §123, ADR A14).
-- ---------------------------------------------------------------------------------------------

-- EVENT_RULES documents are bound to one Edition through a derived key (no extra link table).
create or replace function private.edition_rules_document_key(p_edition_id uuid)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'EVENT_RULES_' || upper(replace(p_edition_id::text, '-', ''))
$$;

create or replace function private.current_legal_version(p_legal_document_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('legal_document_version_id', v.legal_document_version_id, 'version', v.version,
    'published_at', v.published_at)
  from app.legal_document_version v
  where v.legal_document_id = p_legal_document_id and v.status = 'PUBLISHED'
  order by v.version desc
  limit 1
$$;

-- Documents a registration in this Edition needs accepted: every ACTIVE SPORT_WAIVER (applies_to
-- ALL), MINOR_TERMS (applies_to MINOR, participants 15-17) and the Edition's own EVENT_RULES document
-- if it exists (ALL). current_version is NULL when nothing is published yet.
create or replace function private.edition_required_legal_documents(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('legal_document_id', d.legal_document_id, 'document_key', d.document_key,
      'document_type', d.document_type,
      'applies_to', case when d.document_type = 'MINOR_TERMS' then 'MINOR' else 'ALL' end,
      'current_version', private.current_legal_version(d.legal_document_id))
    order by d.document_type, d.document_key), '[]'::jsonb)
  from app.legal_document d
  where d.status = 'ACTIVE'
    and exists (select 1 from app.edition e where e.edition_id = p_edition_id)
    and (d.document_type in ('SPORT_WAIVER', 'MINOR_TERMS')
         or (d.document_type = 'EVENT_RULES' and d.document_key = private.edition_rules_document_key(p_edition_id)))
$$;

-- Edition number wins over the platform default; NULL means not configured (ADR A14).
create or replace function private.effective_whatsapp(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('phone_e164', coalesce(e.whatsapp_phone_e164, s.default_whatsapp_phone_e164),
    'source', case when e.whatsapp_phone_e164 is not null then 'EDITION'
                   when s.default_whatsapp_phone_e164 is not null then 'PLATFORM' end)
  from app.edition e
  left join app.platform_settings s on s.settings_id = 1
  where e.edition_id = p_edition_id
$$;

create or replace function private.readiness_check(p_code text, p_ok boolean, p_detail jsonb default '{}')
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(jsonb_build_object('code', p_code, 'ok', coalesce(p_ok, false),
    'detail', coalesce(p_detail, '{}'::jsonb)))
$$;

create or replace function private.readiness_result(p_checks jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ready', not exists (select 1 from jsonb_array_elements(p_checks) c where not (c ->> 'ok')::boolean),
    'checks', p_checks)
$$;

-- Master §30. Minimum description: a PUBLISHED RICH_TEXT/CUSTOM_SECTION block with >= 30 characters.
create or replace function private.publication_readiness(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e app.edition%rowtype;
  v_schedule jsonb := private.current_schedule(p_edition_id);
  v_checks jsonb := '[]'::jsonb;
  v_has_media boolean;
begin
  select * into v_e from app.edition e where e.edition_id = p_edition_id;
  if not found then return null; end if;

  v_checks := v_checks
    || private.readiness_check('EVENT_ACTIVE',
         exists (select 1 from app.event ev where ev.event_id = v_e.event_id and ev.status = 'ACTIVE'))
    || private.readiness_check('EVENT_TYPE_ACTIVE',
         exists (select 1 from app.event ev join app.event_type et on et.event_type_id = ev.event_type_id
                 where ev.event_id = v_e.event_id and et.active))
    || private.readiness_check('SLUG_VALID', v_e.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    || private.readiness_check('TIMEZONE_VALID', private.is_iana_timezone(v_e.timezone))
    || private.readiness_check('CITY_PRESENT', btrim(v_e.city) <> '' and btrim(v_e.state_region) <> '')
    || private.readiness_check('DATE_KNOWN',
         v_schedule ->> 'local_date' is not null
         or (v_e.execution_state = 'POSTPONED' and v_schedule ->> 'schedule_state' = 'POSTPONED_NO_NEW_DATE'),
         jsonb_build_object('schedule_state', v_schedule ->> 'schedule_state'))
    || private.readiness_check('MODALITY_PRESENT',
         exists (select 1 from app.modality m where m.edition_id = p_edition_id and m.status <> 'CANCELED'));

  v_has_media := exists (select 1 from app.event_media_asset a where a.edition_id = p_edition_id and a.status = 'PUBLISHED');
  v_checks := v_checks
    -- The platform fallback image always exists, so this informs rather than blocks.
    || private.readiness_check('MAIN_IMAGE', true,
         jsonb_build_object('source', case when v_has_media then 'MEDIA' else 'FALLBACK' end))
    || private.readiness_check('DESCRIPTION_PRESENT',
         exists (select 1 from app.event_content_block b
                 where b.edition_id = p_edition_id and b.status = 'PUBLISHED'
                   and b.block_type in ('RICH_TEXT', 'CUSTOM_SECTION')
                   and char_length(btrim(coalesce(b.payload ->> 'markdown', ''))) >= 30),
         jsonb_build_object('min_length', 30))
    || private.readiness_check('STATES_COHERENT',
         v_e.execution_state in ('SCHEDULED', 'POSTPONED') and v_e.closure_state = 'OPEN'
         and (v_e.publication_state <> 'DRAFT' or v_e.registration_state in ('NOT_OPEN', 'CLOSED')),
         jsonb_build_object('publication_state', v_e.publication_state, 'registration_state', v_e.registration_state,
           'execution_state', v_e.execution_state, 'closure_state', v_e.closure_state));

  return private.readiness_result(v_checks);
end;
$$;

-- Master §31, evaluated at now(). Detail lists the offending ids/keys so the editor can link to them.
create or replace function private.registration_readiness(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e app.edition%rowtype;
  v_schedule jsonb := private.current_schedule(p_edition_id);
  v_whatsapp jsonb := private.effective_whatsapp(p_edition_id);
  v_checks jsonb := '[]'::jsonb;
  v_active uuid[];
  v_missing jsonb;
  v_admits_minors boolean;
begin
  select * into v_e from app.edition e where e.edition_id = p_edition_id;
  if not found then return null; end if;

  select coalesce(array_agg(m.modality_id order by m.sort_order, m.modality_id), '{}') into v_active
  from app.modality m where m.edition_id = p_edition_id and m.status = 'ACTIVE';

  v_checks := v_checks
    || private.readiness_check('EDITION_PUBLISHED', v_e.publication_state = 'PUBLISHED')
    || private.readiness_check('EXECUTION_SCHEDULED', v_e.execution_state = 'SCHEDULED')
    || private.readiness_check('SCHEDULE_DATE_VALID',
         (v_schedule ->> 'local_date')::date >= (now() at time zone v_e.timezone)::date)
    || private.readiness_check('REGISTRATION_OPEN_AT_REACHED', v_e.registration_open_at is null or v_e.registration_open_at <= now())
    || private.readiness_check('REGISTRATION_CLOSE_AT_FUTURE', v_e.registration_close_at > now())
    || private.readiness_check('ACTIVE_MODALITY', cardinality(v_active) > 0);

  select coalesce(jsonb_agg(m.modality_id), '[]') into v_missing
  from app.modality m
  where m.modality_id = any (v_active) and m.generates_distance_credit and coalesce(m.official_distance_m, 0) <= 0;
  v_checks := v_checks || private.readiness_check('OFFICIAL_DISTANCE_FOR_CREDIT', v_missing = '[]', jsonb_build_object('modality_ids', v_missing));

  select coalesce(jsonb_agg(x.id), '[]') into v_missing
  from unnest(v_active) x(id)
  where not exists (select 1 from app.modality_capacity mc where mc.modality_id = x.id);
  v_checks := v_checks || private.readiness_check('CAPACITY_VALID', v_missing = '[]', jsonb_build_object('modality_ids', v_missing));

  select coalesce(jsonb_agg(x.id), '[]') into v_missing
  from unnest(v_active) x(id)
  where private.resolve_modality_price(x.id, now()) is null;
  v_checks := v_checks || private.readiness_check('PRICE_VALID', v_missing = '[]',
    jsonb_build_object('registration_mode', v_e.registration_mode, 'modality_ids', v_missing));

  select coalesce(jsonb_agg(x.id), '[]') into v_missing
  from (
    select m.modality_id as id from app.modality m
    where m.modality_id = any (v_active) and private.cfg_eligibility_error(m.eligibility_rules) is not null
    union all
    select c.category_id from app.category c
    where c.edition_id = p_edition_id and c.active and private.cfg_eligibility_error(c.eligibility_rule) is not null) x;
  v_checks := v_checks || private.readiness_check('ELIGIBILITY_RULES_VALID', v_missing = '[]', jsonb_build_object('ids', v_missing));

  select coalesce(jsonb_agg(x.id), '[]') into v_missing
  from unnest(v_active) x(id)
  where not exists (
    select 1 from app.registration_form f
    where f.edition_id = p_edition_id and f.status = 'PUBLISHED' and (f.modality_id is null or f.modality_id = x.id));
  v_checks := v_checks || private.readiness_check('FORM_PUBLISHED', v_missing = '[]', jsonb_build_object('modality_ids', v_missing));

  v_checks := v_checks || private.readiness_check('WHATSAPP_CONFIGURED',
    v_e.registration_mode <> 'EXTERNAL_WHATSAPP' or v_whatsapp ->> 'phone_e164' is not null,
    jsonb_build_object('required', v_e.registration_mode = 'EXTERNAL_WHATSAPP', 'source', v_whatsapp ->> 'source'));

  v_admits_minors := exists (
    select 1 from app.modality m
    where m.modality_id = any (v_active) and coalesce((m.eligibility_rules ->> 'min_age')::numeric, 15) < 18);
  -- Platform pages (terms, privacy) must be published too, besides what registrants accept.
  select coalesce(jsonb_agg(distinct t.document_type order by t.document_type), '[]') into v_missing
  from (
    select req.document_type
    from unnest(array['TERMS_OF_SERVICE', 'PRIVACY_NOTICE', 'SPORT_WAIVER', 'MINOR_TERMS']) req(document_type)
    where (req.document_type <> 'MINOR_TERMS' or v_admits_minors)
      and not exists (
        select 1 from app.legal_document d
        where d.document_type = req.document_type and d.status = 'ACTIVE'
          and private.current_legal_version(d.legal_document_id) is not null)
    union all
    select d ->> 'document_type'
    from jsonb_array_elements(private.edition_required_legal_documents(p_edition_id)) d
    where d -> 'current_version' = 'null'::jsonb and (d ->> 'applies_to' = 'ALL' or v_admits_minors)) t;
  v_checks := v_checks || private.readiness_check('LEGAL_DOCUMENTS_PUBLISHED', v_missing = '[]',
    jsonb_build_object('missing_document_types', v_missing, 'minors_admitted', v_admits_minors));

  return private.readiness_result(v_checks);
end;
$$;

-- Master §59: resolves a public slug, following one-hop redirect rows (slug history).
create or replace function private.resolve_edition_slug(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('edition_id', e.edition_id, 'slug', e.slug, 'redirect', false)
     from app.edition e where e.slug = p_slug),
    (select jsonb_build_object('edition_id', e.edition_id, 'slug', e.slug, 'redirect', true)
     from app.edition_slug_history h join app.edition e on e.edition_id = h.edition_id
     where h.old_slug = p_slug))
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: kernel functions are internal (callers are definer commands); only the availability
-- read facade is public.
-- ---------------------------------------------------------------------------------------------

revoke all on function
  private.protect_versioned_status(),
  private.protect_form_field(),
  private.cfg_fail(text, text, jsonb),
  private.cfg_object(jsonb, text[], text),
  private.cfg_present(jsonb, text),
  private.cfg_text(jsonb, text, boolean, integer, integer, text),
  private.cfg_enum(jsonb, text, boolean, text[], text),
  private.cfg_numeric(jsonb, text, boolean, numeric, numeric, boolean, text),
  private.cfg_int(jsonb, text, boolean, integer, integer, text),
  private.cfg_bool(jsonb, text, boolean, text),
  private.cfg_uuid(jsonb, text, boolean, text),
  private.cfg_date(jsonb, text, boolean, text),
  private.cfg_time(jsonb, text, boolean, text),
  private.cfg_timestamptz(jsonb, text, boolean, text),
  private.cfg_e164(jsonb, text, boolean, text),
  private.cfg_slug(jsonb, text, boolean, text),
  private.cfg_key(jsonb, text, boolean, text),
  private.cfg_markdown_error(text),
  private.is_allowed_link(text),
  private.cfg_eligibility_error(jsonb),
  private.cfg_eligibility_rules(jsonb, text, text),
  private.resolve_price_offer(uuid, timestamptz),
  private.resolve_modality_price(uuid, timestamptz),
  private.current_schedule(uuid),
  private.effective_start(uuid, uuid),
  private.schedule_close_reference(date, time, text),
  private.availability_state(integer, boolean, integer, numeric),
  private.edition_availability(uuid),
  private.get_edition_availability(uuid),
  public.get_edition_availability(uuid),
  private.edition_rules_document_key(uuid),
  private.current_legal_version(uuid),
  private.edition_required_legal_documents(uuid),
  private.effective_whatsapp(uuid),
  private.readiness_check(text, boolean, jsonb),
  private.readiness_result(jsonb),
  private.publication_readiness(uuid),
  private.registration_readiness(uuid),
  private.resolve_edition_slug(text)
from public, anon, authenticated, service_role;

grant execute on function private.get_edition_availability(uuid), public.get_edition_availability(uuid)
  to anon, authenticated;
