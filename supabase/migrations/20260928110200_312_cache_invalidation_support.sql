-- T31c-cache-invalidation: small SQL support for wiring lib/server/cache/invalidation.ts into the
-- committed T30/T34 route handlers. Never edits committed migrations — only create-or-replace here.
--
-- 1) private.price_offer_projection and the four content delete commands (delete_modality,
--    delete_edition_location, delete_schedule_item, delete_content_block) now also return
--    edition_id, so their TS callers can build the `edition:<id>` cache tag without an extra fetch
--    (each function already resolved v_edition_id locally to authorize the command).
-- 2) private.cfg_media_ref now also requires the referenced app.event_media_asset to be PUBLISHED
--    (previously only checked existence + edition scope), closing the dangling-reference gap a code
--    review flagged after T31b-discovery-fixes: no command anywhere in the codebase yet creates or
--    publishes an event_media_asset row (that's future work), so this has zero blast radius on any
--    existing workflow or test today.

-- ---------------------------------------------------------------------------------------------
-- price_offer_projection: +edition_id (via app.modality). Consumers: priceOfferSchema (contracts.ts)
-- now declares edition_id too — this is the only producer of that shape, so the strictObject stays
-- exact. Everything else byte-identical to 20260928100200_302_events_configuration_commands.sql.
-- ---------------------------------------------------------------------------------------------
create or replace function private.price_offer_projection(p_price_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('price_offer_id', po.price_offer_id, 'modality_id', po.modality_id,
    'edition_id', m.edition_id, 'name', po.name,
    'amount_minor', po.amount_minor, 'currency', po.currency, 'starts_at', po.starts_at, 'ends_at', po.ends_at,
    'status', po.status, 'priority', po.priority, 'created_at', po.created_at, 'updated_at', po.updated_at)
  from app.price_offer po
  join app.modality m on m.modality_id = po.modality_id
  where po.price_offer_id = p_price_offer_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Delete commands: +edition_id in the result. Bodies are byte-identical to 302 except the final
-- return statement.
-- ---------------------------------------------------------------------------------------------
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
  return jsonb_build_object('modality_id', p_modality_id, 'deleted', true, 'edition_id', v_edition_id);
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
  return jsonb_build_object('edition_location_id', p_location_id, 'deleted', true, 'edition_id', v_edition_id);
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
  return jsonb_build_object('edition_schedule_item_id', p_item_id, 'deleted', true, 'edition_id', v_edition_id);
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
  return jsonb_build_object('event_content_block_id', p_block_id, 'deleted', true, 'edition_id', v_edition_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- cfg_media_ref: a referenced event_media_asset must be PUBLISHED, not merely exist in-edition.
-- ---------------------------------------------------------------------------------------------
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
       select 1 from app.event_media_asset a
       where a.event_media_asset_id = v_id and a.edition_id = p_edition_id and a.status = 'PUBLISHED') then
    perform private.raise_domain_error('NOT_FOUND', jsonb_build_object('field', p_field));
  end if;
  return v_id;
end;
$$;
