-- T31c-cache-invalidation SQL support (20260928110200_312): price_offer_projection and the four
-- content delete commands now return edition_id (so the route layer can invalidate the `edition:<id>`
-- cache tag without an extra fetch), and cfg_media_ref now requires the referenced media to be
-- PUBLISHED. Synthetic ids in a private 2020x-252 range.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

create function pg_temp.err(p_sql text) returns jsonb language plpgsql as $$
declare v_code text; v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('code', v_code, 'detail', case when v_detail ~ '^\{' then v_detail::jsonb end);
end $$;
grant execute on function pg_temp.err(text) to authenticated;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000252001', 'cache-inv-admin@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000252001', '00000000-0000-4000-8000-000000252001', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000252001', 'ADMIN', 'GLOBAL');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000252001', event_type_id, 'Cache Inv Support Event', 'cache-inv-support-event'
from app.event_type where key = 'ROAD_RACE';

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000252001", "role": "authenticated"}';

insert into ids select 'edition', public.create_edition('40000000-0000-4000-8000-000000252001',
  jsonb_build_object('slug', 'cache-inv-support-edition', 'name', 'Cache Inv Support Edition',
    'registration_mode', 'EXTERNAL_WHATSAPP', 'city', 'Monterrey', 'state_region', 'NL',
    'whatsapp_phone_e164', '+528110000002',
    'registration_close_at', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
insert into ids select 'modality', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('key', '10k', 'name', '10K', 'official_distance_m', 10000));

-- ---------------------------------------------------------------------------------------------
-- price_offer_projection: +edition_id.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'price', public.create_price_offer((select value ->> 'modality_id' from ids where name = 'modality')::uuid,
  jsonb_build_object('name', 'Early bird', 'amount_minor', 15000));
select is((select value -> 'price_offer' ->> 'edition_id' from ids where name = 'price'),
  (select value ->> 'edition_id' from ids where name = 'edition'), 'create_price_offer returns the owning edition_id');

insert into ids select 'price_v2', public.update_price_offer((select value -> 'price_offer' ->> 'price_offer_id' from ids where name = 'price')::uuid,
  jsonb_build_object('name', 'Early bird renamed'));
select is((select value -> 'price_offer' ->> 'edition_id' from ids where name = 'price_v2'),
  (select value ->> 'edition_id' from ids where name = 'edition'), 'update_price_offer returns the owning edition_id too');

-- ---------------------------------------------------------------------------------------------
-- Delete commands: +edition_id.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'location', public.create_edition_location((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('location_type', 'VENUE', 'name', 'Parque Fundidora'));
select is(public.delete_edition_location((select value ->> 'edition_location_id' from ids where name = 'location')::uuid) ->> 'edition_id',
  (select value ->> 'edition_id' from ids where name = 'edition'), 'delete_edition_location returns edition_id');

insert into ids select 'agenda_item', public.create_schedule_item((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('title', 'Entrega de kits', 'local_date', to_char(current_date + 5, 'YYYY-MM-DD')));
select is(public.delete_schedule_item((select value ->> 'edition_schedule_item_id' from ids where name = 'agenda_item')::uuid) ->> 'edition_id',
  (select value ->> 'edition_id' from ids where name = 'edition'), 'delete_schedule_item returns edition_id');

insert into ids select 'block', public.create_content_block((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('block_type', 'RICH_TEXT', 'payload', jsonb_build_object('markdown', 'Texto de prueba con más de treinta caracteres para pasar la validación.')));
select is(public.delete_content_block((select value ->> 'event_content_block_id' from ids where name = 'block')::uuid) ->> 'edition_id',
  (select value ->> 'edition_id' from ids where name = 'edition'), 'delete_content_block returns edition_id');

insert into ids select 'modality2', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('key', '21k', 'name', '21K', 'official_distance_m', 21097));
select is(public.delete_modality((select value ->> 'modality_id' from ids where name = 'modality2')::uuid) ->> 'edition_id',
  (select value ->> 'edition_id' from ids where name = 'edition'), 'delete_modality returns edition_id (DRAFT Edition, deletable)');

-- ---------------------------------------------------------------------------------------------
-- cfg_media_ref: only a PUBLISHED asset may be referenced by a content block. No command creates
-- event_media_asset rows yet (future work), so the fixture inserts directly, like 251's.
-- ---------------------------------------------------------------------------------------------
reset role;
insert into app.event_media_asset (event_media_asset_id, edition_id, media_type, storage_object_key, alt_text, status, sort_order) values
  ('70000000-0000-4000-8000-000000252001', (select value ->> 'edition_id' from ids where name = 'edition')::uuid,
   'IMAGE', 'runiis/qa252/pending', 'Pendiente', 'PENDING', 1),
  ('70000000-0000-4000-8000-000000252002', (select value ->> 'edition_id' from ids where name = 'edition')::uuid,
   'IMAGE', 'runiis/qa252/published', 'Publicada', 'PUBLISHED', 2);
set local role authenticated;

select is(
  pg_temp.err(format($$ select public.create_content_block(%L, jsonb_build_object('block_type', 'IMAGE',
    'payload', jsonb_build_object('event_media_asset_id', '70000000-0000-4000-8000-000000252001'))) $$,
    (select value ->> 'edition_id' from ids where name = 'edition'))) ->> 'code',
  'NOT_FOUND', 'cfg_media_ref rejects a PENDING (not yet PUBLISHED) media asset reference');

insert into ids select 'image_block', public.create_content_block((select value ->> 'edition_id' from ids where name = 'edition')::uuid,
  jsonb_build_object('block_type', 'IMAGE', 'payload', jsonb_build_object('event_media_asset_id', '70000000-0000-4000-8000-000000252002')));
select is((select value -> 'payload' ->> 'event_media_asset_id' from ids where name = 'image_block'),
  '70000000-0000-4000-8000-000000252002', 'cfg_media_ref accepts a PUBLISHED media asset reference');

select is(pg_temp.err(format($$ select public.create_content_block(%L, jsonb_build_object('block_type', 'IMAGE',
    'payload', jsonb_build_object('event_media_asset_id', gen_random_uuid()))) $$,
    (select value ->> 'edition_id' from ids where name = 'edition'))) ->> 'code',
  'NOT_FOUND', 'cfg_media_ref still rejects a non-existent media asset id (unchanged prior behavior)');

select * from finish();
rollback;
