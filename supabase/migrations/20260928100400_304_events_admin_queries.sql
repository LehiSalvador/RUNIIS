-- T30 admin read projections (Master §169): the events list and the single editor projection the
-- admin UI hydrates from. Scope always narrows through EVENT_CONTENT_MANAGE per row/Edition
-- (GLOBAL ADMIN/OPERATOR see everything; EDITION-scoped OPERATOR only their own Edition; CHECKIN/
-- MODERATOR see none). Never locks; never mutates.

-- ---------------------------------------------------------------------------------------------
-- GET /api/v1/admin/events: filterable, cursor-paginated list of Editions (Master §169).
-- ---------------------------------------------------------------------------------------------

create or replace function private.admin_list_editions(
  p_publication_state text default null, p_registration_state text default null,
  p_execution_state text default null, p_event_id uuid default null, p_search text default null,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_search text := nullif(private.normalize_search_text(coalesce(p_search, '')), '');
  v_items jsonb;
begin
  perform private.require_actor();
  -- Scope-agnostic on purpose: require_staff(roles) with no Edition needs a GLOBAL assignment, which
  -- would wrongly reject an EDITION-scoped OPERATOR/ADMIN before the row-level has_permission narrowing
  -- below ever runs (they must still see their own Edition; CHECKIN/MODERATOR pass here but the row
  -- filter yields none of them).
  if not exists (
      select 1 from app.staff_role_assignment sra
      where sra.staff_member_id = private.current_staff_member_id()
        and sra.revoked_at is null
        and sra.role = any (array['ADMIN', 'OPERATOR', 'CHECKIN', 'MODERATOR'])) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;
  if p_publication_state is not null and p_publication_state not in ('DRAFT', 'PUBLISHED', 'HIDDEN') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'publication_state'));
  end if;
  if p_registration_state is not null and p_registration_state not in ('NOT_OPEN', 'OPEN', 'PAUSED', 'CLOSED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'registration_state'));
  end if;
  if p_execution_state is not null and p_execution_state not in ('SCHEDULED', 'POSTPONED', 'IN_PROGRESS', 'FINISHED', 'CANCELED') then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'execution_state'));
  end if;
  if pg_catalog.char_length(coalesce(v_search, '')) > 100 then
    perform private.raise_domain_error('VALIDATION_ERROR', jsonb_build_object('field', 'search'));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'edition_id', s.edition_id, 'event_id', s.event_id, 'event_name', s.event_name, 'slug', s.slug,
      'name', s.name, 'publication_state', s.publication_state, 'registration_state', s.registration_state,
      'execution_state', s.execution_state, 'closure_state', s.closure_state, 'city', s.city,
      'country_code', s.country_code, 'created_at', s.created_at,
      'sport_date', (private.current_schedule(s.edition_id) ->> 'local_date'))
      order by s.created_at desc, s.edition_id desc), '[]'::jsonb)
  into v_items
  from (
    select e.edition_id, e.event_id, ev.name as event_name, e.slug, e.name, e.publication_state,
      e.registration_state, e.execution_state, e.closure_state, e.city, e.country_code, e.created_at
    from app.edition e
    join app.event ev on ev.event_id = e.event_id
    where private.has_permission('EVENT_CONTENT_MANAGE', e.edition_id)
      and (p_publication_state is null or e.publication_state = p_publication_state)
      and (p_registration_state is null or e.registration_state = p_registration_state)
      and (p_execution_state is null or e.execution_state = p_execution_state)
      and (p_event_id is null or e.event_id = p_event_id)
      and (v_search is null or pg_catalog.strpos(private.normalize_search_text(e.name), v_search) > 0
           or pg_catalog.strpos(private.normalize_search_text(ev.name), v_search) > 0
           or pg_catalog.strpos(e.slug, v_search) > 0)
      and (p_cursor_created_at is null or (e.created_at, e.edition_id) < (p_cursor_created_at, p_cursor_id))
    order by e.created_at desc, e.edition_id desc
    limit v_limit + 1) s;

  return jsonb_build_object(
    -- coalesce: jsonb_agg over zero rows is NULL, not '[]' (an empty result page must still be an array).
    'items', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_items) with ordinality t(x, o) where o <= v_limit), '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(v_items) > v_limit then jsonb_build_object(
      'created_at', v_items -> (v_limit - 1) -> 'created_at', 'edition_id', v_items -> (v_limit - 1) -> 'edition_id') end);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- GET /api/v1/admin/editions/:id: the whole editor projection, incl. readiness (Master §169).
