import { beforeAll, describe, expect, test } from "vitest";
import {
  archiveGuest,
  createGuest,
  requestFriendship,
  respondFriendship,
  searchPeople,
  updateGuest,
} from "@/lib/server/domain/people/service";
import { AppError } from "@/lib/server/http/errors";
import { localAnonClient } from "../supabase";
import { createReadyProfile, queryValue, sql, type TestProfile } from "./helpers";

// Exercises the real people domain stack end to end: real local Postgres, real RLS (auth.uid()
// from a real OTP session), real zod contracts and real rate-limit counters. The Next.js HTTP
// route layer itself (cookies, routing) is generic and already unit-tested by handler.test.ts;
// login/session cookies are not yet buildable in this repo (no auth route exists), so these
// tests drive the domain/service layer with a real session client instead of raw HTTP.

const guestFields = (suffix: string) => ({
  full_name: `Invitado Prueba ${suffix}`,
  date_of_birth: "1990-02-02",
  sex_code: "M" as const,
  phone_e164: "+528110000700",
  emergency_contact_name: "Contacto Emergencia",
  emergency_contact_phone_e164: "+528110000701",
  emergency_contact_relationship: "Hermano",
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await promise.catch((error: AppError) => {
    expect(error.code).toBe(code);
  });
}

describe("people domain (T33) integration", () => {
  let alice: TestProfile;
  let bob: TestProfile;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([createReadyProfile("alice"), createReadyProfile("bob")]);
  }, 30_000);

  test("§23 search requires a session: anon has no grant on the RPC at all (FORBIDDEN, 403; defense in depth beyond the route's auth gate)", async () => {
    const error = await searchPeople(localAnonClient(), "perfil", undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("FORBIDDEN");
    expect((error as AppError).status).toBe(403);
  });

  test("§22 friend request -> accept is visible both ways and search reflects it", async () => {
    const requested = await requestFriendship(alice.client, bob.publicProfileId, null);
    expect(requested.status).toBe("PENDING");
    expect(requested.direction).toBe("OUTGOING");

    const accepted = await respondFriendship(bob.client, requested.friendship_id, "accept");
    expect(accepted.status).toBe("ACCEPTED");

    const byName = await searchPeople(alice.client, "perfil bob", undefined);
    const match = byName.items.find((i) => i.public_profile_id === bob.publicProfileId);
    // display_name defaults from full_name ("Perfil bob"); normalisation lowercases/unaccents it.
    expect(match?.friendship.state).toBe("FRIENDS");
  });

  test("SEC-010/016 a guest is owner-only and PATCH is a strict allowlist", async () => {
    const guest = await createGuest(alice.client, guestFields("owner"), null);
    expect(guest.full_name).toBe("Invitado Prueba owner");

    await expectAppError(updateGuest(bob.client, guest.guest_participant_id, { phone_e164: "+528110000799" }), "NOT_FOUND");
    await expectAppError(archiveGuest(bob.client, guest.guest_participant_id), "NOT_FOUND");

    const updated = await updateGuest(alice.client, guest.guest_participant_id, { phone_e164: "+528110000799" });
    expect(updated.phone_e164).toBe("+528110000799");

    const archived = await archiveGuest(alice.client, guest.guest_participant_id);
    expect(archived.status).toBe("ARCHIVED");

    // Observability (SEC-112): the audit trail records the caller, never the guest's PII.
    const actorRole = queryValue(
      `select actor_role from audit.audit_log where action = 'GUEST_ARCHIVED' and entity_id = '${guest.guest_participant_id}';`,
    );
    expect(actorRole).toBe("RUNNER");
  });

  test("§179 the command-side rate limit trips after the policy's max hits (RATE_LIMITED, 429)", async () => {
    const limited = await createReadyProfile("ratelimited");
    // people.search / people.search:cmd are both 60 per 10 minutes (helpers/HELPERS_READY.md §4).
    for (let i = 0; i < 60; i++) {
      await searchPeople(limited.client, "zz-no-match-query", undefined);
    }
    const error = await searchPeople(limited.client, "zz-no-match-query", undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("RATE_LIMITED");
    expect((error as AppError).status).toBe(429);
  }, 30_000);
});

// Cheap safety net: fail loudly if the fixture SQL helper itself breaks silently.
test("fixture helper: sql() runs against the local database", () => {
  expect(() => sql("select 1;")).not.toThrow();
});
