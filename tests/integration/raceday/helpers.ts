import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { activePassPayload } from "@/lib/server/domain/passes/credentials";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { buildEdition, type BuildEditionOptions, selfAcceptance } from "../registration/helpers";
import { queryValue, sql, systemClient } from "../helpers";

// T40 Race Day fixture builder: reuses T30/T34's real domain services to stand up a registrable,
// FREE Edition and a real CONFIRMED Registration + ParticipantPass, then issues a real RN1 token
// through the same SYSTEM path production uses (lib/server/domain/passes/credentials.ts).

export async function buildRacedayEdition(admin: SupabaseClient, options: Partial<BuildEditionOptions> = {}) {
  return buildEdition(admin, { mode: "FREE", modalityCapacity: 1000, ...options });
}

/**
 * buildEdition schedules 60 days out (needed so `registration_close_at` stays open for registering
 * fixtures) and the scanner's NOT_YET_ALLOWED window opens the day before the sport date, so Race Day
 * tests move the event to "tomorrow" only after every registration for the test is already in place
 * (rescheduling re-materialises `registration_close_at` off the new date and would otherwise close it).
 */
const MONTERREY_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey", year: "numeric", month: "2-digit", day: "2-digit" });

/** The Edition's calendar date (America/Monterrey), `days` from now -- computed the same way the DB
 * evaluates SCHEDULE_DATE_VALID/NOT_YET_ALLOWED (`... at time zone 'America/Monterrey'`), so this never
 * disagrees with the server near a UTC day boundary the way a naive `toISOString().slice(0, 10)` would. */
function monterreyDate(days: number): string {
  return MONTERREY_DATE_FORMAT.format(new Date(Date.now() + days * 86_400_000));
}

export async function openCheckInWindow(admin: SupabaseClient, editionId: string): Promise<void> {
  await transitionEdition(
    admin,
    "reschedule",
    editionId,
    { reason: "raceday fixture: move event to tomorrow", local_date: monterreyDate(1), local_start_time: "07:00:00" },
    null,
  );
}

/** Registers `buyer` (adult, self) in `edition` and returns the real `RN1.<token>` QR payload. */
export async function registerSelfAndIssueToken(
  buyer: { client: SupabaseClient; publicProfileId: string | null },
  edition: { editionId: string; modalityId: string; sportWaiverVersionId: string },
): Promise<{ registrationId: string; participantPassId: string; token: string }> {
  const result = await createRegistrationRequest(
    buyer.client,
    {
      edition_id: edition.editionId,
      participants: [{ kind: "PROFILE", public_profile_id: buyer.publicProfileId!, modality_id: edition.modalityId }],
      legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
    },
    null,
  );
  const registration = result.participants[0].registration;
  if (!registration?.participant_pass_id) throw new Error("registration did not confirm inline with a pass");
  const token = await activePassPayload(systemClient(), registration.participant_pass_id);
  return { registrationId: registration.registration_id, participantPassId: registration.participant_pass_id, token };
}

export type KitFixture = { kitDefinitionId: string; kitVariantId: string };

/** Direct-SQL kit fixture: kit_definition/variant/allocation creation is T30/T34 territory; T40 only
 * mutates allocations, so this mirrors the pgTAP fixture convention instead of duplicating that domain. */
export function buildKitFixture(editionId: string, registrationId: string, capacity: number | null = null): KitFixture {
  const kitDefinitionId = randomUUID();
  const kitVariantId = randomUUID();
  const capacityLiteral = capacity === null ? "null" : String(capacity);
  sql(`
    insert into app.kit_definition (kit_definition_id, edition_id, name, status) values ('${kitDefinitionId}', '${editionId}', 'Playera', 'ACTIVE');
    insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, capacity, status)
      values ('${kitVariantId}', '${kitDefinitionId}', 'U', 'Unica', ${capacityLiteral}, 'ACTIVE');
    insert into app.kit_allocation (kit_allocation_id, registration_id, kit_definition_id, kit_variant_id, status, assigned_at)
      values ('${randomUUID()}', '${registrationId}', '${kitDefinitionId}', '${kitVariantId}', 'ASSIGNED', now());
  `);
  return { kitDefinitionId, kitVariantId };
}

export function kitAllocationIdFor(registrationId: string): string {
  const id = queryValue(`select kit_allocation_id::text from app.kit_allocation where registration_id = '${registrationId}'`);
  if (!id) throw new Error(`no kit_allocation for registration ${registrationId}`);
  return id;
}
