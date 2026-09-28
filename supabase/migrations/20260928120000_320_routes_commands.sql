-- T32 Routes domain (Master §45-50, §170): Route/RouteRevision/POI commands. RBAC reuses
-- EVENT_CONTENT_MANAGE (ADMIN, OPERATOR; T20 matrix) — routes are Edition content, no new action is
-- needed. Edition scope always comes from the target row (SEC-020). GPX bytes are never parsed here:
-- the TS layer (lib/server/domain/routes/gpx-parser.ts) hardens fast-xml-parser (SEC-100/101) and
-- calls import_gpx_revision with already-normalized GeoJSON + POIs; this file re-validates every
-- coordinate itself (defense in depth, SEC-006) before any geometry is built.

-- ---------------------------------------------------------------------------------------------
-- Config helpers specific to route geometry.
-- ---------------------------------------------------------------------------------------------

-- Builds a validated geometry(LineString,4326) from p_input->p_key (a GeoJSON LineString object).
-- Set-based (no per-point PL/pgSQL loop) so a 200k-point payload stays linear, not quadratic.
create or replace function private.cfg_geojson_linestring(p_input jsonb, p_key text default 'geometry', p_max_points integer default 200000)
returns extensions.geometry
language plpgsql
set search_path = ''
as $$
declare
  v_geo jsonb := p_input -> p_key;
  v_coords jsonb;
  v_n integer;
  v_bad_index integer;
  v_geom extensions.geometry;
begin
  if v_geo is null or jsonb_typeof(v_geo) <> 'object' or (v_geo ->> 'type') is distinct from 'LineString' then
    perform private.cfg_fail(p_key, 'invalid_geometry');
  end if;
  v_coords := v_geo -> 'coordinates';
  if jsonb_typeof(v_coords) <> 'array' then perform private.cfg_fail(p_key, 'invalid_geometry'); end if;
  v_n := jsonb_array_length(v_coords);
  if v_n < 2 or v_n > p_max_points then
    perform private.cfg_fail(p_key, 'invalid_point_count', jsonb_build_object('min', 2, 'max', p_max_points, 'actual', v_n));
  end if;

  select (t.ord - 1) into v_bad_index
  from jsonb_array_elements(v_coords) with ordinality as t(elem, ord)
  where jsonb_typeof(t.elem) <> 'array' or jsonb_array_length(t.elem) < 2
     or jsonb_typeof(t.elem -> 0) <> 'number' or jsonb_typeof(t.elem -> 1) <> 'number'
  order by t.ord limit 1;
  if v_bad_index is not null then
    perform private.cfg_fail(p_key, 'invalid_coordinate', jsonb_build_object('index', v_bad_index));
  end if;

  begin
    select (t.ord - 1) into v_bad_index
    from jsonb_array_elements(v_coords) with ordinality as t(elem, ord)
    where (t.elem ->> 0)::numeric < -180 or (t.elem ->> 0)::numeric > 180
       or (t.elem ->> 1)::numeric < -90 or (t.elem ->> 1)::numeric > 90
    order by t.ord limit 1;
  exception when numeric_value_out_of_range or invalid_text_representation then
    perform private.cfg_fail(p_key, 'invalid_coordinate');
  end;
  if v_bad_index is not null then
    perform private.cfg_fail(p_key, 'coordinate_out_of_range', jsonb_build_object('index', v_bad_index));
  end if;

  begin
    select extensions.st_setsrid(extensions.st_makeline(array(
      select extensions.st_makepoint((t.elem ->> 0)::double precision, (t.elem ->> 1)::double precision)
      from jsonb_array_elements(v_coords) with ordinality as t(elem, ord)
      order by t.ord
    )), 4326) into v_geom;
  exception when numeric_value_out_of_range or invalid_text_representation then
    perform private.cfg_fail(p_key, 'invalid_coordinate');
  end;

  if v_geom is null or extensions.st_npoints(v_geom) < 2 or not extensions.st_isvalid(v_geom) then
    perform private.cfg_fail(p_key, 'degenerate_linestring');
  end if;
  return v_geom;
end;
$$;

