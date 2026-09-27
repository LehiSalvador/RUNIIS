-- Access-path indexes (Master §163). Uniqueness and "current row" indexes live with their tables.

create index runner_profile_search_name_trgm_idx on app.runner_profile
  using gin (search_name extensions.gin_trgm_ops);

create index community_profile_listing_idx on app.community_profile (is_visible, is_searchable, competition_status);
create index community_profile_display_name_trgm_idx on app.community_profile
  using gin (private.normalize_search_text(display_name) extensions.gin_trgm_ops);

create index friendship_requester_idx on app.friendship (requester_profile_id, status);
create index friendship_addressee_idx on app.friendship (addressee_profile_id, status);
create index guest_participant_owner_idx on app.guest_participant (owner_profile_id, status);
create index guardian_assignment_guardian_idx on app.guardian_assignment (guardian_profile_id, status);
create index guardian_assignment_minor_runner_idx on app.guardian_assignment (minor_runner_profile_id)
  where minor_runner_profile_id is not null;
create index guardian_assignment_minor_guest_idx on app.guardian_assignment (minor_guest_participant_id)
  where minor_guest_participant_id is not null;

create index staff_role_assignment_edition_idx on app.staff_role_assignment (edition_id) where edition_id is not null;
create index account_sanction_profile_idx on app.account_sanction (runner_profile_id, sanction_type, status);
create index blocked_identity_profile_idx on private.blocked_identity (runner_profile_id);
create index blocked_identity_email_idx on private.blocked_identity (normalized_email) where active;
create index blocked_identity_oauth_idx on private.blocked_identity (oauth_provider, oauth_subject) where active;

create index legal_acceptance_profile_idx on app.legal_acceptance (runner_profile_id, legal_document_version_id);
create index legal_acceptance_request_idx on app.legal_acceptance (registration_request_id)
  where registration_request_id is not null;

create index event_event_type_idx on app.event (event_type_id);
create index edition_event_idx on app.edition (event_id);
create index edition_state_idx on app.edition (publication_state, registration_state);
create index edition_registration_close_idx on app.edition (registration_close_at);
create index edition_slug_history_edition_idx on app.edition_slug_history (edition_id);
create index edition_location_geometry_idx on app.edition_location using gist (geometry);
create index edition_schedule_item_edition_idx on app.edition_schedule_item (edition_id, local_date);

create index modality_edition_status_idx on app.modality (edition_id, status);
create index modality_category_category_idx on app.modality_category (edition_id, category_id);
create index price_offer_selection_idx on app.price_offer (modality_id, status, starts_at, ends_at, priority);

create index route_modality_modality_idx on app.route_modality (edition_id, modality_id);
create index route_revision_geometry_idx on app.route_revision using gist (geometry);
create index route_poi_revision_idx on app.route_poi (route_revision_id);
create index route_poi_geometry_idx on app.route_poi using gist (geometry);
create index event_content_block_edition_idx on app.event_content_block (edition_id, position);
create index event_media_asset_edition_idx on app.event_media_asset (edition_id, sort_order);

create index registration_request_buyer_idx on app.registration_request (buyer_profile_id, status);
create index registration_request_edition_idx on app.registration_request (edition_id, status, expires_at);
create index registration_request_participant_profile_idx on app.registration_request_participant (runner_profile_id)
  where runner_profile_id is not null;
create index registration_request_participant_guest_idx on app.registration_request_participant (guest_participant_id)
  where guest_participant_id is not null;
create index registration_request_participant_modality_idx on app.registration_request_participant (modality_id);
create index registration_participant_claim_request_idx on app.registration_participant_claim (registration_request_id);
create index registration_participant_claim_expiry_idx on app.registration_participant_claim (expires_at)
  where status = 'ACTIVE';
create index registration_hold_availability_idx on app.registration_hold (modality_id, status, expires_at);

create index registration_edition_status_idx on app.registration (edition_id, status);
create index registration_modality_status_idx on app.registration (modality_id, status);
create index registration_profile_idx on app.registration (runner_profile_id) where runner_profile_id is not null;
create index registration_guest_idx on app.registration (guest_participant_id) where guest_participant_id is not null;
create index registration_buyer_idx on app.registration (buyer_profile_id);
create index registration_request_idx on app.registration (registration_request_id);
create index registration_category_assignment_category_idx on app.registration_category_assignment (category_id);

