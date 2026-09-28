/**
 * Client-side views of the account API projections (source of truth: the strict zod schemas in
 * lib/server/domain/{registration,passes,people,communications}/contracts.ts). Only the fields the
 * UI reads are declared.
 */
import type { RequestStatus } from "@/lib/shared/registration";

export type RequestParticipantView = {
  request_participant_id: string;
  participant_kind: "PROFILE" | "GUEST";
  is_buyer: boolean;
  display_name: string | null;
  modality: { modality_id: string; name: string };
  category: { category_id: string; name: string } | null;
  price_snapshot_minor: number;
  legal_acceptance_status: "ACCEPTED" | "PENDING";
  kit_selection: { label: string } | null;
  registration: { registration_id: string; registration_number: string; status: string; participant_pass_id: string | null } | null;
};

export type RequestView = {
  registration_request_id: string;
  public_reference: string;
  edition: { edition_id: string; name: string; slug: string };
  status: RequestStatus;
  effective_status: RequestStatus;
  registration_mode: "FREE" | "EXTERNAL_WHATSAPP";
  currency: string;
  total_snapshot_minor: number;
  created_at: string;
  expires_at: string | null;
  confirmed_at: string | null;
  canceled_at: string | null;
  server_time: string;
  whatsapp_url: string | null;
  participants: RequestParticipantView[];
};

export type PassView = {
  participant_pass_id: string;
  public_code: string;
  status: string;
  issued_at: string;
  canceled_at: string | null;
  has_active_credential: boolean;
  registration: { registration_id: string; registration_number: string; status: string; confirmed_at: string | null };
  participant: { participant_kind: "PROFILE" | "GUEST"; is_self: boolean; display_name: string | null };
  edition: { edition_id: string; name: string; slug: string; event_date: string | null };
  modality: { modality_id: string; name: string };
  category: { category_id: string; name: string } | null;
};

export type PublicCard = { public_profile_id: string; display_name: string; avatar_object_key: string | null };

export type FriendshipView = {
  friendship_id: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "REMOVED";
  direction: "INCOMING" | "OUTGOING";
  requested_at: string;
  responded_at: string | null;
  removed_at: string | null;
  counterpart: PublicCard | null;
};

export type FriendshipState = "NONE" | "PENDING_OUTGOING" | "PENDING_INCOMING" | "FRIENDS";

export type PersonSearchItem = {
  public_profile_id: string;
  display_name: string;
  avatar_object_key: string | null;
  public_stats: { verified_distance_m: number; verified_participation_count: number; achievement_count: number } | null;
  friendship: { state: FriendshipState; friendship_id: string | null };
};

export type GuestView = {
  guest_participant_id: string;
  full_name: string;
  date_of_birth: string;
  sex_code: "F" | "M" | "X";
  phone_e164: string;
  emergency_contact_name: string;
  emergency_contact_phone_e164: string;
  emergency_contact_relationship: string;
  status: "ACTIVE" | "ARCHIVED";
  is_minor: boolean;
  identity_locked: boolean;
  guardian_status: "NONE" | "PENDING" | "ACTIVE";
  archive_after: string | null;
  archived_at: string | null;
};

export type GuardianAssignmentView = {
  guardian_assignment_id: string;
  minor_kind: "RUNNER" | "GUEST";
  my_roles: ("MINOR" | "GUARDIAN" | "GUEST_OWNER")[];
  status: "PENDING" | "ACTIVE" | "REVOKED";
  relationship_type: string;
  awaiting_confirmation_by: "ME" | "COUNTERPART" | null;
  minor: PublicCard | { guest_participant_id: string | null; full_name: string | null } | null;
  guardian: PublicCard | null;
  guest_owner: PublicCard | null;
  created_at: string;
  activated_at: string | null;
  revoked_at: string | null;
};

export type PendingActionView = {
  action_type: "LEGAL_ACCEPTANCE_REQUIRED";
  edition: { edition_id: string; name: string; slug: string };
  subject:
    | { kind: "SELF" }
    | { kind: "MINOR_PROFILE"; public_profile_id: string | null; display_name: string | null }
    | { kind: "MINOR_GUEST"; guest_participant_id: string; display_name: string | null };
  documents: { legal_document_version_id: string; document_type: string; version: number }[];
};

export type FavoriteView = {
  edition_id: string;
  slug: string;
  name: string;
  registration_state: string;
  execution_state: string;
  favorited_at: string;
  reminder: { reminder_id: string; status: string } | null;
};

type PurposeState = { granted: boolean; suppressed: boolean; effective: boolean };

export type PreferencesView = {
  contact: { has_email: boolean; verified: boolean };
  purposes: { GENERAL_MARKETING: PurposeState; EVENT_REMINDER: PurposeState; OTHER_OPTIONAL: PurposeState };
  reminders: { reminder_id: string; edition_id: string; slug: string; name: string; status: string; registration_state: string }[];
};

export type Paged<T> = { items: T[]; nextCursor: string | null };
