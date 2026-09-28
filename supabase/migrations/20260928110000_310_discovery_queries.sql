-- T31 public discovery read side (Master §53-60, §165): event library search/filter/sort,
-- event page data (levels 1-3), home data, sitemap entries and slug redirects. Read models expose
-- only PUBLISHED Editions and public-safe fields (no drafts, no staff ids, no PII) — SEC-008/051/052.
-- Uses the T30 kernel only (KERNEL_READY.md): current_schedule, effective_start,
-- resolve_modality_price, edition_availability, resolve_edition_slug. Never re-implements
-- availability/price/schedule rules. Never locks or mutates.

-- ---------------------------------------------------------------------------------------------
-- Public-safe availability reshape (Master §36-37): drops raw counts, keeps state only. Mirrors
-- the shape of the already-frozen public.get_edition_availability facade (KERNEL_READY.md) but is
-- reimplemented here (not called cross-schema) so every discovery projection stays inside
-- private.* internal calls, matching the rest of the codebase's convention. NULL for unknown Edition.
-- ---------------------------------------------------------------------------------------------
create or replace function private.discovery_public_availability(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_full jsonb := private.edition_availability(p_edition_id);
  v_edition app.edition%rowtype;
begin
  if v_full is null then return null; end if;
  select * into v_edition from app.edition e where e.edition_id = p_edition_id;
  return jsonb_build_object(
    'edition_id', p_edition_id,
    'registration_state', v_edition.registration_state,
    'execution_state', v_edition.execution_state,
    'global_state', v_full -> 'global' ->> 'state',
    'modalities', coalesce((
      select jsonb_agg(jsonb_build_object('modality_id', mm.m ->> 'modality_id', 'status', mm.m ->> 'status', 'state', mm.m ->> 'state')
                        order by mm.ord)
      from jsonb_array_elements(v_full -> 'modalities') with ordinality as mm(m, ord)
      where mm.m ->> 'status' <> 'CANCELED'), '[]'::jsonb));
end;
$$;

-- Card price/distance summary (Master §57: never a single misleading value when Modalities differ).
-- is_free is NOT derived here: Edition.registration_mode is the single source of truth
-- (KERNEL_READY.md — "FREE is never inferred from missing offers").
create or replace function private.discovery_modality_summary(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*),
    'min_distance_m', min(m.official_distance_m),
    'max_distance_m', max(m.official_distance_m),
    'distance_varies', min(m.official_distance_m) is distinct from max(m.official_distance_m),
    'min_amount_minor', min((pr.value ->> 'amount_minor')::bigint),
    'max_amount_minor', max((pr.value ->> 'amount_minor')::bigint),
    'currency', max(pr.value ->> 'currency'),
    'price_varies', min((pr.value ->> 'amount_minor')::bigint) is distinct from max((pr.value ->> 'amount_minor')::bigint),
    -- coalesce: bool_or (like every aggregate but count(*)) is NULL over zero rows — an Edition
    -- whose Modalities are all CANCELED still yields one summary row (count:0), and price_pending
    -- must stay a real boolean or the strict zod schema fails the whole card/page response closed.
    'price_pending', coalesce(bool_or(pr.value is null), false))
  from app.modality m
  left join lateral (select private.resolve_modality_price(m.modality_id, now()) as value) pr on true
  where m.edition_id = p_edition_id and m.status in ('ACTIVE', 'CLOSED')
$$;

-- Kit info for the public Event page (Master §58 Level 2 "kit"): variant labels only, no staff-facing
-- allocation counts (that stays admin-only in private.kit_projection).
create or replace function private.discovery_kit_projection(p_kit_definition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('kit_definition_id', k.kit_definition_id, 'name', k.name, 'status', k.status,
    'pickup_start_at', k.pickup_start_at, 'pickup_end_at', k.pickup_end_at, 'instructions', k.instructions,
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object('kit_variant_id', v.kit_variant_id, 'variant_key', v.variant_key,
          'label', v.label, 'status', v.status) order by v.variant_key)
      from app.kit_variant v where v.kit_definition_id = k.kit_definition_id and v.status = 'ACTIVE'), '[]'::jsonb))
  from app.kit_definition k
  where k.kit_definition_id = p_kit_definition_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Event Card projection (Master §57, §191 payload budget: minimal). Callable for any Edition id;