-- Validates and normalizes p_input->p_key into a jsonb array of {poi_type, name, longitude, latitude,
-- metadata, sort_order}; unknown keys never reach the output (SEC-101), only the allowlisted fields
-- this function itself reads.
create or replace function private.cfg_route_pois(p_input jsonb, p_key text default 'pois')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_list jsonb := coalesce(p_input -> p_key, '[]'::jsonb);
  v_n integer;
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_type text;
  v_name text;
  v_desc text;
  v_lon numeric;
  v_lat numeric;
  i integer;
begin
  if jsonb_typeof(v_list) <> 'array' then perform private.cfg_fail(p_key, 'must_be_array'); end if;
  v_n := jsonb_array_length(v_list);
  if v_n > 200 then perform private.cfg_fail(p_key, 'too_many_pois', jsonb_build_object('max', 200)); end if;
  for i in 0 .. v_n - 1 loop
    v_item := v_list -> i;
    if jsonb_typeof(v_item) <> 'object' then
      perform private.cfg_fail(p_key, 'invalid_item', jsonb_build_object('index', i));
    end if;
    v_type := private.cfg_enum(v_item, 'poi_type', true,
      array['START', 'FINISH', 'HYDRATION', 'MEDICAL', 'CHECKPOINT', 'RESTROOM', 'VIEWPOINT', 'OTHER'],
      p_key || '.' || i || '.poi_type');
    v_name := private.cfg_text(v_item, 'name', true, 120, 1, p_key || '.' || i || '.name');
    v_desc := private.cfg_text(v_item, 'description', false, 500, 0, p_key || '.' || i || '.description');
    v_lon := private.cfg_numeric(v_item, 'longitude', true, -180, 180, false, p_key || '.' || i || '.longitude');
    v_lat := private.cfg_numeric(v_item, 'latitude', true, -90, 90, false, p_key || '.' || i || '.latitude');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'poi_type', v_type, 'name', v_name, 'longitude', v_lon, 'latitude', v_lat,
      'metadata', case when v_desc is not null then jsonb_build_object('description', v_desc) else '{}'::jsonb end,
      'sort_order', i));
  end loop;
  return v_out;
end;
$$;

-- Shared insert path for MANUAL/GPX_IMPORT/DUPLICATED revisions: always DRAFT (Master §49 step 15:
-- publish is a separate explicit command), computed_distance_m from the geography length (never
-- official_distance_m, which lives on app.modality and is never touched here).
create or replace function private.cfg_insert_route_revision(
  p_route_id uuid, p_source text, p_source_filename text, p_geom extensions.geometry, p_pois jsonb, p_staff_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision integer;
  v_revision_id uuid;
begin
  select coalesce(max(rr.revision), 0) + 1 into v_revision from app.route_revision rr where rr.route_id = p_route_id;
  insert into app.route_revision (route_id, revision, status, geometry, geojson_snapshot, computed_distance_m,
    source, source_filename, created_by_staff_id)
  values (p_route_id, v_revision, 'DRAFT', p_geom, extensions.st_asgeojson(p_geom)::jsonb,
    round(extensions.st_length(p_geom::extensions.geography))::integer, p_source, p_source_filename, p_staff_id)
  returning route_revision_id into v_revision_id;

  insert into app.route_poi (route_revision_id, poi_type, name, geometry, sort_order, metadata)
  select v_revision_id, (poi ->> 'poi_type'), (poi ->> 'name'),
    extensions.st_setsrid(extensions.st_makepoint((poi ->> 'longitude')::double precision, (poi ->> 'latitude')::double precision), 4326)::extensions.geography,
    (poi ->> 'sort_order')::integer, coalesce(poi -> 'metadata', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_pois, '[]'::jsonb)) as poi;

  return v_revision_id;
end;
$$;

