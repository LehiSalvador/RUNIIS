-- RLS policies for every app table (Master §156-§158, §205). Read-only: there is no client write
-- path (no INSERT/UPDATE/DELETE grants anywhere); every state change is a definer command.
-- The grants that make these policies reachable live in 029: the 026 privilege sweep runs after this file.
-- anon: published projections and visible community only. authenticated: own rows, the same
-- public rows, and staff rows scoped through has_permission/is_edition_staff on the row's Edition.

-- GraphQL is a second API surface with its own reflection rules (SEC-004).
drop extension if exists pg_graphql;

create function private.is_edition_published(p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.edition e where e.edition_id = p_edition_id and e.publication_state = 'PUBLISHED')
$$;
revoke all on function private.is_edition_published(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Profiles, community, people
-- ---------------------------------------------------------------------------------------------
create policy runner_profile_own_select on app.runner_profile for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy community_profile_public_select on app.community_profile for select to anon, authenticated
  using (private.is_public_profile(runner_profile_id));
create policy community_profile_own_select on app.community_profile for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));

create policy friendship_party_select on app.friendship for select to authenticated
  using ((select private.current_profile_id()) in (requester_profile_id, addressee_profile_id));

create policy guest_participant_owner_select on app.guest_participant for select to authenticated
  using (owner_profile_id = (select private.current_profile_id()));

create policy guardian_assignment_party_select on app.guardian_assignment for select to authenticated
  using ((select private.current_profile_id()) in (guardian_profile_id, minor_runner_profile_id)
         or private.owns_guest(minor_guest_participant_id));

create policy staff_member_self_select on app.staff_member for select to authenticated
  using (auth_user_id = (select auth.uid()));
create policy staff_member_admin_select on app.staff_member for select to authenticated
  using ((select private.is_admin_global()));

create policy staff_role_assignment_self_select on app.staff_role_assignment for select to authenticated
  using (staff_member_id = (select private.current_staff_member_id()));
create policy staff_role_assignment_admin_select on app.staff_role_assignment for select to authenticated
  using ((select private.is_admin_global()));

-- Effective restriction only (column grants hide reasons and staff ids).
create policy account_sanction_own_select on app.account_sanction for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));

-- ---------------------------------------------------------------------------------------------
-- Legal
-- ---------------------------------------------------------------------------------------------
create policy legal_document_public_select on app.legal_document for select to anon, authenticated
  using (status = 'ACTIVE');
create policy legal_document_version_public_select on app.legal_document_version for select to anon, authenticated
  using (status in ('PUBLISHED', 'SUPERSEDED'));
create policy legal_acceptance_own_select on app.legal_acceptance for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));

-- ---------------------------------------------------------------------------------------------
-- Events: published projections for everyone, drafts for staff of that Edition
-- ---------------------------------------------------------------------------------------------
create policy event_type_public_select on app.event_type for select to anon, authenticated
  using (active);

create policy event_public_select on app.event for select to anon, authenticated
  using (status = 'ACTIVE' and exists (
    select 1 from app.edition e where e.event_id = event.event_id and e.publication_state = 'PUBLISHED'));
create policy event_staff_select on app.event for select to authenticated
  using ((select private.current_staff_member_id()) is not null);

create policy edition_public_select on app.edition for select to anon, authenticated
  using (publication_state = 'PUBLISHED');
create policy edition_staff_select on app.edition for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy edition_slug_history_public_select on app.edition_slug_history for select to anon, authenticated
  using (private.is_edition_published(edition_id));
create policy edition_slug_history_staff_select on app.edition_slug_history for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy edition_schedule_revision_public_select on app.edition_schedule_revision for select to anon, authenticated
  using (private.is_edition_published(edition_id));
create policy edition_schedule_revision_staff_select on app.edition_schedule_revision for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy edition_location_public_select on app.edition_location for select to anon, authenticated
  using (private.is_edition_published(edition_id));
create policy edition_location_staff_select on app.edition_location for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy edition_schedule_item_public_select on app.edition_schedule_item for select to anon, authenticated
  using (private.is_edition_published(edition_id));
create policy edition_schedule_item_staff_select on app.edition_schedule_item for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy modality_public_select on app.modality for select to anon, authenticated
  using (private.is_edition_published(edition_id));
create policy modality_staff_select on app.modality for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy category_public_select on app.category for select to anon, authenticated
  using (active and private.is_edition_published(edition_id));
create policy category_staff_select on app.category for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy modality_category_public_select on app.modality_category for select to anon, authenticated
  using (private.is_edition_published(edition_id));
