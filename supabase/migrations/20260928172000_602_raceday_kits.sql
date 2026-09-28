-- Kit Center: inventory, pickup (scan or manual/third-party), reversal, size change (Master §86-89, T40).
-- A Registration has at most one kit_allocation (schema-level unique), so "kit" below always means that
-- single allocation. Pickup shares the participant_pass_scan outcome vocabulary with the scanner (§85):
-- always 200 + `outcome`, never a thrown error for a scan-shaped rejection.

insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('raceday.kit_pickup:cmd', 240, 60, 'ACTOR', 'Master §179 kit pickup per staff/station (command)'),
  ('raceday.kit_manage:cmd', 120, 60, 'ACTOR', 'Master §179 kit reversal/size change per staff (command)')
on conflict (scope) do nothing;

create function private.raceday_kit_inventory(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('KIT_PICKUP_RECORD', p_edition_id);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'kit_definition_id', kd.kit_definition_id, 'name', kd.name, 'status', kd.status,
        'pickup_start_at', kd.pickup_start_at, 'pickup_end_at', kd.pickup_end_at,
        'variants', coalesce((
          select jsonb_agg(jsonb_build_object(
              'kit_variant_id', kv.kit_variant_id, 'variant_key', kv.variant_key, 'label', kv.label,
              'status', kv.status, 'capacity', kv.capacity,
              'allocated_count', (select count(*) from app.kit_allocation a where a.kit_variant_id = kv.kit_variant_id and a.status <> 'CANCELED'),
              'delivered_count', (select count(*) from app.kit_allocation a where a.kit_variant_id = kv.kit_variant_id and a.status = 'DELIVERED'),
              'pending_count', (select count(*) from app.kit_allocation a where a.kit_variant_id = kv.kit_variant_id and a.status in ('ASSIGNED', 'READY')),
              'exception_count', (select count(*) from app.kit_allocation a where a.kit_variant_id = kv.kit_variant_id and a.status = 'EXCEPTION'),
              'available', case when kv.capacity is null then null
                else greatest(kv.capacity - (select count(*) from app.kit_allocation a where a.kit_variant_id = kv.kit_variant_id and a.status <> 'CANCELED'), 0) end)
            order by kv.variant_key)
          from app.kit_variant kv where kv.kit_definition_id = kd.kit_definition_id), '[]'::jsonb))
      order by kd.name)
    from app.kit_definition kd where kd.edition_id = p_edition_id), '[]'::jsonb));
end;
$$;