-- callers (search_editions/get_home_data) only ever feed PUBLISHED ones in.
-- ---------------------------------------------------------------------------------------------
create or replace function private.discovery_card_projection(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'edition_id', e.edition_id, 'slug', e.slug, 'name', e.name,
    'city', e.city, 'state_region', e.state_region, 'country_code', e.country_code,
    'sport_date', (private.current_schedule(e.edition_id) ->> 'local_date'),
    'registration_state', e.registration_state, 'execution_state', e.execution_state,
    'registration_mode', e.registration_mode,
    'availability', private.discovery_public_availability(e.edition_id),
    'modality_summary', private.discovery_modality_summary(e.edition_id),
    'image', (
      select jsonb_build_object('storage_object_key', a.storage_object_key, 'alt_text', a.alt_text)
      from app.event_media_asset a
      where a.edition_id = e.edition_id and a.status = 'PUBLISHED'
      order by a.sort_order, a.created_at
      limit 1))
  from app.edition e
  where e.edition_id = p_edition_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Event Page projection (Master §58, levels 1-3). PUBLISHED-only sub-resources: ACTIVE/CLOSED
-- Modalities (never CANCELED), active Categories, ACTIVE agenda items, PUBLISHED content blocks,
-- ACTIVE kits, PUBLISHED media. Reuses the T30 admin projections where their fields are already
-- public-safe (edition/event/modality/category/location/schedule_item/content_block).
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
    -- edition.whatsapp_phone_e164 (inside edition_projection) is the Edition's OWN number only
    -- (NULL when it relies on the platform default). `whatsapp` here is the resolved one
    -- (KERNEL_READY.md private.effective_whatsapp — Edition wins, else PLATFORM, else not
    -- configured) so an EXTERNAL_WHATSAPP Edition without its own number still shows a contact.
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
      select jsonb_agg(jsonb_build_object('storage_object_key', a.storage_object_key, 'alt_text', a.alt_text,
          'media_type', a.media_type, 'sort_order', a.sort_order, 'focal_point', a.focal_point) order by a.sort_order)
      from app.event_media_asset a where a.edition_id = e.edition_id and a.status = 'PUBLISHED'), '[]'::jsonb))
  from app.edition e
  where e.edition_id = p_edition_id
$$;

-- ---------------------------------------------------------------------------------------------
-- GET /api/v1/events/:slug (Master §165, §59): resolves current or historical slug, applies the
-- publication filter itself (resolve_edition_slug has none — SEC: never leak a DRAFT/HIDDEN
-- Edition's existence through a slug guess, current or historical alike). NULL = unknown/hidden (404).
-- redirect=true: caller must send a permanent redirect to `slug` (Master §59 "permanent redirect").
-- ---------------------------------------------------------------------------------------------
create or replace function private.get_edition_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resolved jsonb := private.resolve_edition_slug(p_slug);
  v_edition_id uuid;
  v_pub_state text;
begin
  if v_resolved is null then return null; end if;
  v_edition_id := (v_resolved ->> 'edition_id')::uuid;
  select e.publication_state into v_pub_state from app.edition e where e.edition_id = v_edition_id;
  if v_pub_state is distinct from 'PUBLISHED' then return null; end if;
  if (v_resolved ->> 'redirect')::boolean then
    return jsonb_build_object('redirect', true, 'slug', v_resolved ->> 'slug');
  end if;
  return jsonb_build_object('redirect', false, 'edition', private.discovery_page_projection(v_edition_id));
end;
$$;

-- Fresh (never cached — Master §60) availability for the Event page's CTA, resolved by slug so the
-- page never needs a second lookup for the Edition id. Same publication guard as get_edition_page.
create or replace function private.get_edition_page_availability(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resolved jsonb := private.resolve_edition_slug(p_slug);
  v_edition_id uuid;
  v_pub_state text;
begin
  if v_resolved is null then return null; end if;
  v_edition_id := (v_resolved ->> 'edition_id')::uuid;
  select e.publication_state into v_pub_state from app.edition e where e.edition_id = v_edition_id;
  if v_pub_state is distinct from 'PUBLISHED' then return null; end if;
  return private.discovery_public_availability(v_edition_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Home data (Master §53): only the dynamic slots. Hero/biblioteca/informacion/contacto/footer are
-- static content owned by the frontend, not this domain. community_slot is a placeholder — ranking
-- data is T42's (Master §53: "expose a slot").
-- ---------------------------------------------------------------------------------------------
create or replace function private.get_home_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'upcoming', coalesce((
      select jsonb_agg(private.discovery_card_projection(y.edition_id) order by y.sport_date, y.edition_id)
      from (
        select x.edition_id, x.sport_date
        from (
          select e.edition_id, (private.current_schedule(e.edition_id) ->> 'local_date')::date as sport_date
          from app.edition e
          where e.publication_state = 'PUBLISHED'
        ) x
        where x.sport_date is not null and x.sport_date >= current_date
        order by x.sport_date, x.edition_id
        limit 6
      ) y), '[]'::jsonb),
    'community_slot', jsonb_build_object('available', false, 'reason', 'ranking_pending_t42'));
$$;

-- ---------------------------------------------------------------------------------------------
-- Sitemap entries (Master §59): every PUBLISHED Edition's current slug + lastmod basis.
-- ---------------------------------------------------------------------------------------------
create or replace function private.get_sitemap_entries()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', e.slug, 'updated_at', e.updated_at, 'published_at', e.published_at)
                   order by e.slug), '[]'::jsonb)
  from app.edition e
  where e.publication_state = 'PUBLISHED'
