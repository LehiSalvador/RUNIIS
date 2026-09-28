-- T30 platform settings (Master §155) and legal documents (Master §123, §165): both GLOBAL-only via
-- PLATFORM_SETTINGS_MANAGE/LEGAL_DOCUMENTS_PUBLISH; EVENT_RULES documents derive their key from the
-- Edition; the public facade returns only the current PUBLISHED version of an ACTIVE document.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

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
  ('00000000-0000-4000-8000-000000203001', 'events-legal-admin@example.test'),
  ('00000000-0000-4000-8000-000000203002', 'events-legal-operator@example.test');
insert into app.staff_member (staff_member_id, auth_user_id, status) values
  ('20000000-0000-4000-8000-000000203001', '00000000-0000-4000-8000-000000203001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000203002', '00000000-0000-4000-8000-000000203002', 'ACTIVE');
insert into app.staff_role_assignment (staff_member_id, role, scope_type) values
  ('20000000-0000-4000-8000-000000203001', 'ADMIN', 'GLOBAL'),
  ('20000000-0000-4000-8000-000000203002', 'OPERATOR', 'GLOBAL');

insert into app.event (event_id, event_type_id, name, canonical_key)
select '40000000-0000-4000-8000-000000203001', event_type_id, 'Legal Cmd Event', 'legal-cmd-event'
from app.event_type where key = 'ROAD_RACE';

create temp table ids (name text primary key, value jsonb) on commit drop;
grant select, insert, update on ids to authenticated;
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Platform settings (§155): GLOBAL only, changing defaults never rewrites existing Editions.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000203002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.update_platform_settings(jsonb_build_object('registration_hold_minutes', 20)) $$) ->> 'code',
  'FORBIDDEN', '§145 OPERATOR cannot PLATFORM_SETTINGS_MANAGE');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000203001", "role": "authenticated"}';