-- p_scan_reference (QR) or p_registration_id (manual/third-party lookup), never both. Locks the kit
-- allocation so a duplicate scan/tap never delivers twice ("must prove" concurrency case).
create function private.raceday_record_kit_pickup(
  p_edition_id uuid, p_kit_definition_id uuid, p_scan_reference text default null, p_registration_id uuid default null,
  p_station_key text default null, p_third_party boolean default false, p_third_party_reason text default null,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_idem jsonb;
  v_lock record;
  v_registration_id uuid;
  v_edition_id uuid;
  v_registration_status text;
  v_pass_id uuid;
  v_credential_id uuid;
  v_outcome text;
  v_allocation record;
  v_kd record;
  v_method text;
  v_pickup_id uuid;
  v_scan_id uuid;
  v_result jsonb;
begin
  v_staff := private.require_permission('KIT_PICKUP_RECORD', p_edition_id);
  if (p_scan_reference is null) = (p_registration_id is null) then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'scan_reference_or_registration_id'));
  end if;
  if p_scan_reference is not null and p_scan_reference !~ '^[0-9a-f]{64}$' then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'credential_token'));
  end if;
  if p_third_party and (pg_catalog.btrim(coalesce(p_third_party_reason, '')) = '' or pg_catalog.char_length(p_third_party_reason) > 500) then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'third_party_reason'));
  end if;
  perform private.consume_policy_rate_limit('raceday.kit_pickup:cmd', auth.uid()::text);

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('raceday.kit_pickup', coalesce(p_registration_id::text, p_scan_reference), p_idempotency_key,
      jsonb_build_object('edition_id', p_edition_id, 'kit_definition_id', p_kit_definition_id,
        'registration_id', p_registration_id, 'third_party', coalesce(p_third_party, false)));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  if p_scan_reference is not null then
    select * into v_lock from private.raceday_lock_pass_by_scan(p_scan_reference);
    v_pass_id := v_lock.participant_pass_id;
    v_credential_id := v_lock.credential_id;
    v_registration_id := v_lock.registration_id;
    v_edition_id := v_lock.edition_id;
    v_registration_status := v_lock.registration_status;
    if v_pass_id is null then
      v_outcome := 'UNKNOWN_PASS';
    elsif v_lock.credential_status = 'REVOKED' then
      v_outcome := 'REVOKED_CREDENTIAL';
    elsif v_lock.credential_status = 'REPLACED' then
      v_outcome := 'REPLACED_CREDENTIAL';
    end if;
    v_method := 'QR_SCAN';
  else
    select r.registration_id, r.edition_id, r.status into v_registration_id, v_edition_id, v_registration_status
    from app.registration r where r.registration_id = p_registration_id for update;
    if v_registration_id is null then
      perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'registration_id'));
    end if;
    v_method := 'MANUAL_LOOKUP';
  end if;
  if p_third_party then
    v_method := 'THIRD_PARTY';
  end if;

  if v_outcome is null and v_registration_status = 'CANCELED' then
    v_outcome := 'CANCELED_REGISTRATION';
  elsif v_outcome is null and v_registration_status <> 'CONFIRMED' then
    v_outcome := 'REGISTRATION_NOT_CONFIRMED';
  elsif v_outcome is null and v_edition_id <> p_edition_id then
    v_outcome := 'WRONG_EVENT';
  end if;

  if v_outcome is null then
    select a.kit_allocation_id, a.kit_definition_id, a.kit_variant_id, a.status
    into v_allocation
    from app.kit_allocation a where a.registration_id = v_registration_id
    for update;
    select kd.kit_definition_id, kd.pickup_start_at, kd.pickup_end_at into v_kd
    from app.kit_definition kd where kd.kit_definition_id = p_kit_definition_id and kd.edition_id = p_edition_id;
    if v_kd.kit_definition_id is null then
      perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', 'kit_definition_id'));
    end if;
    if v_allocation.kit_allocation_id is null or v_allocation.kit_definition_id <> p_kit_definition_id then
      v_outcome := 'OTHER_REVIEW';
    elsif v_allocation.status = 'DELIVERED' then
      v_outcome := 'ALREADY_CHECKED_IN';
    elsif v_allocation.status not in ('ASSIGNED', 'READY') then
      v_outcome := 'OTHER_REVIEW';
    elsif v_kd.pickup_start_at is not null and pg_catalog.now() < v_kd.pickup_start_at then
      v_outcome := 'NOT_YET_ALLOWED';
    elsif v_kd.pickup_end_at is not null and pg_catalog.now() > v_kd.pickup_end_at then
      v_outcome := 'OTHER_REVIEW';
    end if;
  end if;

  if v_outcome is null then
    v_outcome := 'VALID';
    insert into app.kit_pickup
      (registration_id, kit_allocation_id, participant_pass_credential_id, edition_id, status,
       delivered_by_staff_id, station_key, verification_method, third_party_reason)
    values (v_registration_id, v_allocation.kit_allocation_id, v_credential_id, p_edition_id, 'DELIVERED',
      v_staff, p_station_key, v_method, case when p_third_party then p_third_party_reason end)
    returning kit_pickup_id into v_pickup_id;
    update app.kit_allocation set status = 'DELIVERED' where kit_allocation_id = v_allocation.kit_allocation_id;
    perform private.audit('KIT_DELIVERED', 'kit_allocation', v_allocation.kit_allocation_id, p_edition_id,
      jsonb_build_object('status', v_allocation.status), jsonb_build_object('status', 'DELIVERED', 'verification_method', v_method));
    perform private.enqueue_outbox('KitDelivered', 'KitAllocation', v_allocation.kit_allocation_id,
      'KitDelivered:' || v_allocation.kit_allocation_id,
      jsonb_build_object('kit_allocation_id', v_allocation.kit_allocation_id, 'registration_id', v_registration_id, 'edition_id', p_edition_id));
  end if;

  insert into app.participant_pass_scan
    (participant_pass_id, participant_pass_credential_id, edition_id, operation_type, outcome, staff_member_id, station_key,
     metadata)
  values (v_pass_id, v_credential_id, p_edition_id, 'KIT_PICKUP', v_outcome, v_staff, p_station_key,
    jsonb_build_object('kit_definition_id', p_kit_definition_id))
  returning participant_pass_scan_id into v_scan_id;
  if v_outcome = 'UNKNOWN_PASS' then
    perform private.raceday_flag_unknown_pass_burst(p_edition_id, v_staff, p_station_key);
  end if;

  v_result := jsonb_build_object(
    'participant_pass_scan_id', v_scan_id, 'kit_pickup_id', v_pickup_id, 'outcome', v_outcome,
    'participant', case when v_registration_id is not null then private.raceday_participant_view(v_registration_id, p_edition_id) end);
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