create policy modality_category_staff_select on app.modality_category for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy registration_form_public_select on app.registration_form for select to anon, authenticated
  using (status = 'PUBLISHED' and private.is_edition_published(edition_id));
create policy registration_form_staff_select on app.registration_form for select to authenticated
  using (private.is_edition_staff(edition_id));

-- Visibility follows the parent form's own policies.
create policy registration_form_field_visible_form_select on app.registration_form_field for select to anon, authenticated
  using (exists (select 1 from app.registration_form f where f.registration_form_id = registration_form_field.registration_form_id));

-- Raw capacity is operational data; the public sees computed availability through projections.
create policy modality_capacity_staff_select on app.modality_capacity for select to authenticated
  using (exists (select 1 from app.modality m
                 where m.modality_id = modality_capacity.modality_id and private.is_edition_staff(m.edition_id)));

create policy price_offer_public_select on app.price_offer for select to anon, authenticated
  using (status = 'ACTIVE' and exists (select 1 from app.modality m
         where m.modality_id = price_offer.modality_id and private.is_edition_published(m.edition_id)));
create policy price_offer_staff_select on app.price_offer for select to authenticated
  using (exists (select 1 from app.modality m
                 where m.modality_id = price_offer.modality_id and private.is_edition_staff(m.edition_id)));

create policy route_public_select on app.route for select to anon, authenticated
  using (status = 'PUBLISHED' and private.is_edition_published(edition_id));
create policy route_staff_select on app.route for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy route_modality_public_select on app.route_modality for select to anon, authenticated
  using (private.is_edition_published(edition_id));
create policy route_modality_staff_select on app.route_modality for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy route_revision_public_select on app.route_revision for select to anon, authenticated
  using (status = 'PUBLISHED' and exists (select 1 from app.route r
         where r.route_id = route_revision.route_id and r.status = 'PUBLISHED' and private.is_edition_published(r.edition_id)));
create policy route_revision_staff_select on app.route_revision for select to authenticated
  using (exists (select 1 from app.route r
                 where r.route_id = route_revision.route_id and private.is_edition_staff(r.edition_id)));

-- Visibility follows the parent revision's own policies.
create policy route_poi_visible_revision_select on app.route_poi for select to anon, authenticated
  using (exists (select 1 from app.route_revision rr where rr.route_revision_id = route_poi.route_revision_id));

create policy event_content_block_public_select on app.event_content_block for select to anon, authenticated
  using (status = 'PUBLISHED' and private.is_edition_published(edition_id));
create policy event_content_block_staff_select on app.event_content_block for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy event_media_asset_public_select on app.event_media_asset for select to anon, authenticated
  using (status = 'PUBLISHED' and private.is_edition_published(edition_id));
create policy event_media_asset_staff_select on app.event_media_asset for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy kit_definition_public_select on app.kit_definition for select to anon, authenticated
  using (private.is_edition_published(edition_id));
create policy kit_definition_staff_select on app.kit_definition for select to authenticated
  using (private.is_edition_staff(edition_id));

create policy kit_variant_visible_definition_select on app.kit_variant for select to anon, authenticated
  using (exists (select 1 from app.kit_definition kd where kd.kit_definition_id = kit_variant.kit_definition_id));

-- ---------------------------------------------------------------------------------------------
-- Registration: buyer / titular own rows, staff scoped by the row's Edition
-- ---------------------------------------------------------------------------------------------
create policy registration_request_buyer_select on app.registration_request for select to authenticated
  using (buyer_profile_id = (select private.current_profile_id()));
create policy registration_request_staff_select on app.registration_request for select to authenticated
  using (private.has_permission('REGISTRATION_REQUEST_MANAGE', edition_id));

-- Buyer sees the request summary; an included Friend sees only their own inclusion.
create policy registration_request_participant_buyer_select on app.registration_request_participant for select to authenticated
  using (exists (select 1 from app.registration_request r
                 where r.registration_request_id = registration_request_participant.registration_request_id
                   and r.buyer_profile_id = (select private.current_profile_id())));
create policy registration_request_participant_self_select on app.registration_request_participant for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));
create policy registration_request_participant_staff_select on app.registration_request_participant for select to authenticated
  using (exists (select 1 from app.registration_request r
                 where r.registration_request_id = registration_request_participant.registration_request_id
                   and private.has_permission('REGISTRATION_REQUEST_MANAGE', r.edition_id)));

create policy registration_confirmation_buyer_select on app.registration_confirmation for select to authenticated
  using (exists (select 1 from app.registration_request r
                 where r.registration_request_id = registration_confirmation.registration_request_id
                   and r.buyer_profile_id = (select private.current_profile_id())));
