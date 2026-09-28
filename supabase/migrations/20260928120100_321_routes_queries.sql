-- T32 read projections: admin list/detail for F4 (route editor) and the public projection F1 (event
-- page, via T31 discovery) consumes. Never locks; never mutates.

-- ---------------------------------------------------------------------------------------------
-- Admin: GET /api/v1/admin/editions/:editionId/routes
-- ---------------------------------------------------------------------------------------------

create or replace function private.admin_list_routes(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform 1 from app.edition e where e.edition_id = p_edition_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if not private.has_permission('EVENT_CONTENT_MANAGE', p_edition_id) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;

  return coalesce((
    select jsonb_agg(private.route_projection(r.route_id) order by r.created_at, r.route_id)
    from app.route r where r.edition_id = p_edition_id), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin: GET /api/v1/admin/routes/:routeId (route + its revisions, summarized).
-- ---------------------------------------------------------------------------------------------

create or replace function private.admin_get_route(p_route_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_route jsonb;
begin
  select r.edition_id into v_edition_id from app.route r where r.route_id = p_route_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if not private.has_permission('EVENT_CONTENT_MANAGE', v_edition_id) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;

  v_route := private.route_projection(p_route_id);
  return v_route || jsonb_build_object('revisions', coalesce((
    select jsonb_agg(jsonb_build_object('route_revision_id', rr.route_revision_id, 'revision', rr.revision,
             'status', rr.status, 'source', rr.source, 'computed_distance_m', rr.computed_distance_m,
             'created_at', rr.created_at, 'published_at', rr.published_at, 'superseded_at', rr.superseded_at)
           order by rr.revision desc)
    from app.route_revision rr where rr.route_id = p_route_id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin: GET /api/v1/admin/route-revisions/:revisionId (full editor projection incl. geometry+POIs).
-- ---------------------------------------------------------------------------------------------

create or replace function private.admin_get_route_revision(p_route_revision_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
begin
  select r.edition_id into v_edition_id from app.route_revision rr join app.route r on r.route_id = rr.route_id
  where rr.route_revision_id = p_route_revision_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  if not private.has_permission('EVENT_CONTENT_MANAGE', v_edition_id) then
    perform private.raise_domain_error('FORBIDDEN');
  end if;
  return private.route_revision_projection(p_route_revision_id);
end;
$$;

create or replace function public.admin_list_routes(p_edition_id uuid)
returns jsonb language sql security invoker stable set search_path = ''
as $$ select private.admin_list_routes(p_edition_id) $$;

create or replace function public.admin_get_route(p_route_id uuid)
returns jsonb language sql security invoker stable set search_path = ''
as $$ select private.admin_get_route(p_route_id) $$;

create or replace function public.admin_get_route_revision(p_route_revision_id uuid)
returns jsonb language sql security invoker stable set search_path = ''
as $$ select private.admin_get_route_revision(p_route_revision_id) $$;

grant execute on function
  private.admin_list_routes(uuid), public.admin_list_routes(uuid),
  private.admin_get_route(uuid), public.admin_get_route(uuid),
  private.admin_get_route_revision(uuid), public.admin_get_route_revision(uuid)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Public: the event page (F1, via T31 discovery) and any other public surface. Published routes of
-- a PUBLISHED Edition only, active revision only. geometry_preview is a topology-preserving
-- simplification for payload budgets (Master §191); geometry_full is the canonical precision.
-- Frozen shape — see T32 handoff `decisions` for the exact contract other tasks build against.
-- ---------------------------------------------------------------------------------------------

create or replace function private.get_edition_routes(p_edition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'route_id', r.route_id, 'name', r.name,
      'modality_ids', coalesce((select jsonb_agg(rm.modality_id order by rm.modality_id)
                                from app.route_modality rm where rm.route_id = r.route_id), '[]'::jsonb),
      'revision', jsonb_build_object(
        'route_revision_id', rr.route_revision_id, 'revision', rr.revision, 'published_at', rr.published_at,
        'computed_distance_m', rr.computed_distance_m,
        'geometry_preview', extensions.st_asgeojson(extensions.st_simplifypreservetopology(rr.geometry, 0.0001))::jsonb,
        'geometry_full', extensions.st_asgeojson(rr.geometry)::jsonb,
        'pois', coalesce((select jsonb_agg(jsonb_build_object('route_poi_id', p.route_poi_id, 'poi_type', p.poi_type,
                   'name', p.name, 'longitude', extensions.st_x(p.geometry::extensions.geometry),
                   'latitude', extensions.st_y(p.geometry::extensions.geometry), 'sort_order', p.sort_order,
                   'metadata', p.metadata) order by p.sort_order)
                 from app.route_poi p where p.route_revision_id = rr.route_revision_id), '[]'::jsonb))
    ) order by r.created_at, r.route_id), '[]'::jsonb)
  from app.route r
  join app.route_revision rr on rr.route_revision_id = r.active_revision_id
  where r.edition_id = p_edition_id and r.status = 'PUBLISHED' and private.is_edition_published(p_edition_id)
$$;

create or replace function public.get_edition_routes(p_edition_id uuid)
returns jsonb language sql security invoker stable set search_path = ''
as $$ select private.get_edition_routes(p_edition_id) $$;

grant execute on function private.get_edition_routes(uuid), public.get_edition_routes(uuid) to anon, authenticated;
