-- Static catalogues only: no users, PII, provider data or legal texts (external dependency).
insert into app.event_type (key, name, default_generates_distance_credit, active) values
  ('ROAD_RACE', 'Carrera de ruta', true, true),
  ('TRAIL', 'Trail', true, true),
  ('HIKE', 'Senderismo', true, true),
  ('WALK', 'Caminata', false, true),
  ('OTHER', 'Otro', false, true)
on conflict (key) do nothing;

-- default_whatsapp_phone_e164 stays NULL until PEND-OPS-001; low-availability threshold is unset.
insert into app.platform_settings (settings_id) values (1) on conflict (settings_id) do nothing;

insert into app.competition_settings (settings_id) values (1) on conflict (settings_id) do nothing;

insert into app.achievement_definition (key, family, place, name, active) values
  ('MONTHLY_PODIUM_1', 'MONTHLY_PODIUM', 1, 'Podio mensual - 1.er lugar', true),
  ('MONTHLY_PODIUM_2', 'MONTHLY_PODIUM', 2, 'Podio mensual - 2.º lugar', true),
  ('MONTHLY_PODIUM_3', 'MONTHLY_PODIUM', 3, 'Podio mensual - 3.er lugar', true),
  ('HISTORICAL_PODIUM_CUT_1', 'HISTORICAL_PODIUM_CUT', 1, 'Podio histórico - 1.er lugar', true),
  ('HISTORICAL_PODIUM_CUT_2', 'HISTORICAL_PODIUM_CUT', 2, 'Podio histórico - 2.º lugar', true),
  ('HISTORICAL_PODIUM_CUT_3', 'HISTORICAL_PODIUM_CUT', 3, 'Podio histórico - 3.er lugar', true)
on conflict (key) do nothing;

insert into app.legal_document (document_key, document_type, status) values
  ('TERMS_OF_SERVICE', 'TERMS_OF_SERVICE', 'ACTIVE'),
  ('PRIVACY_NOTICE', 'PRIVACY_NOTICE', 'ACTIVE'),
  ('SPORT_WAIVER', 'SPORT_WAIVER', 'ACTIVE'),
  ('MINOR_TERMS', 'MINOR_TERMS', 'ACTIVE')
on conflict (document_key) do nothing;
