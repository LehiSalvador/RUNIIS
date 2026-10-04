import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { runCommunicationDispatch } from "@/lib/server/domain/communications/dispatch";
import { cancelRegistrationRequest, confirmRegistrationRequest, createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { runOutboxDispatch } from "@/lib/server/workers/outbox/dispatcher";
import { cleanup, createTestStaff, createTestUser, queryValue, sql, systemClient, type TestStaff, type TestUser } from "../helpers";
import { callRoute, type RouteHandler } from "../closure/harness";
import { buildClosureEdition, finishEdition, type ClosureEdition } from "../closure/fixtures";
import { buildEdition, selfAcceptance, type EditionFixture } from "./helpers";

// P3-S (P3-AC-08, P3-AC-09, P3-AC-13) over the REAL route modules with real staff sessions against the local Postgres:
//   * staff cancel of a pending request (single and bulk) notifies the BUYER through outbox -> consumer -> dispatch (Mailpit), exactly once per
//     request, only the category label (never the free text), `notification` in the responses and the follow-up task for a buyer without email;
//   * the buyer's own cancel and the worker's expiry send nothing;
//   * the participants list carries final attendance, sporting eligibility, incidents and credited distance with the same RBAC.
// The SQL rules have their own pgTAP file (790); this file proves the wiring a database test cannot.

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? sessionOrAnon(null) };
});

import { POST as cancelRequestPost } from "@/app/api/v1/admin/registration-requests/[id]/cancel/route";
import { POST as bulkPost } from "@/app/api/v1/admin/editions/[editionId]/registration-requests/bulk-cancel/route";
import { GET as participantsGet } from "@/app/api/v1/admin/editions/[editionId]/participants/route";
import { GET as taskGet } from "@/app/api/v1/admin/tasks/[id]/route";
import { POST as resolveAttendancePost } from "@/app/api/v1/admin/registrations/[id]/attendance/resolve/route";
import { POST as finalizePost } from "@/app/api/v1/admin/editions/[editionId]/attendance/finalize/route";
import { POST as closePost } from "@/app/api/v1/admin/editions/[editionId]/close/route";

const asHandler = (route: unknown) => route as RouteHandler;
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54624";
const SECRET_REASON = "TEXTO-INTERNO-SECRETO llamó para decir que no pagó";
const SUBJECT = "Tu solicitud de inscripción";

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

