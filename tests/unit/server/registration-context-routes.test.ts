import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/server/auth/actor";
import { AppError } from "@/lib/server/http/errors";
import { accountLegalStatusResponseSchema, acceptAccountLegalBodySchema } from "@/lib/shared/legal";
import { registrationContextRedirectSchema, registrationContextSchema } from "@/lib/shared/registration-context";

// P2-B route wiring: registration-context (GET /api/v1/events/:slug/registration-context) and the account-level
// legal routes (GET /api/v1/me/legal, POST /api/v1/me/legal/accept). Mocks auth resolution and the service layer
// (like route-cache-invalidation.test.ts); the SQL side is covered by pgTAP 420 and the integration suites.

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn<() => Promise<Actor>>(),
  createSessionClient: vi.fn(async () => ({ marker: "session-client" })),
}));
vi.mock("@/lib/server/supabase/clients", () => ({ createSessionClient: mocks.createSessionClient }));
vi.mock("@/lib/server/auth/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/auth/actor")>()),
  resolveActor: mocks.resolveActor,
}));

const registrationService = vi.hoisted(() => ({ getRegistrationContext: vi.fn() }));
vi.mock("@/lib/server/domain/registration/service", () => registrationService);
const discoveryService = vi.hoisted(() => ({ getEditionPage: vi.fn() }));
vi.mock("@/lib/server/domain/discovery/service", () => discoveryService);
const authService = vi.hoisted(() => ({ getMyLegalStatus: vi.fn(), acceptAccountLegalDocuments: vi.fn() }));
vi.mock("@/lib/server/domain/auth/service", () => authService);

const { GET: getContext } = await import("@/app/api/v1/events/[edition]/registration-context/route");
const { GET: getEventPage } = await import("@/app/api/v1/events/[edition]/route");
const { GET: getLegal } = await import("@/app/api/v1/me/legal/route");
const { POST: acceptLegal } = await import("@/app/api/v1/me/legal/accept/route");

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

const anonymous: Actor = { auth_user_id: null, runner_profile_id: null, profile_readiness: null, account_state: null, staff_member_id: null, staff_roles: [] };
const ready: Actor = { auth_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", runner_profile_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", profile_readiness: "READY", account_state: "ACTIVE", staff_member_id: null, staff_roles: [] };
const incomplete: Actor = { ...ready, profile_readiness: "PROFILE_INCOMPLETE" };
const locked: Actor = { ...ready, account_state: "IDENTITY_LOCKED" };

const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const json = async (response: Response) => (await response.json()) as { data?: unknown; error?: { code: string; details: Record<string, unknown> } };

beforeEach(() => {
  mocks.resolveActor.mockReset();
  registrationService.getRegistrationContext.mockReset();
  authService.getMyLegalStatus.mockReset();
  authService.acceptAccountLegalDocuments.mockReset();
});