-- Master §50 blocking errors + warnings. Read-only: neither locks nor writes (callers persist the
-- result themselves when appropriate).
create or replace function private.compute_route_validation(p_route_revision_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_geom extensions.geometry;
  v_route_id uuid;
  v_distance_m integer;
  v_npoints integer;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_max_jump numeric;
  v_has_start boolean;
  v_has_finish boolean;
  v_far_pois jsonb;
  v_official record;
begin
  select rr.geometry, rr.route_id, rr.computed_distance_m into v_geom, v_route_id, v_distance_m
  from app.route_revision rr where rr.route_revision_id = p_route_revision_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;

  if v_geom is null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'GEOMETRY_MISSING'));
  else
    v_npoints := extensions.st_npoints(v_geom);
    if v_npoints < 2 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'LINESTRING_DEGENERATE'));
    end if;
    if not extensions.st_isvalid(v_geom) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'INVALID_GEOMETRY'));
    end if;
    if extensions.st_xmin(v_geom) < -180 or extensions.st_xmax(v_geom) > 180
       or extensions.st_ymin(v_geom) < -90 or extensions.st_ymax(v_geom) > 90 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'COORDINATES_OUT_OF_RANGE'));
    end if;

    if v_npoints > 20000 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'TOO_MANY_POINTS',
        'detail', jsonb_build_object('count', v_npoints)));
    end if;

    select max(extensions.st_distance(
             extensions.st_pointn(v_geom, gs)::extensions.geography,
             extensions.st_pointn(v_geom, gs + 1)::extensions.geography))
    into v_max_jump
    from generate_series(1, greatest(v_npoints - 1, 0)) as gs;
    if v_max_jump is not null and v_max_jump > 2000 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'IMPROBABLE_JUMP',
        'detail', jsonb_build_object('max_jump_m', round(v_max_jump))));
    end if;

    if not extensions.st_issimple(v_geom) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'SELF_INTERSECTION'));
    end if;
  end if;

  v_has_start := exists (select 1 from app.route_poi p where p.route_revision_id = p_route_revision_id and p.poi_type = 'START');
  v_has_finish := exists (select 1 from app.route_poi p where p.route_revision_id = p_route_revision_id and p.poi_type = 'FINISH');
  if not v_has_start or not v_has_finish then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'START_FINISH_MISSING',
      'detail', jsonb_build_object('has_start', v_has_start, 'has_finish', v_has_finish)));
  end if;

  if v_geom is not null then
    select coalesce(jsonb_agg(jsonb_build_object('route_poi_id', p.route_poi_id,
             'distance_m', round(extensions.st_distance(p.geometry, v_geom::extensions.geography)))), '[]'::jsonb)
    into v_far_pois
    from app.route_poi p
    where p.route_revision_id = p_route_revision_id
      and extensions.st_distance(p.geometry, v_geom::extensions.geography) > 200;
    if jsonb_array_length(v_far_pois) > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'POI_FAR_FROM_ROUTE',
        'detail', jsonb_build_object('pois', v_far_pois)));
    end if;
  end if;

  for v_official in
    select m.modality_id, m.official_distance_m
    from app.route_modality rm join app.modality m on m.modality_id = rm.modality_id
    where rm.route_id = v_route_id
  loop
    if v_distance_m is not null and v_official.official_distance_m is not null and v_official.official_distance_m > 0
       and abs(v_distance_m - v_official.official_distance_m)::numeric / v_official.official_distance_m > 0.15 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'DISTANCE_MISMATCH',
        'detail', jsonb_build_object('modality_id', v_official.modality_id, 'computed_distance_m', v_distance_m,
          'official_distance_m', v_official.official_distance_m)));
    end if;
  end loop;

  return jsonb_build_object('valid', jsonb_array_length(v_errors) = 0, 'errors', v_errors, 'warnings', v_warnings,
    'validated_at', now());
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Projections (explicit jsonb, never setof app.*; SEC-006).
-- ---------------------------------------------------------------------------------------------