-- ---------------------------------------------------------------------------------------------

create or replace function private.admin_get_edition_editor(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from app.edition e where e.edition_id = p_edition_id) then
    perform private.raise_domain_error('NOT_FOUND');
  end if;
  perform private.require_permission('EVENT_CONTENT_MANAGE', p_edition_id);

  return jsonb_build_object(
    'edition', private.edition_projection(p_edition_id),
    'availability', private.edition_availability(p_edition_id),
    'readiness', jsonb_build_object(
      'publication', private.publication_readiness(p_edition_id),
      'registration', private.registration_readiness(p_edition_id)),
    'modalities', coalesce((
      select jsonb_agg(private.modality_projection(m.modality_id)
                        || jsonb_build_object('price_offers', coalesce((
                             select jsonb_agg(private.price_offer_projection(po.price_offer_id) order by po.priority desc, po.created_at desc)
                             from app.price_offer po where po.modality_id = m.modality_id), '[]'::jsonb))
                       order by m.sort_order, m.key)
      from app.modality m where m.edition_id = p_edition_id), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(private.category_projection(c.category_id) order by c.sort_order, c.key)
      from app.category c where c.edition_id = p_edition_id), '[]'::jsonb),
    'registration_forms', coalesce((
      select jsonb_agg(private.registration_form_projection(f.registration_form_id)
                        order by f.modality_id nulls first, f.version desc)
      from app.registration_form f where f.edition_id = p_edition_id), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(private.location_projection(l.edition_location_id) order by l.sort_order)
      from app.edition_location l where l.edition_id = p_edition_id), '[]'::jsonb),
    'agenda', coalesce((
      select jsonb_agg(private.schedule_item_projection(i.edition_schedule_item_id) order by i.sort_order)
      from app.edition_schedule_item i where i.edition_id = p_edition_id), '[]'::jsonb),
    'content_blocks', coalesce((
      select jsonb_agg(private.content_block_projection(b.event_content_block_id) order by b.position)
      from app.event_content_block b where b.edition_id = p_edition_id), '[]'::jsonb),
    'kits', coalesce((
      select jsonb_agg(private.kit_projection(k.kit_definition_id) order by k.created_at)
      from app.kit_definition k where k.edition_id = p_edition_id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public facades and grants.
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_list_editions(
  p_publication_state text default null, p_registration_state text default null,
  p_execution_state text default null, p_event_id uuid default null, p_search text default null,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 20)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_list_editions(p_publication_state, p_registration_state, p_execution_state,
  p_event_id, p_search, p_cursor_created_at, p_cursor_id, p_limit) $$;

create or replace function public.admin_get_edition_editor(p_edition_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_get_edition_editor(p_edition_id) $$;

revoke all on function
  private.admin_list_editions(text, text, text, uuid, text, timestamptz, uuid, integer),
  public.admin_list_editions(text, text, text, uuid, text, timestamptz, uuid, integer),
  private.admin_get_edition_editor(uuid), public.admin_get_edition_editor(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  private.admin_list_editions(text, text, text, uuid, text, timestamptz, uuid, integer),
  public.admin_list_editions(text, text, text, uuid, text, timestamptz, uuid, integer),
  private.admin_get_edition_editor(uuid), public.admin_get_edition_editor(uuid)
to authenticated;