describe("GET /api/v1/events/:slug/registration-context", () => {
  it("requires a session: anonymous is AUTH_REQUIRED (401) and the service is never reached", async () => {
    mocks.resolveActor.mockResolvedValue(anonymous);
    const response = await getContext(get("/api/v1/events/carrera/registration-context"), params({ edition: "carrera" }));
    expect(response.status).toBe(401);
    expect((await json(response)).error?.code).toBe("AUTH_REQUIRED");
    expect(registrationService.getRegistrationContext).not.toHaveBeenCalled();
  });

  it("requires a READY profile: onboarding unfinished is PROFILE_INCOMPLETE (422), identity lock is IDENTITY_LOCKED (403)", async () => {
    mocks.resolveActor.mockResolvedValue(incomplete);
    const r1 = await getContext(get("/api/v1/events/carrera/registration-context"), params({ edition: "carrera" }));
    expect(r1.status).toBe(422);
    expect((await json(r1)).error?.code).toBe("PROFILE_INCOMPLETE");
    mocks.resolveActor.mockResolvedValue(locked);
    const r2 = await getContext(get("/api/v1/events/carrera/registration-context"), params({ edition: "carrera" }));
    expect(r2.status).toBe(403);
    expect(registrationService.getRegistrationContext).not.toHaveBeenCalled();
  });

  it("validates the slug segment (strict) before touching the service", async () => {
    mocks.resolveActor.mockResolvedValue(ready);
    const response = await getContext(get("/api/v1/events/Not%20A%20Slug/registration-context"), params({ edition: "Not A Slug" }));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe("VALIDATION_ERROR");
    expect(registrationService.getRegistrationContext).not.toHaveBeenCalled();
  });

  it("returns the context in the data envelope, private + no-store, and passes the slug to the service", async () => {
    mocks.resolveActor.mockResolvedValue(ready);
    const context = { redirect: false, edition: { slug: "carrera" } };
    registrationService.getRegistrationContext.mockResolvedValue({ redirect: false, context });
    const response = await getContext(get("/api/v1/events/carrera/registration-context"), params({ edition: "carrera" }));
    expect(response.status).toBe(200);
    expect((await json(response)).data).toEqual(context);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(registrationService.getRegistrationContext).toHaveBeenCalledWith({ marker: "session-client" }, "carrera");
  });

  it("unknown / unpublished slug is NOT_FOUND (404)", async () => {
    mocks.resolveActor.mockResolvedValue(ready);
    registrationService.getRegistrationContext.mockResolvedValue(null);
    const response = await getContext(get("/api/v1/events/nada/registration-context"), params({ edition: "nada" }));
    expect(response.status).toBe(404);
    expect((await json(response)).error?.code).toBe("NOT_FOUND");
  });

  it("a historical slug answers a permanent redirect to the current registration-context URL", async () => {
    mocks.resolveActor.mockResolvedValue(ready);
    registrationService.getRegistrationContext.mockResolvedValue({ redirect: true, slug: "carrera-nueva" });
    const response = await getContext(get("/api/v1/events/carrera-vieja/registration-context"), params({ edition: "carrera-vieja" }));
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/api/v1/events/carrera-nueva/registration-context");
  });

  it("propagates a stable domain error (rate limit) with its status", async () => {
    mocks.resolveActor.mockResolvedValue(ready);
    registrationService.getRegistrationContext.mockRejectedValue(new AppError("RATE_LIMITED", { details: { retry_after_seconds: 30 } }));
    const response = await getContext(get("/api/v1/events/carrera/registration-context"), params({ edition: "carrera" }));
    expect(response.status).toBe(429);
    expect((await json(response)).error?.details.retry_after_seconds).toBe(30);
  });
});