insert into ids select 'edition', public.create_edition('40000000-0000-4000-8000-000000203001',
  jsonb_build_object('slug', 'legal-cmd-edition', 'name', 'Legal Edition', 'registration_mode', 'FREE', 'city', 'Monterrey',
    'state_region', 'NL', 'registration_close_at', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

insert into ids select 'edition_close_before', to_jsonb(
  (select registration_close_at from app.edition where edition_id = (select value ->> 'edition_id' from ids where name = 'edition')::uuid)::text);
insert into ids select 'settings', public.update_platform_settings(jsonb_build_object('registration_hold_minutes', 20));
select is((select value ->> 'registration_hold_minutes' from ids where name = 'settings'), '20', 'update_platform_settings applies the change');
select is((select registration_close_at from app.edition where edition_id = (select value ->> 'edition_id' from ids where name = 'edition')::uuid)::text,
  (select value #>> '{}' from ids where name = 'edition_close_before'),
  '§155 changing platform defaults never rewrites an already-created Edition');

select is(pg_temp.err($$ select public.update_platform_settings(jsonb_build_object('registration_hold_minutes', 0)) $$) ->> 'code',
  'VALIDATION_ERROR', 'update_platform_settings enforces its bounds (registration_hold_minutes >= 1)');

-- ---------------------------------------------------------------------------------------------
-- Legal documents (§123): singleton-type creation, EVENT_RULES key derivation, DRAFT -> PUBLISHED
-- supersedes the previous PUBLISHED version, GLOBAL only.
-- ---------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000203002", "role": "authenticated"}';
select is(pg_temp.err($$ select public.create_legal_document(jsonb_build_object('document_type', 'TERMS_OF_SERVICE', 'document_key', 'X')) $$) ->> 'code',
  'FORBIDDEN', '§145 OPERATOR cannot LEGAL_DOCUMENTS_PUBLISH');

set local "request.jwt.claims" = '{"sub": "00000000-0000-4000-8000-000000203001", "role": "authenticated"}';
insert into ids select 'doc', public.create_legal_document(jsonb_build_object('document_type', 'SPORT_WAIVER', 'document_key', 'SPORT_WAIVER_LEGAL203'));
select is((select value ->> 'document_key' from ids where name = 'doc'), 'SPORT_WAIVER_LEGAL203', 'create_legal_document with an explicit key');

insert into ids select 'rules_doc', public.create_legal_document(
  jsonb_build_object('document_type', 'EVENT_RULES', 'edition_id', (select value ->> 'edition_id' from ids where name = 'edition')));
select is((select value ->> 'document_key' from ids where name = 'rules_doc'),
  'EVENT_RULES_' || upper(replace((select value ->> 'edition_id' from ids where name = 'edition'), '-', '')),
  '§123 EVENT_RULES document_key is derived from the Edition id');
select is(pg_temp.err(format($$ select public.create_legal_document(jsonb_build_object('document_type', 'EVENT_RULES', 'edition_id', %L,
    'document_key', 'CUSTOM')) $$, (select value ->> 'edition_id' from ids where name = 'edition'))) ->> 'code', 'VALIDATION_ERROR',
  '§123 an explicit document_key for EVENT_RULES is rejected (derived_for_event_rules)');

insert into ids select 'ver1', public.create_legal_document_version((select value ->> 'legal_document_id' from ids where name = 'doc')::uuid,
  jsonb_build_object('content_markdown', '[DOCUMENTO DE PRUEBA LOCAL — no es texto legal] v1'));
select is((select value ->> 'status' from ids where name = 'ver1'), 'DRAFT', 'create_legal_document_version starts DRAFT');
insert into ids select 'ver1_pub', public.publish_legal_document_version((select value ->> 'legal_document_version_id' from ids where name = 'ver1')::uuid);
select is((select value ->> 'status' from ids where name = 'ver1_pub'), 'PUBLISHED', 'publish_legal_document_version DRAFT -> PUBLISHED');
select is(pg_temp.err(format($$ select public.update_legal_document_version(%L, jsonb_build_object('content_markdown', 'x')) $$,
  (select value ->> 'legal_document_version_id' from ids where name = 'ver1'))) ->> 'code', 'CONFLICT',
  '§123 a PUBLISHED version is immutable (protect_versioned_status)');

insert into ids select 'ver2', public.create_legal_document_version((select value ->> 'legal_document_id' from ids where name = 'doc')::uuid,
  jsonb_build_object('content_markdown', '[DOCUMENTO DE PRUEBA LOCAL — no es texto legal] v2'));
insert into ids select 'ver2_pub', public.publish_legal_document_version((select value ->> 'legal_document_version_id' from ids where name = 'ver2')::uuid);
select is((select value ->> 'superseded_legal_document_version_id' from ids where name = 'ver2_pub'),
  (select value ->> 'legal_document_version_id' from ids where name = 'ver1'),
  '§123 publishing v2 supersedes the previously PUBLISHED v1');
reset role;
select is((select status from app.legal_document_version
           where legal_document_version_id = (select value ->> 'legal_document_version_id' from ids where name = 'ver1')::uuid),
  'SUPERSEDED', 'the superseded version is materialised SUPERSEDED');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Public facade (§165): GET-equivalent get_legal_document, anon/authenticated readable.
-- ---------------------------------------------------------------------------------------------
select is((public.get_legal_document('SPORT_WAIVER_LEGAL203') ->> 'content_markdown'),
  '[DOCUMENTO DE PRUEBA LOCAL — no es texto legal] v2', '§165 get_legal_document returns the current PUBLISHED version');
select is(public.get_legal_document('SPORT_WAIVER_LEGAL203_UNKNOWN'), null, '§165 an unknown document_key returns NULL (client maps it to 404)');

insert into ids select 'doc2', public.create_legal_document(jsonb_build_object('document_type', 'PRIVACY_NOTICE', 'document_key', 'PRIVACY_LEGAL203'));
select is(public.get_legal_document('PRIVACY_LEGAL203'), null, '§165 a document with no PUBLISHED version returns NULL');

set local role anon;
select is(public.get_legal_document('SPORT_WAIVER_LEGAL203') ->> 'document_key', 'SPORT_WAIVER_LEGAL203', '§165 the public facade is readable by anon');
set local role authenticated;

select * from finish();
rollback;
