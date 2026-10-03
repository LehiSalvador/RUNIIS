import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { createTestUser, queryValue, sql, type TestUser } from "../helpers";
import { buildEdition, selfAcceptance } from "../registration/helpers";

// P3-C fixtures: a real FREE Edition built through the T30/T34 domain services, real runners with confirmed registrations
// (pass included), plus a second ACTIVE modality for change-modality tests. The Edition is moved to FINISHED by direct SQL
// only when a test needs the closure phase, exactly like the pgTAP fixtures do (the finish transition is T30 territory).

export type ClosureRunner = { user: TestUser; registrationId: string; participantPassId: string | null };

export type ClosureEdition = {
  editionId: string;
  modalityId: string;
  /** A second ACTIVE modality (10K, capacity `secondCapacity`) of the same Edition. */
  secondModalityId: string;
  runners: ClosureRunner[];
};

export async function buildClosureEdition(
  admin: SupabaseClient,
  authUserIds: string[],
  options: { runners: number; secondCapacity?: number; label?: string },
): Promise<ClosureEdition> {
  const edition = await buildEdition(admin, { mode: "FREE", modalityCapacity: 1000 });
  const secondModalityId = randomUUID();
  sql(`
    insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order)
    values ('${secondModalityId}', '${edition.editionId}', '10k', '10K', 10000, true, 'ACTIVE', 2);
    insert into app.modality_capacity (modality_id, effective_capacity) values ('${secondModalityId}', ${options.secondCapacity ?? 1});
  `);

  const runners: ClosureRunner[] = [];
  for (let index = 0; index < options.runners; index += 1) {
    const user = await createTestUser({ label: `${options.label ?? "p3c"}-${index + 1}` });
    authUserIds.push(user.authUserId);
    const view = await createRegistrationRequest(
      user.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    const registration = view.participants[0]?.registration;
    if (!registration) throw new Error("registration did not confirm inline");
    runners.push({ user, registrationId: registration.registration_id, participantPassId: registration.participant_pass_id });
  }
  return { editionId: edition.editionId, modalityId: edition.modalityId, secondModalityId, runners };
}

/** Moves the Edition to FINISHED (registration CLOSED) so attendance can be finalized and the Edition closed. */
export function finishEdition(editionId: string): void {
  sql(`update app.edition set execution_state = 'FINISHED', registration_state = 'CLOSED', closure_state = 'PENDING' where edition_id = '${editionId}'`);
}

export function attendanceStatus(registrationId: string): string | null {
  return queryValue(`select status from app.attendance_resolution where registration_id = '${registrationId}' and superseded_at is null`);
}

export function activeCreditCount(editionId: string): number {
  return Number(queryValue(`select count(*) from app.distance_credit where edition_id = '${editionId}' and status = 'ACTIVE'`));
}
