begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(33);

-- Synthetic identities only.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'runner-a@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'runner-b@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'staff@example.test'),
  ('00000000-0000-4000-8000-000000000004', 'runner-c@example.test');
insert into app.runner_profile (runner_profile_id, auth_user_id, full_name) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'José  Ñúñez '),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'Runner Beta'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', 'Runner Gamma');
insert into app.staff_member (staff_member_id, auth_user_id) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
  phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Invitado Delta', '2009-05-01',
   'F', '+528110000001', 'Contacto Delta', '+528110000002', 'Madre');

-- runner_profile
select is((select search_name from app.runner_profile where runner_profile_id = '10000000-0000-4000-8000-000000000001'),
  'jose nunez', 'search_name is derived from full_name');
update app.runner_profile set search_name = 'tampered' where runner_profile_id = '10000000-0000-4000-8000-000000000001';
select is((select search_name from app.runner_profile where runner_profile_id = '10000000-0000-4000-8000-000000000001'),
  'jose nunez', 'search_name cannot be written directly');
select throws_ok($$ insert into auth.users (id) values ('00000000-0000-4000-8000-000000000009');
  insert into app.runner_profile (auth_user_id, profile_readiness, full_name)
  values ('00000000-0000-4000-8000-000000000009', 'READY', 'Sin Datos') $$, '23514', null,
  'READY requires every universal field');
select throws_ok($$ insert into app.runner_profile (auth_user_id)
  values ('00000000-0000-4000-8000-000000000001') $$, '23505', null, 'one RunnerProfile per AuthUser');
select throws_ok($$ insert into app.runner_profile (auth_user_id)
  values ('00000000-0000-4000-8000-0000000000ff') $$, '23503', null, 'runner_profile requires an existing auth user');
select throws_ok($$ update app.runner_profile set phone_e164 = '81 1234 5678'
  where runner_profile_id = '10000000-0000-4000-8000-000000000002' $$, '23514', null, 'phones must be E.164');
select throws_ok($$ update app.runner_profile set account_state = 'SUSPENDED'
  where runner_profile_id = '10000000-0000-4000-8000-000000000002' $$, '23514', null,
  'account_state is limited to the Master value set');

-- community_profile display_name sync
insert into app.community_profile (runner_profile_id, competition_status) values
  ('10000000-0000-4000-8000-000000000001', 'ELIGIBLE'),
  ('10000000-0000-4000-8000-000000000002', 'ELIGIBLE');
select is((select display_name from app.community_profile where runner_profile_id = '10000000-0000-4000-8000-000000000002'),
  'Runner Beta', 'display_name defaults to full_name');
update app.runner_profile set full_name = 'Runner Beta Corregido'
  where runner_profile_id = '10000000-0000-4000-8000-000000000002';
select is((select display_name from app.community_profile where runner_profile_id = '10000000-0000-4000-8000-000000000002'),
  'Runner Beta Corregido', 'display_name follows a full_name correction');
update app.community_profile set display_name = 'Alias Administrativo'
  where runner_profile_id = '10000000-0000-4000-8000-000000000002';
update app.runner_profile set full_name = 'Runner Beta Final'
  where runner_profile_id = '10000000-0000-4000-8000-000000000002';
select is((select display_name from app.community_profile where runner_profile_id = '10000000-0000-4000-8000-000000000002'),
  'Alias Administrativo', 'an administratively set display_name is not overwritten');
select throws_ok($$ update app.community_profile set competition_status = 'PUBLIC'
  where runner_profile_id = '10000000-0000-4000-8000-000000000001' $$, '23514', null,
  'competition_status is limited to the Master value set');

-- friendship
select throws_ok($$ insert into app.friendship (requester_profile_id, addressee_profile_id) values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$, '23514', null,
  'friendship with self is rejected');
insert into app.friendship (friendship_id, requester_profile_id, addressee_profile_id) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');
select throws_ok($$ insert into app.friendship (requester_profile_id, addressee_profile_id) values
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $$, '23505', null,
  'inverse duplicate friendship is rejected while PENDING');
update app.friendship set status = 'ACCEPTED', responded_at = now() where friendship_id = '40000000-0000-4000-8000-000000000001';
select throws_ok($$ insert into app.friendship (requester_profile_id, addressee_profile_id) values
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $$, '23505', null,
  'inverse duplicate friendship is rejected while ACCEPTED');
update app.friendship set status = 'REMOVED', removed_at = now() where friendship_id = '40000000-0000-4000-8000-000000000001';
select lives_ok($$ insert into app.friendship (requester_profile_id, addressee_profile_id) values
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $$,
  'a new request is allowed after the relationship was removed');

-- guest and guardian
select throws_ok($$ update app.guest_participant set status = 'ARCHIVED'
  where guest_participant_id = '30000000-0000-4000-8000-000000000001' $$, '23514', null,
  'ARCHIVED guest requires archived_at');
select throws_ok($$ insert into app.guardian_assignment (minor_runner_profile_id, minor_guest_participant_id,
  guardian_profile_id, relationship_type) values ('10000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'PARENT') $$, '23514', null,
  'guardian target must be exactly one (both given)');
select throws_ok($$ insert into app.guardian_assignment (guardian_profile_id, relationship_type)
  values ('10000000-0000-4000-8000-000000000001', 'PARENT') $$, '23514', null,
  'guardian target must be exactly one (none given)');
select throws_ok($$ insert into app.guardian_assignment (minor_runner_profile_id, guardian_profile_id, relationship_type)
  values ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'PARENT') $$, '23514', null,
  'guardian cannot be the minor');