$$;

-- ---------------------------------------------------------------------------------------------
-- GET /api/v1/events (Master §165, §54-56): search + filters, AND across dimensions, OR within a
-- multiselect dimension (type, price). Default order: nearest future date first (bucket 0, known or
-- unknown date), then past Editions in a separate, most-recent-first bucket (bucket 1) — Master §54
-- "Eventos pasados en sección separada". `distance_min_m/max_m` bound each Edition's ACTIVE/CLOSED
-- Modalities' official_distance_m (a race-distance filter, not a geo-radius — Master §165's own
-- param names). `price` is FREE|PAID against registration_mode (never inferred from price_offers).
-- Keyset pagination on (bucket, sort_num, edition_id): sort_num is ascending-epoch for bucket 0
-- (nearest date first, unknown-date last) and negated-epoch for bucket 1 (most recent past first),
-- so a single ascending (bucket, sort_num, edition_id) tuple comparison paginates both sections.
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
      and (p_distance_min_m is null or exists (
            select 1 from app.modality m where m.edition_id = e.edition_id and m.status <> 'CANCELED'
              and m.official_distance_m is not null and m.official_distance_m >= p_distance_min_m))
      and (p_distance_max_m is null or exists (
            select 1 from app.modality m where m.edition_id = e.edition_id and m.status <> 'CANCELED'
              and m.official_distance_m is not null and m.official_distance_m <= p_distance_max_m))
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
-- Public facades and grants (SEC-008: server-side caps already applied above; anon/authenticated,
-- session-free, cacheable per Master §60 except the availability facade — always read fresh).
-- ---------------------------------------------------------------------------------------------

create or replace function public.search_editions(
  p_q text default null, p_type text[] default null, p_date_from date default null, p_date_to date default null,
  p_distance_min_m integer default null, p_distance_max_m integer default null, p_location text default null,
  p_price text[] default null, p_registration_open boolean default null,
  p_cursor_bucket integer default null, p_cursor_sort_num numeric default null, p_cursor_id uuid default null,
  p_limit integer default 20)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.search_editions(p_q, p_type, p_date_from, p_date_to, p_distance_min_m, p_distance_max_m,
  p_location, p_price, p_registration_open, p_cursor_bucket, p_cursor_sort_num, p_cursor_id, p_limit) $$;

create or replace function public.get_home_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_home_data() $$;

create or replace function public.get_edition_page(p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_edition_page(p_slug) $$;

create or replace function public.get_edition_page_availability(p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_edition_page_availability(p_slug) $$;

create or replace function public.get_sitemap_entries()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_sitemap_entries() $$;

revoke all on function
  private.search_editions(text, text[], date, date, integer, integer, text, text[], boolean, integer, numeric, uuid, integer),
  public.search_editions(text, text[], date, date, integer, integer, text, text[], boolean, integer, numeric, uuid, integer),
  private.get_home_data(), public.get_home_data(),
  private.get_edition_page(text), public.get_edition_page(text),
  private.get_edition_page_availability(text), public.get_edition_page_availability(text),
  private.get_sitemap_entries(), public.get_sitemap_entries()
from public, anon, authenticated, service_role;

grant execute on function
  private.search_editions(text, text[], date, date, integer, integer, text, text[], boolean, integer, numeric, uuid, integer),
  public.search_editions(text, text[], date, date, integer, integer, text, text[], boolean, integer, numeric, uuid, integer),
  private.get_home_data(), public.get_home_data(),
  private.get_edition_page(text), public.get_edition_page(text),
  private.get_edition_page_availability(text), public.get_edition_page_availability(text),
  private.get_sitemap_entries(), public.get_sitemap_entries()
to anon, authenticated;
