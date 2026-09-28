-- T31b discovery fixes (F1 follow-up, small/surgical — see .local-state/envelopes/T31b-discovery-fixes.md):
-- 1) search_editions distance_min_m/max_m must be satisfied by the SAME Modality.
-- 2) Event page media now carries event_media_asset_id so IMAGE/GALLERY/SPONSOR_GROUP content
--    blocks (which reference media by that id — private.cfg_media_ref) can resolve their asset; the
--    delivery-URL conversion itself is a TS-side fix (lib/server/domain/discovery/seo.ts uses
--    lib/shared/media-url.ts — pure, client-safe, Cloudinary-only per ADR-001 Amendment 1 A9).
-- 3) Public reads for the library filter (active event types) and the platform contact (effective
--    default WhatsApp only — nothing else from platform_settings, which has no RLS policy for any
--    API role and is otherwise definer-only).
-- Never edits the committed 20260928110000_310_discovery_queries.sql — only create-or-replace here.

-- ---------------------------------------------------------------------------------------------
-- Fix 1: private.search_editions — distance_min_m/max_m bound the SAME Modality (a 5K+21K Edition
-- must not match a 6-10km range just because one Modality clears the min and another clears the
-- max independently). Everything else is byte-identical to 20260928110000_310_discovery_queries.sql.
-- ---------------------------------------------------------------------------------------------
create or replace function private.search_editions(
  p_q text default null, p_type text[] default null, p_date_from date default null, p_date_to date default null,
  p_distance_min_m integer default null, p_distance_max_m integer default null, p_location text default null,
  p_price text[] default null, p_registration_open boolean default null,
  p_cursor_bucket integer default null, p_cursor_sort_num numeric default null, p_cursor_id uuid default null,
  p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q text := nullif(private.normalize_search_text(coalesce(p_q, '')), '');
  v_location text := nullif(private.normalize_search_text(coalesce(p_location, '')), '');
  v_type text[] := nullif(p_type, array[]::text[]);
  v_price text[] := nullif(p_price, array[]::text[]);
  v_rows jsonb;
begin
  if p_distance_min_m is not null and p_distance_min_m < 0 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'distance_min_m'));
  end if;
  if p_distance_max_m is not null and p_distance_min_m is not null and p_distance_max_m < p_distance_min_m then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'distance_max_m'));
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'date_to'));
  end if;
  if v_price is not null and exists (select 1 from unnest(v_price) as val where val not in ('FREE', 'PAID')) then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'price'));
  end if;

  with base as (
    select e.edition_id, (private.current_schedule(e.edition_id) ->> 'local_date')::date as sport_date
    from app.edition e
    join app.event ev on ev.event_id = e.event_id
    join app.event_type et on et.event_type_id = ev.event_type_id
    where e.publication_state = 'PUBLISHED'
      and (v_q is null or pg_catalog.strpos(private.normalize_search_text(e.name), v_q) > 0
           or pg_catalog.strpos(private.normalize_search_text(ev.name), v_q) > 0
           or pg_catalog.strpos(private.normalize_search_text(e.city), v_q) > 0)
      and (v_location is null or pg_catalog.strpos(private.normalize_search_text(e.city), v_location) > 0
           or pg_catalog.strpos(private.normalize_search_text(e.state_region), v_location) > 0)
      and (v_type is null or et.key = any (v_type))
      and (v_price is null
           or (('FREE' = any (v_price)) and e.registration_mode = 'FREE')
           or (('PAID' = any (v_price)) and e.registration_mode <> 'FREE'))
      and (p_registration_open is distinct from true or e.registration_state = 'OPEN')
      -- Fix 1: both bounds (when present) must be satisfied by the same row, not by two different
      -- Modalities independently (a race-distance range, not "the Edition has something below max
      -- and something above min" — those are unrelated Modalities on a multi-distance Edition).
      and (
        (p_distance_min_m is null and p_distance_max_m is null) or exists (
          select 1 from app.modality m where m.edition_id = e.edition_id and m.status <> 'CANCELED'
            and m.official_distance_m is not null
            and (p_distance_min_m is null or m.official_distance_m >= p_distance_min_m)
            and (p_distance_max_m is null or m.official_distance_m <= p_distance_max_m)))
  ), ranked as (
    select b.edition_id, b.sport_date,
      case when b.sport_date is null or b.sport_date >= current_date then 0 else 1 end as bucket,
      case when b.sport_date is null or b.sport_date >= current_date
        then extract(epoch from coalesce(b.sport_date, date '9999-12-31'))
        else -extract(epoch from b.sport_date) end as sort_num
    from base b
    where (p_date_from is null or (b.sport_date is not null and b.sport_date >= p_date_from))
      and (p_date_to is null or (b.sport_date is not null and b.sport_date <= p_date_to))
  )
  select coalesce(jsonb_agg(t.obj order by t.bucket, t.sort_num, t.edition_id), '[]'::jsonb)
  into v_rows
  from (
    select r.bucket, r.sort_num, r.edition_id,
      jsonb_build_object('bucket', r.bucket, 'sort_num', r.sort_num, 'edition_id', r.edition_id,
        'card', private.discovery_card_projection(r.edition_id)) as obj
    from ranked r
    where p_cursor_bucket is null or (r.bucket, r.sort_num, r.edition_id) > (p_cursor_bucket, p_cursor_sort_num, p_cursor_id)
    order by r.bucket, r.sort_num, r.edition_id
    limit v_limit + 1
  ) t;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(x -> 'card' order by o)
      from jsonb_array_elements(v_rows) with ordinality tt(x, o)
      where o <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then jsonb_build_object(
      'bucket', v_rows -> (v_limit - 1) -> 'bucket', 'sort_num', v_rows -> (v_limit - 1) -> 'sort_num',
      'edition_id', v_rows -> (v_limit - 1) -> 'edition_id') end);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Fix 2: private.discovery_page_projection — 'media' entries now carry event_media_asset_id so the
