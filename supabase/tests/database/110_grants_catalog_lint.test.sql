-- SEC-002/003/004/006 grants allowlist and catalog lint. Rules, not snapshots, for functions so
-- domain migrations stay compliant by construction; relations use an explicit SELECT allowlist.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(18);

-- ---------------------------------------------------------------------------------------------
-- Relations
-- ---------------------------------------------------------------------------------------------
create temp table expected_select (rolname text, relname text, cols text[]) on commit drop;
insert into expected_select (rolname, relname, cols)
select r, t, null
from unnest(array['anon', 'authenticated']) r
cross join unnest(array['legal_document', 'legal_document_version', 'event_type', 'event', 'edition',
  'edition_slug_history', 'edition_location', 'edition_schedule_item', 'modality', 'category', 'modality_category',
  'registration_form', 'registration_form_field', 'price_offer', 'route', 'route_modality', 'route_poi',
  'event_content_block', 'event_media_asset', 'kit_definition', 'kit_variant', 'ranking_period',
  'achievement_definition']) t;
insert into expected_select (rolname, relname, cols)
select r, t.relname, t.cols
from unnest(array['anon', 'authenticated']) r
cross join (values
  ('community_profile', array['public_profile_id', 'display_name', 'avatar_asset_id', 'verified_distance_projection_m',
    'verified_participation_count']),
  ('edition_schedule_revision', array['edition_schedule_revision_id', 'edition_id', 'revision', 'schedule_state',
    'local_date', 'local_start_time', 'local_end_time', 'timezone', 'effective_start_at', 'effective_end_at',
    'created_at', 'superseded_at']),
  ('route_revision', array['route_revision_id', 'route_id', 'revision', 'status', 'geometry', 'geojson_snapshot',
    'computed_distance_m', 'published_at', 'created_at']),
  ('ranking_snapshot', array['ranking_snapshot_id', 'ranking_period_id', 'revision', 'status', 'cutoff_at',
    'generated_at', 'superseded_at'])) t(relname, cols);
insert into expected_select (rolname, relname, cols)
select 'authenticated', t, null
from unnest(array['runner_profile', 'friendship', 'guest_participant', 'guardian_assignment', 'staff_member',
  'staff_role_assignment', 'legal_acceptance', 'modality_capacity', 'registration', 'achievement_grant',
  'communication_recipient', 'communication_contact_point', 'communication_consent', 'communication_preference',
  'edition_interest', 'event_reminder_subscription']) t;
insert into expected_select (rolname, relname, cols) values
  ('authenticated', 'account_sanction', array['sanction_id', 'runner_profile_id', 'sanction_type', 'status', 'starts_at',
    'ends_at', 'revoked_at', 'created_at']),
  ('authenticated', 'registration_request', array['registration_request_id', 'public_reference', 'buyer_profile_id',
    'edition_id', 'status', 'registration_mode', 'currency', 'total_snapshot_minor', 'whatsapp_phone_snapshot',
    'created_at', 'expires_at', 'confirmed_at', 'canceled_at', 'canceled_by_profile_id', 'cancel_reason',
    'revalidated_from_expired', 'updated_at']),
  ('authenticated', 'registration_request_participant', array['request_participant_id', 'registration_request_id',
    'participant_kind', 'runner_profile_id', 'guest_participant_id', 'modality_id', 'category_id', 'price_offer_id',
    'price_snapshot_minor', 'currency', 'created_at']),
  ('authenticated', 'registration_confirmation', array['registration_confirmation_id', 'registration_request_id',
    'confirmation_method', 'confirmed_at']),
  ('authenticated', 'registration_category_assignment', array['registration_category_assignment_id', 'registration_id',
    'category_id', 'assignment_source', 'assigned_at']),
  ('authenticated', 'registration_revision', array['registration_revision_id', 'registration_id', 'revision', 'modality_id',
    'category_id', 'status', 'effective_from', 'created_at', 'superseded_at']),
  ('authenticated', 'kit_allocation', array['kit_allocation_id', 'registration_id', 'kit_definition_id', 'kit_variant_id',
    'status', 'assigned_at', 'updated_at']),
  ('authenticated', 'participant_pass', array['participant_pass_id', 'registration_id', 'public_code', 'status', 'issued_at',
    'canceled_at', 'created_at', 'updated_at']),
  ('authenticated', 'distance_credit', array['distance_credit_id', 'runner_profile_id', 'registration_id', 'edition_id',
    'modality_id', 'attendance_resolution_id', 'attendance_finalization_id', 'administrative_closure_id',
    'sporting_eligibility_resolution_id', 'official_distance_snapshot_m', 'credited_distance_m', 'sport_date',
    'sport_timezone', 'status', 'source', 'created_at', 'reversed_at', 'reversal_reason', 'supersedes_distance_credit_id']),
  ('authenticated', 'profile_image_asset', array['profile_image_asset_id', 'runner_profile_id', 'public_object_key',
    'status', 'uploaded_at', 'processed_at', 'approved_at', 'rejected_at', 'removed_at', 'created_at', 'updated_at']);