create index participant_pass_scan_pass_idx on app.participant_pass_scan (participant_pass_id, scanned_at);
create index participant_pass_scan_edition_idx on app.participant_pass_scan (edition_id, scanned_at);

create index kit_allocation_inventory_idx on app.kit_allocation (kit_definition_id, kit_variant_id, status);
create index kit_pickup_registration_idx on app.kit_pickup (registration_id);
create index kit_pickup_edition_idx on app.kit_pickup (edition_id, status);

create index guardian_event_verification_assignment_idx on app.guardian_event_verification (guardian_assignment_id);
create index attendance_checkin_edition_idx on app.attendance_checkin (edition_id, status);
create index attendance_checkin_registration_idx on app.attendance_checkin (registration_id);
create index attendance_resolution_edition_idx on app.attendance_resolution (edition_id, status);

create index distance_credit_runner_idx on app.distance_credit (runner_profile_id, status, sport_date);
create index distance_credit_registration_idx on app.distance_credit (registration_id);
create index distance_credit_edition_idx on app.distance_credit (edition_id, status);

create index ranking_snapshot_entry_rank_idx on app.ranking_snapshot_entry (ranking_snapshot_id, rank_position);
create index ranking_snapshot_entry_runner_idx on app.ranking_snapshot_entry (runner_profile_id);
create index ranking_projection_entry_rank_idx on app.ranking_projection_entry
  (projection_type, ranking_period_id, rank_position);
create index ranking_projection_entry_runner_idx on app.ranking_projection_entry (runner_profile_id);
create index achievement_grant_runner_idx on app.achievement_grant (runner_profile_id, status);
create index achievement_grant_snapshot_idx on app.achievement_grant (ranking_snapshot_id);
create index community_integrity_case_period_idx on app.community_integrity_case (ranking_period_id, status)
  where ranking_period_id is not null;
create index community_integrity_case_edition_idx on app.community_integrity_case (edition_id, status)
  where edition_id is not null;

create index profile_image_asset_queue_idx on app.profile_image_asset (status, uploaded_at);
create index avatar_moderation_decision_asset_idx on app.avatar_moderation_decision (profile_image_asset_id, decided_at);

create index communication_contact_point_recipient_idx on app.communication_contact_point (communication_recipient_id);
create index communication_consent_recipient_idx on app.communication_consent
  (communication_recipient_id, purpose, occurred_at);
create index edition_interest_edition_idx on app.edition_interest (edition_id);
create index event_reminder_subscription_edition_idx on app.event_reminder_subscription (edition_id, status);
create index event_reminder_subscription_recipient_idx on app.event_reminder_subscription (communication_recipient_id);
create index communication_suppression_contact_idx on app.communication_suppression (contact_point_id) where active;
create index communication_campaign_edition_idx on app.communication_campaign (edition_id) where edition_id is not null;
create index communication_message_dispatch_idx on app.communication_message (status, scheduled_for);
create index communication_message_recipient_idx on app.communication_message (recipient_id);
create index communication_message_registration_idx on app.communication_message (registration_id)
  where registration_id is not null;
create index communication_message_campaign_idx on app.communication_message (campaign_id) where campaign_id is not null;
create index communication_delivery_attempt_provider_idx on app.communication_delivery_attempt (provider_message_id)
  where provider_message_id is not null;
create index communication_provider_event_message_idx on infra.communication_provider_event (provider_message_id)
  where provider_message_id is not null;

create index admin_task_edition_idx on app.admin_task (edition_id, status, priority);
create index admin_task_open_idx on app.admin_task (status, blocking_level);

create index audit_log_entity_idx on audit.audit_log (entity_type, entity_id, occurred_at);
create index audit_log_edition_idx on audit.audit_log (edition_id, occurred_at) where edition_id is not null;

create index outbox_event_dispatch_idx on infra.outbox_event (status, available_at);
create index outbox_event_claim_expiry_idx on infra.outbox_event (claim_expires_at) where status = 'PROCESSING';
create index idempotency_record_expiry_idx on infra.idempotency_record (expires_at);
create index worker_run_worker_idx on infra.worker_run (worker_key, started_at);
create index rate_limit_counter_window_idx on infra.rate_limit_counter (window_start);

-- Final sweep: nothing in the domain schemas is reachable by API roles until 025 grants it.
revoke all on all tables in schema app, private, audit, infra from public, anon, authenticated;
revoke all on all sequences in schema app, private, audit, infra from public, anon, authenticated;
revoke all on all functions in schema app, private, audit, infra from public, anon, authenticated;
