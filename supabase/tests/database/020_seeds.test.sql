begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(12);

select results_eq(
  $$ select key, default_generates_distance_credit from app.event_type order by key $$,
  $$ values ('HIKE', true), ('OTHER', false), ('ROAD_RACE', true), ('TRAIL', true), ('WALK', false) $$,
  'event types are seeded with their distance-credit defaults');

select results_eq(
  $$ select settings_id::int, timezone, default_whatsapp_phone_e164, registration_hold_minutes,
            registration_close_offset_minutes, email_otp_expiry_seconds, availability_low_threshold_percent
     from app.platform_settings $$,
  $$ values (1, 'America/Monterrey', null::text, 1440, 2880, 600, null::numeric) $$,
  'platform_settings singleton: WhatsApp and low-availability threshold not configured (PEND-OPS-001)');

select results_eq(
  $$ select settings_id::int, timezone, ranking_epoch, ranking_epoch_frozen_at from app.competition_settings $$,
  $$ values (1, 'America/Monterrey', null::date, null::timestamptz) $$,
  'competition_settings singleton with ranking epoch unset');

select results_eq(
  $$ select key, family, place from app.achievement_definition where active order by key $$,
  $$ values ('HISTORICAL_PODIUM_CUT_1', 'HISTORICAL_PODIUM_CUT', 1), ('HISTORICAL_PODIUM_CUT_2', 'HISTORICAL_PODIUM_CUT', 2),
            ('HISTORICAL_PODIUM_CUT_3', 'HISTORICAL_PODIUM_CUT', 3), ('MONTHLY_PODIUM_1', 'MONTHLY_PODIUM', 1),
            ('MONTHLY_PODIUM_2', 'MONTHLY_PODIUM', 2), ('MONTHLY_PODIUM_3', 'MONTHLY_PODIUM', 3) $$,
  'the six V1 achievement definitions are seeded');

select results_eq(
  $$ select document_key, document_type, status from app.legal_document order by document_key $$,
  $$ values ('MINOR_TERMS', 'MINOR_TERMS', 'ACTIVE'), ('PRIVACY_NOTICE', 'PRIVACY_NOTICE', 'ACTIVE'),
            ('SPORT_WAIVER', 'SPORT_WAIVER', 'ACTIVE'), ('TERMS_OF_SERVICE', 'TERMS_OF_SERVICE', 'ACTIVE') $$,
  'legal document keys are seeded');

select is_empty($$ select 1 from app.legal_document_version $$, 'no legal text versions are seeded');
select is_empty($$ select 1 from app.runner_profile union all select 1 from app.staff_member $$,
  'seeds contain no people');

select throws_ok($$ insert into app.platform_settings (settings_id) values (2) $$, '23514', null,
  'platform_settings is a singleton');
select throws_ok($$ insert into app.competition_settings (settings_id) values (2) $$, '23514', null,
  'competition_settings is a singleton');
select throws_ok($$ update app.platform_settings set default_whatsapp_phone_e164 = '8112345678' $$, '23514', null,
  'default WhatsApp number must be E.164');
select lives_ok($$ update app.platform_settings set default_whatsapp_phone_e164 = '+528112345678' $$,
  'a valid E.164 default WhatsApp number is accepted');
select throws_ok($$ update app.competition_settings set timezone = 'Mars/Olympus' $$, '23514', null,
  'settings timezone must be an IANA name');

select * from finish();
rollback;