create or replace function private.route_projection(p_route_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('route_id', r.route_id, 'edition_id', r.edition_id, 'name', r.name, 'status', r.status,
    'active_revision_id', r.active_revision_id,
    'modality_ids', coalesce((select jsonb_agg(rm.modality_id order by rm.modality_id)
                              from app.route_modality rm where rm.route_id = r.route_id), '[]'::jsonb),
    'created_at', r.created_at, 'updated_at', r.updated_at)
  from app.route r
  where r.route_id = p_route_id
$$;

create or replace function private.route_revision_projection(p_route_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('route_revision_id', rr.route_revision_id, 'route_id', rr.route_id,
    'edition_id', r.edition_id,
    'revision', rr.revision, 'status', rr.status, 'source', rr.source, 'source_filename', rr.source_filename,
    'geometry', extensions.st_asgeojson(rr.geometry)::jsonb, 'computed_distance_m', rr.computed_distance_m,
    'validation_result', rr.validation_result,
    'pois', coalesce((select jsonb_agg(jsonb_build_object('route_poi_id', p.route_poi_id, 'poi_type', p.poi_type,
               'name', p.name, 'longitude', extensions.st_x(p.geometry::extensions.geometry),
               'latitude', extensions.st_y(p.geometry::extensions.geometry), 'sort_order', p.sort_order,
               'metadata', p.metadata) order by p.sort_order)
             from app.route_poi p where p.route_revision_id = rr.route_revision_id), '[]'::jsonb),
    'created_by_staff_id', rr.created_by_staff_id, 'created_at', rr.created_at,
    'published_at', rr.published_at, 'superseded_at', rr.superseded_at)
  from app.route_revision rr
  join app.route r on r.route_id = rr.route_id
  where rr.route_revision_id = p_route_revision_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Commands.
-- ---------------------------------------------------------------------------------------------

create or replace function private.create_route(p_edition_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_input jsonb;
  v_name text;
  v_modality_ids jsonb;
  v_route_id uuid;
  v_idem jsonb;
  v_result jsonb;
  v_constraint text;
begin
  perform 1 from app.edition e where e.edition_id = p_edition_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('EVENT_CONTENT_MANAGE', p_edition_id);
  v_input := private.cfg_object(p_input, array['name', 'modality_ids']);
  v_name := private.cfg_text(v_input, 'name', true, 160);
  v_modality_ids := private.cfg_list(v_input, 'modality_ids', 1, 20, 'modality_ids');

  v_idem := private.cfg_idempotency_begin('route.create', p_edition_id::text, p_idempotency_key,
    jsonb_build_object('edition_id', p_edition_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = p_edition_id for update;
  perform private.cfg_assert_configurable(p_edition_id);

  insert into app.route (edition_id, name) values (p_edition_id, v_name) returning route_id into v_route_id;

  -- The composite FK (edition_id, modality_id) -> app.modality enforces "same Edition" (Master §45);
  -- a foreign modality id fails as 23503 -> NOT_FOUND (SEC-020: no existence oracle across editions).
  insert into app.route_modality (route_id, modality_id, edition_id)
  select v_route_id, t.elem::uuid, p_edition_id from jsonb_array_elements_text(v_modality_ids) as t(elem)
  on conflict do nothing;

  v_result := private.route_projection(v_route_id);
  perform private.audit('ROUTE_CREATED', 'route', v_route_id, p_edition_id, null, v_result);
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

create or replace function private.create_manual_revision(p_route_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_input jsonb;
  v_geom extensions.geometry;
  v_pois jsonb;
  v_idem jsonb;
  v_revision_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  select r.edition_id into v_edition_id from app.route r where r.route_id = p_route_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['geometry', 'pois']);
  v_geom := private.cfg_geojson_linestring(v_input, 'geometry', 200000);
  v_pois := private.cfg_route_pois(v_input, 'pois');

  v_idem := private.cfg_idempotency_begin('route.revision.create', p_route_id::text, p_idempotency_key,
    jsonb_build_object('route_id', p_route_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform 1 from app.route r where r.route_id = p_route_id for update;
  perform private.cfg_assert_configurable(v_edition_id);

  v_revision_id := private.cfg_insert_route_revision(p_route_id, 'MANUAL', null, v_geom, v_pois, v_staff_id);

  v_result := private.route_revision_projection(v_revision_id);
  perform private.audit('ROUTE_REVISION_CREATED', 'route_revision', v_revision_id, v_edition_id, null,
    jsonb_build_object('route_id', p_route_id, 'source', 'MANUAL'));
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- p_input carries the already-parsed GeoJSON + POIs produced by lib/server/domain/routes/gpx-parser.ts
-- (SEC-100/101 live there); this command re-validates every coordinate before building geometry and
-- never fetches anything. Always DRAFT (Master §49 step 15).
create or replace function private.import_gpx_revision(p_route_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_input jsonb;
  v_geom extensions.geometry;
  v_pois jsonb;
  v_filename text;
  v_idem jsonb;
  v_revision_id uuid;
  v_result jsonb;
  v_constraint text;
begin
  select r.edition_id into v_edition_id from app.route r where r.route_id = p_route_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['geometry', 'pois', 'source_filename']);
  v_filename := private.cfg_text(v_input, 'source_filename', true, 200);
  v_geom := private.cfg_geojson_linestring(v_input, 'geometry', 200000);
  v_pois := private.cfg_route_pois(v_input, 'pois');

  v_idem := private.cfg_idempotency_begin('route.import_gpx', p_route_id::text, p_idempotency_key,
    jsonb_build_object('route_id', p_route_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform 1 from app.route r where r.route_id = p_route_id for update;
  perform private.cfg_assert_configurable(v_edition_id);

  v_revision_id := private.cfg_insert_route_revision(p_route_id, 'GPX_IMPORT', v_filename, v_geom, v_pois, v_staff_id);

  v_result := private.route_revision_projection(v_revision_id);
  perform private.audit('ROUTE_REVISION_IMPORTED', 'route_revision', v_revision_id, v_edition_id, null,
    jsonb_build_object('route_id', p_route_id, 'source', 'GPX_IMPORT', 'source_filename', v_filename));
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

create or replace function private.update_revision(p_route_revision_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_route_id uuid;
  v_status text;
  v_staff_id uuid;
  v_input jsonb;
  v_geom extensions.geometry;
  v_pois jsonb;
  v_result jsonb;
  v_constraint text;
begin
  select rr.route_id, rr.status, r.edition_id into v_route_id, v_status, v_edition_id
  from app.route_revision rr join app.route r on r.route_id = rr.route_id
  where rr.route_revision_id = p_route_revision_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  if v_status <> 'DRAFT' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'revision_not_draft'));
  end if;
  v_input := private.cfg_object(p_input, array['geometry', 'pois']);

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  -- Re-check status under the lock (TOCTOU): a concurrent publish between the pre-lock read above
  -- and here must not let this PATCH silently mutate an already-PUBLISHED revision.
  select rr.status into v_status from app.route_revision rr where rr.route_revision_id = p_route_revision_id for update;
  if v_status <> 'DRAFT' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'revision_not_draft'));
  end if;
  perform private.cfg_assert_configurable(v_edition_id);

  if private.cfg_present(v_input, 'geometry') then
    v_geom := private.cfg_geojson_linestring(v_input, 'geometry', 200000);
    update app.route_revision set geometry = v_geom, geojson_snapshot = extensions.st_asgeojson(v_geom)::jsonb,
      computed_distance_m = round(extensions.st_length(v_geom::extensions.geography))::integer,
      validation_result = '{}'::jsonb
    where route_revision_id = p_route_revision_id;
  end if;

  if private.cfg_present(v_input, 'pois') then
    v_pois := private.cfg_route_pois(v_input, 'pois');
    delete from app.route_poi where route_revision_id = p_route_revision_id;
    insert into app.route_poi (route_revision_id, poi_type, name, geometry, sort_order, metadata)
    select p_route_revision_id, (poi ->> 'poi_type'), (poi ->> 'name'),
      extensions.st_setsrid(extensions.st_makepoint((poi ->> 'longitude')::double precision, (poi ->> 'latitude')::double precision), 4326)::extensions.geography,
      (poi ->> 'sort_order')::integer, coalesce(poi -> 'metadata', '{}'::jsonb)
    from jsonb_array_elements(v_pois) as poi;
    update app.route_revision set validation_result = '{}'::jsonb where route_revision_id = p_route_revision_id;
  end if;

  v_result := private.route_revision_projection(p_route_revision_id);
  perform private.audit('ROUTE_REVISION_UPDATED', 'route_revision', p_route_revision_id, v_edition_id, null,
    jsonb_build_object('route_id', v_route_id));
  return v_result;
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

create or replace function private.validate_revision(p_route_revision_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_status text;
  v_result jsonb;
begin
  select r.edition_id, rr.status into v_edition_id, v_status
  from app.route_revision rr join app.route r on r.route_id = rr.route_id
  where rr.route_revision_id = p_route_revision_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  perform private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  if v_status <> 'DRAFT' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'revision_not_draft'));
  end if;

  v_result := private.compute_route_validation(p_route_revision_id);
  update app.route_revision set validation_result = v_result where route_revision_id = p_route_revision_id;
  return v_result;
end;
$$;

-- One PUBLISHED revision per route is a structural DB invariant (route_revision_published_uidx,
-- migration 011): the supersede-then-publish sequence below never races past it.
create or replace function private.publish_revision(p_route_revision_id uuid, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_route_id uuid;
  v_status text;
  v_staff_id uuid;
  v_validation jsonb;
  v_idem jsonb;
  v_result jsonb;
  v_prev_id uuid;
begin
  select r.edition_id, rr.route_id, rr.status into v_edition_id, v_route_id, v_status
  from app.route_revision rr join app.route r on r.route_id = rr.route_id
  where rr.route_revision_id = p_route_revision_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  if v_status <> 'DRAFT' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'revision_not_draft'));
  end if;

  v_idem := private.cfg_idempotency_begin('route.revision.publish', p_route_revision_id::text, p_idempotency_key,
    jsonb_build_object('route_revision_id', p_route_revision_id));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform 1 from app.route r where r.route_id = v_route_id for update;
  -- Re-check status under the lock (TOCTOU): a concurrent publish/update between the pre-lock read
  -- above and here must not be allowed to publish an already-PUBLISHED or now-stale revision.
  select rr.status into v_status from app.route_revision rr where rr.route_revision_id = p_route_revision_id for update;
  if v_status <> 'DRAFT' then
    perform private.raise_domain_error('CONFLICT', jsonb_build_object('reason', 'revision_not_draft'));
  end if;
  perform private.cfg_assert_configurable(v_edition_id);

  v_validation := private.compute_route_validation(p_route_revision_id);
  update app.route_revision set validation_result = v_validation where route_revision_id = p_route_revision_id;
  if not (v_validation ->> 'valid')::boolean then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION',
      jsonb_build_object('reason', 'validation_failed', 'errors', v_validation -> 'errors'));
  end if;

  select route_revision_id into v_prev_id from app.route_revision
  where route_id = v_route_id and status = 'PUBLISHED';
  if v_prev_id is not null then
    update app.route_revision set status = 'SUPERSEDED', superseded_at = now() where route_revision_id = v_prev_id;
  end if;

  update app.route_revision set status = 'PUBLISHED', published_at = now() where route_revision_id = p_route_revision_id;
  update app.route set status = 'PUBLISHED', active_revision_id = p_route_revision_id where route_id = v_route_id;

  v_result := private.route_revision_projection(p_route_revision_id);
  perform private.audit('ROUTE_REVISION_PUBLISHED', 'route_revision', p_route_revision_id, v_edition_id,
    case when v_prev_id is not null then jsonb_build_object('previous_revision_id', v_prev_id) else null end,
    jsonb_build_object('route_id', v_route_id, 'status', 'PUBLISHED'));
  perform private.enqueue_outbox('RoutePublished', 'Route', v_route_id,
    'RoutePublished:' || v_route_id || ':' || p_route_revision_id,
    jsonb_build_object('edition_id', v_edition_id, 'route_id', v_route_id, 'route_revision_id', p_route_revision_id));
  return private.cfg_idempotency_complete(v_idem, 200, v_result);
exception when integrity_constraint_violation or data_exception then
  perform private.raise_constraint_error(sqlstate, null);
end;
$$;

create or replace function private.duplicate_route(p_route_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_staff_id uuid;
  v_input jsonb;
  v_name text;
  v_modality_ids jsonb;
  v_source_name text;
  v_source_revision_id uuid;
  v_geom extensions.geometry;
  v_pois jsonb;
  v_new_route_id uuid;
  v_idem jsonb;
  v_result jsonb;
  v_constraint text;
begin
  select r.edition_id, r.name, r.active_revision_id into v_edition_id, v_source_name, v_source_revision_id
  from app.route r where r.route_id = p_route_id;
  if not found then perform private.raise_domain_error('NOT_FOUND'); end if;
  v_staff_id := private.cfg_authorize('EVENT_CONTENT_MANAGE', v_edition_id);
  v_input := private.cfg_object(p_input, array['name', 'modality_ids']);
  v_name := coalesce(private.cfg_text(v_input, 'name', false, 160), v_source_name || ' (copy)');
  if private.cfg_present(v_input, 'modality_ids') then
    v_modality_ids := private.cfg_list(v_input, 'modality_ids', 1, 20, 'modality_ids');
  else
    select coalesce(jsonb_agg(rm.modality_id), '[]'::jsonb) into v_modality_ids
    from app.route_modality rm where rm.route_id = p_route_id;
  end if;

  if v_source_revision_id is null then
    select rr.route_revision_id into v_source_revision_id from app.route_revision rr
    where rr.route_id = p_route_id order by rr.revision desc limit 1;
  end if;
  if v_source_revision_id is null then
    perform private.raise_domain_error('BUSINESS_RULE_VIOLATION', jsonb_build_object('reason', 'no_revision_to_duplicate'));
  end if;

  v_idem := private.cfg_idempotency_begin('route.duplicate', p_route_id::text, p_idempotency_key,
    jsonb_build_object('route_id', p_route_id, 'input', v_input));
  if (v_idem ->> 'replay')::boolean then return v_idem -> 'response_body'; end if;

  perform 1 from app.edition e where e.edition_id = v_edition_id for update;
  perform 1 from app.route r where r.route_id = p_route_id for update;
  perform private.cfg_assert_configurable(v_edition_id);

  select rr.geometry into v_geom from app.route_revision rr where rr.route_revision_id = v_source_revision_id;
  select coalesce(jsonb_agg(jsonb_build_object('poi_type', p.poi_type, 'name', p.name,
           'longitude', extensions.st_x(p.geometry::extensions.geometry),
           'latitude', extensions.st_y(p.geometry::extensions.geometry),
           'sort_order', p.sort_order, 'metadata', p.metadata)), '[]'::jsonb)
  into v_pois
  from app.route_poi p where p.route_revision_id = v_source_revision_id;

  insert into app.route (edition_id, name) values (v_edition_id, v_name) returning route_id into v_new_route_id;

  insert into app.route_modality (route_id, modality_id, edition_id)
  select v_new_route_id, t.elem::uuid, v_edition_id from jsonb_array_elements_text(v_modality_ids) as t(elem)
  on conflict do nothing;

  perform private.cfg_insert_route_revision(v_new_route_id, 'DUPLICATED', null, v_geom, v_pois, v_staff_id);

  v_result := private.route_projection(v_new_route_id);
  perform private.audit('ROUTE_DUPLICATED', 'route', v_new_route_id, v_edition_id,
    jsonb_build_object('source_route_id', p_route_id), v_result);
  return private.cfg_idempotency_complete(v_idem, 201, v_result);
exception when integrity_constraint_violation or data_exception then
  get stacked diagnostics v_constraint = constraint_name;
  perform private.raise_constraint_error(sqlstate, v_constraint);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public (invoker) wrappers + grants.
-- ---------------------------------------------------------------------------------------------

create or replace function public.create_route(p_edition_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_route(p_edition_id, p_input, p_idempotency_key) $$;

create or replace function public.create_manual_revision(p_route_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_manual_revision(p_route_id, p_input, p_idempotency_key) $$;

create or replace function public.import_gpx_revision(p_route_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_gpx_revision(p_route_id, p_input, p_idempotency_key) $$;

create or replace function public.update_revision(p_route_revision_id uuid, p_input jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.update_revision(p_route_revision_id, p_input) $$;

create or replace function public.validate_revision(p_route_revision_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.validate_revision(p_route_revision_id) $$;

create or replace function public.publish_revision(p_route_revision_id uuid, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.publish_revision(p_route_revision_id, p_idempotency_key) $$;

create or replace function public.duplicate_route(p_route_id uuid, p_input jsonb, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.duplicate_route(p_route_id, p_input, p_idempotency_key) $$;

grant execute on function
  private.create_route(uuid, jsonb, text), public.create_route(uuid, jsonb, text),
  private.create_manual_revision(uuid, jsonb, text), public.create_manual_revision(uuid, jsonb, text),
  private.import_gpx_revision(uuid, jsonb, text), public.import_gpx_revision(uuid, jsonb, text),
  private.update_revision(uuid, jsonb), public.update_revision(uuid, jsonb),
  private.validate_revision(uuid), public.validate_revision(uuid),
  private.publish_revision(uuid, text), public.publish_revision(uuid, text),
  private.duplicate_route(uuid, jsonb, text), public.duplicate_route(uuid, jsonb, text)
to authenticated;
