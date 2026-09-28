-- T32 synthetic Route fixtures (local/dev only): one PUBLISHED Route per OPEN Edition from
-- 20_events.sql, associated to every Modality of that Edition, with synthetic Monterrey coordinates
-- and START/FINISH POIs. Direct inserts (not the admin RPCs): seeds run outside an authenticated
-- session, so there is no auth.uid() to authorise through (matches 20_events.sql convention).
-- Runs after 20_events.sql (edition/modality/staff fixtures) in lexical order.

-- ---------------------------------------------------------------------------------------------
-- Edition 1 (900001, OPEN/FREE): a 5K+10K shared out-and-back Route along Av. Constitución.
-- ---------------------------------------------------------------------------------------------
insert into app.route (route_id, edition_id, name, status) values
  ('70000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001', 'Ruta Parque Fundidora', 'DRAFT')
on conflict (route_id) do nothing;
insert into app.route_modality (route_id, modality_id, edition_id) values
  ('70000000-0000-4000-8000-000000900001', '60000000-0000-4000-8000-000000900001', '50000000-0000-4000-8000-000000900001'),
  ('70000000-0000-4000-8000-000000900001', '60000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900001')
on conflict (route_id, modality_id) do nothing;

insert into app.route_revision (route_revision_id, route_id, revision, status, geometry, geojson_snapshot,
  computed_distance_m, source, created_by_staff_id, published_at)
select '71000000-0000-4000-8000-000000900001', '70000000-0000-4000-8000-000000900001', 1, 'PUBLISHED', geom,
  extensions.st_asgeojson(geom)::jsonb, round(extensions.st_length(geom::extensions.geography))::integer,
  'MANUAL', '20000000-0000-4000-8000-000000200001', now() - interval '4 days'
from (
  select extensions.st_setsrid(extensions.st_makeline(array[
    extensions.st_makepoint(-100.283700, 25.677500), extensions.st_makepoint(-100.286300, 25.679400),
    extensions.st_makepoint(-100.289100, 25.680900), extensions.st_makepoint(-100.292000, 25.681600),
    extensions.st_makepoint(-100.294800, 25.680700), extensions.st_makepoint(-100.296500, 25.678300),
    extensions.st_makepoint(-100.294800, 25.680700), extensions.st_makepoint(-100.292000, 25.681600),
    extensions.st_makepoint(-100.289100, 25.680900), extensions.st_makepoint(-100.286300, 25.679400),
    extensions.st_makepoint(-100.283700, 25.677500)]), 4326) as geom
) g
where not exists (select 1 from app.route_revision where route_revision_id = '71000000-0000-4000-8000-000000900001');

update app.route set status = 'PUBLISHED', active_revision_id = '71000000-0000-4000-8000-000000900001'
where route_id = '70000000-0000-4000-8000-000000900001' and active_revision_id is null;

insert into app.route_poi (route_poi_id, route_revision_id, poi_type, name, geometry, sort_order) values
  ('72000000-0000-4000-8000-000000900001', '71000000-0000-4000-8000-000000900001', 'START', 'Salida Parque Fundidora',
   extensions.st_setsrid(extensions.st_makepoint(-100.283700, 25.677500), 4326)::extensions.geography, 1),
  ('72000000-0000-4000-8000-000000900002', '71000000-0000-4000-8000-000000900001', 'HYDRATION', 'Hidratación km 2.5',
   extensions.st_setsrid(extensions.st_makepoint(-100.292000, 25.681600), 4326)::extensions.geography, 2),
  ('72000000-0000-4000-8000-000000900003', '71000000-0000-4000-8000-000000900001', 'FINISH', 'Meta Parque Fundidora',
   extensions.st_setsrid(extensions.st_makepoint(-100.283700, 25.677500), 4326)::extensions.geography, 3)
on conflict (route_poi_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Edition 2 (900002, OPEN/EXTERNAL_WHATSAPP): a longer 10K+21K loop through San Pedro Garza García.
-- ---------------------------------------------------------------------------------------------
insert into app.route (route_id, edition_id, name, status) values
  ('70000000-0000-4000-8000-000000900002', '50000000-0000-4000-8000-000000900002', 'Ruta Valle Oriente', 'DRAFT')
on conflict (route_id) do nothing;
insert into app.route_modality (route_id, modality_id, edition_id) values
  ('70000000-0000-4000-8000-000000900002', '60000000-0000-4000-8000-000000900003', '50000000-0000-4000-8000-000000900002'),
  ('70000000-0000-4000-8000-000000900002', '60000000-0000-4000-8000-000000900004', '50000000-0000-4000-8000-000000900002')
on conflict (route_id, modality_id) do nothing;

insert into app.route_revision (route_revision_id, route_id, revision, status, geometry, geojson_snapshot,
  computed_distance_m, source, created_by_staff_id, published_at)
select '71000000-0000-4000-8000-000000900002', '70000000-0000-4000-8000-000000900002', 1, 'PUBLISHED', geom,
  extensions.st_asgeojson(geom)::jsonb, round(extensions.st_length(geom::extensions.geography))::integer,
  'MANUAL', '20000000-0000-4000-8000-000000200001', now() - interval '9 days'
from (
  select extensions.st_setsrid(extensions.st_makeline(array[
    extensions.st_makepoint(-100.353800, 25.651200), extensions.st_makepoint(-100.357200, 25.653900),
    extensions.st_makepoint(-100.360900, 25.656100), extensions.st_makepoint(-100.364500, 25.657200),
    extensions.st_makepoint(-100.368100, 25.656500), extensions.st_makepoint(-100.371000, 25.654100),
    extensions.st_makepoint(-100.372400, 25.650900), extensions.st_makepoint(-100.371000, 25.647600),
    extensions.st_makepoint(-100.367300, 25.645800), extensions.st_makepoint(-100.362800, 25.646100),
    extensions.st_makepoint(-100.358500, 25.647900), extensions.st_makepoint(-100.355000, 25.649400),
    extensions.st_makepoint(-100.353800, 25.651200)]), 4326) as geom
) g
where not exists (select 1 from app.route_revision where route_revision_id = '71000000-0000-4000-8000-000000900002');

update app.route set status = 'PUBLISHED', active_revision_id = '71000000-0000-4000-8000-000000900002'
where route_id = '70000000-0000-4000-8000-000000900002' and active_revision_id is null;

insert into app.route_poi (route_poi_id, route_revision_id, poi_type, name, geometry, sort_order) values
  ('72000000-0000-4000-8000-000000900004', '71000000-0000-4000-8000-000000900002', 'START', 'Salida Valle Oriente',
   extensions.st_setsrid(extensions.st_makepoint(-100.353800, 25.651200), 4326)::extensions.geography, 1),
  ('72000000-0000-4000-8000-000000900005', '71000000-0000-4000-8000-000000900002', 'MEDICAL', 'Puesto médico km 7',
   extensions.st_setsrid(extensions.st_makepoint(-100.372400, 25.650900), 4326)::extensions.geography, 2),
  ('72000000-0000-4000-8000-000000900006', '71000000-0000-4000-8000-000000900002', 'FINISH', 'Meta Valle Oriente',
   extensions.st_setsrid(extensions.st_makepoint(-100.353800, 25.651200), 4326)::extensions.geography, 3)
on conflict (route_poi_id) do nothing;
