import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { runCommunicationDispatch } from "@/lib/server/domain/communications/dispatch";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { runOutboxDispatch } from "@/lib/server/workers/outbox/dispatcher";
import { cleanup, createTestStaff, createTestUser, queryValue, sql, systemClient, type TestStaff } from "../helpers";
import { callRoute, type RouteHandler } from "../closure/harness";
import { buildClosureEdition, type ClosureEdition } from "../closure/fixtures";
import { buildKitFixture } from "../raceday/helpers";
import { currentLegalVersionId, selfAcceptance } from "./helpers";

// P3-C: staff cancellation of a CONFIRMED registration (OWN-04) and change of modality (Master §77-79), over the real route
// modules (defineRoute) with real staff sessions against the local Postgres. Includes the OWN-04 email end to end:
// RegistrationCanceled outbox -> consumer -> dispatch (capture/Mailpit), exactly one message, never the free-text reason.

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? sessionOrAnon(null) };
});

import { POST as cancelPost } from "@/app/api/v1/admin/registrations/[id]/cancel/route";
import { POST as changeModalityPost } from "@/app/api/v1/admin/registrations/[id]/change-modality/route";

const asHandler = (route: unknown) => route as RouteHandler;
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54624";
const SECRET_REASON = "TEXTO-INTERNO-SECRETO llamó para decir que se lesionó";

type MailpitSummary = { ID: string; Subject: string; To: { Address: string }[] };

async function mailpitMessages(address: string, subjectFragment: string): Promise<MailpitSummary[]> {
  const search = new URL("/api/v1/search", MAILPIT_URL);
  search.searchParams.set("query", `to:${address}`);
  const body = (await (await fetch(search)).json()) as { messages: MailpitSummary[] };
  return body.messages.filter((message) => message.Subject.includes(subjectFragment));
}

