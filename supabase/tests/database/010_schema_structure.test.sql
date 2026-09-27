begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(31);

select has_schema('app');
select has_schema('private');
select has_schema('audit');
select has_schema('infra');

select has_extension('extensions', 'pgcrypto', 'pgcrypto is installed in schema extensions');
select has_extension('extensions', 'pg_trgm', 'pg_trgm is installed in schema extensions');
select has_extension('extensions', 'unaccent', 'unaccent is installed in schema extensions');
select has_extension('extensions', 'postgis', 'postgis is installed in schema extensions');
select has_extension('pg_catalog', 'pg_cron', 'pg_cron is installed in schema pg_catalog');

select is_empty($$
  select c.relkind::text || ' ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
$$, 'public holds no tables, views, materialized views, sequences or foreign tables');
select is_empty($$
  select e.extname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = 'public'
$$, 'no extension is installed in public');
select ok(to_regclass('public.spatial_ref_sys') is null and to_regclass('extensions.spatial_ref_sys') is not null,
  'PostGIS spatial_ref_sys lives in extensions, not public');
select ok(not has_schema_privilege('anon', 'cron', 'USAGE') and not has_schema_privilege('authenticated', 'cron', 'USAGE'),
  'API roles have no USAGE on the pg_cron schema');

select tables_are('app', array[
  'runner_profile', 'community_profile', 'friendship', 'guest_participant', 'guardian_assignment',
  'staff_member', 'staff_role_assignment', 'account_sanction',
  'legal_document', 'legal_document_version', 'legal_acceptance', 'platform_settings', 'competition_settings',
  'event_type', 'event', 'edition', 'edition_slug_history', 'edition_schedule_revision', 'edition_location',
  'edition_schedule_item', 'modality', 'category', 'modality_category', 'registration_form',
  'registration_form_field', 'modality_capacity', 'price_offer', 'route', 'route_modality', 'route_revision',
  'route_poi', 'event_content_block', 'event_media_asset', 'registration_request',
  'registration_request_participant', 'registration_participant_claim', 'registration_hold',
  'registration_field_response', 'registration_confirmation', 'registration', 'registration_category_assignment',
  'registration_revision', 'participant_pass', 'participant_pass_credential', 'participant_pass_scan',
  'kit_definition', 'kit_variant', 'kit_selection', 'kit_allocation', 'kit_pickup',
  'guardian_event_verification', 'attendance_checkin', 'attendance_resolution', 'sporting_eligibility_resolution',
  'attendance_finalization', 'administrative_closure', 'distance_credit', 'ranking_period', 'ranking_snapshot',
  'ranking_snapshot_entry', 'ranking_projection_entry', 'achievement_definition', 'achievement_grant',
  'community_integrity_case', 'profile_image_asset', 'avatar_moderation_decision', 'communication_recipient',
  'communication_contact_point', 'communication_consent', 'communication_preference', 'edition_interest',
  'event_reminder_subscription', 'communication_suppression', 'communication_template',
  'communication_template_version', 'communication_automation_rule', 'communication_campaign',
  'communication_campaign_recipient', 'communication_message', 'communication_delivery_attempt',
  'communication_provider_usage', 'admin_task']);
select tables_are('private', array['blocked_identity']);
select tables_are('audit', array['audit_log']);
select tables_are('infra', array['communication_provider_event', 'outbox_event', 'idempotency_record',
  'worker_run', 'rate_limit_counter']);

select is_empty($$
  select n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app', 'private', 'audit', 'infra') and c.relkind in ('r', 'p') and not c.relrowsecurity
$$, 'row level security is enabled on every table');

select is_empty($$
  select r.rolname || ' -> ' || n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  where n.nspname in ('public', 'app', 'private', 'audit', 'infra') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
$$, 'anon/authenticated hold no relation privileges in public/app/private/audit/infra (including via PUBLIC)');

select is_empty($$
  select grantee || ' -> ' || table_schema || '.' || table_name || '.' || column_name
  from information_schema.column_privileges
  where table_schema in ('public', 'app', 'private', 'audit', 'infra') and grantee in ('anon', 'authenticated', 'PUBLIC')
$$, 'anon/authenticated hold no column privileges');

select is_empty($$
  select r.rolname || ' -> ' || s.nspname
  from pg_namespace s cross join (values ('anon'), ('authenticated')) r(rolname)
  where s.nspname in ('app', 'private', 'audit', 'infra') and has_schema_privilege(r.rolname, s.oid, 'USAGE')
$$, 'anon/authenticated have no USAGE on domain schemas');

select is_empty($$
  select r.rolname || ' -> ' || p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  where n.nspname in ('public', 'app', 'private', 'audit', 'infra') and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
$$, 'anon/authenticated cannot execute any function in public/app/private/audit/infra');

select is_empty($$
  select p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'private', 'audit', 'infra')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
$$, 'every domain function pins search_path');

select is_empty($$
  select c.conrelid::regclass || '.' || c.conname
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where c.contype = 'f' and n.nspname in ('app', 'private', 'audit', 'infra') and c.confdeltype <> 'r'
$$, 'every foreign key is ON DELETE RESTRICT');

select ok(not has_table_privilege('anon', 'audit.audit_log', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'audit.audit_log', 'TRUNCATE')
          and not has_table_privilege('service_role', 'audit.audit_log', 'TRUNCATE'),
          'no API role (service_role included) holds TRUNCATE on audit.audit_log');

-- Default privileges keep future objects closed, including in the public API facade.
create table app.zz_default_privilege_probe (id integer);
create function app.zz_default_privilege_probe_fn() returns integer language sql set search_path = '' as 'select 1';
create table public.zz_default_privilege_probe (id integer);
create function public.zz_default_privilege_probe_fn() returns integer language sql set search_path = '' as 'select 1';
select ok(not has_table_privilege('anon', 'app.zz_default_privilege_probe', 'SELECT')
          and not has_table_privilege('authenticated', 'app.zz_default_privilege_probe', 'SELECT'),
          'new tables in app are not granted to API roles');
select ok(not has_function_privilege('anon', 'app.zz_default_privilege_probe_fn()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'app.zz_default_privilege_probe_fn()', 'EXECUTE'),
          'new functions in app are not executable by API roles');
select ok(not has_table_privilege('anon', 'public.zz_default_privilege_probe', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
          and not has_table_privilege('authenticated', 'public.zz_default_privilege_probe', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'),
          'new tables in public are not granted to API roles');
select ok(not has_function_privilege('anon', 'public.zz_default_privilege_probe_fn()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.zz_default_privilege_probe_fn()', 'EXECUTE'),
          'new functions in public are not executable by API roles');

select is(private.normalize_search_text(E'  José\t ÁLVAREZ   Núñez '), 'jose alvarez nunez',
          'normalize_search_text lowercases, unaccents, collapses whitespace and trims');
select is(private.normalize_search_text(null), null, 'normalize_search_text is null-safe');

select * from finish();
rollback;