select set_eq($$
  select r.rolname || ':' || c.relname || '.' || a.attname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  cross join (values ('anon'), ('authenticated')) r(rolname)
  where n.nspname = 'app' and c.relkind in ('r', 'p') and has_column_privilege(r.rolname, c.oid, a.attnum, 'SELECT')
$$, $$
  select e.rolname || ':' || e.relname || '.' || a.attname
  from expected_select e
  join pg_attribute a on a.attrelid = ('app.' || e.relname)::regclass and a.attnum > 0 and not a.attisdropped
  where e.cols is null or a.attname = any (e.cols)
$$, 'anon/authenticated SELECT on app matches the column allowlist (Master §159-§160)');

select is_empty($$
  select r.rolname || ' -> ' || c.oid::regclass::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  where n.nspname = 'app' and c.relkind in ('r', 'p')
    and (has_table_privilege(r.rolname, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege(r.rolname, c.oid, 'INSERT, UPDATE, REFERENCES'))
$$, 'no client writes: anon/authenticated hold no write privilege on any app table');

select is_empty($$
  select c.oid::regclass::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app', 'private', 'audit', 'infra') and c.relkind in ('r', 'p', 'v', 'm', 'S')
    and (has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
$$, 'SYSTEM (service_role) reaches data only through granted functions');

select is_empty($$
  select distinct e.rolname || ' -> ' || e.relname
  from expected_select e
  where not exists (
    select 1 from pg_policy p
    where p.polrelid = ('app.' || e.relname)::regclass and p.polcmd in ('r', '*')
      and (0 = any (p.polroles) or e.rolname::regrole::oid = any (p.polroles)))
$$, 'every granted (role, table) has a SELECT policy for that role');

select set_eq($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind in ('r', 'p') and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
$$, array['platform_settings', 'competition_settings', 'registration_participant_claim', 'registration_hold',
  'registration_field_response', 'participant_pass_credential', 'participant_pass_scan', 'kit_selection', 'kit_pickup',
  'guardian_event_verification', 'attendance_checkin', 'attendance_resolution', 'sporting_eligibility_resolution',
  'attendance_finalization', 'administrative_closure', 'ranking_snapshot_entry', 'ranking_projection_entry',
  'community_integrity_case', 'avatar_moderation_decision', 'communication_suppression', 'communication_template',
  'communication_template_version', 'communication_automation_rule', 'communication_campaign',
  'communication_campaign_recipient', 'communication_message', 'communication_delivery_attempt',
  'communication_provider_usage', 'admin_task'],
  'app tables without policies are exactly the definer-only set (deny for API roles)');

select is_empty($$
  select p.polrelid::regclass::text || '.' || p.polname from pg_policy p
  join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and p.polcmd <> 'r'
$$, 'policies are SELECT-only (commands are the only write path)');

select ok(not exists (select 1 from pg_extension where extname = 'pg_graphql'), 'SEC-004: pg_graphql is not installed');

-- ---------------------------------------------------------------------------------------------
-- Functions (SEC-002/006)
-- ---------------------------------------------------------------------------------------------
create temp view api_exec as
select p.oid, p.oid::regprocedure::text as sig, n.nspname, p.proname, r.rolname, p.provolatile, p.prosecdef,
       p.proconfig, p.prolang, p.proargtypes, p.proargnames
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
where n.nspname in ('public', 'private', 'app', 'audit', 'infra') and has_function_privilege(r.rolname, p.oid, 'EXECUTE');

select is_empty($$ select rolname || ' -> ' || sig from api_exec where nspname in ('app', 'audit', 'infra') $$,
  'no function in app/audit/infra is executable by API roles');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.prosecdef or p.prolang <> (select oid from pg_language where lanname = 'sql')
         or coalesce(p.proconfig, '{}') <> array['search_path=""'])
$$, 'public functions are security invoker SQL wrappers with an empty search_path');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not exists (
    select 1 from pg_proc q join pg_namespace qn on qn.oid = q.pronamespace
    where qn.nspname = 'private' and q.proname = p.proname and q.proargtypes = p.proargtypes and q.prosecdef
      and q.proconfig = array['search_path=""'])
