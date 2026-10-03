import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { cleanup, createCookieJar, createTestStaff, createTestUser, httpSignIn, queryValue, sql, type TestStaff, type TestUser } from "../helpers";
import { buildEdition, ensureGlobalLegalDocumentsPublished, selfAcceptance } from "./helpers";

// P2-G1 (F-2): the staff request queue (Master §70) and the confirm / revalidate paths (§71-72) over the real
// HTTP routes with a real staff session. Regression: the list answered 500 INTERNAL_ERROR (rpc_result_invalid)
// because the RPC `counts` is JSON null on an edition without requests and only carries the statuses present
// otherwise, while the output schema required every status key.

type Envelope = {
  data?: any;
  meta?: { next_cursor: string | null; counts: Record<string, number> };
  error?: { code: string; details?: Record<string, any> };
};

async function send(jar: ReturnType<typeof createCookieJar>, method: string, path: string, body?: unknown): Promise<{ status: number; body: Envelope }> {
  const response = await jar.fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Envelope) : {} };
}

/** Both timestamps move back so expires_at < now() while created_at < expires_at keeps holding (no worker needed). */
function backdateExpiry(registrationRequestId: string): void {
  sql(`update app.registration_request set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
       where registration_request_id = '${registrationRequestId}'`);
}

describe("admin registration request queue over HTTP (P2-G1) integration", () => {
  let admin: TestStaff;
  let operator: TestStaff;
  const users: TestUser[] = [];
  const authUserIds: string[] = [];
  const adminJar = createCookieJar();

  beforeAll(async () => {
    sql(`delete from infra.rate_limit_counter where scope in ('auth.otp.ip', 'auth.verify.ip')`);
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    operator = await createTestStaff("OPERATOR", "GLOBAL");
    authUserIds.push(admin.authUserId, operator.authUserId);
    await httpSignIn(adminJar, admin.email);
  }, 60_000);

  afterAll(async () => {
    await cleanup([...authUserIds, ...users.map((u) => u.authUserId)]);
  });

  async function whatsappRequest(editionId: string, modalityId: string, sportWaiverVersionId: string, label: string) {
    const buyer = await createTestUser({ label: `g1-${label}` });
    users.push(buyer);
    const view = await createRegistrationRequest(
      buyer.client,
      {
        edition_id: editionId,
        participants: [{ kind: "PROFILE", public_profile_id: buyer.publicProfileId!, modality_id: modalityId }],
        legal_acceptances: [selfAcceptance(0, sportWaiverVersionId)],
      },
      null,
    );
    return { buyer, view };
  }

  test("P2-AC-09.d: list answers 200 with the documented shape for an empty and a non-empty edition", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 10 });
    const path = `/api/v1/admin/editions/${edition.editionId}/registration-requests`;

    const empty = await send(adminJar, "GET", path);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta).toEqual({ next_cursor: null, counts: {} });

    const first = await whatsappRequest(edition.editionId, edition.modalityId, edition.sportWaiverVersionId, "list-a");
    const second = await whatsappRequest(edition.editionId, edition.modalityId, edition.sportWaiverVersionId, "list-b");
    backdateExpiry(second.view.registration_request_id);

    const listed = await send(adminJar, "GET", path);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(2);
    // Counts carry only the effective statuses that exist (an expired-by-time PENDING counts as EXPIRED).
    expect(listed.body.meta).toEqual({ next_cursor: null, counts: { PENDING_CONFIRMATION: 1, EXPIRED: 1 } });
    const byId = new Map<string, any>(listed.body.data.map((row: any) => [row.registration_request_id, row]));
    expect(byId.get(first.view.registration_request_id)).toMatchObject({
      status: "PENDING_CONFIRMATION",
      effective_status: "PENDING_CONFIRMATION",
      registration_mode: "EXTERNAL_WHATSAPP",
      buyer: { full_name: expect.any(String), phone_e164: expect.any(String), is_new_account: expect.any(Boolean) },
    });
    expect(byId.get(second.view.registration_request_id)).toMatchObject({ status: "PENDING_CONFIRMATION", effective_status: "EXPIRED" });
    expect(byId.get(first.view.registration_request_id).whatsapp_url).toMatch(/^https:\/\/wa\.me\//);

    // Filters and keyset pagination keep the same envelope.
    const expiredOnly = await send(adminJar, "GET", `${path}?status=EXPIRED`);
    expect(expiredOnly.status).toBe(200);
    expect(expiredOnly.body.data.map((row: any) => row.registration_request_id)).toEqual([second.view.registration_request_id]);
    const page1 = await send(adminJar, "GET", `${path}?limit=1`);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.meta!.next_cursor).toEqual(expect.any(String));
    const page2 = await send(adminJar, "GET", `${path}?limit=1&cursor=${encodeURIComponent(page1.body.meta!.next_cursor!)}`);
    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].registration_request_id).not.toBe(page1.body.data[0].registration_request_id);
    expect(page2.body.meta!.next_cursor).toBeNull();

    // Authorization: anonymous 401, a signed-in non-staff 403, an OPERATOR allowed (REGISTRATION_REQUEST_MANAGE).
    expect((await send(createCookieJar(), "GET", path)).status).toBe(401);
    const plainJar = createCookieJar();
    await httpSignIn(plainJar, first.buyer.email);
    expect((await send(plainJar, "GET", path)).status).toBe(403);
    const operatorJar = createCookieJar();
    await httpSignIn(operatorJar, operator.email);
    expect((await send(operatorJar, "GET", path)).status).toBe(200);
    expect((await send(adminJar, "GET", `${path}?status=BOGUS`)).status).toBe(400);
  }, 120_000);

  test("P2-AC-09.e: staff confirms a pending WhatsApp request (Registration + ParticipantPass); idempotent", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 10 });
    const { buyer, view } = await whatsappRequest(edition.editionId, edition.modalityId, edition.sportWaiverVersionId, "confirm");
    const id = view.registration_request_id;

    const confirmed = await send(adminJar, "POST", `/api/v1/admin/registration-requests/${id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({ registration_request_id: id, status: "CONFIRMED", effective_status: "CONFIRMED" });
    const registration = confirmed.body.data.participants[0].registration;
    expect(registration).toMatchObject({ status: expect.any(String), registration_number: expect.any(String) });
    expect(registration.participant_pass_id).toBeTruthy();

    expect(queryValue(`select count(*) from app.registration where registration_request_id = '${id}'`)).toBe("1");
    expect(queryValue(`select count(*) from app.participant_pass where participant_pass_id = '${registration.participant_pass_id}'`)).toBe("1");
    // The credential is issued after commit by the system (A1): the buyer can render the QR.
    const buyerJar = createCookieJar();
    await httpSignIn(buyerJar, buyer.email);
    expect((await buyerJar.fetch(`/api/v1/me/passes/${registration.participant_pass_id}/render-qr`, { method: "POST" })).status).toBe(200);

    // Confirm is idempotent (Master §171): the second call answers the confirmed view, no second Registration.
    const again = await send(adminJar, "POST", `/api/v1/admin/registration-requests/${id}/confirm`);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe("CONFIRMED");
    expect(queryValue(`select count(*) from app.registration where registration_request_id = '${id}'`)).toBe("1");

    // The queue now reports it CONFIRMED.
    const list = await send(adminJar, "GET", `/api/v1/admin/editions/${edition.editionId}/registration-requests`);
    expect(list.body.meta!.counts).toEqual({ CONFIRMED: 1 });
  }, 120_000);

  test("P2-AC-09.e: an expired request is refused by confirm (Master §72) and revalidate-and-confirm follows the contract", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 10, priceAmountMinor: 50000 });
    const { view } = await whatsappRequest(edition.editionId, edition.modalityId, edition.sportWaiverVersionId, "expired");
    const id = view.registration_request_id;
    backdateExpiry(id);

    // The worker has not run: only expires_at governs, so a plain confirm is refused with REQUEST_EXPIRED.
    const plain = await send(adminJar, "POST", `/api/v1/admin/registration-requests/${id}/confirm`);
    expect(plain.status).toBe(410);
    expect(plain.body.error!.code).toBe("REQUEST_EXPIRED");
    expect(queryValue(`select count(*) from app.registration where registration_request_id = '${id}'`)).toBe("0");

    // A changed price blocks the revalidation until staff acknowledges it with the new total.
    sql(`update app.price_offer set amount_minor = 60000 where modality_id = '${edition.modalityId}'`);
    const changed = await send(adminJar, "POST", `/api/v1/admin/registration-requests/${id}/revalidate-and-confirm`, {});
    expect(changed.status).toBe(409);
    expect(changed.body.error!.code).toBe("PRICE_CHANGED");

    const revalidated = await send(adminJar, "POST", `/api/v1/admin/registration-requests/${id}/revalidate-and-confirm`, { expected_total_minor: 60000 });
    expect(revalidated.status).toBe(200);
    expect(revalidated.body.data).toMatchObject({ status: "CONFIRMED", revalidated_from_expired: true });
    expect(revalidated.body.data.participants[0].registration.participant_pass_id).toBeTruthy();
    expect(queryValue(`select count(*) from app.registration where registration_request_id = '${id}'`)).toBe("1");

    // A request that is not expired cannot take the revalidation path.
    const fresh = await whatsappRequest(edition.editionId, edition.modalityId, edition.sportWaiverVersionId, "not-expired");
    const early = await send(adminJar, "POST", `/api/v1/admin/registration-requests/${fresh.view.registration_request_id}/revalidate-and-confirm`, {});
    expect(early.status).toBe(409);
  }, 120_000);
});
