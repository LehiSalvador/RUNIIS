import { describe, expect, test, vi } from "vitest";
import type { ApiFailure, ApiResult } from "@/lib/client/api";
import {
  GUARDIAN_METHODS,
  buildGuardianReject,
  buildGuardianVerify,
  describeScanFailure,
  guardianRejectPath,
  guardianVerifyPath,
  isRetryable,
  listItems,
  manualCheckInRequest,
  manualKitRequest,
  parseParticipantHits,
  parseScanResult,
  scanRequest,
  searchUrl,
  sendScan,
  withFreshKey,
} from "@/components/scanner/scan-api";

const SESSION = { editionId: "50000000-0000-4000-8000-000000000001", station: "Entrada 1", kitDefinitionId: "k0000000-0000-4000-8000-000000000001" };
const TOKEN = "RN1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const failure = (code: ApiFailure["code"], status = 0, details: ApiFailure["details"] = {}): ApiFailure => ({ ok: false, status, code, message: "", requestId: "req_1", details });
const success = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data, meta: {} });

describe("requests", () => {
  test("a QR check-in passes the code through untouched to the server, with the Edition and station; the outcome is idempotent, so no key", () => {
    const request = scanRequest(SESSION, "EVENT_CHECKIN", TOKEN);
    expect(request.path).toBe("/api/v1/check-in");
    expect(request.body).toEqual({ edition_id: SESSION.editionId, credential_token: TOKEN, station_key: "Entrada 1" });
    expect(request.idempotencyKey).toBeNull();
  });

  test("a QR kit pickup names the kit and carries its own Idempotency-Key", () => {
    const request = scanRequest(SESSION, "KIT_PICKUP", TOKEN);
    expect(request.path).toBe("/api/v1/admin/kits/pickup");
    expect(request.body).toMatchObject({ kit_definition_id: SESSION.kitDefinitionId, credential_token: TOKEN });
    expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("the manual check-in sends the resolved pass id and a trimmed reason", () => {
    const request = manualCheckInRequest(SESSION, "p0000000-0000-4000-8000-000000000001", "  Sin batería  ", "key-1");
    expect(request.path).toBe("/api/v1/check-in/manual-verify");
    expect(request.body).toEqual({ edition_id: SESSION.editionId, participant_pass_id: "p0000000-0000-4000-8000-000000000001", reason: "Sin batería", station_key: "Entrada 1" });
    expect(request.idempotencyKey).toBe("key-1");
  });

  test("a manual kit pickup is by registration; a third party adds the explicit reason", () => {
    const own = manualKitRequest(SESSION, "r0000000-0000-4000-8000-000000000001", null, "key-2");
    expect(own.body).not.toHaveProperty("third_party");
    expect(own.body).toMatchObject({ registration_id: "r0000000-0000-4000-8000-000000000001", kit_definition_id: SESSION.kitDefinitionId });
    const other = manualKitRequest(SESSION, "r0000000-0000-4000-8000-000000000001", { reason: " Su hermano " }, "key-3");
    expect(other.body).toMatchObject({ third_party: true, third_party_reason: "Su hermano" });
  });

  test("a retry reuses the same request value (same key); a new intent gets a fresh key", () => {
    const request = manualCheckInRequest(SESSION, "p0000000-0000-4000-8000-000000000001", "x", "key-1");
    const fresh = withFreshKey(request);
    expect(fresh.idempotencyKey).not.toBe(request.idempotencyKey);
    expect(fresh.body).toEqual(request.body);
    expect(withFreshKey(scanRequest(SESSION, "EVENT_CHECKIN", TOKEN)).idempotencyKey).toBeNull();
  });

  test("the lookup URL encodes the query and never carries a credential", () => {
    expect(searchUrl("e1", " Ana & Co ")).toBe("/api/v1/admin/editions/e1/participants/search?q=Ana%20%26%20Co");
  });
});

describe("answers", () => {
  test("every one of the 11 outcomes parses; an unknown one is rejected instead of guessed", () => {
    expect(parseScanResult({ outcome: "VALID", participant: null })?.outcome).toBe("VALID");
    expect(parseScanResult({ outcome: "OTHER_REVIEW" })?.participant).toBeNull();
    expect(parseScanResult({ outcome: "PERFECTLY_FINE" })).toBeNull();
    expect(parseScanResult(null)).toBeNull();
    expect(parseScanResult({ outcome: "VALID", kit_pickup_id: "kp1" })?.kitPickupId).toBe("kp1");
  });

  test("a participant is kept to the minimal fields", () => {
    const parsed = parseScanResult({
      outcome: "VALID",
      participant: {
        registration_id: "r1",
        registration_number: "I-ABCD-0001",
        registration_status: "CONFIRMED",
        participant_kind: "PROFILE",
        display_name: "Ana",
        modality: { modality_id: "m1", name: "10K" },
        category: { category_id: "c1", name: "Libre" },
        is_minor: true,
        guardian_state: "PENDING",
        secret_field: "never",
      },
    });
    expect(parsed?.participant).toMatchObject({ display_name: "Ana", is_minor: true, guardian_state: "PENDING" });
    expect(parsed?.participant).not.toHaveProperty("secret_field");
  });

  test("sendScan returns the outcome only after the server answered, and a failure keeps the status and the retry hint", async () => {
    const ok = await sendScan(scanRequest(SESSION, "EVENT_CHECKIN", TOKEN), (async () => success({ outcome: "VALID", participant: null })) as never);
    expect(ok).toMatchObject({ kind: "outcome", result: { outcome: "VALID" } });

    const lost = await sendScan(scanRequest(SESSION, "EVENT_CHECKIN", TOKEN), (async () => failure("NETWORK_ERROR")) as never);
    expect(lost).toMatchObject({ kind: "failure", retryable: true });
    const refused = await sendScan(scanRequest(SESSION, "EVENT_CHECKIN", TOKEN), (async () => failure("FORBIDDEN", 403)) as never);
    expect(refused).toMatchObject({ kind: "failure", retryable: false });
    const strange = await sendScan(scanRequest(SESSION, "EVENT_CHECKIN", TOKEN), (async () => success({ outcome: "NOPE" })) as never);
    expect(strange.kind).toBe("failure");
  });

  test("sendScan sends the Idempotency-Key it was given and nothing else about the code", async () => {
    const fetcher = vi.fn(async () => success({ outcome: "VALID" }));
    await sendScan(manualCheckInRequest(SESSION, "p1", "motivo", "key-9"), fetcher as never);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/check-in/manual-verify", expect.objectContaining({ method: "POST", idempotencyKey: "key-9" }));
  });

  test("only transport and dependency failures are retryable", () => {
    expect(isRetryable(failure("NETWORK_ERROR"))).toBe(true);
    expect(isRetryable(failure("DEPENDENCY_UNAVAILABLE", 503))).toBe(true);
    expect(isRetryable(failure("RATE_LIMITED", 429))).toBe(true);
    expect(isRetryable(failure("INTERNAL_ERROR", 500))).toBe(true);
    expect(isRetryable(failure("VALIDATION_ERROR", 400))).toBe(false);
    expect(isRetryable(failure("FORBIDDEN", 403))).toBe(false);
  });

  test("a malformed code is explained as such; any other refusal uses the shared actionable copy and keeps the request id", () => {
    const view = describeScanFailure(failure("VALIDATION_ERROR", 400, { field: "credential_token" }));
    expect(view.title).toBe("Ese código no es de un pase");
    expect(view.requestId).toBe("req_1");
    expect(describeScanFailure(failure("FORBIDDEN", 403)).kind).toBe("permission");
    expect(describeScanFailure(failure("VALIDATION_ERROR", 400, { field: "reason" })).title).not.toBe("Ese código no es de un pase");
  });
});

describe("lookup results", () => {
  test("the search route answers a bare array; an items envelope is accepted too", () => {
    const row = { registration_id: "r1", participant_pass_id: "p1", registration_number: "I-ABCD-0001", display_name: "Ana", modality: { modality_id: "m1", name: "10K" }, guardian_state: "VERIFIED" };
    expect(listItems([row])).toHaveLength(1);
    expect(listItems({ items: [row] })).toHaveLength(1);
    expect(listItems(null)).toEqual([]);
    expect(parseParticipantHits([row])).toEqual([{ ...row, guardian_state: "VERIFIED" }]);
    expect(parseParticipantHits([{ nope: true }, row])).toHaveLength(1);
    expect(parseParticipantHits([{ ...row, participant_pass_id: null }])[0].participant_pass_id).toBeNull();
  });
});

describe("guardian decisions", () => {
  test("paths address the minor's registration", () => {
    expect(guardianVerifyPath("r1")).toBe("/api/v1/admin/guardian-verifications/r1/verify");
    expect(guardianRejectPath("r1")).toBe("/api/v1/admin/guardian-verifications/r1/reject");
  });

  test("verify needs a method; 'Otro' also needs the explanation; notes are optional otherwise", () => {
    expect(buildGuardianVerify({ method: "", notes: "" })).toMatchObject({ ok: false });
    expect(buildGuardianVerify({ method: GUARDIAN_METHODS[0], notes: "" })).toEqual({ ok: true, body: { verification_method: GUARDIAN_METHODS[0] } });
    expect(buildGuardianVerify({ method: GUARDIAN_METHODS[3], notes: "" })).toMatchObject({ ok: false, errors: { notes: expect.any(String) } });
    expect(buildGuardianVerify({ method: GUARDIAN_METHODS[0], notes: " Madre, INE " })).toEqual({ ok: true, body: { verification_method: GUARDIAN_METHODS[0], notes: "Madre, INE" } });
    expect(buildGuardianVerify({ method: GUARDIAN_METHODS[0], notes: "x".repeat(501) })).toMatchObject({ ok: false });
    for (const method of GUARDIAN_METHODS) expect(method.length).toBeLessThanOrEqual(100);
  });

  test("reject needs a reason, which the server stores as evidence", () => {
    expect(buildGuardianReject("   ")).toMatchObject({ ok: false });
    expect(buildGuardianReject(" No acreditó parentesco ")).toEqual({ ok: true, body: { reason: "No acreditó parentesco" } });
    expect(buildGuardianReject("x".repeat(501))).toMatchObject({ ok: false });
  });
});