$$, 'every public wrapper has a private definer counterpart with the same name and argument types');

select is_empty($$
  select w.rolname || ' -> ' || w.sig from api_exec w
  where w.nspname = 'public' and not exists (
    select 1 from api_exec d where d.nspname = 'private' and d.proname = w.proname and d.proargtypes = w.proargtypes
      and d.rolname = w.rolname)
$$, 'every role granted a public wrapper is granted its private counterpart (grants do not drift)');

select is_empty($$
  select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' group by p.proname having count(*) > 1
$$, 'no overloaded names in public');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'app', 'audit', 'infra') and p.prosecdef
    and coalesce(p.proconfig, '{}') <> array['search_path=""']
$$, 'every SECURITY DEFINER function pins an empty search_path');

select is_empty($$
  select distinct sig from api_exec, unnest(coalesce(proargnames, '{}')) arg
  where rolname in ('anon', 'authenticated')
    and arg ~* '(actor|owner|staff|token|hash|cipher|key_version|secret|password)'
$$, 'no anon/authenticated-callable function takes actor/owner/staff/credential parameters');

select is_empty($$ select sig from api_exec where rolname = 'anon' and provolatile = 'v' $$,
  'anon executes read projections only (no volatile function)');

select is_empty($$
  select distinct e.rolname || ' -> ' || e.sig from api_exec e
  where e.nspname = 'private'
    and not exists (select 1 from pg_proc w join pg_namespace wn on wn.oid = w.pronamespace
                    where wn.nspname = 'public' and w.proname = e.proname and w.proargtypes = e.proargtypes)
    and e.proname not in ('current_profile_id', 'current_staff_member_id', 'is_profile_ready', 'is_profile_active',
      'has_staff_role', 'is_admin_global', 'is_edition_staff', 'has_permission', 'owns_guest', 'friendship_accepted',
      'is_public_profile', 'is_edition_published', 'normalize_search_text', 'is_iana_timezone')
$$, 'private functions granted to API roles are public wrappers'' targets or allowlisted RLS/pure helpers');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'app', 'audit', 'infra')
    and has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
    and p.oid::regprocedure::text <> 'private.hook_before_user_created(jsonb)'
$$, 'GoTrue (supabase_auth_admin) executes only the before-user-created hook');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'app', 'audit', 'infra') and has_function_privilege('public', p.oid, 'EXECUTE')
$$, 'PUBLIC executes nothing');

select * from finish();
rollback;
