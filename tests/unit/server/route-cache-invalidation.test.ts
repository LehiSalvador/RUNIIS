import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/server/auth/actor";

// T31c-cache-invalidation: proves each route FAMILY calls invalidateCache with the right event
// after a successful mutation. Mocks next/cache (like tests/unit/server/cache-invalidation.test.ts),
// auth resolution (like tests/unit/server/handler.test.ts) and the domain service layer, so this
// never touches Supabase — the RPC/SQL side is covered by pgTAP (supabase/tests/database/202, 252).

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag }));

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn<() => Promise<Actor>>(),
  createSessionClient: vi.fn(async () => ({ marker: "session-client" })),
}));
vi.mock("@/lib/server/supabase/clients", () => ({ createSessionClient: mocks.createSessionClient }));
vi.mock("@/lib/server/auth/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/auth/actor")>()),
  resolveActor: mocks.resolveActor,
}));

const eventsService = vi.hoisted(() => ({
  transitionEdition: vi.fn(),
  updateEdition: vi.fn(),
  setEditionSchedule: vi.fn(),
  setEditionGlobalCapacity: vi.fn(),
  createModality: vi.fn(),
  updateModality: vi.fn(),
  deleteModality: vi.fn(),
  createPriceOffer: vi.fn(),
  updatePriceOffer: vi.fn(),
  publishLegalDocumentVersion: vi.fn(),
}));
vi.mock("@/lib/server/domain/events/service", () => eventsService);

const registrationService = vi.hoisted(() => ({
  createRegistrationRequest: vi.fn(),
  cancelRegistrationRequest: vi.fn(),
  confirmRegistrationRequest: vi.fn(),
}));
vi.mock("@/lib/server/domain/registration/service", () => registrationService);

const { POST: cancelEdition } = await import("@/app/api/v1/admin/editions/[editionId]/cancel/route");
const { POST: openRegistration } = await import("@/app/api/v1/admin/editions/[editionId]/open-registration/route");
const { POST: pauseRegistration } = await import("@/app/api/v1/admin/editions/[editionId]/pause-registration/route");
const { PATCH: patchEdition } = await import("@/app/api/v1/admin/editions/[editionId]/route");
const { POST: setCapacity } = await import("@/app/api/v1/admin/editions/[editionId]/capacity/route");
const { POST: createModalityRoute } = await import("@/app/api/v1/admin/editions/[editionId]/modalities/route");
const { PATCH: patchModality, DELETE: deleteModalityRoute } = await import("@/app/api/v1/admin/modalities/[modalityId]/route");
const { POST: createPrice } = await import("@/app/api/v1/admin/modalities/[modalityId]/prices/route");
const { PATCH: patchPrice } = await import("@/app/api/v1/admin/prices/[priceOfferId]/route");
const { POST: publishLegal } = await import("@/app/api/v1/admin/legal/versions/[versionId]/publish/route");
const { POST: createRegistrationRequestRoute } = await import("@/app/api/v1/registration-requests/route");
const { POST: cancelRegistrationRequestRoute } = await import("@/app/api/v1/registration-requests/[id]/cancel/route");
const { POST: confirmRegistrationRequestRoute } = await import("@/app/api/v1/admin/registration-requests/[id]/confirm/route");

const E = "11111111-1111-4111-8111-111111111111";
const MOD = "22222222-2222-4222-8222-222222222222";
const PRICE = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const REQ = "55555555-5555-4555-8555-555555555555";

const ADMIN: Actor = {
  auth_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  runner_profile_id: null,
  profile_readiness: null,
  account_state: null,
  staff_member_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  staff_roles: [{ role: "ADMIN", scope_type: "GLOBAL", edition_id: null }],
};

const readyRunner: Actor = {
  auth_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  runner_profile_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  profile_readiness: "READY",
  account_state: "ACTIVE",
  staff_member_id: null,
  staff_roles: [],
};