create function private.raceday_reverse_kit_pickup(p_kit_pickup_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_idem jsonb;
  v_reason text := pg_catalog.btrim(p_reason);
  v_pickup record;
  v_result jsonb;
begin
  select p.kit_pickup_id, p.edition_id, p.kit_allocation_id, p.status
  into v_pickup
  from app.kit_pickup p where p.kit_pickup_id = p_kit_pickup_id;
  if v_pickup.kit_pickup_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff := private.require_permission('KIT_MANAGE', v_pickup.edition_id);
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  perform private.consume_policy_rate_limit('raceday.kit_manage:cmd', auth.uid()::text);

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('raceday.kit_pickup_reverse', p_kit_pickup_id::text, p_idempotency_key,
      jsonb_build_object('kit_pickup_id', p_kit_pickup_id, 'reason', v_reason));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  perform 1 from app.kit_allocation a where a.kit_allocation_id = v_pickup.kit_allocation_id for update;
  select p.kit_pickup_id, p.edition_id, p.kit_allocation_id, p.status into v_pickup
  from app.kit_pickup p where p.kit_pickup_id = p_kit_pickup_id for update;
  if v_pickup.status <> 'DELIVERED' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'ALREADY_REVERSED'));
  end if;

  update app.kit_pickup
  set status = 'REVERSED', reversed_at = pg_catalog.now(), reversed_by_staff_id = v_staff, reversal_reason = v_reason
  where kit_pickup_id = p_kit_pickup_id;
  update app.kit_allocation set status = 'ASSIGNED' where kit_allocation_id = v_pickup.kit_allocation_id;
  perform private.audit('KIT_PICKUP_REVERSED', 'kit_allocation', v_pickup.kit_allocation_id, v_pickup.edition_id,
    jsonb_build_object('status', 'DELIVERED'), jsonb_build_object('status', 'ASSIGNED'), v_reason);
  perform private.enqueue_outbox('KitPickupReversed', 'KitAllocation', v_pickup.kit_allocation_id,
    'KitPickupReversed:' || p_kit_pickup_id,
    jsonb_build_object('kit_pickup_id', p_kit_pickup_id, 'kit_allocation_id', v_pickup.kit_allocation_id, 'edition_id', v_pickup.edition_id));

  v_result := jsonb_build_object('kit_pickup_id', p_kit_pickup_id, 'status', 'REVERSED');
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

