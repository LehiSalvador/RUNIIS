import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import {
  friendshipPageSchema,
  friendshipSchema,
  guardianAssignmentListSchema,
  guardianAssignmentSchema,
  guestPageSchema,
  guestSchema,
  personSearchPageSchema,
  staffGuardianRevocationSchema,
  type guardianCreateSchema,
  type guestFieldsSchema,
  type guestPatchSchema,
} from "./contracts";
import { consumeRateLimit, readKeyset, writeKeyset } from "./paging";

// Thin RPC layer over the people commands (supabase/migrations/2026092813*). Authorisation,
// validation and ownership live in the database; these functions add the committed rate-limit
// pre-checks (A6), cursor encoding and strict result validation.

// ---- People search (Master §23) ----

export async function searchPeople(supabase: SupabaseClient, query: string, cursor: string | undefined) {
  const after = readKeyset(cursor);
  await consumeRateLimit(supabase, "people.search");
  const page = await callRpc(
    supabase,
    "search_people",
    { p_query: query, p_after_sort_key: after?.sortKey ?? null, p_after_public_profile_id: after?.id ?? null },
    personSearchPageSchema,
  );
  return { items: page.items, nextCursor: writeKeyset(page.next_cursor) };
}

// ---- Friendship (Master §22) ----

export async function listMyFriendships(
  supabase: SupabaseClient,
  view: "FRIENDS" | "INCOMING" | "OUTGOING",
  cursor: string | undefined,
) {
  const after = readKeyset(cursor);
  const page = await callRpc(
    supabase,
    "list_my_friendships",
    { p_view: view, p_after_sort_key: after?.sortKey ?? null, p_after_friendship_id: after?.id ?? null },
    friendshipPageSchema,
  );
  return { items: page.items, nextCursor: writeKeyset(page.next_cursor) };
}

export async function requestFriendship(supabase: SupabaseClient, publicProfileId: string, idempotencyKey: string | null) {
  await consumeRateLimit(supabase, "friendship.request.minute");
  await consumeRateLimit(supabase, "friendship.request.day");
  const friendship = await callRpc(
    supabase,
    "request_friendship",
    { p_public_profile_id: publicProfileId, p_idempotency_key: idempotencyKey },
    friendshipSchema,
  );
  logEvent("info", "friendship_requested", { friendship_id: friendship.friendship_id });
  return friendship;
}

export async function respondFriendship(supabase: SupabaseClient, friendshipId: string, answer: "accept" | "reject") {
  const friendship = await callRpc(supabase, `${answer}_friendship`, { p_friendship_id: friendshipId }, friendshipSchema);
  logEvent("info", `friendship_${answer}ed`, { friendship_id: friendship.friendship_id });
  return friendship;
}

export async function removeFriendship(supabase: SupabaseClient, friendshipId: string) {
  const friendship = await callRpc(supabase, "remove_friendship", { p_friendship_id: friendshipId }, friendshipSchema);
  logEvent("info", "friendship_removed", { friendship_id: friendship.friendship_id });
  return friendship;
}

// ---- GuestParticipant (Master §24-25) ----

export async function listMyGuests(supabase: SupabaseClient, status: "ACTIVE" | "ARCHIVED", cursor: string | undefined) {
  const after = readKeyset(cursor);
  const page = await callRpc(
    supabase,
    "list_my_guests",
    { p_status: status, p_after_sort_key: after?.sortKey ?? null, p_after_guest_participant_id: after?.id ?? null },
    guestPageSchema,
  );
  return { items: page.items, nextCursor: writeKeyset(page.next_cursor) };
}