describe("GET /api/v1/events/:slug (historical slug)", () => {
  it("answers a real 308 (Response.redirect headers are immutable and used to turn this into a 500)", async () => {
    discoveryService.getEditionPage.mockResolvedValue({ redirect: true, slug: "carrera-nueva" });
    const response = await getEventPage(get("/api/v1/events/carrera-vieja"), params({ edition: "carrera-vieja" }));
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/api/v1/events/carrera-nueva");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("GET /api/v1/me/legal and POST /api/v1/me/legal/accept (OWN-05)", () => {
  const status = { needs_acceptance: false, needs_reacceptance: false, missing_document_version_ids: [], documents: [], server_time: "2026-10-03T00:00:00Z" };

  it("GET requires only a session (onboarding screens read it before READY)", async () => {
    mocks.resolveActor.mockResolvedValue(anonymous);
    expect((await getLegal(get("/api/v1/me/legal"), params({}))).status).toBe(401);
    mocks.resolveActor.mockResolvedValue(incomplete);
    authService.getMyLegalStatus.mockResolvedValue(status);
    const response = await getLegal(get("/api/v1/me/legal"), params({}));
    expect(response.status).toBe(200);
    expect((await json(response)).data).toEqual(status);
  });

  it("POST validates a strict body: 1-10 uuids, no unknown fields", async () => {
    mocks.resolveActor.mockResolvedValue(ready);
    for (const body of [{}, { legal_document_version_ids: [] }, { legal_document_version_ids: ["nope"] }, { legal_document_version_ids: [V1], extra: true }]) {
      const response = await acceptLegal(post("/api/v1/me/legal/accept", body), params({}));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(authService.acceptAccountLegalDocuments).not.toHaveBeenCalled();
  });

  it("POST requires a session and rejects a cross-site request", async () => {
    mocks.resolveActor.mockResolvedValue(anonymous);
    expect((await acceptLegal(post("/api/v1/me/legal/accept", { legal_document_version_ids: [V1] }), params({}))).status).toBe(401);
    mocks.resolveActor.mockResolvedValue(ready);
    const cross = await acceptLegal(post("/api/v1/me/legal/accept", { legal_document_version_ids: [V1] }, { origin: "https://evil.example" }), params({}));
    expect(cross.status).toBe(403);
    expect(authService.acceptAccountLegalDocuments).not.toHaveBeenCalled();
  });

  it("POST forwards the ids to the service and returns the status; a stale version is a stable 422 with the current ids", async () => {
    mocks.resolveActor.mockResolvedValue(ready);
    authService.acceptAccountLegalDocuments.mockResolvedValue(status);
    const ok = await acceptLegal(post("/api/v1/me/legal/accept", { legal_document_version_ids: [V1, V2] }), params({}));
    expect(ok.status).toBe(200);
    expect(authService.acceptAccountLegalDocuments).toHaveBeenCalledWith({ marker: "session-client" }, [V1, V2]);

    authService.acceptAccountLegalDocuments.mockRejectedValue(
      new AppError("LEGAL_ACCEPTANCE_REQUIRED", { details: { reason: "VERSION_NOT_CURRENT", scope: "ACCOUNT", required_legal_document_version_ids: [V2] } }),
    );
    const stale = await acceptLegal(post("/api/v1/me/legal/accept", { legal_document_version_ids: [V1] }), params({}));
    expect(stale.status).toBe(422);
    const body = await json(stale);
    expect(body.error?.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(body.error?.details).toMatchObject({ reason: "VERSION_NOT_CURRENT", required_legal_document_version_ids: [V2] });
  });
});

describe("shared contracts (strict, client-safe)", () => {
  it("account legal status rejects unknown keys (fail closed) and accepts the documented shape", () => {
    const doc = { document_type: "TERMS_OF_SERVICE", document_key: "TERMS_OF_SERVICE", legal_document_version_id: V1, version: 2, published_at: "2026-10-03T00:00:00Z", status: "NEW_VERSION", accepted_at: null, accepted_version: 1 };
    const ok = { needs_acceptance: true, needs_reacceptance: true, missing_document_version_ids: [V1], documents: [doc], server_time: "2026-10-03T00:00:00Z" };
    expect(accountLegalStatusResponseSchema.safeParse(ok).success).toBe(true);
    expect(accountLegalStatusResponseSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(accountLegalStatusResponseSchema.safeParse({ ...ok, documents: [{ ...doc, status: "MAYBE" }] }).success).toBe(false);
    expect(acceptAccountLegalBodySchema.safeParse({ legal_document_version_ids: [V1] }).success).toBe(true);
  });

  it("registration context schema is strict at every level and the redirect shape is separate", () => {
    expect(registrationContextRedirectSchema.safeParse({ redirect: true, slug: "x" }).success).toBe(true);
    expect(registrationContextRedirectSchema.safeParse({ redirect: true, slug: "x", more: 1 }).success).toBe(false);
    expect(registrationContextSchema.safeParse({ redirect: false }).success).toBe(false);
    expect(registrationContextSchema.safeParse({ redirect: true, slug: "x" }).success).toBe(false);
  });
});
