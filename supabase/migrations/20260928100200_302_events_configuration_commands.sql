-- T30 Edition configuration commands (Master §34-44, §51, §86): modalities, capacity, prices,
-- categories, versioned forms, locations, agenda, content blocks and kits. Each resolves the Edition
-- from the target row (SEC-020), locks the Edition row first (ADR-001 §3) and audits the change.

-- ---------------------------------------------------------------------------------------------
-- Projections.
-- ---------------------------------------------------------------------------------------------

create or replace function private.modality_projection(p_modality_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('modality_id', m.modality_id, 'edition_id', m.edition_id, 'key', m.key, 'name', m.name,
    'official_distance_m', m.official_distance_m, 'generates_distance_credit', m.generates_distance_credit,
    'local_start_time', m.local_start_time, 'status', m.status, 'sort_order', m.sort_order,
    'eligibility_rule_version', m.eligibility_rule_version, 'eligibility_rules', m.eligibility_rules,
    'effective_capacity', mc.effective_capacity,
    'category_ids', coalesce((select jsonb_agg(mcat.category_id order by mcat.category_id)
                              from app.modality_category mcat where mcat.modality_id = m.modality_id), '[]'::jsonb),
    'created_at', m.created_at, 'updated_at', m.updated_at)
  from app.modality m
  left join app.modality_capacity mc on mc.modality_id = m.modality_id
  where m.modality_id = p_modality_id
$$;

create or replace function private.price_offer_projection(p_price_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('price_offer_id', po.price_offer_id, 'modality_id', po.modality_id, 'name', po.name,
    'amount_minor', po.amount_minor, 'currency', po.currency, 'starts_at', po.starts_at, 'ends_at', po.ends_at,
    'status', po.status, 'priority', po.priority, 'created_at', po.created_at, 'updated_at', po.updated_at)
  from app.price_offer po
  where po.price_offer_id = p_price_offer_id
$$;

create or replace function private.category_projection(p_category_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('category_id', c.category_id, 'edition_id', c.edition_id, 'key', c.key, 'name', c.name,
    'assignment_mode', c.assignment_mode, 'eligibility_rule', c.eligibility_rule, 'active', c.active,
    'sort_order', c.sort_order,
    'modality_ids', coalesce((select jsonb_agg(mc.modality_id order by mc.modality_id)
                              from app.modality_category mc where mc.category_id = c.category_id), '[]'::jsonb))
  from app.category c
  where c.category_id = p_category_id
$$;

create or replace function private.registration_form_projection(p_registration_form_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('registration_form_id', f.registration_form_id, 'edition_id', f.edition_id,
    'modality_id', f.modality_id, 'version', f.version, 'status', f.status, 'created_at', f.created_at,
    'published_at', f.published_at,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('registration_form_field_id', ff.registration_form_field_id,
          'field_key', ff.field_key, 'label', ff.label, 'field_type', ff.field_type, 'required', ff.required,
          'validation_config', ff.validation_config, 'options_config', ff.options_config,
          'sensitivity', ff.sensitivity, 'sort_order', ff.sort_order) order by ff.sort_order, ff.field_key)
      from app.registration_form_field ff where ff.registration_form_id = f.registration_form_id), '[]'::jsonb))
  from app.registration_form f
  where f.registration_form_id = p_registration_form_id
$$;

create or replace function private.location_projection(p_location_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('edition_location_id', l.edition_location_id, 'edition_id', l.edition_id,
    'location_type', l.location_type, 'name', l.name, 'address_line', l.address_line, 'city', l.city,
    'state_region', l.state_region, 'country_code', l.country_code,
    'latitude', extensions.st_y(l.geometry::extensions.geometry),
    'longitude', extensions.st_x(l.geometry::extensions.geometry),
    'is_primary', l.is_primary, 'sort_order', l.sort_order)
  from app.edition_location l
  where l.edition_location_id = p_location_id
$$;

create or replace function private.schedule_item_projection(p_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('edition_schedule_item_id', i.edition_schedule_item_id, 'edition_id', i.edition_id,
    'modality_id', i.modality_id, 'title', i.title, 'description', i.description, 'local_date', i.local_date,
    'local_start_time', i.local_start_time, 'local_end_time', i.local_end_time, 'location_id', i.location_id,
    'sort_order', i.sort_order, 'status', i.status)
  from app.edition_schedule_item i
  where i.edition_schedule_item_id = p_item_id
$$;

create or replace function private.content_block_projection(p_block_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('event_content_block_id', b.event_content_block_id, 'edition_id', b.edition_id,
    'modality_id', b.modality_id, 'block_type', b.block_type, 'position', b.position, 'status', b.status,
    'payload', b.payload, 'created_at', b.created_at, 'updated_at', b.updated_at)
  from app.event_content_block b
  where b.event_content_block_id = p_block_id
$$;

create or replace function private.kit_projection(p_kit_definition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('kit_definition_id', k.kit_definition_id, 'edition_id', k.edition_id, 'name', k.name,
    'status', k.status, 'pickup_start_at', k.pickup_start_at, 'pickup_end_at', k.pickup_end_at,
    'instructions', k.instructions,
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object('kit_variant_id', v.kit_variant_id, 'variant_key', v.variant_key,
          'label', v.label, 'capacity', v.capacity, 'status', v.status,
          'allocated', (select count(*) from app.kit_allocation a
                        where a.kit_variant_id = v.kit_variant_id and a.status <> 'CANCELED')) order by v.created_at, v.variant_key)
      from app.kit_variant v where v.kit_definition_id = k.kit_definition_id), '[]'::jsonb))
  from app.kit_definition k
  where k.kit_definition_id = p_kit_definition_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Modalities (Master §34).
-- ---------------------------------------------------------------------------------------------

-- A credit-generating modality that can take registrations needs an official distance (Master §34, §161.6).
create or replace function private.cfg_assert_distance(p_edition_id uuid, p_status text, p_generates boolean, p_distance integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status = 'ACTIVE' and p_generates and coalesce(p_distance, 0) <= 0
     and exists (select 1 from app.edition e where e.edition_id = p_edition_id and e.registration_state in ('OPEN', 'PAUSED')) then
    perform private.cfg_fail('official_distance_m', 'required_for_distance_credit');
  end if;
end;
$$;

create or replace function private.create_modality(p_edition_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_input jsonb;
  v_default_credit boolean;
  v_generates boolean;
  v_distance integer;
  v_capacity integer;
  v_idem jsonb;
  v_modality_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  select et.default_generates_distance_credit into v_default_credit
  from app.edition e join app.event ev on ev.event_id = e.event_id join app.event_type et on et.event_type_id = ev.event_type_id
  where e.edition_id = p_edition_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('MODALITY_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['key', 'name', 'official_distance_m', 'generates_distance_credit',
    'local_start_time', 'sort_order', 'eligibility_rules', 'effective_capacity']);
  v_generates := coalesce(private.cfg_bool(v_input, 'generates_distance_credit', false), v_default_credit);
  v_distance := private.cfg_int(v_input, 'official_distance_m', false, 1, 1000000);
  v_capacity := private.cfg_int(v_input, 'effective_capacity', false, 0, 1000000);

  v_idem := private.cfg_idempotency_begin('modality.create', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  perform private.cfg_assert_configurable(p_edition_id);
  perform private.cfg_assert_distance(p_edition_id, 'ACTIVE', v_generates, v_distance);

  insert into app.modality (edition_id, key, name, official_distance_m, generates_distance_credit, local_start_time,
    sort_order, eligibility_rules)
  values (p_edition_id, private.cfg_key(v_input, 'key', true), private.cfg_text(v_input, 'name', true, 120), v_distance,
    v_generates, private.cfg_time(v_input, 'local_start_time', false),
    coalesce(private.cfg_int(v_input, 'sort_order', false, 0, 10000),
             (select coalesce(max(m.sort_order), 0) + 1 from app.modality m where m.edition_id = p_edition_id)),
    coalesce(private.cfg_eligibility_rules(v_input, 'eligibility_rules'), '{}'::jsonb))
  returning modality_id into v_modality_id;

  if v_capacity is not null then
    insert into app.modality_capacity (modality_id, effective_capacity, updated_by_staff_id)
    values (v_modality_id, v_capacity, v_staff_id);
  end if;

  v_result := private.modality_projection(v_modality_id);
  perform private.audit('MODALITY_CREATED', 'modality', v_modality_id, p_edition_id, null,
    v_result - array['created_at', 'updated_at']);
  if v_capacity is not null then
    perform private.enqueue_outbox('CapacityChanged', 'Modality', v_modality_id,
      'CapacityChanged:' || v_modality_id || ':created',
      jsonb_build_object('edition_id', p_edition_id, 'modality_id', v_modality_id));
  end if;
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- Configuration fields only; status moves through set_modality_status.
create or replace function private.update_modality(p_modality_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_m app.modality%rowtype;
  v_n app.modality%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_constraint text;
begin
  select m.edition_id into v_edition_id from app.modality m where m.modality_id = p_modality_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('MODALITY_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['key', 'name', 'official_distance_m', 'generates_distance_credit',
    'local_start_time', 'sort_order', 'eligibility_rules']);

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform private.cfg_assert_configurable(v_edition_id);
  select * into v_m from app.modality m where m.modality_id = p_modality_id for update;
  v_n := v_m;
  if v_input ? 'key' then v_n.key := private.cfg_key(v_input, 'key', true); end if;
  if v_input ? 'name' then v_n.name := private.cfg_text(v_input, 'name', true, 120); end if;
  if v_input ? 'official_distance_m' then v_n.official_distance_m := private.cfg_int(v_input, 'official_distance_m', false, 1, 1000000); end if;
  if v_input ? 'generates_distance_credit' then v_n.generates_distance_credit := private.cfg_bool(v_input, 'generates_distance_credit', true); end if;
  if v_input ? 'local_start_time' then v_n.local_start_time := private.cfg_time(v_input, 'local_start_time', false); end if;
  if v_input ? 'sort_order' then v_n.sort_order := private.cfg_int(v_input, 'sort_order', true, 0, 10000); end if;
  if v_input ? 'eligibility_rules' then
    v_n.eligibility_rules := coalesce(private.cfg_eligibility_rules(v_input, 'eligibility_rules'), '{}'::jsonb);
    if v_n.eligibility_rules is distinct from v_m.eligibility_rules then
      v_n.eligibility_rule_version := v_m.eligibility_rule_version + 1;
    end if;
  end if;
  if v_n.key <> v_m.key and exists (select 1 from app.registration_request_participant p where p.modality_id = p_modality_id) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('field', 'key', 'reason', 'modality_in_use'));
  end if;
  perform private.cfg_assert_distance(v_edition_id, v_n.status, v_n.generates_distance_credit, v_n.official_distance_m);

  update app.modality set key = v_n.key, name = v_n.name, official_distance_m = v_n.official_distance_m,
    generates_distance_credit = v_n.generates_distance_credit, local_start_time = v_n.local_start_time,
    sort_order = v_n.sort_order, eligibility_rules = v_n.eligibility_rules,
    eligibility_rule_version = v_n.eligibility_rule_version
  where modality_id = p_modality_id;

  select jsonb_object_agg(k, to_jsonb(v_m) -> k), jsonb_object_agg(k, to_jsonb(v_n) -> k) into v_before, v_after
  from jsonb_object_keys(v_input) k where to_jsonb(v_m) -> k is distinct from to_jsonb(v_n) -> k;
  if v_after is not null then
    perform private.audit('MODALITY_UPDATED', 'modality', p_modality_id, v_edition_id, v_before, v_after);
  end if;
  return private.modality_projection(p_modality_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ACTIVE <-> CLOSED, ACTIVE|CLOSED -> CANCELED (terminal). Existing Registrations are never touched;
-- the response warns about them.
create or replace function private.set_modality_status(p_modality_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_status text;
  v_reason text;
  v_m app.modality%rowtype;
  v_confirmed integer;
  v_holds integer;
  v_warnings jsonb := '[]'::jsonb;
  v_constraint text;
begin
  select m.edition_id into v_edition_id from app.modality m where m.modality_id = p_modality_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('MODALITY_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['status', 'reason']);
  v_status := private.cfg_enum(v_input, 'status', true, array['ACTIVE', 'CLOSED', 'CANCELED']);
  v_reason := private.cfg_text(v_input, 'reason', v_status = 'CANCELED', 500);

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform private.cfg_assert_configurable(v_edition_id);
  select * into v_m from app.modality m where m.modality_id = p_modality_id for update;
  if v_m.status = v_status then
    return jsonb_build_object('modality', private.modality_projection(p_modality_id), 'warnings', v_warnings);
  end if;
  if v_m.status = 'CANCELED' then perform private.cfg_invalid_transition('status', v_m.status); end if;
  if v_status = 'ACTIVE' then
    perform private.cfg_assert_distance(v_edition_id, 'ACTIVE', v_m.generates_distance_credit, v_m.official_distance_m);
  end if;

  select count(*) into v_confirmed from app.registration r where r.modality_id = p_modality_id and r.status = 'CONFIRMED';
  select coalesce(sum(h.quantity), 0) into v_holds from app.registration_hold h
  where h.modality_id = p_modality_id and h.status = 'ACTIVE' and h.expires_at > now();
  if v_status <> 'ACTIVE' and (v_confirmed > 0 or v_holds > 0) then
    v_warnings := v_warnings || jsonb_build_object('code', 'MODALITY_HAS_PARTICIPANTS', 'confirmed', v_confirmed, 'active_holds', v_holds);
  end if;

  update app.modality set status = v_status where modality_id = p_modality_id;
  perform private.audit('MODALITY_STATUS_CHANGED', 'modality', p_modality_id, v_edition_id,
    jsonb_build_object('status', v_m.status), jsonb_build_object('status', v_status), v_reason);
  return jsonb_build_object('modality', private.modality_projection(p_modality_id), 'warnings', v_warnings);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- Draft Editions only: a published modality is closed or canceled instead.
create or replace function private.delete_modality(p_modality_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
begin
  select m.edition_id into v_edition_id from app.modality m where m.modality_id = p_modality_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('MODALITY_MANAGE', v_edition_id);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  if exists (select 1 from app.edition e where e.edition_id = v_edition_id and e.publication_state <> 'DRAFT') then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'edition_not_draft'));
  end if;
  begin
    delete from app.modality_category mc where mc.modality_id = p_modality_id;
    delete from app.modality_capacity mc where mc.modality_id = p_modality_id;
    delete from app.price_offer po where po.modality_id = p_modality_id;
    delete from app.modality m where m.modality_id = p_modality_id;
  exception when foreign_key_violation or restrict_violation then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'in_use'));
  end;
  perform private.audit('MODALITY_DELETED', 'modality', p_modality_id, v_edition_id);
  return jsonb_build_object('modality_id', p_modality_id, 'deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Capacity (Master §35-37). Lowering below current occupation needs an explicit acknowledgement
-- and never touches existing Registrations or holds; availability simply reports 0.
-- ---------------------------------------------------------------------------------------------

create or replace function private.set_modality_capacity(p_modality_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_input jsonb;
  v_capacity integer;
  v_ack boolean;
  v_previous integer;
  v_occupation jsonb;
  v_occupied integer;
  v_warnings jsonb := '[]'::jsonb;
  v_audit_id uuid;
  v_constraint text;
begin
  select m.edition_id into v_edition_id from app.modality m where m.modality_id = p_modality_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('CAPACITY_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['effective_capacity', 'acknowledge_below_occupation']);
  v_capacity := private.cfg_int(v_input, 'effective_capacity', true, 0, 1000000);
  v_ack := coalesce(private.cfg_bool(v_input, 'acknowledge_below_occupation', false), false);

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform private.cfg_assert_configurable(v_edition_id);
  select mc.effective_capacity into v_previous from app.modality_capacity mc where mc.modality_id = p_modality_id for update;

  select t.x into v_occupation from jsonb_array_elements(private.edition_availability(v_edition_id) -> 'modalities') as t(x)
  where t.x ->> 'modality_id' = p_modality_id::text;
  v_occupied := (v_occupation ->> 'confirmed')::integer + (v_occupation ->> 'active_holds')::integer;
  if v_capacity < v_occupied then
    if not v_ack then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'capacity_below_occupation',
        'confirmed', (v_occupation ->> 'confirmed')::integer, 'active_holds', (v_occupation ->> 'active_holds')::integer));
    end if;
    v_warnings := v_warnings || jsonb_build_object('code', 'CAPACITY_BELOW_OCCUPATION',
      'confirmed', (v_occupation ->> 'confirmed')::integer, 'active_holds', (v_occupation ->> 'active_holds')::integer);
  end if;

  if v_previous is distinct from v_capacity then
    insert into app.modality_capacity as mc (modality_id, effective_capacity, updated_by_staff_id)
    values (p_modality_id, v_capacity, v_staff_id)
    on conflict (modality_id) do update set effective_capacity = excluded.effective_capacity,
      updated_by_staff_id = excluded.updated_by_staff_id;
    v_audit_id := private.audit('MODALITY_CAPACITY_CHANGED', 'modality', p_modality_id, v_edition_id,
      jsonb_build_object('effective_capacity', v_previous), jsonb_build_object('effective_capacity', v_capacity));
    perform private.enqueue_outbox('CapacityChanged', 'Modality', p_modality_id, 'CapacityChanged:' || p_modality_id || ':' || v_audit_id,
      jsonb_build_object('edition_id', v_edition_id, 'modality_id', p_modality_id));
  end if;
  return jsonb_build_object('modality', private.modality_projection(p_modality_id),
    'availability', private.edition_availability(v_edition_id), 'warnings', v_warnings);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- NULL removes the global limit (Master §35).
create or replace function private.set_edition_global_capacity(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_capacity integer;
  v_ack boolean;
  v_previous integer;
  v_global jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_audit_id uuid;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('CAPACITY_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['global_capacity', 'acknowledge_below_occupation']);
  if not v_input ? 'global_capacity' then perform private.cfg_fail('global_capacity', 'required'); end if;
  v_capacity := private.cfg_int(v_input, 'global_capacity', false, 0, 1000000);
  v_ack := coalesce(private.cfg_bool(v_input, 'acknowledge_below_occupation', false), false);

  select e.global_capacity into v_previous from app.edition e where e.edition_id = p_edition_id for update;
  perform private.cfg_assert_configurable(p_edition_id);
  v_global := private.edition_availability(p_edition_id) -> 'global';
  if v_capacity is not null and v_capacity < (v_global ->> 'confirmed')::integer + (v_global ->> 'active_holds')::integer then
    if not v_ack then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'capacity_below_occupation',
        'confirmed', (v_global ->> 'confirmed')::integer, 'active_holds', (v_global ->> 'active_holds')::integer));
    end if;
    v_warnings := v_warnings || jsonb_build_object('code', 'CAPACITY_BELOW_OCCUPATION',
      'confirmed', (v_global ->> 'confirmed')::integer, 'active_holds', (v_global ->> 'active_holds')::integer);
  end if;

  if v_previous is distinct from v_capacity then
    update app.edition set global_capacity = v_capacity where edition_id = p_edition_id;
    v_audit_id := private.audit('EDITION_GLOBAL_CAPACITY_CHANGED', 'edition', p_edition_id, p_edition_id,
      jsonb_build_object('global_capacity', v_previous), jsonb_build_object('global_capacity', v_capacity));
    perform private.enqueue_outbox('CapacityChanged', 'Edition', p_edition_id, 'CapacityChanged:' || p_edition_id || ':' || v_audit_id,
      jsonb_build_object('edition_id', p_edition_id));
  end if;
  return jsonb_build_object('edition', private.edition_projection(p_edition_id),
    'availability', private.edition_availability(p_edition_id), 'warnings', v_warnings);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Price offers (Master §38). Overlapping ACTIVE windows are reported as warnings, never errors: the
-- deterministic order decides, the editor makes it visible.
-- ---------------------------------------------------------------------------------------------

create or replace function private.price_offer_warnings(p_price_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(w) from (
      select jsonb_build_object('code', 'PRICE_OFFER_OVERLAP',
        'price_offer_ids', jsonb_agg(o.price_offer_id order by o.price_offer_id)) as w
      from app.price_offer p
      join app.price_offer o on o.modality_id = p.modality_id and o.price_offer_id <> p.price_offer_id
        and o.status = 'ACTIVE'
        and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(p.starts_at, p.ends_at, '[)')
      where p.price_offer_id = p_price_offer_id and p.status = 'ACTIVE'
      having count(*) > 0
      union all
      select jsonb_build_object('code', 'FREE_MODE_IGNORES_PRICE_OFFERS')
      from app.price_offer p
      join app.modality m on m.modality_id = p.modality_id
      join app.edition e on e.edition_id = m.edition_id
      where p.price_offer_id = p_price_offer_id and e.registration_mode = 'FREE') x), '[]'::jsonb)
$$;

create or replace function private.cfg_price_window(p_starts_at timestamptz, p_ends_at timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    perform private.cfg_fail('ends_at', 'must_follow_start');
  end if;
end;
$$;

create or replace function private.create_price_offer(p_modality_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
  v_currency text;
  v_idem jsonb;
  v_id uuid;
  v_audit_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  select m.edition_id into v_edition_id from app.modality m where m.modality_id = p_modality_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('PRICE_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['name', 'amount_minor', 'currency', 'starts_at', 'ends_at', 'priority', 'status']);
  v_starts := private.cfg_timestamptz(v_input, 'starts_at', false);
  v_ends := private.cfg_timestamptz(v_input, 'ends_at', false);
  perform private.cfg_price_window(v_starts, v_ends);
  v_currency := coalesce(private.cfg_text(v_input, 'currency', false, 3, 3), 'MXN');
  if v_currency !~ '^[A-Z]{3}$' then perform private.cfg_fail('currency', 'invalid_currency'); end if;

  v_idem := private.cfg_idempotency_begin('price_offer.create', p_modality_id::text, p_idempotency_key,
    jsonb_build_object('modality_id', p_modality_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform private.cfg_assert_configurable(v_edition_id);
  insert into app.price_offer (modality_id, name, amount_minor, currency, starts_at, ends_at, status, priority)
  values (p_modality_id, private.cfg_text(v_input, 'name', true, 120),
    private.cfg_numeric(v_input, 'amount_minor', true, 0, 100000000, true)::bigint, v_currency, v_starts, v_ends,
    coalesce(private.cfg_enum(v_input, 'status', false, array['ACTIVE', 'INACTIVE']), 'ACTIVE'),
    coalesce(private.cfg_int(v_input, 'priority', false, -1000, 1000), 0))
  returning price_offer_id into v_id;

  v_audit_id := private.audit('PRICE_OFFER_CREATED', 'price_offer', v_id, v_edition_id, null,
    private.price_offer_projection(v_id) - array['created_at', 'updated_at']);
  perform private.enqueue_outbox('PriceOfferChanged', 'PriceOffer', v_id, 'PriceOfferChanged:' || v_id || ':' || v_audit_id,
    jsonb_build_object('edition_id', v_edition_id, 'modality_id', p_modality_id, 'price_offer_id', v_id));
  v_result := jsonb_build_object('price_offer', private.price_offer_projection(v_id), 'warnings', private.price_offer_warnings(v_id));
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- Amount and currency of an offer already snapshotted by a request stay as they were: create a new offer.
create or replace function private.update_price_offer(p_price_offer_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_p app.price_offer%rowtype;
  v_n app.price_offer%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_audit_id uuid;
  v_constraint text;
begin
  select m.edition_id into v_edition_id
  from app.price_offer po join app.modality m on m.modality_id = po.modality_id
  where po.price_offer_id = p_price_offer_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('PRICE_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['name', 'amount_minor', 'currency', 'starts_at', 'ends_at', 'priority', 'status']);

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform private.cfg_assert_configurable(v_edition_id);
  select * into v_p from app.price_offer po where po.price_offer_id = p_price_offer_id for update;
  v_n := v_p;
  if v_input ? 'name' then v_n.name := private.cfg_text(v_input, 'name', true, 120); end if;
  if v_input ? 'amount_minor' then v_n.amount_minor := private.cfg_numeric(v_input, 'amount_minor', true, 0, 100000000, true)::bigint; end if;
  if v_input ? 'currency' then
    v_n.currency := private.cfg_text(v_input, 'currency', true, 3, 3);
    if v_n.currency !~ '^[A-Z]{3}$' then perform private.cfg_fail('currency', 'invalid_currency'); end if;
  end if;
  if v_input ? 'starts_at' then v_n.starts_at := private.cfg_timestamptz(v_input, 'starts_at', false); end if;
  if v_input ? 'ends_at' then v_n.ends_at := private.cfg_timestamptz(v_input, 'ends_at', false); end if;
  if v_input ? 'priority' then v_n.priority := private.cfg_int(v_input, 'priority', true, -1000, 1000); end if;
  if v_input ? 'status' then v_n.status := private.cfg_enum(v_input, 'status', true, array['ACTIVE', 'INACTIVE', 'EXPIRED']); end if;
  perform private.cfg_price_window(v_n.starts_at, v_n.ends_at);
  if (v_n.amount_minor <> v_p.amount_minor or v_n.currency <> v_p.currency)
     and exists (select 1 from app.registration_request_participant rp where rp.price_offer_id = p_price_offer_id) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('field', 'amount_minor', 'reason', 'price_offer_in_use'));
  end if;

  update app.price_offer set name = v_n.name, amount_minor = v_n.amount_minor, currency = v_n.currency,
    starts_at = v_n.starts_at, ends_at = v_n.ends_at, priority = v_n.priority, status = v_n.status
  where price_offer_id = p_price_offer_id;

  select jsonb_object_agg(k, to_jsonb(v_p) -> k), jsonb_object_agg(k, to_jsonb(v_n) -> k) into v_before, v_after
  from jsonb_object_keys(v_input) k where to_jsonb(v_p) -> k is distinct from to_jsonb(v_n) -> k;
  if v_after is not null then
    v_audit_id := private.audit('PRICE_OFFER_UPDATED', 'price_offer', p_price_offer_id, v_edition_id, v_before, v_after);
    perform private.enqueue_outbox('PriceOfferChanged', 'PriceOffer', p_price_offer_id,
      'PriceOfferChanged:' || p_price_offer_id || ':' || v_audit_id,
      jsonb_build_object('edition_id', v_edition_id, 'modality_id', v_p.modality_id, 'price_offer_id', p_price_offer_id));
  end if;
  return jsonb_build_object('price_offer', private.price_offer_projection(p_price_offer_id),
    'warnings', private.price_offer_warnings(p_price_offer_id));
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Categories (Master §39).
-- ---------------------------------------------------------------------------------------------

create or replace function private.cfg_replace_category_modalities(p_category_id uuid, p_edition_id uuid, p_ids jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) > 100
     or exists (select 1 from jsonb_array_elements(p_ids) x
                where jsonb_typeof(x) <> 'string'
                   or (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    perform private.cfg_fail('modality_ids', 'invalid_uuid_list');
  end if;
  select coalesce(array_agg(distinct (x #>> '{}')::uuid), '{}') into v_ids from jsonb_array_elements(p_ids) x;
  if exists (select 1 from unnest(v_ids) i
             where not exists (select 1 from app.modality m where m.modality_id = i and m.edition_id = p_edition_id)) then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'modality_ids'));
  end if;
  delete from app.modality_category mc where mc.category_id = p_category_id and mc.modality_id <> all (v_ids);
  insert into app.modality_category (modality_id, category_id, edition_id)
  select i, p_category_id, p_edition_id from unnest(v_ids) i
  on conflict (modality_id, category_id) do nothing;
end;
$$;

create or replace function private.create_category(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('MODALITY_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['key', 'name', 'assignment_mode', 'eligibility_rule', 'active', 'sort_order', 'modality_ids']);
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  perform private.cfg_assert_configurable(p_edition_id);

  insert into app.category (edition_id, key, name, assignment_mode, eligibility_rule, active, sort_order)
  values (p_edition_id, private.cfg_key(v_input, 'key', true), private.cfg_text(v_input, 'name', true, 120),
    private.cfg_enum(v_input, 'assignment_mode', true, array['USER_SELECTS', 'SYSTEM_DERIVES']),
    coalesce(private.cfg_eligibility_rules(v_input, 'eligibility_rule'), '{}'::jsonb),
    coalesce(private.cfg_bool(v_input, 'active', false), true),
    coalesce(private.cfg_int(v_input, 'sort_order', false, 0, 10000),
             (select coalesce(max(c.sort_order), 0) + 1 from app.category c where c.edition_id = p_edition_id)))
  returning category_id into v_id;
  if private.cfg_present(v_input, 'modality_ids') then
    perform private.cfg_replace_category_modalities(v_id, p_edition_id, v_input -> 'modality_ids');
  end if;

  v_result := private.category_projection(v_id);
  perform private.audit('CATEGORY_CREATED', 'category', v_id, p_edition_id, null, v_result);
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.update_category(p_category_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_c app.category%rowtype;
  v_n app.category%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_constraint text;
begin
  select c.edition_id into v_edition_id from app.category c where c.category_id = p_category_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('MODALITY_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['key', 'name', 'assignment_mode', 'eligibility_rule', 'active', 'sort_order', 'modality_ids']);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform private.cfg_assert_configurable(v_edition_id);
  select * into v_c from app.category c where c.category_id = p_category_id for update;
  v_n := v_c;
  if v_input ? 'key' then v_n.key := private.cfg_key(v_input, 'key', true); end if;
  if v_input ? 'name' then v_n.name := private.cfg_text(v_input, 'name', true, 120); end if;
  if v_input ? 'assignment_mode' then v_n.assignment_mode := private.cfg_enum(v_input, 'assignment_mode', true, array['USER_SELECTS', 'SYSTEM_DERIVES']); end if;
  if v_input ? 'eligibility_rule' then v_n.eligibility_rule := coalesce(private.cfg_eligibility_rules(v_input, 'eligibility_rule'), '{}'::jsonb); end if;
  if v_input ? 'active' then v_n.active := private.cfg_bool(v_input, 'active', true); end if;
  if v_input ? 'sort_order' then v_n.sort_order := private.cfg_int(v_input, 'sort_order', true, 0, 10000); end if;
  if v_n.key <> v_c.key and exists (select 1 from app.registration_category_assignment a where a.category_id = p_category_id) then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('field', 'key', 'reason', 'category_in_use'));
  end if;

  update app.category set key = v_n.key, name = v_n.name, assignment_mode = v_n.assignment_mode,
    eligibility_rule = v_n.eligibility_rule, active = v_n.active, sort_order = v_n.sort_order
  where category_id = p_category_id;
  if v_input ? 'modality_ids' then
    perform private.cfg_replace_category_modalities(p_category_id, v_edition_id, v_input -> 'modality_ids');
  end if;

  select jsonb_object_agg(k, to_jsonb(v_c) -> k), jsonb_object_agg(k, to_jsonb(v_n) -> k) into v_before, v_after
  from jsonb_object_keys(v_input - 'modality_ids') k where to_jsonb(v_c) -> k is distinct from to_jsonb(v_n) -> k;
  perform private.audit('CATEGORY_UPDATED', 'category', p_category_id, v_edition_id, v_before,
    coalesce(v_after, '{}'::jsonb) || case when v_input ? 'modality_ids'
      then jsonb_build_object('modality_ids', private.category_projection(p_category_id) -> 'modality_ids') else '{}'::jsonb end);
  return private.category_projection(p_category_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Registration forms (Master §41): versioned per (Edition, Modality|NULL); fields change only while
-- DRAFT; publishing supersedes the previous PUBLISHED version of the same scope. validation_config /
-- options_config follow schema v1 (KERNEL_READY.md) — data only, never executable logic.
-- ---------------------------------------------------------------------------------------------

create or replace function private.cfg_form_field(p_field jsonb, p_index integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_prefix text := 'fields[' || p_index || '].';
  v_field jsonb := private.cfg_object(p_field, array['field_key', 'label', 'field_type', 'required', 'validation_config',
    'options_config', 'sensitivity', 'sort_order'], 'fields[' || p_index || ']');
  v_key text := private.cfg_text(v_field, 'field_key', true, 64, 1, v_prefix || 'field_key');
  v_type text := private.cfg_enum(v_field, 'field_type', true,
    array['TEXT', 'TEXTAREA', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'DATE', 'NUMBER'], v_prefix || 'field_type');
  v_vfield text := v_prefix || 'validation_config';
  v_ofield text := v_prefix || 'options_config';
  v_validation jsonb := coalesce(v_field -> 'validation_config', '{}'::jsonb);
  v_options jsonb := coalesce(v_field -> 'options_config', '{}'::jsonb);
  v_option_count integer := 0;
  v_text_limit integer := case v_type when 'TEXT' then 200 else 2000 end;
  v_low numeric;
  v_high numeric;
begin
  if v_key !~ '^[a-z][a-z0-9_]{0,63}$' then perform private.cfg_fail(v_prefix || 'field_key', 'invalid_key'); end if;

  perform private.cfg_object(v_options, case when v_type in ('SELECT', 'MULTISELECT') then array['options'] else array[]::text[] end, v_ofield);
  if v_type in ('SELECT', 'MULTISELECT') then
    if jsonb_typeof(v_options -> 'options') is distinct from 'array'
       or jsonb_array_length(v_options -> 'options') not between 1 and 100 then
      perform private.cfg_fail(v_ofield || '.options', 'invalid_options');
    end if;
    for i in 0 .. jsonb_array_length(v_options -> 'options') - 1 loop
      perform private.cfg_object(v_options -> 'options' -> i, array['value', 'label'], v_ofield || '.options[' || i || ']');
      if coalesce(private.cfg_text(v_options -> 'options' -> i, 'value', true, 64, 1, v_ofield || '.options[' || i || '].value'), '')
         !~ '^[A-Za-z0-9_.-]{1,64}$' then
        perform private.cfg_fail(v_ofield || '.options[' || i || '].value', 'invalid_option_value');
      end if;
      perform private.cfg_text(v_options -> 'options' -> i, 'label', true, 120, 1, v_ofield || '.options[' || i || '].label');
    end loop;
    v_option_count := jsonb_array_length(v_options -> 'options');
    if (select count(distinct o ->> 'value') from jsonb_array_elements(v_options -> 'options') o) <> v_option_count then
      perform private.cfg_fail(v_ofield || '.options', 'duplicate_option_value');
    end if;
  end if;

  perform private.cfg_object(v_validation, case v_type
    when 'TEXT' then array['min_length', 'max_length']
    when 'TEXTAREA' then array['min_length', 'max_length']
    when 'NUMBER' then array['min', 'max', 'integer']
    when 'DATE' then array['min_date', 'max_date']
    when 'MULTISELECT' then array['min_items', 'max_items']
    else array[]::text[] end, v_vfield);
  case v_type
    when 'TEXT', 'TEXTAREA' then
      v_low := private.cfg_int(v_validation, 'min_length', false, 0, v_text_limit, v_vfield || '.min_length');
      v_high := private.cfg_int(v_validation, 'max_length', false, 1, v_text_limit, v_vfield || '.max_length');
    when 'NUMBER' then
      v_low := private.cfg_numeric(v_validation, 'min', false, -1000000000, 1000000000, false, v_vfield || '.min');
      v_high := private.cfg_numeric(v_validation, 'max', false, -1000000000, 1000000000, false, v_vfield || '.max');
      perform private.cfg_bool(v_validation, 'integer', false, v_vfield || '.integer');
    when 'DATE' then
      if private.cfg_date(v_validation, 'min_date', false, v_vfield || '.min_date')
         > private.cfg_date(v_validation, 'max_date', false, v_vfield || '.max_date') then
        perform private.cfg_fail(v_vfield, 'min_exceeds_max');
      end if;
    when 'MULTISELECT' then
      v_low := private.cfg_int(v_validation, 'min_items', false, 0, v_option_count, v_vfield || '.min_items');
      v_high := private.cfg_int(v_validation, 'max_items', false, 1, v_option_count, v_vfield || '.max_items');
    else
      null;
  end case;
  if v_low is not null and v_high is not null and v_low > v_high then
    perform private.cfg_fail(v_vfield, 'min_exceeds_max');
  end if;

  return jsonb_build_object('field_key', v_key,
    'label', private.cfg_text(v_field, 'label', true, 160, 1, v_prefix || 'label'),
    'field_type', v_type,
    'required', coalesce(private.cfg_bool(v_field, 'required', false, v_prefix || 'required'), false),
    'validation_config', v_validation, 'options_config', v_options,
    'sensitivity', coalesce(private.cfg_enum(v_field, 'sensitivity', false, array['NORMAL', 'SENSITIVE'], v_prefix || 'sensitivity'), 'NORMAL'),
    'sort_order', coalesce(private.cfg_int(v_field, 'sort_order', false, 0, 10000, v_prefix || 'sort_order'), p_index + 1));
end;
$$;

create or replace function private.cfg_insert_form_fields(p_registration_form_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized jsonb := '[]'::jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) > 50 then
    perform private.cfg_fail('fields', 'invalid_field_list', jsonb_build_object('max', 50));
  end if;
  for i in 0 .. jsonb_array_length(p_fields) - 1 loop
    v_normalized := v_normalized || private.cfg_form_field(p_fields -> i, i);
  end loop;
  if (select count(distinct f ->> 'field_key') from jsonb_array_elements(v_normalized) f) <> jsonb_array_length(v_normalized) then
    perform private.cfg_fail('fields', 'duplicate_field_key');
  end if;
  insert into app.registration_form_field (registration_form_id, field_key, label, field_type, required,
    validation_config, options_config, sensitivity, sort_order)
  select p_registration_form_id, f ->> 'field_key', f ->> 'label', f ->> 'field_type', (f ->> 'required')::boolean,
    f -> 'validation_config', f -> 'options_config', f ->> 'sensitivity', (f ->> 'sort_order')::integer
  from jsonb_array_elements(v_normalized) f;
end;
$$;

-- New DRAFT version for (Edition, Modality|NULL). Copies the current PUBLISHED fields unless told not to;
-- `fields` replaces them outright.
create or replace function private.create_registration_form(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_modality_id uuid;
  v_draft_id uuid;
  v_published_id uuid;
  v_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['modality_id', 'copy_published_fields', 'fields']);
  v_modality_id := private.cfg_uuid(v_input, 'modality_id', false);
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  perform private.cfg_assert_configurable(p_edition_id);
  if v_modality_id is not null
     and not exists (select 1 from app.modality m where m.modality_id = v_modality_id and m.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'modality_id'));
  end if;

  select f.registration_form_id into v_draft_id from app.registration_form f
  where f.edition_id = p_edition_id and f.modality_id is not distinct from v_modality_id and f.status = 'DRAFT';
  if v_draft_id is not null then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'draft_exists', 'registration_form_id', v_draft_id));
  end if;
  select f.registration_form_id into v_published_id from app.registration_form f
  where f.edition_id = p_edition_id and f.modality_id is not distinct from v_modality_id and f.status = 'PUBLISHED';

  insert into app.registration_form (edition_id, modality_id, version)
  values (p_edition_id, v_modality_id,
    (select coalesce(max(f.version), 0) + 1 from app.registration_form f
     where f.edition_id = p_edition_id and f.modality_id is not distinct from v_modality_id))
  returning registration_form_id into v_id;

  if private.cfg_present(v_input, 'fields') then
    perform private.cfg_insert_form_fields(v_id, v_input -> 'fields');
  elsif coalesce(private.cfg_bool(v_input, 'copy_published_fields', false), true) and v_published_id is not null then
    insert into app.registration_form_field (registration_form_id, field_key, label, field_type, required,
      validation_config, options_config, sensitivity, sort_order)
    select v_id, ff.field_key, ff.label, ff.field_type, ff.required, ff.validation_config, ff.options_config,
      ff.sensitivity, ff.sort_order
    from app.registration_form_field ff where ff.registration_form_id = v_published_id;
  end if;

  v_result := private.registration_form_projection(v_id);
  perform private.audit('REGISTRATION_FORM_CREATED', 'registration_form', v_id, p_edition_id, null,
    jsonb_build_object('modality_id', v_modality_id, 'version', v_result -> 'version'));
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.cfg_lock_draft_form(p_registration_form_id uuid, p_action text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_status text;
begin
  select f.edition_id into v_edition_id from app.registration_form f where f.registration_form_id = p_registration_form_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize(p_action, v_edition_id);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform private.cfg_assert_configurable(v_edition_id);
  select f.status into v_status from app.registration_form f where f.registration_form_id = p_registration_form_id for update;
  if v_status <> 'DRAFT' then perform private.cfg_invalid_transition('status', v_status); end if;
  return v_edition_id;
end;
$$;

create or replace function private.replace_registration_form_fields(p_registration_form_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid := private.cfg_lock_draft_form(p_registration_form_id, 'EVENT_CONTENT_MANAGE');
  v_input jsonb := private.cfg_object(p_input, array['fields']);
  v_result jsonb;
  v_constraint text;
begin
  if not private.cfg_present(v_input, 'fields') then perform private.cfg_fail('fields', 'required'); end if;
  delete from app.registration_form_field ff where ff.registration_form_id = p_registration_form_id;
  perform private.cfg_insert_form_fields(p_registration_form_id, v_input -> 'fields');
  v_result := private.registration_form_projection(p_registration_form_id);
  perform private.audit('REGISTRATION_FORM_FIELDS_REPLACED', 'registration_form', p_registration_form_id, v_edition_id, null,
    jsonb_build_object('field_keys', (select coalesce(jsonb_agg(f -> 'field_key'), '[]'::jsonb) from jsonb_array_elements(v_result -> 'fields') f)));
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.publish_registration_form(p_registration_form_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_form app.registration_form%rowtype;
  v_superseded uuid;
  v_idem jsonb;
  v_result jsonb;
  v_constraint text;
begin
  select f.edition_id into v_edition_id from app.registration_form f where f.registration_form_id = p_registration_form_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  v_idem := private.cfg_idempotency_begin('registration_form.publish', p_registration_form_id::text, p_idempotency_key,
    jsonb_build_object('registration_form_id', p_registration_form_id));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform private.cfg_assert_configurable(v_edition_id);
  select * into v_form from app.registration_form f where f.registration_form_id = p_registration_form_id for update;
  if v_form.status <> 'DRAFT' then perform private.cfg_invalid_transition('status', v_form.status); end if;

  update app.registration_form f set status = 'SUPERSEDED'
  where f.edition_id = v_edition_id and f.modality_id is not distinct from v_form.modality_id and f.status = 'PUBLISHED'
  returning f.registration_form_id into v_superseded;
  update app.registration_form set status = 'PUBLISHED', published_at = now()
  where registration_form_id = p_registration_form_id;

  perform private.audit('REGISTRATION_FORM_PUBLISHED', 'registration_form', p_registration_form_id, v_edition_id,
    jsonb_build_object('status', 'DRAFT'), jsonb_build_object('status', 'PUBLISHED', 'superseded_registration_form_id', v_superseded));
  v_result := private.registration_form_projection(p_registration_form_id) || jsonb_build_object('superseded_registration_form_id', v_superseded);
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.delete_registration_form(p_registration_form_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid := private.cfg_lock_draft_form(p_registration_form_id, 'EVENT_CONTENT_MANAGE');
begin
  delete from app.registration_form_field ff where ff.registration_form_id = p_registration_form_id;
  delete from app.registration_form f where f.registration_form_id = p_registration_form_id;
  perform private.audit('REGISTRATION_FORM_DELETED', 'registration_form', p_registration_form_id, v_edition_id);
  return jsonb_build_object('registration_form_id', p_registration_form_id, 'deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Locations (Master §43) and agenda (Master §44).
-- ---------------------------------------------------------------------------------------------

create or replace function private.cfg_point(p_input jsonb, p_current extensions.geography default null)
returns extensions.geography
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_lat numeric;
  v_lng numeric;
begin
  if not (p_input ? 'latitude' or p_input ? 'longitude') then return p_current; end if;
  v_lat := private.cfg_numeric(p_input, 'latitude', false, -90, 90, false);
  v_lng := private.cfg_numeric(p_input, 'longitude', false, -180, 180, false);
  if (v_lat is null) <> (v_lng is null) then perform private.cfg_fail('longitude', 'coordinates_must_be_paired'); end if;
  if v_lat is null then return null; end if;
  return extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography;
end;
$$;

create or replace function private.cfg_sync_primary_location(p_edition_id uuid, p_location_id uuid, p_is_primary boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_is_primary then
    update app.edition_location l set is_primary = false
    where l.edition_id = p_edition_id and l.is_primary and l.edition_location_id <> p_location_id;
    update app.edition_location l set is_primary = true where l.edition_location_id = p_location_id and not l.is_primary;
    update app.edition e set primary_location_id = p_location_id
    where e.edition_id = p_edition_id and e.primary_location_id is distinct from p_location_id;
  else
    update app.edition_location l set is_primary = false where l.edition_location_id = p_location_id and l.is_primary;
    update app.edition e set primary_location_id = null
    where e.edition_id = p_edition_id and e.primary_location_id = p_location_id;
  end if;
end;
$$;

create or replace function private.create_edition_location(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_country text;
  v_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['location_type', 'name', 'address_line', 'city', 'state_region',
    'country_code', 'latitude', 'longitude', 'is_primary', 'sort_order']);
  v_country := private.cfg_text(v_input, 'country_code', false, 2, 2);
  if v_country !~ '^[A-Z]{2}$' then perform private.cfg_fail('country_code', 'invalid_country_code'); end if;
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;

  insert into app.edition_location (edition_id, location_type, name, address_line, city, state_region, country_code,
    geometry, sort_order)
  values (p_edition_id,
    private.cfg_enum(v_input, 'location_type', true,
      array['DISCOVERY', 'VENUE', 'START', 'FINISH', 'MEETING_POINT', 'PARKING', 'KIT_PICKUP', 'OTHER']),
    private.cfg_text(v_input, 'name', true, 160), private.cfg_text(v_input, 'address_line', false, 300),
    private.cfg_text(v_input, 'city', false, 120), private.cfg_text(v_input, 'state_region', false, 120), v_country,
    private.cfg_point(v_input),
    coalesce(private.cfg_int(v_input, 'sort_order', false, 0, 10000),
             (select coalesce(max(l.sort_order), 0) + 1 from app.edition_location l where l.edition_id = p_edition_id)))
  returning edition_location_id into v_id;
  if coalesce(private.cfg_bool(v_input, 'is_primary', false), false) then
    perform private.cfg_sync_primary_location(p_edition_id, v_id, true);
  end if;

  v_result := private.location_projection(v_id);
  perform private.audit('EDITION_LOCATION_CREATED', 'edition_location', v_id, p_edition_id, null,
    jsonb_build_object('location_type', v_result -> 'location_type', 'is_primary', v_result -> 'is_primary'));
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.update_edition_location(p_location_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_l app.edition_location%rowtype;
  v_n app.edition_location%rowtype;
  v_constraint text;
begin
  select l.edition_id into v_edition_id from app.edition_location l where l.edition_location_id = p_location_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['location_type', 'name', 'address_line', 'city', 'state_region',
    'country_code', 'latitude', 'longitude', 'is_primary', 'sort_order']);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  select * into v_l from app.edition_location l where l.edition_location_id = p_location_id for update;
  v_n := v_l;
  if v_input ? 'location_type' then
    v_n.location_type := private.cfg_enum(v_input, 'location_type', true,
      array['DISCOVERY', 'VENUE', 'START', 'FINISH', 'MEETING_POINT', 'PARKING', 'KIT_PICKUP', 'OTHER']);
  end if;
  if v_input ? 'name' then v_n.name := private.cfg_text(v_input, 'name', true, 160); end if;
  if v_input ? 'address_line' then v_n.address_line := private.cfg_text(v_input, 'address_line', false, 300); end if;
  if v_input ? 'city' then v_n.city := private.cfg_text(v_input, 'city', false, 120); end if;
  if v_input ? 'state_region' then v_n.state_region := private.cfg_text(v_input, 'state_region', false, 120); end if;
  if v_input ? 'country_code' then
    v_n.country_code := private.cfg_text(v_input, 'country_code', false, 2, 2);
    if v_n.country_code !~ '^[A-Z]{2}$' then perform private.cfg_fail('country_code', 'invalid_country_code'); end if;
  end if;
  if v_input ? 'sort_order' then v_n.sort_order := private.cfg_int(v_input, 'sort_order', true, 0, 10000); end if;
  v_n.geometry := private.cfg_point(v_input, v_l.geometry);

  update app.edition_location set location_type = v_n.location_type, name = v_n.name, address_line = v_n.address_line,
    city = v_n.city, state_region = v_n.state_region, country_code = v_n.country_code, geometry = v_n.geometry,
    sort_order = v_n.sort_order
  where edition_location_id = p_location_id;
  if v_input ? 'is_primary' then
    perform private.cfg_sync_primary_location(v_edition_id, p_location_id, private.cfg_bool(v_input, 'is_primary', true));
  end if;
  perform private.audit('EDITION_LOCATION_UPDATED', 'edition_location', p_location_id, v_edition_id, null,
    jsonb_build_object('changed_fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_input) k)));
  return private.location_projection(p_location_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.delete_edition_location(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
begin
  select l.edition_id into v_edition_id from app.edition_location l where l.edition_location_id = p_location_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  begin
    perform private.cfg_sync_primary_location(v_edition_id, p_location_id, false);
    delete from app.edition_location l where l.edition_location_id = p_location_id;
  exception when foreign_key_violation then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'in_use'));
  end;
  perform private.audit('EDITION_LOCATION_DELETED', 'edition_location', p_location_id, v_edition_id);
  return jsonb_build_object('edition_location_id', p_location_id, 'deleted', true);
end;
$$;

create or replace function private.cfg_schedule_item_refs(p_edition_id uuid, p_modality_id uuid, p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_modality_id is not null
     and not exists (select 1 from app.modality m where m.modality_id = p_modality_id and m.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'modality_id'));
  end if;
  if p_location_id is not null
     and not exists (select 1 from app.edition_location l where l.edition_location_id = p_location_id and l.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'location_id'));
  end if;
end;
$$;

create or replace function private.create_schedule_item(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_modality_id uuid;
  v_location_id uuid;
  v_start time;
  v_end time;
  v_id uuid;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['title', 'description', 'local_date', 'local_start_time', 'local_end_time',
    'modality_id', 'location_id', 'sort_order', 'status']);
  v_modality_id := private.cfg_uuid(v_input, 'modality_id', false);
  v_location_id := private.cfg_uuid(v_input, 'location_id', false);
  v_start := private.cfg_time(v_input, 'local_start_time', false);
  v_end := private.cfg_time(v_input, 'local_end_time', false);
  if v_end is not null and (v_start is null or v_end <= v_start) then perform private.cfg_fail('local_end_time', 'must_follow_start'); end if;
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  perform private.cfg_schedule_item_refs(p_edition_id, v_modality_id, v_location_id);

  insert into app.edition_schedule_item (edition_id, modality_id, title, description, local_date, local_start_time,
    local_end_time, location_id, sort_order, status)
  values (p_edition_id, v_modality_id, private.cfg_text(v_input, 'title', true, 160),
    private.cfg_text(v_input, 'description', false, 2000), private.cfg_date(v_input, 'local_date', true), v_start, v_end,
    v_location_id,
    coalesce(private.cfg_int(v_input, 'sort_order', false, 0, 10000),
             (select coalesce(max(i.sort_order), 0) + 1 from app.edition_schedule_item i where i.edition_id = p_edition_id)),
    coalesce(private.cfg_enum(v_input, 'status', false, array['ACTIVE', 'CANCELED']), 'ACTIVE'))
  returning edition_schedule_item_id into v_id;
  perform private.audit('SCHEDULE_ITEM_CREATED', 'edition_schedule_item', v_id, p_edition_id);
  return private.schedule_item_projection(v_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.update_schedule_item(p_item_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_n app.edition_schedule_item%rowtype;
  v_constraint text;
begin
  select i.edition_id into v_edition_id from app.edition_schedule_item i where i.edition_schedule_item_id = p_item_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['title', 'description', 'local_date', 'local_start_time', 'local_end_time',
    'modality_id', 'location_id', 'sort_order', 'status']);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  select * into v_n from app.edition_schedule_item i where i.edition_schedule_item_id = p_item_id for update;
  if v_input ? 'title' then v_n.title := private.cfg_text(v_input, 'title', true, 160); end if;
  if v_input ? 'description' then v_n.description := private.cfg_text(v_input, 'description', false, 2000); end if;
  if v_input ? 'local_date' then v_n.local_date := private.cfg_date(v_input, 'local_date', true); end if;
  if v_input ? 'local_start_time' then v_n.local_start_time := private.cfg_time(v_input, 'local_start_time', false); end if;
  if v_input ? 'local_end_time' then v_n.local_end_time := private.cfg_time(v_input, 'local_end_time', false); end if;
  if v_input ? 'modality_id' then v_n.modality_id := private.cfg_uuid(v_input, 'modality_id', false); end if;
  if v_input ? 'location_id' then v_n.location_id := private.cfg_uuid(v_input, 'location_id', false); end if;
  if v_input ? 'sort_order' then v_n.sort_order := private.cfg_int(v_input, 'sort_order', true, 0, 10000); end if;
  if v_input ? 'status' then v_n.status := private.cfg_enum(v_input, 'status', true, array['ACTIVE', 'CANCELED']); end if;
  if v_n.local_end_time is not null and (v_n.local_start_time is null or v_n.local_end_time <= v_n.local_start_time) then
    perform private.cfg_fail('local_end_time', 'must_follow_start');
  end if;
  perform private.cfg_schedule_item_refs(v_edition_id, v_n.modality_id, v_n.location_id);

  update app.edition_schedule_item set title = v_n.title, description = v_n.description, local_date = v_n.local_date,
    local_start_time = v_n.local_start_time, local_end_time = v_n.local_end_time, modality_id = v_n.modality_id,
    location_id = v_n.location_id, sort_order = v_n.sort_order, status = v_n.status
  where edition_schedule_item_id = p_item_id;
  perform private.audit('SCHEDULE_ITEM_UPDATED', 'edition_schedule_item', p_item_id, v_edition_id, null,
    jsonb_build_object('changed_fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_input) k)));
  return private.schedule_item_projection(p_item_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.delete_schedule_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
begin
  select i.edition_id into v_edition_id from app.edition_schedule_item i where i.edition_schedule_item_id = p_item_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  delete from app.edition_schedule_item i where i.edition_schedule_item_id = p_item_id;
  perform private.audit('SCHEDULE_ITEM_DELETED', 'edition_schedule_item', p_item_id, v_edition_id);
  return jsonb_build_object('edition_schedule_item_id', p_item_id, 'deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Content blocks (Master §51, SEC-061). Payload schema v1 per block_type; markdown is text with the
-- write-side rules of private.cfg_markdown_error. Never authoritative for date/price/capacity/etc.
-- ---------------------------------------------------------------------------------------------

create or replace function private.cfg_markdown(p_input jsonb, p_key text, p_required boolean, p_max integer, p_field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := private.cfg_text(p_input, p_key, p_required, p_max, 1, p_field);
  v_error text := private.cfg_markdown_error(v_text);
begin
  if v_error is not null then perform private.cfg_fail(p_field, v_error); end if;
  return v_text;
end;
$$;

create or replace function private.cfg_link(p_input jsonb, p_key text, p_required boolean, p_https_only boolean, p_field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_url text := private.cfg_text(p_input, p_key, p_required, 2000, 1, p_field);
begin
  if v_url is not null and (not private.is_allowed_link(v_url) or (p_https_only and v_url !~* '^https://')) then
    perform private.cfg_fail(p_field, 'link_scheme_not_allowed');
  end if;
  return v_url;
end;
$$;

create or replace function private.cfg_media_ref(p_input jsonb, p_key text, p_required boolean, p_edition_id uuid, p_field text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.cfg_uuid(p_input, p_key, p_required, p_field);
begin
  if v_id is not null and not exists (
       select 1 from app.event_media_asset a where a.event_media_asset_id = v_id and a.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', p_field));
  end if;
  return v_id;
end;
$$;

create or replace function private.cfg_list(p_input jsonb, p_key text, p_min integer, p_max integer, p_field text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_input -> p_key) is distinct from 'array' or jsonb_array_length(p_input -> p_key) not between p_min and p_max then
    perform private.cfg_fail(p_field, 'invalid_list', jsonb_build_object('min', p_min, 'max', p_max));
  end if;
  return p_input -> p_key;
end;
$$;

create or replace function private.cfg_content_payload(p_block_type text, p_payload jsonb, p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_path text;
begin
  case p_block_type
    when 'RICH_TEXT' then
      perform private.cfg_object(p_payload, array['title', 'markdown'], 'payload');
      return jsonb_strip_nulls(jsonb_build_object('title', private.cfg_text(p_payload, 'title', false, 160, 1, 'payload.title'),
        'markdown', private.cfg_markdown(p_payload, 'markdown', true, 20000, 'payload.markdown')));
    when 'CUSTOM_SECTION' then
      perform private.cfg_object(p_payload, array['title', 'markdown'], 'payload');
      return jsonb_build_object('title', private.cfg_text(p_payload, 'title', true, 160, 1, 'payload.title'),
        'markdown', private.cfg_markdown(p_payload, 'markdown', true, 20000, 'payload.markdown'));
    when 'CALLOUT' then
      perform private.cfg_object(p_payload, array['tone', 'title', 'markdown'], 'payload');
      return jsonb_strip_nulls(jsonb_build_object(
        'tone', coalesce(private.cfg_enum(p_payload, 'tone', false, array['INFO', 'SUCCESS', 'WARNING', 'DANGER'], 'payload.tone'), 'INFO'),
        'title', private.cfg_text(p_payload, 'title', false, 160, 1, 'payload.title'),
        'markdown', private.cfg_markdown(p_payload, 'markdown', true, 2000, 'payload.markdown')));
    when 'IMAGE' then
      perform private.cfg_object(p_payload, array['event_media_asset_id', 'caption'], 'payload');
      return jsonb_strip_nulls(jsonb_build_object(
        'event_media_asset_id', private.cfg_media_ref(p_payload, 'event_media_asset_id', true, p_edition_id, 'payload.event_media_asset_id'),
        'caption', private.cfg_text(p_payload, 'caption', false, 300, 1, 'payload.caption')));
    when 'GALLERY' then
      perform private.cfg_object(p_payload, array['title', 'items'], 'payload');
      v_items := private.cfg_list(p_payload, 'items', 1, 30, 'payload.items');
      for i in 0 .. jsonb_array_length(v_items) - 1 loop
        v_path := 'payload.items[' || i || ']';
        v_item := private.cfg_object(v_items -> i, array['event_media_asset_id', 'caption'], v_path);
        v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
          'event_media_asset_id', private.cfg_media_ref(v_item, 'event_media_asset_id', true, p_edition_id, v_path || '.event_media_asset_id'),
          'caption', private.cfg_text(v_item, 'caption', false, 300, 1, v_path || '.caption')));
      end loop;
      return jsonb_strip_nulls(jsonb_build_object('title', private.cfg_text(p_payload, 'title', false, 160, 1, 'payload.title'), 'items', v_out));
    when 'FAQ' then
      perform private.cfg_object(p_payload, array['title', 'items'], 'payload');
      v_items := private.cfg_list(p_payload, 'items', 1, 50, 'payload.items');
      for i in 0 .. jsonb_array_length(v_items) - 1 loop
        v_path := 'payload.items[' || i || ']';
        v_item := private.cfg_object(v_items -> i, array['question', 'answer_markdown'], v_path);
        v_out := v_out || jsonb_build_object(
          'question', private.cfg_text(v_item, 'question', true, 300, 1, v_path || '.question'),
          'answer_markdown', private.cfg_markdown(v_item, 'answer_markdown', true, 5000, v_path || '.answer_markdown'));
      end loop;
      return jsonb_strip_nulls(jsonb_build_object('title', private.cfg_text(p_payload, 'title', false, 160, 1, 'payload.title'), 'items', v_out));
    when 'DOCUMENT_LINK' then
      perform private.cfg_object(p_payload, array['label', 'url', 'description'], 'payload');
      return jsonb_strip_nulls(jsonb_build_object(
        'label', private.cfg_text(p_payload, 'label', true, 160, 1, 'payload.label'),
        'url', private.cfg_link(p_payload, 'url', true, false, 'payload.url'),
        'description', private.cfg_text(p_payload, 'description', false, 300, 1, 'payload.description')));
    when 'SPONSOR_GROUP' then
      perform private.cfg_object(p_payload, array['title', 'sponsors'], 'payload');
      v_items := private.cfg_list(p_payload, 'sponsors', 1, 50, 'payload.sponsors');
      for i in 0 .. jsonb_array_length(v_items) - 1 loop
        v_path := 'payload.sponsors[' || i || ']';
        v_item := private.cfg_object(v_items -> i, array['name', 'url', 'event_media_asset_id'], v_path);
        v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
          'name', private.cfg_text(v_item, 'name', true, 120, 1, v_path || '.name'),
          'url', private.cfg_link(v_item, 'url', false, true, v_path || '.url'),
          'event_media_asset_id', private.cfg_media_ref(v_item, 'event_media_asset_id', false, p_edition_id, v_path || '.event_media_asset_id')));
      end loop;
      return jsonb_strip_nulls(jsonb_build_object('title', private.cfg_text(p_payload, 'title', false, 160, 1, 'payload.title'), 'sponsors', v_out));
    else
      perform private.cfg_fail('block_type', 'invalid_value');
  end case;
  return null;
end;
$$;

create or replace function private.create_content_block(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_type text;
  v_modality_id uuid;
  v_id uuid;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['block_type', 'modality_id', 'position', 'status', 'payload']);
  v_type := private.cfg_enum(v_input, 'block_type', true,
    array['RICH_TEXT', 'CALLOUT', 'IMAGE', 'GALLERY', 'FAQ', 'DOCUMENT_LINK', 'SPONSOR_GROUP', 'CUSTOM_SECTION']);
  v_modality_id := private.cfg_uuid(v_input, 'modality_id', false);
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  perform private.cfg_schedule_item_refs(p_edition_id, v_modality_id, null);

  insert into app.event_content_block (edition_id, modality_id, block_type, position, status, payload)
  values (p_edition_id, v_modality_id, v_type,
    coalesce(private.cfg_int(v_input, 'position', false, 0, 10000),
             (select coalesce(max(b.position), 0) + 1 from app.event_content_block b where b.edition_id = p_edition_id)),
    coalesce(private.cfg_enum(v_input, 'status', false, array['DRAFT', 'PUBLISHED', 'ARCHIVED']), 'DRAFT'),
    private.cfg_content_payload(v_type, v_input -> 'payload', p_edition_id))
  returning event_content_block_id into v_id;
  perform private.audit('CONTENT_BLOCK_CREATED', 'event_content_block', v_id, p_edition_id, null,
    jsonb_build_object('block_type', v_type));
  return private.content_block_projection(v_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.update_content_block(p_block_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_n app.event_content_block%rowtype;
  v_before_status text;
  v_constraint text;
begin
  select b.edition_id into v_edition_id from app.event_content_block b where b.event_content_block_id = p_block_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['modality_id', 'position', 'status', 'payload']);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  select * into v_n from app.event_content_block b where b.event_content_block_id = p_block_id for update;
  v_before_status := v_n.status;
  if v_input ? 'modality_id' then
    v_n.modality_id := private.cfg_uuid(v_input, 'modality_id', false);
    perform private.cfg_schedule_item_refs(v_edition_id, v_n.modality_id, null);
  end if;
  if v_input ? 'position' then v_n.position := private.cfg_int(v_input, 'position', true, 0, 10000); end if;
  if v_input ? 'status' then v_n.status := private.cfg_enum(v_input, 'status', true, array['DRAFT', 'PUBLISHED', 'ARCHIVED']); end if;
  if v_input ? 'payload' then v_n.payload := private.cfg_content_payload(v_n.block_type, v_input -> 'payload', v_edition_id); end if;

  update app.event_content_block set modality_id = v_n.modality_id, position = v_n.position, status = v_n.status,
    payload = v_n.payload
  where event_content_block_id = p_block_id;
  perform private.audit('CONTENT_BLOCK_UPDATED', 'event_content_block', p_block_id, v_edition_id,
    jsonb_build_object('status', v_before_status),
    jsonb_build_object('status', v_n.status, 'changed_fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_input) k)));
  return private.content_block_projection(p_block_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.delete_content_block(p_block_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
begin
  select b.edition_id into v_edition_id from app.event_content_block b where b.event_content_block_id = p_block_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  delete from app.event_content_block b where b.event_content_block_id = p_block_id;
  perform private.audit('CONTENT_BLOCK_DELETED', 'event_content_block', p_block_id, v_edition_id);
  return jsonb_build_object('event_content_block_id', p_block_id, 'deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Kits (Master §86, configuration only).
-- ---------------------------------------------------------------------------------------------

create or replace function private.cfg_insert_kit_variant(p_kit_definition_id uuid, p_input jsonb, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb := private.cfg_object(p_input, array['variant_key', 'label', 'capacity', 'status'], p_path);
  v_prefix text := case when p_path = 'body' then '' else p_path || '.' end;
  v_key text := private.cfg_text(v_input, 'variant_key', true, 32, 1, v_prefix || 'variant_key');
  v_id uuid;
begin
  if v_key !~ '^[A-Za-z0-9_-]{1,32}$' then perform private.cfg_fail(v_prefix || 'variant_key', 'invalid_key'); end if;
  insert into app.kit_variant (kit_definition_id, variant_key, label, capacity, status)
  values (p_kit_definition_id, v_key,
    private.cfg_text(v_input, 'label', true, 80, 1, v_prefix || 'label'),
    private.cfg_int(v_input, 'capacity', false, 0, 1000000, v_prefix || 'capacity'),
    coalesce(private.cfg_enum(v_input, 'status', false, array['ACTIVE', 'INACTIVE'], v_prefix || 'status'), 'ACTIVE'))
  returning kit_variant_id into v_id;
  return v_id;
end;
$$;

create or replace function private.cfg_kit_window(p_start timestamptz, p_end timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_start is not null and p_end is not null and p_end <= p_start then
    perform private.cfg_fail('pickup_end_at', 'must_follow_start');
  end if;
end;
$$;

create or replace function private.create_kit_definition(p_edition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_variants jsonb;
  v_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.cfg_authorize('KIT_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['name', 'status', 'pickup_start_at', 'pickup_end_at', 'instructions', 'variants']);
  v_start := private.cfg_timestamptz(v_input, 'pickup_start_at', false);
  v_end := private.cfg_timestamptz(v_input, 'pickup_end_at', false);
  perform private.cfg_kit_window(v_start, v_end);
  perform 1 from app.edition e where e.edition_id = p_edition_id for update;

  insert into app.kit_definition (edition_id, name, status, pickup_start_at, pickup_end_at, instructions)
  values (p_edition_id, private.cfg_text(v_input, 'name', true, 120),
    coalesce(private.cfg_enum(v_input, 'status', false, array['ACTIVE', 'INACTIVE']), 'ACTIVE'), v_start, v_end,
    private.cfg_text(v_input, 'instructions', false, 2000))
  returning kit_definition_id into v_id;
  if private.cfg_present(v_input, 'variants') then
    v_variants := private.cfg_list(v_input, 'variants', 0, 50, 'variants');
    for i in 0 .. jsonb_array_length(v_variants) - 1 loop
      perform private.cfg_insert_kit_variant(v_id, v_variants -> i, 'variants[' || i || ']');
    end loop;
  end if;

  v_result := private.kit_projection(v_id);
  perform private.audit('KIT_DEFINITION_CREATED', 'kit_definition', v_id, p_edition_id, null,
    jsonb_build_object('variant_keys', (select coalesce(jsonb_agg(v -> 'variant_key'), '[]'::jsonb) from jsonb_array_elements(v_result -> 'variants') v)));
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.update_kit_definition(p_kit_definition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_n app.kit_definition%rowtype;
  v_constraint text;
begin
  select k.edition_id into v_edition_id from app.kit_definition k where k.kit_definition_id = p_kit_definition_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('KIT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['name', 'status', 'pickup_start_at', 'pickup_end_at', 'instructions']);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  select * into v_n from app.kit_definition k where k.kit_definition_id = p_kit_definition_id for update;
  if v_input ? 'name' then v_n.name := private.cfg_text(v_input, 'name', true, 120); end if;
  if v_input ? 'status' then v_n.status := private.cfg_enum(v_input, 'status', true, array['ACTIVE', 'INACTIVE']); end if;
  if v_input ? 'pickup_start_at' then v_n.pickup_start_at := private.cfg_timestamptz(v_input, 'pickup_start_at', false); end if;
  if v_input ? 'pickup_end_at' then v_n.pickup_end_at := private.cfg_timestamptz(v_input, 'pickup_end_at', false); end if;
  if v_input ? 'instructions' then v_n.instructions := private.cfg_text(v_input, 'instructions', false, 2000); end if;
  perform private.cfg_kit_window(v_n.pickup_start_at, v_n.pickup_end_at);

  update app.kit_definition set name = v_n.name, status = v_n.status, pickup_start_at = v_n.pickup_start_at,
    pickup_end_at = v_n.pickup_end_at, instructions = v_n.instructions
  where kit_definition_id = p_kit_definition_id;
  perform private.audit('KIT_DEFINITION_UPDATED', 'kit_definition', p_kit_definition_id, v_edition_id, null,
    jsonb_build_object('changed_fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_input) k)));
  return private.kit_projection(p_kit_definition_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

create or replace function private.create_kit_variant(p_kit_definition_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_id uuid;
  v_constraint text;
begin
  select k.edition_id into v_edition_id from app.kit_definition k where k.kit_definition_id = p_kit_definition_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('KIT_MANAGE', v_edition_id);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  v_id := private.cfg_insert_kit_variant(p_kit_definition_id, p_input, 'body');
  perform private.audit('KIT_VARIANT_CREATED', 'kit_variant', v_id, v_edition_id);
  return private.kit_projection(p_kit_definition_id);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- Capacity below live allocations needs an explicit acknowledgement; allocations are never touched.
create or replace function private.update_kit_variant(p_kit_variant_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_input jsonb;
  v_v app.kit_variant%rowtype;
  v_n app.kit_variant%rowtype;
  v_allocated integer;
  v_warnings jsonb := '[]'::jsonb;
  v_constraint text;
begin
  select k.edition_id into v_edition_id
  from app.kit_variant v join app.kit_definition k on k.kit_definition_id = v.kit_definition_id
  where v.kit_variant_id = p_kit_variant_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('KIT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['label', 'capacity', 'status', 'acknowledge_below_allocation']);
  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  select * into v_v from app.kit_variant v where v.kit_variant_id = p_kit_variant_id for update;
  v_n := v_v;
  if v_input ? 'label' then v_n.label := private.cfg_text(v_input, 'label', true, 80); end if;
  if v_input ? 'capacity' then v_n.capacity := private.cfg_int(v_input, 'capacity', false, 0, 1000000); end if;
  if v_input ? 'status' then v_n.status := private.cfg_enum(v_input, 'status', true, array['ACTIVE', 'INACTIVE']); end if;
  select count(*) into v_allocated from app.kit_allocation a where a.kit_variant_id = p_kit_variant_id and a.status <> 'CANCELED';
  if v_n.capacity is not null and v_n.capacity < v_allocated then
    if not coalesce(private.cfg_bool(v_input, 'acknowledge_below_allocation', false), false) then
      perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'capacity_below_allocation', 'allocated', v_allocated));
    end if;
    v_warnings := v_warnings || jsonb_build_object('code', 'CAPACITY_BELOW_ALLOCATION', 'allocated', v_allocated);
  end if;

  update app.kit_variant set label = v_n.label, capacity = v_n.capacity, status = v_n.status
  where kit_variant_id = p_kit_variant_id;
  perform private.audit('KIT_VARIANT_UPDATED', 'kit_variant', p_kit_variant_id, v_edition_id,
    jsonb_build_object('capacity', v_v.capacity, 'status', v_v.status), jsonb_build_object('capacity', v_n.capacity, 'status', v_n.status));
  return jsonb_build_object('kit', private.kit_projection(v_v.kit_definition_id), 'warnings', v_warnings);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.cfg_raise_constraint(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public facades (security invoker, same signature/name, ADR-001 §2) and grants.
-- ---------------------------------------------------------------------------------------------

create or replace function public.create_modality(p_edition_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_modality(p_edition_id, p_input, p_idempotency_key) $$;
create or replace function public.update_modality(p_modality_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_modality(p_modality_id, p_input) $$;
create or replace function public.set_modality_status(p_modality_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.set_modality_status(p_modality_id, p_input) $$;
create or replace function public.delete_modality(p_modality_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.delete_modality(p_modality_id) $$;
create or replace function public.set_modality_capacity(p_modality_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.set_modality_capacity(p_modality_id, p_input) $$;
create or replace function public.set_edition_global_capacity(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.set_edition_global_capacity(p_edition_id, p_input) $$;
create or replace function public.create_price_offer(p_modality_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_price_offer(p_modality_id, p_input, p_idempotency_key) $$;
create or replace function public.update_price_offer(p_price_offer_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_price_offer(p_price_offer_id, p_input) $$;
create or replace function public.create_category(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_category(p_edition_id, p_input) $$;
create or replace function public.update_category(p_category_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_category(p_category_id, p_input) $$;
create or replace function public.create_registration_form(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_registration_form(p_edition_id, p_input) $$;
create or replace function public.replace_registration_form_fields(p_registration_form_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.replace_registration_form_fields(p_registration_form_id, p_input) $$;
create or replace function public.publish_registration_form(p_registration_form_id uuid, p_idempotency_key text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.publish_registration_form(p_registration_form_id, p_idempotency_key) $$;
create or replace function public.delete_registration_form(p_registration_form_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.delete_registration_form(p_registration_form_id) $$;
create or replace function public.create_edition_location(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_edition_location(p_edition_id, p_input) $$;
create or replace function public.update_edition_location(p_location_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_edition_location(p_location_id, p_input) $$;
create or replace function public.delete_edition_location(p_location_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.delete_edition_location(p_location_id) $$;
create or replace function public.create_schedule_item(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_schedule_item(p_edition_id, p_input) $$;
create or replace function public.update_schedule_item(p_item_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_schedule_item(p_item_id, p_input) $$;
create or replace function public.delete_schedule_item(p_item_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.delete_schedule_item(p_item_id) $$;
create or replace function public.create_content_block(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_content_block(p_edition_id, p_input) $$;
create or replace function public.update_content_block(p_block_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_content_block(p_block_id, p_input) $$;
create or replace function public.delete_content_block(p_block_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.delete_content_block(p_block_id) $$;
create or replace function public.create_kit_definition(p_edition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_kit_definition(p_edition_id, p_input) $$;
create or replace function public.update_kit_definition(p_kit_definition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_kit_definition(p_kit_definition_id, p_input) $$;
create or replace function public.create_kit_variant(p_kit_definition_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_kit_variant(p_kit_definition_id, p_input) $$;
create or replace function public.update_kit_variant(p_kit_variant_id uuid, p_input jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_kit_variant(p_kit_variant_id, p_input) $$;

revoke all on function
  private.create_modality(uuid, jsonb, text), public.create_modality(uuid, jsonb, text),
  private.update_modality(uuid, jsonb), public.update_modality(uuid, jsonb),
  private.set_modality_status(uuid, jsonb), public.set_modality_status(uuid, jsonb),
  private.delete_modality(uuid), public.delete_modality(uuid),
  private.set_modality_capacity(uuid, jsonb), public.set_modality_capacity(uuid, jsonb),
  private.set_edition_global_capacity(uuid, jsonb), public.set_edition_global_capacity(uuid, jsonb),
  private.create_price_offer(uuid, jsonb, text), public.create_price_offer(uuid, jsonb, text),
  private.update_price_offer(uuid, jsonb), public.update_price_offer(uuid, jsonb),
  private.create_category(uuid, jsonb), public.create_category(uuid, jsonb),
  private.update_category(uuid, jsonb), public.update_category(uuid, jsonb),
  private.create_registration_form(uuid, jsonb), public.create_registration_form(uuid, jsonb),
  private.replace_registration_form_fields(uuid, jsonb), public.replace_registration_form_fields(uuid, jsonb),
  private.publish_registration_form(uuid, text), public.publish_registration_form(uuid, text),
  private.delete_registration_form(uuid), public.delete_registration_form(uuid),
  private.create_edition_location(uuid, jsonb), public.create_edition_location(uuid, jsonb),
  private.update_edition_location(uuid, jsonb), public.update_edition_location(uuid, jsonb),
  private.delete_edition_location(uuid), public.delete_edition_location(uuid),
  private.create_schedule_item(uuid, jsonb), public.create_schedule_item(uuid, jsonb),
  private.update_schedule_item(uuid, jsonb), public.update_schedule_item(uuid, jsonb),
  private.delete_schedule_item(uuid), public.delete_schedule_item(uuid),
  private.create_content_block(uuid, jsonb), public.create_content_block(uuid, jsonb),
  private.update_content_block(uuid, jsonb), public.update_content_block(uuid, jsonb),
  private.delete_content_block(uuid), public.delete_content_block(uuid),
  private.create_kit_definition(uuid, jsonb), public.create_kit_definition(uuid, jsonb),
  private.update_kit_definition(uuid, jsonb), public.update_kit_definition(uuid, jsonb),
  private.create_kit_variant(uuid, jsonb), public.create_kit_variant(uuid, jsonb),
  private.update_kit_variant(uuid, jsonb), public.update_kit_variant(uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  private.create_modality(uuid, jsonb, text), public.create_modality(uuid, jsonb, text),
  private.update_modality(uuid, jsonb), public.update_modality(uuid, jsonb),
  private.set_modality_status(uuid, jsonb), public.set_modality_status(uuid, jsonb),
  private.delete_modality(uuid), public.delete_modality(uuid),
  private.set_modality_capacity(uuid, jsonb), public.set_modality_capacity(uuid, jsonb),
  private.set_edition_global_capacity(uuid, jsonb), public.set_edition_global_capacity(uuid, jsonb),
  private.create_price_offer(uuid, jsonb, text), public.create_price_offer(uuid, jsonb, text),
  private.update_price_offer(uuid, jsonb), public.update_price_offer(uuid, jsonb),
  private.create_category(uuid, jsonb), public.create_category(uuid, jsonb),
  private.update_category(uuid, jsonb), public.update_category(uuid, jsonb),
  private.create_registration_form(uuid, jsonb), public.create_registration_form(uuid, jsonb),
  private.replace_registration_form_fields(uuid, jsonb), public.replace_registration_form_fields(uuid, jsonb),
  private.publish_registration_form(uuid, text), public.publish_registration_form(uuid, text),
  private.delete_registration_form(uuid), public.delete_registration_form(uuid),
  private.create_edition_location(uuid, jsonb), public.create_edition_location(uuid, jsonb),
  private.update_edition_location(uuid, jsonb), public.update_edition_location(uuid, jsonb),
  private.delete_edition_location(uuid), public.delete_edition_location(uuid),
  private.create_schedule_item(uuid, jsonb), public.create_schedule_item(uuid, jsonb),
  private.update_schedule_item(uuid, jsonb), public.update_schedule_item(uuid, jsonb),
  private.delete_schedule_item(uuid), public.delete_schedule_item(uuid),
  private.create_content_block(uuid, jsonb), public.create_content_block(uuid, jsonb),
  private.update_content_block(uuid, jsonb), public.update_content_block(uuid, jsonb),
  private.delete_content_block(uuid), public.delete_content_block(uuid),
  private.create_kit_definition(uuid, jsonb), public.create_kit_definition(uuid, jsonb),
  private.update_kit_definition(uuid, jsonb), public.update_kit_definition(uuid, jsonb),
  private.create_kit_variant(uuid, jsonb), public.create_kit_variant(uuid, jsonb),
  private.update_kit_variant(uuid, jsonb), public.update_kit_variant(uuid, jsonb)
to authenticated;