export async function createGuest(
  supabase: SupabaseClient,
  fields: z.output<typeof guestFieldsSchema>,
  idempotencyKey: string | null,
) {
  await consumeRateLimit(supabase, "guest.create");
  const guest = await callRpc(
    supabase,
    "create_guest",
    {
      p_full_name: fields.full_name,
      p_date_of_birth: fields.date_of_birth,
      p_sex_code: fields.sex_code,
      p_phone_e164: fields.phone_e164,
      p_emergency_contact_name: fields.emergency_contact_name,
      p_emergency_contact_phone_e164: fields.emergency_contact_phone_e164,
      p_emergency_contact_relationship: fields.emergency_contact_relationship,
      p_idempotency_key: idempotencyKey,
    },
    guestSchema,
  );
  logEvent("info", "guest_created", { guest_participant_id: guest.guest_participant_id });
  return guest;
}

export async function updateGuest(supabase: SupabaseClient, guestId: string, changes: z.output<typeof guestPatchSchema>) {
  const guest = await callRpc(supabase, "update_guest", { p_guest_participant_id: guestId, p_changes: changes }, guestSchema);
  logEvent("info", "guest_updated", { guest_participant_id: guest.guest_participant_id });
  return guest;
}

export async function archiveGuest(supabase: SupabaseClient, guestId: string) {
  const guest = await callRpc(supabase, "archive_guest", { p_guest_participant_id: guestId }, guestSchema);
  logEvent("info", "guest_archived", { guest_participant_id: guest.guest_participant_id });
  return guest;
}

export async function reactivateGuest(supabase: SupabaseClient, guestId: string) {
  const guest = await callRpc(supabase, "reactivate_guest", { p_guest_participant_id: guestId }, guestSchema);
  logEvent("info", "guest_reactivated", { guest_participant_id: guest.guest_participant_id });
  return guest;
}

// ---- GuardianAssignment (Master §19-20, ADR-001 A10) ----

export async function listMyGuardianAssignments(supabase: SupabaseClient, includeRevoked: boolean) {
  return callRpc(supabase, "list_my_guardian_assignments", { p_include_revoked: includeRevoked }, guardianAssignmentListSchema);
}

export async function createGuardianAssignment(supabase: SupabaseClient, input: z.output<typeof guardianCreateSchema>) {
  await consumeRateLimit(supabase, "guardian.request");
  const assignment =
    input.minor_kind === "RUNNER"
      ? await callRpc(
          supabase,
          "request_runner_guardianship",
          { p_counterpart_public_profile_id: input.counterpart_public_profile_id, p_relationship_type: input.relationship_type },
          guardianAssignmentSchema,
        )
      : await callRpc(
          supabase,
          "assign_guest_guardian",
          {
            p_guest_participant_id: input.guest_participant_id,
            p_relationship_type: input.relationship_type,
            p_guardian_public_profile_id: input.guardian_public_profile_id ?? null,
          },
          guardianAssignmentSchema,
        );
  logEvent("info", "guardian_assignment_created", { guardian_assignment_id: assignment.guardian_assignment_id });
  return assignment;
}

export async function confirmGuardianAssignment(supabase: SupabaseClient, assignmentId: string) {
  const assignment = await callRpc(
    supabase,
    "confirm_guardian_assignment",
    { p_guardian_assignment_id: assignmentId },
    guardianAssignmentSchema,
  );
  logEvent("info", "guardian_assignment_confirmed", { guardian_assignment_id: assignment.guardian_assignment_id });
  return assignment;
}

export async function revokeGuardianAssignment(supabase: SupabaseClient, assignmentId: string) {
  const assignment = await callRpc(
    supabase,
    "revoke_guardian_assignment",
    { p_guardian_assignment_id: assignmentId },
    guardianAssignmentSchema,
  );
  logEvent("info", "guardian_assignment_revoked", { guardian_assignment_id: assignment.guardian_assignment_id });
  return assignment;
}

export async function staffRevokeGuardianAssignment(supabase: SupabaseClient, assignmentId: string, reason: string) {
  await consumeRateLimit(supabase, "admin.mutation");
  const result = await callRpc(
    supabase,
    "staff_revoke_guardian_assignment",
    { p_guardian_assignment_id: assignmentId, p_reason: reason },
    staffGuardianRevocationSchema,
  );
  logEvent("info", "guardian_assignment_staff_revoked", { guardian_assignment_id: result.guardian_assignment_id });
  return result;
}