-- frontend can match an IMAGE/GALLERY/SPONSOR_GROUP content block's payload.event_media_asset_id
-- (private.cfg_media_ref, 20260928100200_302) to its resolved storage_object_key. Everything else is
-- byte-identical to 20260928110000_310_discovery_queries.sql.
-- ---------------------------------------------------------------------------------------------
create or replace function private.discovery_page_projection(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'edition', private.edition_projection(e.edition_id),
    'event', private.event_projection(e.event_id),
    'whatsapp', private.effective_whatsapp(e.edition_id),
    'availability', private.discovery_public_availability(e.edition_id),
    'is_past', (private.current_schedule(e.edition_id) ->> 'local_date') is not null
      and (private.current_schedule(e.edition_id) ->> 'local_date')::date < current_date,
    'modalities', coalesce((
      select jsonb_agg(private.modality_projection(m.modality_id)
                        || jsonb_build_object('price', private.resolve_modality_price(m.modality_id, now()),
                                               'effective_start', private.effective_start(e.edition_id, m.modality_id))
                        order by m.sort_order, m.key)
      from app.modality m where m.edition_id = e.edition_id and m.status in ('ACTIVE', 'CLOSED')), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(private.category_projection(c.category_id) order by c.sort_order, c.key)
      from app.category c where c.edition_id = e.edition_id and c.active), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(private.location_projection(l.edition_location_id) order by l.sort_order)
      from app.edition_location l where l.edition_id = e.edition_id), '[]'::jsonb),
    'agenda', coalesce((
      select jsonb_agg(private.schedule_item_projection(i.edition_schedule_item_id) order by i.sort_order)
      from app.edition_schedule_item i where i.edition_id = e.edition_id and i.status = 'ACTIVE'), '[]'::jsonb),
    'content_blocks', coalesce((
      select jsonb_agg(private.content_block_projection(b.event_content_block_id) order by b.position)
      from app.event_content_block b where b.edition_id = e.edition_id and b.status = 'PUBLISHED'), '[]'::jsonb),
    'kits', coalesce((
      select jsonb_agg(private.discovery_kit_projection(k.kit_definition_id) order by k.created_at)
      from app.kit_definition k where k.edition_id = e.edition_id and k.status = 'ACTIVE'), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object('event_media_asset_id', a.event_media_asset_id,
          'storage_object_key', a.storage_object_key, 'alt_text', a.alt_text,
          'media_type', a.media_type, 'sort_order', a.sort_order, 'focal_point', a.focal_point) order by a.sort_order)
      from app.event_media_asset a where a.edition_id = e.edition_id and a.status = 'PUBLISHED'), '[]'::jsonb))
  from app.edition e
  where e.edition_id = p_edition_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Fix 3a: active event types for the public library filter (Master §165 `type` param).
-- ---------------------------------------------------------------------------------------------
create or replace function private.get_active_event_types()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name) order by t.name), '[]'::jsonb)
  from app.event_type t
  where t.active
$$;

create or replace function public.get_active_event_types()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_active_event_types() $$;

-- ---------------------------------------------------------------------------------------------
-- Fix 3b: platform public contact — the effective default WhatsApp number only (never any other
-- platform_settings column: hold/close-offset minutes, OTP expiry, availability threshold are
-- operational config, not public data). NULL when not configured (ADR A14/PEND-OPS-001).
-- ---------------------------------------------------------------------------------------------
create or replace function private.get_public_platform_contact()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('whatsapp_phone_e164',
    (select s.default_whatsapp_phone_e164 from app.platform_settings s where s.settings_id = 1))
$$;

create or replace function public.get_public_platform_contact()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_public_platform_contact() $$;

revoke all on function
  private.get_active_event_types(), public.get_active_event_types(),
  private.get_public_platform_contact(), public.get_public_platform_contact()
from public, anon, authenticated, service_role;

grant execute on function
  private.get_active_event_types(), public.get_active_event_types(),
  private.get_public_platform_contact(), public.get_public_platform_contact()
to anon, authenticated;