create policy registration_confirmation_staff_select on app.registration_confirmation for select to authenticated
  using (exists (select 1 from app.registration_request r
                 where r.registration_request_id = registration_confirmation.registration_request_id
                   and private.has_permission('REGISTRATION_REQUEST_MANAGE', r.edition_id)));

create policy registration_titular_select on app.registration for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));
create policy registration_buyer_select on app.registration for select to authenticated
  using (buyer_profile_id = (select private.current_profile_id()));
create policy registration_staff_select on app.registration for select to authenticated
  using (private.has_permission('PARTICIPANT_LIST_READ', edition_id));

-- Children of a registration follow the registration's own policies.
create policy registration_category_assignment_visible_select on app.registration_category_assignment for select to authenticated
  using (exists (select 1 from app.registration r where r.registration_id = registration_category_assignment.registration_id));
create policy registration_revision_visible_select on app.registration_revision for select to authenticated
  using (exists (select 1 from app.registration r where r.registration_id = registration_revision.registration_id));
create policy kit_allocation_visible_select on app.kit_allocation for select to authenticated
  using (exists (select 1 from app.registration r where r.registration_id = kit_allocation.registration_id));

-- Pass: titular; the buyer only for GUEST passes (never a Friend's pass, Master §84).
create policy participant_pass_holder_select on app.participant_pass for select to authenticated
  using (exists (select 1 from app.registration r
                 where r.registration_id = participant_pass.registration_id
                   and (r.runner_profile_id = (select private.current_profile_id())
                        or (r.guest_participant_id is not null and r.buyer_profile_id = (select private.current_profile_id())))));
create policy participant_pass_staff_select on app.participant_pass for select to authenticated
  using (exists (select 1 from app.registration r
                 where r.registration_id = participant_pass.registration_id
                   and private.has_permission('PARTICIPANT_LIST_READ', r.edition_id)));

-- ---------------------------------------------------------------------------------------------
-- Results, community, avatar, communications
-- ---------------------------------------------------------------------------------------------
create policy distance_credit_own_select on app.distance_credit for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));

create policy ranking_period_public_select on app.ranking_period for select to anon, authenticated
  using (true);
create policy ranking_snapshot_public_select on app.ranking_snapshot for select to anon, authenticated
  using (true);
create policy achievement_definition_public_select on app.achievement_definition for select to anon, authenticated
  using (active);
create policy achievement_grant_own_select on app.achievement_grant for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));

create policy profile_image_asset_own_select on app.profile_image_asset for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));

create policy communication_recipient_own_select on app.communication_recipient for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));
create policy communication_contact_point_own_select on app.communication_contact_point for select to authenticated
  using (exists (select 1 from app.communication_recipient cr
                 where cr.communication_recipient_id = communication_contact_point.communication_recipient_id
                   and cr.runner_profile_id = (select private.current_profile_id())));
create policy communication_consent_own_select on app.communication_consent for select to authenticated
  using (exists (select 1 from app.communication_recipient cr
                 where cr.communication_recipient_id = communication_consent.communication_recipient_id
                   and cr.runner_profile_id = (select private.current_profile_id())));
create policy communication_preference_own_select on app.communication_preference for select to authenticated
  using (exists (select 1 from app.communication_recipient cr
                 where cr.communication_recipient_id = communication_preference.communication_recipient_id
                   and cr.runner_profile_id = (select private.current_profile_id())));
create policy edition_interest_own_select on app.edition_interest for select to authenticated
  using (runner_profile_id = (select private.current_profile_id()));
create policy event_reminder_subscription_own_select on app.event_reminder_subscription for select to authenticated
  using (exists (select 1 from app.communication_recipient cr
                 where cr.communication_recipient_id = event_reminder_subscription.communication_recipient_id
                   and cr.runner_profile_id = (select private.current_profile_id())));

-- No policy (deny for every API role; definer projections/commands only):
-- platform_settings, competition_settings, registration_participant_claim, registration_hold,
-- registration_field_response, participant_pass_credential, participant_pass_scan, kit_selection,
-- kit_pickup, guardian_event_verification, attendance_checkin, attendance_resolution,
-- sporting_eligibility_resolution, attendance_finalization, administrative_closure,
-- ranking_snapshot_entry, ranking_projection_entry, community_integrity_case,
-- avatar_moderation_decision, communication_suppression, communication_template,
-- communication_template_version, communication_automation_rule, communication_campaign,
-- communication_campaign_recipient, communication_message, communication_delivery_attempt,
-- communication_provider_usage, admin_task.
