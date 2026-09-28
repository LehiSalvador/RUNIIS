-- T30 admin read projections (Master §169): GET /api/v1/admin/events (filterable, cursor-paginated
-- Edition list) and GET /api/v1/admin/editions/:id (full editor projection). Row-level scope narrows
-- by EVENT_CONTENT_MANAGE: GLOBAL roles see everything, EDITION-scoped roles only their own Edition,
-- CHECKIN/MODERATOR see an empty list (not FORBIDDEN) on the list, but FORBIDDEN on the single editor.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(14);

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

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000204001', 'events-q-admin@example.test'),
  ('00000000-0000-4000-8000-000000204002', 'events-q-operator-scoped@example.test'),
  ('00000000-0000-4000-8000-000000204003', 'events-q-checkin@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000204001', '00000000-0000-4000-8000-000000204001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000204002', '00000000-0000-4000-8000-000000204002', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000204003', '00000000-0000-4000-8000-000000204003', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000204001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000204003', 'CHECKIN', 'GLOBAL');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000204001', event_type_id, 'Query Cmd Event', 'query-cmd-event'
from app.event_type where key = 'ROAD_RACE';

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000204001", "role": "authenticated"}';

insert into ids select 'edition1', public.create_edition('40000000-0000-4000-8000-000000204001',
  jsonb_build_object('slug', 'query-cmd-1', 'name', 'Query Edition 1', 'registration_mode', 'FREE', 'city', 'Monterrey',
    'state_region', 'NL', 'registration_close_at', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
insert into ids select 'edition2', public.create_edition('40000000-0000-4000-8000-000000204001',
  jsonb_build_object('slug', 'query-cmd-2', 'name', 'Query Edition 2', 'registration_mode', 'FREE', 'city', 'Monterrey',
    'state_region', 'NL', 'registration_close_at', to_char(now() + interval '31 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
insert into ids select 'edition3', public.create_edition('40000000-0000-4000-8000-000000204001',
  jsonb_build_object('slug', 'query-cmd-3', 'name', 'Query Edition 3', 'registration_mode', 'FREE', 'city', 'Monterrey',
    'state_region', 'NL', 'registration_close_at', to_char(now() + interval '32 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

reset role;
insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id)
select '20000000-0000-4000-8000-000000204002', 'OPERATOR', 'EDITION', (value ->> 'edition_id')::uuid from ids where name = 'edition1';
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- admin_list_editions (§169): filters, cursor pagination, and role-scope narrowing.
-- ---------------------------------------------------------------------------------------------
insert into ids select 'page_all', public.admin_list_editions(null, null, null, '40000000-0000-4000-8000-000000204001'::uuid);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'page_all')), 3, 'GLOBAL ADMIN sees all 3 Editions of the Event');

insert into ids select 'page1', public.admin_list_editions(null, null, null, '40000000-0000-4000-8000-000000204001'::uuid, null, null, null, 2);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'page1')), 2, 'a limit of 2 returns 2 items');
select isnt((select value -> 'next_cursor' from ids where name = 'page1'), null, 'a further page exists so next_cursor is not null');

insert into ids select 'page2', public.admin_list_editions(null, null, null, '40000000-0000-4000-8000-000000204001'::uuid, null,
  ((select value -> 'next_cursor' ->> 'created_at' from ids where name = 'page1'))::timestamptz,
  ((select value -> 'next_cursor' ->> 'edition_id' from ids where name = 'page1'))::uuid, 2);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'page2')), 1, 'the second page returns the remaining item');

insert into ids select 'page_slug', public.admin_list_editions(null, null, null, '40000000-0000-4000-8000-000000204001'::uuid, 'query-cmd-2');
select is(jsonb_array_length((select value -> 'items' from ids where name = 'page_slug')), 1, 'a search matching the slug narrows the result');
select is((select value -> 'items' -> 0 ->> 'edition_id' from ids where name = 'page_slug'),
  (select value ->> 'edition_id' from ids where name = 'edition2'), 'the search-narrowed result is the matching Edition');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000204002", "role": "authenticated"}';
insert into ids select 'page_scoped', public.admin_list_editions(null, null, null, '40000000-0000-4000-8000-000000204001'::uuid);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'page_scoped')), 1,
  '§145 an EDITION-scoped OPERATOR only sees their own Edition in the list');
select is((select value -> 'items' -> 0 ->> 'edition_id' from ids where name = 'page_scoped'),
  (select value ->> 'edition_id' from ids where name = 'edition1'), 'the scoped list item is Edition 1');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000204003", "role": "authenticated"}';
insert into ids select 'page_checkin', public.admin_list_editions(null, null, null, '40000000-0000-4000-8000-000000204001'::uuid);
select is(jsonb_array_length((select value -> 'items' from ids where name = 'page_checkin')), 0,
  '§145 CHECKIN sees an empty list, not FORBIDDEN');

-- ---------------------------------------------------------------------------------------------
-- admin_get_edition_editor (§169): full projection incl. availability/readiness/sub-resources.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000204001", "role": "authenticated"}';
insert into ids select 'modality', public.create_modality((select value ->> 'edition_id' from ids where name = 'edition1')::uuid,
  jsonb_build_object('key', '5k', 'name', '5K', 'official_distance_m', 5000));
insert into ids select 'editor', public.admin_get_edition_editor((select value ->> 'edition_id' from ids where name = 'edition1')::uuid);
select is((select value -> 'edition' ->> 'edition_id' from ids where name = 'editor'),
  (select value ->> 'edition_id' from ids where name = 'edition1'), 'admin_get_edition_editor returns the requested Edition');
select is(jsonb_array_length((select value -> 'modalities' from ids where name = 'editor')), 1, 'the editor projection lists the Modality just created');
select isnt((select value -> 'readiness' -> 'publication' from ids where name = 'editor'), null, 'the editor projection includes publication readiness');
select isnt((select value -> 'availability' from ids where name = 'editor'), null, 'the editor projection includes availability');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000204003", "role": "authenticated"}';
select is(pg_temp.err(format($$ select public.admin_get_edition_editor(%L) $$,
  (select value ->> 'edition_id' from ids where name = 'edition1'))) ->> 'code', 'FORBIDDEN',
  '§145 CHECKIN is FORBIDDEN from the single-Edition editor projection');

select * from finish();
rollback;