async function waitForMail(address: string, subjectFragment: string, timeoutMs = 15_000): Promise<MailpitSummary[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await mailpitMessages(address, subjectFragment);
    if (found.length > 0 || Date.now() > deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function drainDispatch(rounds = 6): Promise<void> {
  const system = systemClient();
  for (let i = 0; i < rounds; i += 1) {
    await runOutboxDispatch(system, { limit: 100 });
    await runCommunicationDispatch(system, { limit: 100 });
  }
}

describe("registration cancel + change modality (P3-C) integration", () => {
  const authUserIds: string[] = [];
  let operator: TestStaff;
  let checkin: TestStaff;
  let otherOperator: TestStaff;
  let edition: ClosureEdition;
  let spare: Awaited<ReturnType<typeof createTestUser>>;
  let regs: string[];

  const cancel = (id: string, body: unknown, as: TestStaff | null, options: { key?: string | null } = {}) =>
    callRoute(asHandler(cancelPost), { path: `/api/v1/admin/registrations/${id}/cancel`, params: { id }, body, as: as?.client ?? null, key: options.key });
  const change = (id: string, body: unknown, as: TestStaff | null, options: { key?: string | null } = {}) =>
    callRoute(asHandler(changeModalityPost), { path: `/api/v1/admin/registrations/${id}/change-modality`, params: { id }, body, as: as?.client ?? null, key: options.key });
  const confirmedIn = (modalityId: string) => Number(queryValue(`select count(*) from app.registration where modality_id = '${modalityId}' and status = 'CONFIRMED'`));

  beforeAll(async () => {
    const admin = await createTestStaff("ADMIN", "GLOBAL");
    operator = await createTestStaff("OPERATOR", "GLOBAL");
    checkin = await createTestStaff("CHECKIN", "GLOBAL");
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId);
    edition = await buildClosureEdition(admin.client, authUserIds, { runners: 5, secondCapacity: 1, label: "p3c-cancel" });
    const other = await buildClosureEdition(admin.client, authUserIds, { runners: 0, label: "p3c-cancel-other" });
    otherOperator = await createTestStaff("OPERATOR", "EDITION", other.editionId);
    authUserIds.push(otherOperator.authUserId);
    spare = await createTestUser({ label: "p3c-spare" });
    authUserIds.push(spare.authUserId);
    regs = edition.runners.map((runner) => runner.registrationId);
    buildKitFixture(edition.editionId, regs[0]);
  }, 240_000);

  beforeEach(() => {
    cache.revalidateTag.mockClear();
  });

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  // ---- cancel ----

  test("cancel: validation, idempotency key, roles and Edition scope", async () => {
    const valid = { reason: "Prueba", reason_category: "ADMINISTRATIVE" };
    const noKey = await cancel(regs[1], valid, operator, { key: null });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { header: "Idempotency-Key", reason: "missing" } });
    expect((await cancel(regs[1], {}, operator)).status).toBe(400);
    expect((await cancel(regs[1], { reason: "   " }, operator)).status).toBe(400);
    expect((await cancel(regs[1], { reason: "x".repeat(501) }, operator)).status).toBe(400);
    const badCategory = await cancel(regs[1], { reason: "Prueba", reason_category: "INVENTADA" }, operator);
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.error.details.issues[0]).toMatchObject({ path: "reason_category" });
    expect((await cancel(regs[1], { ...valid, status: "CANCELED" }, operator)).status).toBe(400);
    expect((await cancel("not-a-uuid", valid, operator)).status).toBe(400);

    expect((await cancel(regs[1], valid, null)).status).toBe(401);
    expect((await cancel(regs[1], valid, checkin)).body.error.code).toBe("FORBIDDEN");
    const wrongScope = await cancel(regs[1], valid, otherOperator);
    expect(wrongScope.status).toBe(403);
    expect(wrongScope.body.error.code).toBe("FORBIDDEN");
    const unknown = await cancel(randomUUID(), valid, operator);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("NOT_FOUND");
    expect(queryValue(`select status from app.registration where registration_id = '${regs[1]}'`)).toBe("CONFIRMED");
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  test("cancel releases capacity, cancels the pass and the kit, audits, replays, and a second cancel is a CONFLICT", async () => {
    // Fill the 5K exactly: the sixth runner cannot register until a cancellation frees a place.
    sql(`update app.modality_capacity set effective_capacity = 5 where modality_id = '${edition.modalityId}'`);
    const register = () =>
      createRegistrationRequest(
        spare.client,
        { edition_id: edition.editionId, participants: [{ kind: "PROFILE", public_profile_id: spare.publicProfileId!, modality_id: edition.modalityId }], legal_acceptances: [selfAcceptance(0, currentLegalVersionId("SPORT_WAIVER"))] },
        null,
      );
    await expect(register()).rejects.toMatchObject({ code: "CAPACITY_UNAVAILABLE" });
    expect(confirmedIn(edition.modalityId)).toBe(5);

    const cancelKey = `cancel-${randomUUID()}`;
    const body = { reason: SECRET_REASON, reason_category: "DUPLICATE_REGISTRATION" };
    const canceled = await cancel(regs[0], body, operator, { key: cancelKey });
    expect(canceled.status).toBe(200);
    expect(canceled.headers.get("cache-control")).toBe("private, no-store");
    expect(canceled.body.data).toMatchObject({ registration_id: regs[0], status: "CANCELED", modality_id: edition.modalityId, cancel_reason: SECRET_REASON });
    expect(canceled.body.data.canceled_at).toBeTruthy();

    expect(queryValue(`select status from app.registration where registration_id = '${regs[0]}'`)).toBe("CANCELED"); // never deleted
    expect(queryValue(`select status from app.participant_pass where registration_id = '${regs[0]}'`)).toBe("CANCELED");
    expect(queryValue(`select status from app.kit_allocation where registration_id = '${regs[0]}'`)).toBe("CANCELED");
    expect(confirmedIn(edition.modalityId)).toBe(4);
    expect(cache.revalidateTag).toHaveBeenCalledWith(`availability:${edition.editionId}`, expect.anything());

    // Capacity really is released: the sixth runner now fits.
    const view = await register();
    expect(view.status).toBe("CONFIRMED");
    expect(confirmedIn(edition.modalityId)).toBe(5);

    expect(Number(queryValue(`select count(*) from audit.audit_log where action = 'REGISTRATION_CANCELED' and entity_id = '${regs[0]}' and reason = '${SECRET_REASON}'`))).toBe(1);
    expect(queryValue(`select after_snapshot ->> 'reason_category' from audit.audit_log where action = 'REGISTRATION_CANCELED' and entity_id = '${regs[0]}'`)).toBe("DUPLICATE_REGISTRATION");

    // The event the email consumes: recipient + closed category, never the free text.
    const payload = queryValue(`select payload::text from infra.outbox_event where effect_key = 'RegistrationCanceled:${regs[0]}'`)!;
    expect(JSON.parse(payload)).toMatchObject({ registration_id: regs[0], edition_id: edition.editionId, participant_kind: "PROFILE", reason_category: "DUPLICATE_REGISTRATION" });
    expect(payload).not.toContain("SECRETO");

    // Same key replays; a new key finds an already canceled registration.
    const replay = await cancel(regs[0], body, operator, { key: cancelKey });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(canceled.body.data);
    const again = await cancel(regs[0], body, operator);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "invalid_transition", current: "CANCELED" } });
    expect(Number(queryValue(`select count(*) from infra.outbox_event where effect_key like 'RegistrationCanceled:${regs[0]}%'`))).toBe(1);
  });

  test("OWN-04: the participant is emailed exactly once with the reason label only, never the free-text reason", async () => {
    const runner = edition.runners[0].user;
    const subject = "fue cancelada";
    await drainDispatch();

    const dedupeKey = `REGISTRATION_CANCELED:${regs[0]}`;
    expect(Number(queryValue(`select count(*) from app.communication_message where dedupe_key = '${dedupeKey}'`))).toBe(1);
    expect(queryValue(`select status from app.communication_message where dedupe_key = '${dedupeKey}'`)).toBe("SENT");
    expect(queryValue(`select category || '/' || template_key from app.communication_message where dedupe_key = '${dedupeKey}'`)).toBe("TRANSACTIONAL/REGISTRATION_CANCELED");

    const mails = await waitForMail(runner.email.toLowerCase(), subject);
    expect(mails).toHaveLength(1);
    expect(mails[0].Subject).toMatch(/^Tu inscripción a .+ fue cancelada$/);
    const detail = (await (await fetch(new URL(`/api/v1/message/${mails[0].ID}`, MAILPIT_URL))).json()) as { Text: string; HTML: string };
    expect(detail.Text).toContain("Inscripción duplicada");
    expect(detail.Text).toContain("ya no es válido");
    expect(`${detail.Text}${detail.HTML}`).not.toContain("SECRETO");
    expect(`${detail.Text}${detail.HTML}`).not.toMatch(/reembols/i);

    // Re-draining (outbox retry / second worker) never sends a second message.
    await drainDispatch(3);
    expect(Number(queryValue(`select count(*) from app.communication_message where dedupe_key = '${dedupeKey}'`))).toBe(1);
    expect(await mailpitMessages(runner.email.toLowerCase(), subject)).toHaveLength(1);
  }, 60_000);

  // ---- change modality ----

  test("change modality: validation, roles, scope", async () => {
    const valid = { new_modality_id: edition.secondModalityId, reason: "Cambio solicitado" };
    const noKey = await change(regs[1], valid, operator, { key: null });
    expect(noKey.body.error.details).toMatchObject({ header: "Idempotency-Key", reason: "missing" });
    expect((await change(regs[1], { reason: "x" }, operator)).status).toBe(400);
    expect((await change(regs[1], { new_modality_id: "nope", reason: "x" }, operator)).status).toBe(400);
    expect((await change(regs[1], { new_modality_id: edition.secondModalityId }, operator)).status).toBe(400);
    expect((await change(regs[1], { ...valid, extra: 1 }, operator)).status).toBe(400);
    expect((await change(regs[1], valid, null)).status).toBe(401);
    expect((await change(regs[1], valid, checkin)).body.error.code).toBe("FORBIDDEN");
    expect((await change(regs[1], valid, otherOperator)).body.error.code).toBe("FORBIDDEN");
    expect((await change(randomUUID(), valid, operator)).status).toBe(404);

    const same = await change(regs[1], { new_modality_id: edition.modalityId, reason: "Mismo" }, operator);
    expect(same.status).toBe(400);
    expect(same.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { field: "new_modality_id", reason: "same_as_current" } });
    const unknown = await change(regs[1], { new_modality_id: randomUUID(), reason: "No existe" }, operator);
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe("MODALITY_NOT_AVAILABLE");
    expect(confirmedIn(edition.secondModalityId)).toBe(0);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  test("change modality respects capacity: a free place moves the registration, a full modality answers CAPACITY_UNAVAILABLE", async () => {
    const changeKey = `change-${randomUUID()}`;
    const body = { new_modality_id: edition.secondModalityId, reason: "Pidió la distancia mayor" };
    const moved = await change(regs[1], body, operator, { key: changeKey });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({
      registration_id: regs[1],
      modality_id: edition.secondModalityId,
      category_id: null,
      revision: 2,
      official_distance_impact: { from_m: 5000, to_m: 10000, from_generates_credit: true, to_generates_credit: true },
    });
    expect(queryValue(`select modality_id from app.registration where registration_id = '${regs[1]}'`)).toBe(edition.secondModalityId);
    // Baseline revision (the pre-change state) + the new one; the first is superseded.
    expect(queryValue(`select string_agg(revision || ':' || status, ',' order by revision) from app.registration_revision where registration_id = '${regs[1]}'`)).toBe("1:SUPERSEDED,2:ACTIVE");
    expect(cache.revalidateTag).toHaveBeenCalledWith(`availability:${edition.editionId}`, expect.anything());

    const replay = await change(regs[1], body, operator, { key: changeKey });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(moved.body.data);
    expect(Number(queryValue(`select count(*) from app.registration_revision where registration_id = '${regs[1]}'`))).toBe(2);

    // The 10K had capacity 1: the next move is refused and nothing changes.
    const full = await change(regs[2], { new_modality_id: edition.secondModalityId, reason: "También quiere 10K" }, operator);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("CAPACITY_UNAVAILABLE");
    expect(queryValue(`select modality_id from app.registration where registration_id = '${regs[2]}'`)).toBe(edition.modalityId);
    expect(confirmedIn(edition.secondModalityId)).toBe(1);

    // A canceled registration cannot be moved.
    const canceledMove = await change(regs[0], { new_modality_id: edition.secondModalityId, reason: "Ya cancelada" }, operator);
    expect(canceledMove.status).toBe(409);
    expect(canceledMove.body.error.code).toBe("CONFLICT");
  });

  test("change modality respects category, eligibility and modality state", async () => {
    const categoryId = randomUUID();
    const withCategory = randomUUID();
    const restricted = randomUUID();
    const closed = randomUUID();
    sql(`
      insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order, eligibility_rules)
      values ('${withCategory}', '${edition.editionId}', '15k', '15K', 15000, true, 'ACTIVE', 3, '{}'),
             ('${restricted}', '${edition.editionId}', '21k', '21K master', 21097, true, 'ACTIVE', 4, '{"min_age": 70}'),
             ('${closed}', '${edition.editionId}', '3k', '3K cerrada', 3000, true, 'CLOSED', 5, '{}');
      insert into app.category (category_id, edition_id, name, key, assignment_mode, sort_order)
      values ('${categoryId}', '${edition.editionId}', 'Libre', 'libre-p3c', 'USER_SELECTS', 1);
      insert into app.modality_category (modality_id, category_id, edition_id) values ('${withCategory}', '${categoryId}', '${edition.editionId}');
    `);

    const needsCategory = await change(regs[2], { new_modality_id: withCategory, reason: "A 15K" }, operator);
    expect(needsCategory.status).toBe(422);
    expect(needsCategory.body.error).toMatchObject({ code: "FORM_INVALID", details: { field_key: "category_id", reason: "required" } });
    const badCategory = await change(regs[2], { new_modality_id: withCategory, category_id: randomUUID(), reason: "A 15K" }, operator);
    expect(badCategory.status).toBe(422);
    expect(badCategory.body.error).toMatchObject({ code: "FORM_INVALID", details: { reason: "invalid_category" } });
    expect(queryValue(`select modality_id from app.registration where registration_id = '${regs[2]}'`)).toBe(edition.modalityId);

    const moved = await change(regs[2], { new_modality_id: withCategory, category_id: categoryId, reason: "A 15K" }, operator);
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ modality_id: withCategory, category_id: categoryId });
    expect(queryValue(`select category_id from app.registration_category_assignment where registration_id = '${regs[2]}'`)).toBe(categoryId);

    const ineligible = await change(regs[3], { new_modality_id: restricted, reason: "Master" }, operator);
    expect(ineligible.status).toBe(422);
    expect(ineligible.body.error).toMatchObject({ code: "PARTICIPANT_NOT_ELIGIBLE", details: { reasons: ["MODALITY_RULE"] } });
    const closedModality = await change(regs[3], { new_modality_id: closed, reason: "Cerrada" }, operator);
    expect(closedModality.status).toBe(422);
    expect(closedModality.body.error.code).toBe("MODALITY_NOT_AVAILABLE");
    expect(queryValue(`select modality_id from app.registration where registration_id = '${regs[3]}'`)).toBe(edition.modalityId);
    expect(JSON.stringify([needsCategory.body, ineligible.body])).not.toMatch(/select |insert |pg_catalog|stack/i);
  });
});