describe("staff cancel of a request notifies the buyer; participants carry closure fields (P3-S) integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let operator: TestStaff;
  let checkin: TestStaff;
  let otherOperator: TestStaff;
  let edition: EditionFixture;
  let other: EditionFixture;

  const makeRequest = async (user: TestUser, fixture: EditionFixture) =>
    (
      await createRegistrationRequest(
        user.client,
        {
          edition_id: fixture.editionId,
          participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId!, modality_id: fixture.modalityId }],
          legal_acceptances: [selfAcceptance(0, fixture.sportWaiverVersionId)],
        },
        null,
      )
    ).registration_request_id;
  const buyer = async (label: string) => {
    const user = await createTestUser({ label });
    authUserIds.push(user.authUserId);
    return user;
  };
  const cancelOne = (id: string, body: unknown, as: TestStaff | null, key?: string | null) =>
    callRoute(asHandler(cancelRequestPost), { path: `/api/v1/admin/registration-requests/${id}/cancel`, params: { id }, body, as: as?.client ?? null, key });
  const bulk = (editionId: string, body: unknown, as: TestStaff | null, key?: string | null) =>
    callRoute(asHandler(bulkPost), { path: `/api/v1/admin/editions/${editionId}/registration-requests/bulk-cancel`, params: { editionId }, body, as: as?.client ?? null, key });
  const eventCount = (requestId: string) => Number(queryValue(`select count(*) from infra.outbox_event where effect_key = 'RegistrationRequestCanceledByStaff:${requestId}'`));
  const taskCount = (requestId: string) => Number(queryValue(`select count(*) from app.admin_task where task_key = 'registration-request-cancel-notice:${requestId}'`));
  const bodyOf = async (mail: MailpitSummary) => {
    const detail = (await (await fetch(new URL(`/api/v1/message/${mail.ID}`, MAILPIT_URL))).json()) as { Text: string; HTML: string };
    return detail;
  };

  beforeAll(async () => {
    admin = await createTestStaff("ADMIN", "GLOBAL");
    operator = await createTestStaff("OPERATOR", "GLOBAL");
    checkin = await createTestStaff("CHECKIN", "GLOBAL");
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId);
    edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 50, priceAmountMinor: 20000 });
    other = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 50, priceAmountMinor: 20000 });
    otherOperator = await createTestStaff("OPERATOR", "EDITION", other.editionId);
    authUserIds.push(otherOperator.authUserId);
  }, 240_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  describe("single staff cancel (P3-AC-08)", () => {
    test("emails the buyer exactly once with the category label only, and reports notification.queued", async () => {
      const user = await buyer("p3s-single");
      const requestId = await makeRequest(user, edition);
      const key = `p3s-single-${randomUUID()}`;
      const body = { reason: SECRET_REASON, reason_category: "DUPLICATE_REGISTRATION" };

      expect((await cancelOne(requestId, body, null, key)).status).toBe(401);
      expect((await cancelOne(requestId, body, checkin, key)).status).toBe(403);
      expect((await cancelOne(requestId, { ...body, reason_category: "NOPE" }, operator, key)).status).toBe(400);
      expect((await cancelOne(requestId, { ...body, extra: 1 }, operator, key)).status).toBe(400);
      expect(queryValue(`select status from app.registration_request where registration_request_id = '${requestId}'`)).toBe("PENDING_CONFIRMATION");

      const response = await cancelOne(requestId, body, operator, key);
      expect(response.status).toBe(200);
      // The previous view keys are intact; `notification` is the one additive key.
      expect(response.body.data).toMatchObject({ registration_request_id: requestId, status: "CANCELED_BY_STAFF", edition: { edition_id: edition.editionId } });
      expect(response.body.data.notification).toEqual({ status: "queued", follow_up_task_id: null });
      expect(JSON.stringify(response.body.data)).not.toContain("example.test");
      expect(eventCount(requestId)).toBe(1);
      expect(taskCount(requestId)).toBe(0);

      // A replay of the same key returns the stored cancellation, recomputes the notification and creates no second event.
      const replay = await cancelOne(requestId, body, operator, key);
      expect(replay.status).toBe(200);
      expect(replay.body.data.notification).toEqual({ status: "queued", follow_up_task_id: null });
      expect(eventCount(requestId)).toBe(1);

      await drainDispatch();
      const mails = await waitForMail(user.email.toLowerCase(), SUBJECT);
      expect(mails).toHaveLength(1);
      const detail = await bodyOf(mails[0]);
      expect(detail.Text).toContain("Inscripción duplicada");
      expect(detail.Text).toContain("liberados");
      expect(detail.Text).toContain("no procesa pagos");
      expect(`${detail.Text}${detail.HTML}`).not.toContain("SECRETO");
      expect(`${detail.Text}${detail.HTML}`).not.toMatch(/reembols/i);
      await drainDispatch(2);
      expect(await mailpitMessages(user.email.toLowerCase(), SUBJECT)).toHaveLength(1);
    }, 120_000);

    test("a buyer without an email: notification.no_contact, an ACTION_REQUIRED follow-up task, no message", async () => {
      const user = await buyer("p3s-nocontact");
      const requestId = await makeRequest(user, edition);
      sql(`update auth.users set email = null where id = '${user.authUserId}'`);
      const key = `p3s-nocontact-${randomUUID()}`;
      const first = await cancelOne(requestId, { reason: "Sin contacto" }, operator, key);
      expect(first.status).toBe(200);
      expect(first.body.data.notification.status).toBe("no_contact");
      const taskId = first.body.data.notification.follow_up_task_id as string;
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/);

      const task = await callRoute(asHandler(taskGet), { method: "GET", path: `/api/v1/admin/tasks/${taskId}`, params: { id: taskId }, as: operator.client });
      expect(task.status).toBe(200);
      expect(task.body.data).toMatchObject({
        status: "OPEN",
        blocking_level: "ACTION_REQUIRED",
        category: "COMMUNICATIONS",
        source_rule: "registration-request-cancel-notice",
        edition_id: edition.editionId,
        related_entity_type: "registration_request",
        related_entity_id: requestId,
      });
      expect(JSON.stringify(task.body.data)).not.toMatch(/example\.test|Sin contacto/);

      const replay = await cancelOne(requestId, { reason: "Sin contacto" }, operator, key);
      expect(replay.body.data.notification).toEqual({ status: "no_contact", follow_up_task_id: taskId });
      await drainDispatch(3);
      expect(taskCount(requestId)).toBe(1);
      expect(Number(queryValue(`select count(*) from app.communication_message where dedupe_key = 'REGISTRATION_REQUEST_CANCELED:${requestId}'`))).toBe(0);
    }, 120_000);

    test("a CONFIRMED request is still refused (409) and nothing is emailed; the idempotency-less call defaults the category to OTHER", async () => {
      const confirmedUser = await buyer("p3s-confirmed");
      const confirmedId = await makeRequest(confirmedUser, edition);
      await confirmRegistrationRequest(admin.client, confirmedId, null);
      const refused = await cancelOne(confirmedId, { reason: "x" }, operator, null);
      expect(refused.status).toBe(409);
      expect(refused.body.error.details).toMatchObject({ reason: "REQUEST_NOT_CANCELABLE" });
      expect(eventCount(confirmedId)).toBe(0);

      const user = await buyer("p3s-default");
      const requestId = await makeRequest(user, edition);
      const ok = await cancelOne(requestId, { reason: "Sin categoría" }, operator, null);
      expect(ok.status).toBe(200);
      expect(queryValue(`select payload ->> 'reason_category' from infra.outbox_event where effect_key = 'RegistrationRequestCanceledByStaff:${requestId}'`)).toBe("OTHER");
      await drainDispatch();
      const mails = await waitForMail(user.email.toLowerCase(), SUBJECT);
      expect(mails).toHaveLength(1);
      expect((await bodyOf(mails[0])).Text).toContain("Otro motivo");
    }, 120_000);

    test("the buyer's own cancel and the worker's expiry send nothing", async () => {
      const own = await buyer("p3s-own");
      const ownId = await makeRequest(own, edition);
      await cancelRegistrationRequest(own.client, ownId, "ya no puedo", null);
      expect(queryValue(`select status from app.registration_request where registration_request_id = '${ownId}'`)).toBe("CANCELED_BY_BUYER");

      const late = await buyer("p3s-expired");
      const lateId = await makeRequest(late, edition);
      sql(`update app.registration_request set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' where registration_request_id = '${lateId}'`);
      sql(`select private.registration_materialise_expired('${edition.editionId}', '${lateId}')`);
      expect(queryValue(`select status from app.registration_request where registration_request_id = '${lateId}'`)).toBe("EXPIRED");

      await drainDispatch();
      expect(eventCount(ownId)).toBe(0);
      expect(eventCount(lateId)).toBe(0);
      expect(await mailpitMessages(own.email.toLowerCase(), SUBJECT)).toHaveLength(0);
      expect(await mailpitMessages(late.email.toLowerCase(), SUBJECT)).toHaveLength(0);
    }, 120_000);
  });

  describe("bulk cancel (P3-AC-13)", () => {
    test("one email and one notification outcome per canceled request; rejected and already canceled ids carry none", async () => {
      const [a, b, c, d] = [await buyer("p3s-bulk-a"), await buyer("p3s-bulk-b"), await buyer("p3s-bulk-c"), await buyer("p3s-bulk-d")];
      const [ra, rb, rc, rd] = [await makeRequest(a, edition), await makeRequest(b, edition), await makeRequest(c, edition), await makeRequest(d, edition)];
      await confirmRegistrationRequest(admin.client, rd, null);
      sql(`update auth.users set email = null where id = '${b.authUserId}'`);
      const otherUser = await buyer("p3s-bulk-other");
      const otherRequest = await makeRequest(otherUser, other);

      const forbidden = { request_ids: [ra], reason: "x", reason_category: "EVENT_CHANGE" };
      expect((await bulk(edition.editionId, forbidden, checkin, `p3s-${randomUUID()}`)).status).toBe(403);
      expect((await bulk(edition.editionId, forbidden, otherOperator, `p3s-${randomUUID()}`)).status).toBe(403);
      expect((await bulk(edition.editionId, { ...forbidden, reason_category: "NOPE" }, operator, `p3s-${randomUUID()}`)).status).toBe(400);
      expect(queryValue(`select status from app.registration_request where registration_request_id = '${ra}'`)).toBe("PENDING_CONFIRMATION");

      // R_c is canceled first by a single cancel, so the batch reports it as ALREADY_CANCELED.
      expect((await cancelOne(rc, { reason: "antes" }, operator, `p3s-${randomUUID()}`)).status).toBe(200);
      expect(eventCount(rc)).toBe(1);

      const key = `p3s-bulk-${randomUUID()}`;
      const body = { request_ids: [ra, rb, rc, rd, otherRequest], reason: SECRET_REASON, reason_category: "EVENT_CHANGE" };
      const response = await bulk(edition.editionId, body, operator, key);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ requested_count: 5, canceled_count: 2, already_canceled_count: 1, rejected_count: 2, failed_count: 0 });
      const row = (id: string) => response.body.data.results.find((r: any) => r.registration_request_id === id);
      expect(row(ra)).toMatchObject({ outcome: "CANCELED", status: "CANCELED_BY_STAFF", notification: { status: "queued", follow_up_task_id: null } });
      expect(row(rb).outcome).toBe("CANCELED");
      expect(row(rb).notification.status).toBe("no_contact");
      const taskId = row(rb).notification.follow_up_task_id as string;
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
      expect(row(rc)).toMatchObject({ outcome: "ALREADY_CANCELED" });
      expect(row(rc).notification).toBeUndefined();
      expect(row(rd)).toMatchObject({ outcome: "NOT_CANCELABLE", status: "CONFIRMED" });
      expect(row(rd).notification).toBeUndefined();
      expect(row(otherRequest).outcome).toBe("NOT_FOUND");
      expect(row(otherRequest).notification).toBeUndefined();
      expect(JSON.stringify(response.body.data)).not.toMatch(/example\.test|SECRETO/);

      // Replay: the stored batch, the outcomes recomputed, no extra events.
      const replay = await bulk(edition.editionId, body, operator, key);
      expect(replay.status).toBe(200);
      expect(replay.body.data.results.find((r: any) => r.registration_request_id === rb).notification).toEqual({ status: "no_contact", follow_up_task_id: taskId });
      expect(eventCount(ra) + eventCount(rb) + eventCount(rc)).toBe(3);
      expect(eventCount(rd) + eventCount(otherRequest)).toBe(0);

      await drainDispatch();
      const mailA = await waitForMail(a.email.toLowerCase(), SUBJECT);
      expect(mailA).toHaveLength(1);
      const detail = await bodyOf(mailA[0]);
      expect(detail.Text).toContain("Cambio en el evento");
      expect(`${detail.Text}${detail.HTML}`).not.toContain("SECRETO");
      // R_c was emailed once (its single cancel), the batch did not email it again; R_d (confirmed) never.
      expect(await waitForMail(c.email.toLowerCase(), SUBJECT)).toHaveLength(1);
      expect(await mailpitMessages(d.email.toLowerCase(), SUBJECT)).toHaveLength(0);
      expect(taskCount(rb)).toBe(1);
    }, 180_000);
  });

  describe("participants list: closure fields (P3-AC-09)", () => {
    let closing: ClosureEdition;
    let staffAdminEdition: TestStaff;

    test("final attendance, eligibility, incidents and credited distance; contact data stays role-gated; RBAC unchanged", async () => {
      closing = await buildClosureEdition(admin.client, authUserIds, { runners: 2, label: "p3s-part" });
      staffAdminEdition = await createTestStaff("OPERATOR", "EDITION", closing.editionId);
      authUserIds.push(staffAdminEdition.authUserId);
      const [present, absent] = closing.runners;
      finishEdition(closing.editionId);

      const list = (as: TestStaff | null) =>
        callRoute(asHandler(participantsGet), { method: "GET", path: `/api/v1/admin/editions/${closing.editionId}/participants`, params: { editionId: closing.editionId }, as: as?.client ?? null });
      const rowFor = (body: any, registrationId: string) => body.data.find((item: any) => item.registration_id === registrationId);

      expect((await list(null)).status).toBe(401);
      expect((await list(checkin)).status).toBe(403);
      expect((await list(otherOperator)).status).toBe(403);

      // Before any resolution: every new key is present and empty (additive and backwards compatible).
      const before = await list(operator);
      expect(before.status).toBe(200);
      const earlyRow = rowFor(before.body, present.registrationId);
      expect(earlyRow).toMatchObject({
        registration_id: present.registrationId,
        attendance: { finalized: false, final_status: null },
        incidents: { count: 0, highest_severity: null, total_count: 0 },
        credited_distance_m: null,
      });
      expect(earlyRow.attendance).toHaveProperty("checked_in");
      expect(earlyRow.attendance).toHaveProperty("resolution_status");

      const resolve = (registrationId: string, body: unknown) =>
        callRoute(asHandler(resolveAttendancePost), { path: `/api/v1/admin/registrations/${registrationId}/attendance/resolve`, params: { id: registrationId }, body, as: operator.client });
      expect((await resolve(present.registrationId, { status: "PRESENT", reason: "Llegó", evidence_metadata: { method: "MANUAL_DESK" } })).status).toBe(200);
      expect((await resolve(absent.registrationId, { status: "NO_SHOW" })).status).toBe(200);
      const finalized = await callRoute(asHandler(finalizePost), {
        path: `/api/v1/admin/editions/${closing.editionId}/attendance/finalize`,
        params: { editionId: closing.editionId },
        body: {},
        as: operator.client,
      });
      expect(finalized.status).toBe(200);
      const closed = await callRoute(asHandler(closePost), { path: `/api/v1/admin/editions/${closing.editionId}/close`, params: { editionId: closing.editionId }, body: {}, as: admin.client });
      expect(closed.status).toBe(200);

      sql(`
        insert into app.community_integrity_case (case_type, runner_profile_id, edition_id, registration_id, status, severity, blocking_level)
        values ('DISTANCE_MISMATCH', '${present.user.runnerProfileId}', '${closing.editionId}', '${present.registrationId}', 'OPEN', 'MEDIUM', 'NONE'),
               ('INVALID_SPORT_DATE', '${present.user.runnerProfileId}', '${closing.editionId}', '${present.registrationId}', 'OPEN', 'HIGH', 'NONE');
      `);

      const after = await list(operator);
      expect(after.status).toBe(200);
      const presentRow = rowFor(after.body, present.registrationId);
      expect(presentRow.attendance).toMatchObject({ resolution_status: "PRESENT", finalized: true, final_status: "PRESENT" });
      expect(presentRow.sporting_eligibility).toEqual({ status: "ELIGIBLE", distance_credit_disposition: "ALLOW", reason_code: null });
      expect(presentRow.incidents).toEqual({ count: 2, highest_severity: "HIGH", total_count: 2 });
      expect(presentRow.credited_distance_m).toBe(5000);
      const absentRow = rowFor(after.body, absent.registrationId);
      expect(absentRow.attendance).toMatchObject({ resolution_status: "NO_SHOW", finalized: true, final_status: "NO_SHOW" });
      expect(absentRow.credited_distance_m).toBeNull();
      expect(absentRow.incidents).toEqual({ count: 0, highest_severity: null, total_count: 0 });
      // No free text, ids or case types leak into the row.
      expect(JSON.stringify(presentRow)).not.toMatch(/DISTANCE_MISMATCH|INVALID_SPORT_DATE|integrity_case/);

      // Same RBAC for contact: the OPERATOR gets none, the ADMIN (PII_EXPORT) does, with the same closure fields.
      expect(after.body.meta.contact_visible).toBe(false);
      expect(presentRow.contact).toBeNull();
      const asAdmin = await list(admin);
      expect(asAdmin.body.meta.contact_visible).toBe(true);
      expect(rowFor(asAdmin.body, present.registrationId).contact).not.toBeNull();
      expect(rowFor(asAdmin.body, present.registrationId).credited_distance_m).toBe(5000);
      // An Edition-scoped OPERATOR of this Edition sees it too.
      expect((await list(staffAdminEdition)).status).toBe(200);
    }, 240_000);
  });
});