function post(path: string, body: unknown = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function patch(path: string, body: unknown = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function del(path: string) {
  return new NextRequest(`http://localhost:3000${path}`, { method: "DELETE" });
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  mocks.resolveActor.mockResolvedValue(ADMIN);
  revalidateTag.mockReset();
  for (const fn of Object.values(eventsService)) fn.mockReset();
  for (const fn of Object.values(registrationService)) fn.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("T30 edition transition routes invalidate the editions cache", () => {
  it("cancel fires EditionCanceled immediately", async () => {
    eventsService.transitionEdition.mockResolvedValue({ edition: { edition_id: E } });
    const response = await cancelEdition(post(`/api/v1/admin/editions/${E}/cancel`, { reason: "weather" }), params({ editionId: E }));
    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("editions", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, { expire: 0 });
  });

  it("open-registration fires EditionRegistrationOpened, non-immediate", async () => {
    eventsService.transitionEdition.mockResolvedValue({ edition: { edition_id: E } });
    await openRegistration(post(`/api/v1/admin/editions/${E}/open-registration`), params({ editionId: E }));
    expect(revalidateTag).toHaveBeenCalledWith("editions", "max");
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, "max");
  });

  it("pause-registration fires EditionRegistrationPaused, immediate", async () => {
    eventsService.transitionEdition.mockResolvedValue({ edition: { edition_id: E } });
    await pauseRegistration(post(`/api/v1/admin/editions/${E}/pause-registration`, { reason: "issue" }), params({ editionId: E }));
    expect(revalidateTag).toHaveBeenCalledWith("editions", { expire: 0 });
  });
});

describe("PATCH /admin/editions/:editionId", () => {
  it("fires EditionSlugChanged when slug is among the changed fields", async () => {
    eventsService.updateEdition.mockResolvedValue({ edition_id: E, changed_fields: ["slug", "name"] });
    await patchEdition(patch(`/api/v1/admin/editions/${E}`, { slug: "new-slug" }), params({ editionId: E }));
    expect(revalidateTag).toHaveBeenCalledWith("editions", "max");
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, "max");
  });

  it("fires nothing when nothing changed (idempotent no-op PATCH)", async () => {
    eventsService.updateEdition.mockResolvedValue({ edition_id: E, changed_fields: [] });
    await patchEdition(patch(`/api/v1/admin/editions/${E}`, {}), params({ editionId: E }));
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("capacity routes invalidate via CapacityChanged", () => {
  it("global capacity uses the editionId route param", async () => {
    eventsService.setEditionGlobalCapacity.mockResolvedValue({ edition: {}, availability: {}, warnings: [] });
    await setCapacity(post(`/api/v1/admin/editions/${E}/capacity`, { global_capacity: 100 }), params({ editionId: E }));
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, "max");
    expect(revalidateTag).toHaveBeenCalledWith(`availability:${E}`, "max");
  });
});

describe("content sub-resource routes invalidate EditionContentChanged", () => {
  it("create modality uses the editionId route param", async () => {
    eventsService.createModality.mockResolvedValue({ modality_id: MOD, edition_id: E });
    await createModalityRoute(post(`/api/v1/admin/editions/${E}/modalities`, { key: "5k", name: "5K" }), params({ editionId: E }));
    expect(revalidateTag).toHaveBeenCalledWith("editions", "max");
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, "max");
  });

  it("update modality resolves editionId from the result (no editionId in the route)", async () => {
    eventsService.updateModality.mockResolvedValue({ modality_id: MOD, edition_id: E });
    await patchModality(patch(`/api/v1/admin/modalities/${MOD}`, { name: "10K" }), params({ modalityId: MOD }));
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, "max");
  });

  it("delete modality resolves editionId from the result (20260928110200_312)", async () => {
    eventsService.deleteModality.mockResolvedValue({ modality_id: MOD, deleted: true, edition_id: E });
    await deleteModalityRoute(del(`/api/v1/admin/modalities/${MOD}`), params({ modalityId: MOD }));
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, "max");
  });
});

describe("price offer routes invalidate PriceOfferChanged via price_offer.edition_id", () => {
  it("create price offer", async () => {
    eventsService.createPriceOffer.mockResolvedValue({ price_offer: { price_offer_id: PRICE, edition_id: E }, warnings: [] });
    await createPrice(post(`/api/v1/admin/modalities/${MOD}/prices`, { name: "Early", amount_minor: 1000 }), params({ modalityId: MOD }));
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, "max");
  });

  it("update price offer", async () => {
    eventsService.updatePriceOffer.mockResolvedValue({ price_offer: { price_offer_id: PRICE, edition_id: E }, warnings: [] });
    await patchPrice(patch(`/api/v1/admin/prices/${PRICE}`, { name: "Renamed" }), params({ priceOfferId: PRICE }));
    expect(revalidateTag).toHaveBeenCalledWith(`edition:${E}`, "max");
  });
});

describe("legal publish invalidates the shared legal tag (no editionId needed)", () => {
  it("publish legal document version", async () => {
    eventsService.publishLegalDocumentVersion.mockResolvedValue({ legal_document_version_id: VERSION });
    await publishLegal(post(`/api/v1/admin/legal/versions/${VERSION}/publish`), params({ versionId: VERSION }));
    expect(revalidateTag).toHaveBeenCalledWith("legal", "max");
  });
});

describe("T34 registration-request routes invalidate the availability tag", () => {
  beforeEach(() => mocks.resolveActor.mockResolvedValue(readyRunner));

  it("create fires RegistrationRequestCreated", async () => {
    registrationService.createRegistrationRequest.mockResolvedValue({ edition: { edition_id: E } });
    const body = { edition_id: E, participants: [{ kind: "PROFILE", public_profile_id: readyRunner.runner_profile_id, modality_id: MOD }] };
    await createRegistrationRequestRoute(post("/api/v1/registration-requests", body), params({}));
    expect(revalidateTag).toHaveBeenCalledWith(`availability:${E}`, "max");
  });

  it("user cancel fires RegistrationRequestCanceled", async () => {
    registrationService.cancelRegistrationRequest.mockResolvedValue({ edition: { edition_id: E } });
    await cancelRegistrationRequestRoute(post(`/api/v1/registration-requests/${REQ}/cancel`, {}), params({ id: REQ }));
    expect(revalidateTag).toHaveBeenCalledWith(`availability:${E}`, "max");
  });

  it("admin confirm fires RegistrationConfirmed", async () => {
    mocks.resolveActor.mockResolvedValue(ADMIN);
    registrationService.confirmRegistrationRequest.mockResolvedValue({ edition: { edition_id: E } });
    await confirmRegistrationRequestRoute(post(`/api/v1/admin/registration-requests/${REQ}/confirm`), params({ id: REQ }));
    expect(revalidateTag).toHaveBeenCalledWith(`availability:${E}`, "max");
  });
});