-- Master §88 size change: staff validates the new variant's availability and updates the allocation, audited.
create function private.raceday_change_kit_allocation_size(
  p_kit_allocation_id uuid, p_new_kit_variant_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_idem jsonb;
  v_reason text := pg_catalog.btrim(p_reason);
  v_edition_id uuid;
  v_kit_definition_id uuid;
  v_alloc record;
  v_variant record;
  v_taken integer;
  v_result jsonb;
begin
  select a.kit_definition_id, r.edition_id into v_kit_definition_id, v_edition_id
  from app.kit_allocation a join app.registration r on r.registration_id = a.registration_id
  where a.kit_allocation_id = p_kit_allocation_id;
  if v_kit_definition_id is null then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  v_staff := private.require_permission('KIT_MANAGE', v_edition_id);
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 500 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  perform private.consume_policy_rate_limit('raceday.kit_manage:cmd', auth.uid()::text);

  if p_idempotency_key is not null then
    v_idem := private.idempotency_begin('raceday.kit_allocation_size', p_kit_allocation_id::text, p_idempotency_key,
      jsonb_build_object('kit_allocation_id', p_kit_allocation_id, 'new_kit_variant_id', p_new_kit_variant_id, 'reason', v_reason));
    if (v_idem ->> 'replay')::boolean then
      return v_idem -> 'response_body';
    end if;
  end if;

  select a.kit_allocation_id, a.kit_variant_id, a.status into v_alloc
  from app.kit_allocation a where a.kit_allocation_id = p_kit_allocation_id for update;
  if v_alloc.status = 'DELIVERED' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'ALREADY_DELIVERED'));
  end if;
  if v_alloc.status = 'CANCELED' then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'ALLOCATION_CANCELED'));
  end if;
  if v_alloc.kit_variant_id = p_new_kit_variant_id then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'new_kit_variant_id', 'reason', 'unchanged'));
  end if;

  -- Locks the target variant so two concurrent size changes onto the same capacity-limited variant
  -- serialize instead of both reading "0 taken" and both succeeding (capacity is a count over other
  -- allocation rows, not a field on this row, so only a lock on the variant itself closes the race).
  select kv.kit_variant_id, kv.capacity into v_variant
  from app.kit_variant kv where kv.kit_variant_id = p_new_kit_variant_id and kv.kit_definition_id = v_kit_definition_id and kv.status = 'ACTIVE'
  for update;
  if v_variant.kit_variant_id is null then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'new_kit_variant_id'));
  end if;
  if v_variant.capacity is not null then
    select count(*) into v_taken from app.kit_allocation a
    where a.kit_variant_id = p_new_kit_variant_id and a.status <> 'CANCELED' and a.kit_allocation_id <> p_kit_allocation_id;
    if v_taken >= v_variant.capacity then
      perform private.raise_domain_error('CAPACITY_UNAVAILABLE', jsonb_build_object('kit_variant_id', p_new_kit_variant_id));
    end if;
  end if;

  update app.kit_allocation set kit_variant_id = p_new_kit_variant_id where kit_allocation_id = p_kit_allocation_id;
  perform private.audit('KIT_ALLOCATION_SIZE_CHANGED', 'kit_allocation', p_kit_allocation_id, v_edition_id,
    jsonb_build_object('kit_variant_id', v_alloc.kit_variant_id), jsonb_build_object('kit_variant_id', p_new_kit_variant_id), v_reason);
  perform private.enqueue_outbox('KitAllocationSizeChanged', 'KitAllocation', p_kit_allocation_id,
    'KitAllocationSizeChanged:' || p_kit_allocation_id || ':' || p_new_kit_variant_id,
    jsonb_build_object('kit_allocation_id', p_kit_allocation_id, 'kit_variant_id', p_new_kit_variant_id));

  v_result := jsonb_build_object('kit_allocation_id', p_kit_allocation_id, 'kit_variant_id', p_new_kit_variant_id, 'status', v_alloc.status);
  if v_idem is not null then
    perform private.idempotency_complete((v_idem ->> 'record_id')::uuid, 200, v_result);
  end if;
  return v_result;
end;
$$;

create function public.raceday_kit_inventory(p_edition_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.raceday_kit_inventory(p_edition_id) $$;
create function public.raceday_record_kit_pickup(
  p_edition_id uuid, p_kit_definition_id uuid, p_scan_reference text default null, p_registration_id uuid default null,
  p_station_key text default null, p_third_party boolean default false, p_third_party_reason text default null,
  p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.raceday_record_kit_pickup(p_edition_id, p_kit_definition_id, p_scan_reference, p_registration_id,
  p_station_key, p_third_party, p_third_party_reason, p_idempotency_key) $$;
create function public.raceday_reverse_kit_pickup(p_kit_pickup_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.raceday_reverse_kit_pickup(p_kit_pickup_id, p_reason, p_idempotency_key) $$;
create function public.raceday_change_kit_allocation_size(
  p_kit_allocation_id uuid, p_new_kit_variant_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.raceday_change_kit_allocation_size(p_kit_allocation_id, p_new_kit_variant_id, p_reason, p_idempotency_key) $$;

revoke all on function
  private.raceday_kit_inventory(uuid), public.raceday_kit_inventory(uuid),
  private.raceday_record_kit_pickup(uuid, uuid, text, uuid, text, boolean, text, text),
  public.raceday_record_kit_pickup(uuid, uuid, text, uuid, text, boolean, text, text),
  private.raceday_reverse_kit_pickup(uuid, text, text), public.raceday_reverse_kit_pickup(uuid, text, text),
  private.raceday_change_kit_allocation_size(uuid, uuid, text, text), public.raceday_change_kit_allocation_size(uuid, uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.raceday_kit_inventory(uuid), public.raceday_kit_inventory(uuid),
  private.raceday_record_kit_pickup(uuid, uuid, text, uuid, text, boolean, text, text),
  public.raceday_record_kit_pickup(uuid, uuid, text, uuid, text, boolean, text, text),
  private.raceday_reverse_kit_pickup(uuid, text, text), public.raceday_reverse_kit_pickup(uuid, text, text),
  private.raceday_change_kit_allocation_size(uuid, uuid, text, text), public.raceday_change_kit_allocation_size(uuid, uuid, text, text)
to authenticated;
