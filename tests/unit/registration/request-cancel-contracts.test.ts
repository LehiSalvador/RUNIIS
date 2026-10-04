import { describe, expect, it } from "vitest";
import { participantRowSchema, staffCancelBodySchema } from "@/lib/server/domain/registration/contracts";
import { outboxConsumerRegistry } from "@/lib/server/workers/outbox/consumers";
import { bulkCancelRequestsBodySchema, bulkCancelResultSchema } from "@/lib/shared/registration";
import { TASK_SOURCE_RULES } from "@/lib/shared/tasks";

// P3-S: contracts of the staff cancel email (J2 step 4) and of the participant closure fields (T13 4.13).

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("staff cancel of a request: body, notification outcome and consumer registry", () => {
  it("accepts an optional closed reason_category on the single and the bulk body, and nothing else new", () => {
    expect(staffCancelBodySchema.safeParse({ reason: "r" }).success).toBe(true);
    expect(staffCancelBodySchema.safeParse({ reason: "r", reason_category: "DUPLICATE_REGISTRATION" }).success).toBe(true);
    expect(staffCancelBodySchema.safeParse({ reason: "r", reason_category: "NOPE" }).success).toBe(false);
    expect(staffCancelBodySchema.safeParse({ reason: "r", extra: 1 }).success).toBe(false);
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: [id(1)], reason: "r" }).success).toBe(true);
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: [id(1)], reason: "r", reason_category: "EVENT_CHANGE" }).success).toBe(true);
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: [id(1)], reason: "r", reason_category: "NOPE" }).success).toBe(false);
  });

  it("a bulk result row carries the notification outcome (optional, additive) and fails closed on an unknown status", () => {
    const base = {
      edition_id: id(2),
      correlation_id: id(3),
      requested_count: 2,
      canceled_count: 1,
      already_canceled_count: 0,
      rejected_count: 1,
      failed_count: 0,
    };
    const withOutcome = {
      ...base,
      results: [
        { registration_request_id: id(1), outcome: "CANCELED", status: "CANCELED_BY_STAFF", notification: { status: "no_contact", follow_up_task_id: id(9) } },
        { registration_request_id: id(4), outcome: "NOT_FOUND" },
      ],
    };
    expect(bulkCancelResultSchema.safeParse(withOutcome).success).toBe(true);
    // The earlier shape (no notification key) still parses.
    expect(bulkCancelResultSchema.safeParse({ ...base, results: [{ registration_request_id: id(1), outcome: "CANCELED", status: "CANCELED_BY_STAFF" }] }).success).toBe(true);
    for (const status of ["queued", "suppressed", "unknown"]) {
      const row = { registration_request_id: id(1), outcome: "CANCELED", notification: { status, follow_up_task_id: null } };
      expect(bulkCancelResultSchema.safeParse({ ...base, results: [row] }).success, status).toBe(true);
    }
    expect(
      bulkCancelResultSchema.safeParse({ ...base, results: [{ registration_request_id: id(1), outcome: "CANCELED", notification: { status: "sent", follow_up_task_id: null } }] }).success,
    ).toBe(false);
  });

  it("routes RegistrationRequestCanceledByStaff to its own consumer and keeps the buyer-cancel and expiry events unregistered", () => {
    expect(outboxConsumerRegistry.RegistrationRequestCanceledByStaff).toEqual({ rpc: "enqueue_registration_request_canceled_messages", maxAttempts: 10 });
    expect(outboxConsumerRegistry.RegistrationRequestCanceled).toBeUndefined();
    expect(outboxConsumerRegistry.RegistrationRequestExpired).toBeUndefined();
  });

  it("lists the follow-up task rule", () => {
    expect(TASK_SOURCE_RULES).toContain("registration-request-cancel-notice");
  });
});

describe("participant row: closure fields", () => {
  const row = {
    registration_id: id(1),
    registration_number: "I-1234-ABCD",
    status: "CONFIRMED",
    confirmed_at: "2026-10-01T10:00:00.000Z",
    participant_kind: "PROFILE",
    full_name: "Ana",
    public_profile_id: null,
    buyer_full_name: "Ana",
    registration_request_id: id(2),
    modality: { modality_id: id(3), name: "5K" },
    category: null,
    is_minor: false,
    guardian_verification_status: null,
    pass: null,
    kit: null,
    attendance: { checked_in: true, resolution_status: "PRESENT", finalized: true, final_status: "PRESENT" },
    sporting_eligibility: { status: "ELIGIBLE", distance_credit_disposition: "ALLOW", reason_code: null },
    incidents: { count: 1, highest_severity: "HIGH", total_count: 2 },
    credited_distance_m: 5000,
    contact: null,
  };

  it("parses the complete row and the empty states", () => {
    expect(participantRowSchema.safeParse(row).success).toBe(true);
    expect(
      participantRowSchema.safeParse({
        ...row,
        attendance: { checked_in: false, resolution_status: null, finalized: false, final_status: null },
        sporting_eligibility: null,
        incidents: { count: 0, highest_severity: null, total_count: 0 },
        credited_distance_m: null,
      }).success,
    ).toBe(true);
  });

  it("fails closed on an unknown severity or an unexpected key (no free text can slip in)", () => {
    expect(participantRowSchema.safeParse({ ...row, incidents: { count: 1, highest_severity: "SEVERE", total_count: 1 } }).success).toBe(false);
    expect(participantRowSchema.safeParse({ ...row, incidents: { ...row.incidents, notes: "texto libre" } }).success).toBe(false);
    expect(participantRowSchema.safeParse({ ...row, sporting_eligibility: { ...row.sporting_eligibility, reason: "texto libre" } }).success).toBe(false);
  });
});