select throws_ok($$ insert into app.guardian_assignment (minor_guest_participant_id, guardian_profile_id, relationship_type)
  values ('30000000-0000-4000-8000-0000000000ff', '10000000-0000-4000-8000-000000000001', 'PARENT') $$, '23503', null,
  'guardian assignment requires an existing guest');

-- staff and sanctions
select throws_ok($$ insert into app.staff_role_assignment (staff_member_id, role, scope_type)
  values ('20000000-0000-4000-8000-000000000001', 'ADMIN', 'EDITION') $$, '23514', null,
  'EDITION-scoped role requires edition_id');
insert into app.staff_role_assignment (staff_member_id, role, scope_type)
  values ('20000000-0000-4000-8000-000000000001', 'ADMIN', 'GLOBAL');
select throws_ok($$ insert into app.staff_role_assignment (staff_member_id, role, scope_type)
  values ('20000000-0000-4000-8000-000000000001', 'ADMIN', 'GLOBAL') $$, '23505', null,
  'duplicate live global role is rejected');
select throws_ok($$ insert into app.staff_role_assignment (staff_member_id, role, scope_type)
  values ('20000000-0000-4000-8000-000000000001', 'SUPERUSER', 'GLOBAL') $$, '23514', null,
  'role is limited to ADMIN/OPERATOR/CHECKIN/MODERATOR');
select throws_ok($$ insert into private.blocked_identity (runner_profile_id, normalized_email)
  values ('10000000-0000-4000-8000-000000000001', 'Runner-A@Example.test') $$, '23514', null,
  'blocked identity email must be normalized');

-- avatar
insert into app.profile_image_asset (profile_image_asset_id, runner_profile_id, staging_object_key, public_object_key,
  status, approved_at) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'stg/a1', 'pub/a1', 'APPROVED', now()),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'stg/a2', null, 'PENDING_REVIEW', null),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'stg/b1', 'pub/b1', 'APPROVED', now());
select throws_ok($$ insert into app.profile_image_asset (runner_profile_id, staging_object_key, public_object_key, status, approved_at)
  values ('10000000-0000-4000-8000-000000000001', 'stg/a3', 'pub/a3', 'APPROVED', now()) $$, '23505', null,
  'one APPROVED avatar per runner');
select throws_ok($$ insert into app.profile_image_asset (runner_profile_id, staging_object_key, status)
  values ('10000000-0000-4000-8000-000000000001', 'stg/a4', 'PENDING_PROCESSING') $$, '23505', null,
  'one pending avatar per runner');
select throws_ok($$ update app.community_profile set avatar_asset_id = '50000000-0000-4000-8000-000000000003'
  where runner_profile_id = '10000000-0000-4000-8000-000000000001' $$, '23503', null,
  'community profile cannot use another runner''s avatar');
select lives_ok($$ update app.community_profile set avatar_asset_id = '50000000-0000-4000-8000-000000000001'
  where runner_profile_id = '10000000-0000-4000-8000-000000000001' $$, 'community profile can use its own avatar');

-- communications and infra uniqueness
insert into app.communication_recipient (communication_recipient_id, recipient_type, runner_profile_id) values
  ('60000000-0000-4000-8000-000000000001', 'RUNNER', '10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002', 'RUNNER', '10000000-0000-4000-8000-000000000002');
insert into app.communication_contact_point (communication_contact_point_id, communication_recipient_id, channel,
  value_normalized, is_primary) values
  ('61000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'EMAIL', 'runner-b@example.test', true);
select throws_ok($$ insert into app.communication_recipient (recipient_type, guest_participant_id)
  values ('RUNNER', '30000000-0000-4000-8000-000000000001') $$, '23514', null,
  'recipient target must match recipient_type');
select throws_ok($$ insert into app.communication_message (dedupe_key, recipient_id, contact_point_id, template_key,
  template_version, category, priority, purpose, source_type, render_context_snapshot, rendered_subject_snapshot)
  values ('dk-1', '60000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'T', 1,
          'TRANSACTIONAL', 1, 'REGISTRATION', 'TEST', '{}', 'Asunto') $$, '23503', null,
  'message contact point must belong to its recipient');
insert into infra.outbox_event (event_type, aggregate_type, aggregate_id, effect_key, payload)
  values ('ProfileReady', 'runner_profile', '10000000-0000-4000-8000-000000000001', 'profile-ready:a', '{}');
select throws_ok($$ insert into infra.outbox_event (event_type, aggregate_type, aggregate_id, effect_key, payload)
  values ('ProfileReady', 'runner_profile', '10000000-0000-4000-8000-000000000001', 'profile-ready:a', '{}') $$,
  '23505', null, 'outbox effect_key is unique');
insert into infra.idempotency_record (operation_key, resource_scope, idempotency_key, request_hash, state, expires_at)
  values ('worker', 'global', 'k1', repeat('a', 64), 'COMPLETED', now() + interval '1 day');
select throws_ok($$ insert into infra.idempotency_record (operation_key, resource_scope, idempotency_key, request_hash,
  state, expires_at) values ('worker', 'global', 'k1', repeat('b', 64), 'COMPLETED', now() + interval '1 day') $$,
  '23505', null, 'SYSTEM (null actor) idempotency keys are unique too');
insert into infra.communication_provider_event (provider, provider_event_id, event_type, authenticated, payload_safe,
  processing_status) values ('brevo', 'evt-1', 'delivered', true, '{}', 'RECEIVED');
select throws_ok($$ insert into infra.communication_provider_event (provider, provider_event_id, event_type,
  authenticated, payload_safe, processing_status) values ('brevo', 'evt-1', 'delivered', true, '{}', 'RECEIVED') $$,
  '23505', null, 'provider events are deduplicated');

select * from finish();
rollback;
