-- API-role grants allowlist (SEC-002, Master §159). Runs after 026, whose privilege sweep would
-- otherwise erase grants made by 024/025. Later domain migrations grant their own functions.
-- The pgTAP catalog lint (110) fails on anything granted outside these rules.

-- The Data API exposes only `public`; USAGE on `private` lets public invoker wrappers and RLS
-- policies reach the functions granted below. private tables get no grants.
grant usage on schema private to anon, authenticated, service_role;

-- Pure helpers used by CHECK constraints, index expressions and search filters: any role that
-- writes or filters those columns needs EXECUTE (T10 F1).
grant execute on function private.normalize_search_text(text), private.is_iana_timezone(text)
  to anon, authenticated, service_role;

-- RLS helpers: evaluated inside policies with the caller's privileges.
grant execute on function
  private.current_profile_id(),
  private.current_staff_member_id(),
  private.is_profile_ready(),
  private.is_profile_active(),
  private.has_staff_role(text, uuid),
  private.is_admin_global(),
  private.is_edition_staff(uuid),
  private.has_permission(text, uuid),
  private.owns_guest(uuid),
  private.friendship_accepted(uuid)
to authenticated;
grant execute on function private.is_public_profile(uuid), private.is_edition_published(uuid) to anon, authenticated;

grant execute on function private.current_actor(), public.current_actor() to authenticated;
grant execute on function private.consume_actor_rate_limit(text), public.consume_actor_rate_limit(text) to authenticated;
grant execute on function private.consume_subject_rate_limit(text, text), public.consume_subject_rate_limit(text, text)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- Table grants for invoker reads (Master §159-§160). SELECT only; rows are filtered by the 025
-- policies; column lists hide staff ids, internal notes, eligibility snapshots and pending keys.
-- ---------------------------------------------------------------------------------------------
grant usage on schema app to anon, authenticated;

grant select on
  app.legal_document, app.legal_document_version, app.event_type, app.event, app.edition, app.edition_slug_history,
  app.edition_location, app.edition_schedule_item, app.modality, app.category, app.modality_category,
  app.registration_form, app.registration_form_field, app.price_offer, app.route, app.route_modality, app.route_poi,
  app.event_content_block, app.event_media_asset, app.kit_definition, app.kit_variant, app.ranking_period,
  app.achievement_definition
to anon, authenticated;

-- Never public: competition status (reveals minors), searchability, internal ids (Master §18, SEC-120).
grant select (public_profile_id, display_name, avatar_asset_id, verified_distance_projection_m, verified_participation_count)
  on app.community_profile to anon, authenticated;
grant select (edition_schedule_revision_id, edition_id, revision, schedule_state, local_date, local_start_time,
  local_end_time, timezone, effective_start_at, effective_end_at, created_at, superseded_at)
  on app.edition_schedule_revision to anon, authenticated;
grant select (route_revision_id, route_id, revision, status, geometry, geojson_snapshot, computed_distance_m,
  published_at, created_at)
  on app.route_revision to anon, authenticated;
grant select (ranking_snapshot_id, ranking_period_id, revision, status, cutoff_at, generated_at, superseded_at)
  on app.ranking_snapshot to anon, authenticated;

grant select on
  app.runner_profile, app.friendship, app.guest_participant, app.guardian_assignment, app.staff_member,
  app.staff_role_assignment, app.legal_acceptance, app.modality_capacity, app.registration, app.achievement_grant,
  app.communication_recipient, app.communication_contact_point, app.communication_consent,
  app.communication_preference, app.edition_interest, app.event_reminder_subscription
to authenticated;

grant select (sanction_id, runner_profile_id, sanction_type, status, starts_at, ends_at, revoked_at, created_at)
  on app.account_sanction to authenticated;
grant select (registration_request_id, public_reference, buyer_profile_id, edition_id, status, registration_mode,
  currency, total_snapshot_minor, whatsapp_phone_snapshot, created_at, expires_at, confirmed_at, canceled_at,
  canceled_by_profile_id, cancel_reason, revalidated_from_expired, updated_at)
  on app.registration_request to authenticated;
-- SEC-012: buyers never read a Friend's raw eligibility snapshot.
grant select (request_participant_id, registration_request_id, participant_kind, runner_profile_id,
  guest_participant_id, modality_id, category_id, price_offer_id, price_snapshot_minor, currency, created_at)
  on app.registration_request_participant to authenticated;
grant select (registration_confirmation_id, registration_request_id, confirmation_method, confirmed_at)
  on app.registration_confirmation to authenticated;
grant select (registration_category_assignment_id, registration_id, category_id, assignment_source, assigned_at)
  on app.registration_category_assignment to authenticated;
grant select (registration_revision_id, registration_id, revision, modality_id, category_id, status, effective_from,
  created_at, superseded_at)
  on app.registration_revision to authenticated;
grant select (kit_allocation_id, registration_id, kit_definition_id, kit_variant_id, status, assigned_at, updated_at)
  on app.kit_allocation to authenticated;
grant select (participant_pass_id, registration_id, public_code, status, issued_at, canceled_at, created_at, updated_at)
  on app.participant_pass to authenticated;
grant select (distance_credit_id, runner_profile_id, registration_id, edition_id, modality_id, attendance_resolution_id,
  attendance_finalization_id, administrative_closure_id, sporting_eligibility_resolution_id,
  official_distance_snapshot_m, credited_distance_m, sport_date, sport_timezone, status, source, created_at,
  reversed_at, reversal_reason, supersedes_distance_credit_id)
  on app.distance_credit to authenticated;
grant select (profile_image_asset_id, runner_profile_id, public_object_key, status, uploaded_at, processed_at,
  approved_at, rejected_at, removed_at, created_at, updated_at)
  on app.profile_image_asset to authenticated;
