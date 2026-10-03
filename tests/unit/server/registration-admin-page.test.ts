import { describe, expect, test } from "vitest";
import { adminRegistrationRequestPageSchema } from "@/lib/server/domain/registration/contracts";

// P2-G1 (F-2): the SQL projection of admin_list_registration_requests yields `counts: null` on an Edition without
// requests and only the effective statuses that exist otherwise; the output schema must accept both.
describe("adminRegistrationRequestPageSchema", () => {
  test("accepts null counts (empty Edition) and a partial counts object", () => {
    expect(adminRegistrationRequestPageSchema.safeParse({ items: [], next_cursor: null, counts: null }).success).toBe(true);
    expect(adminRegistrationRequestPageSchema.safeParse({ items: [], next_cursor: null, counts: { PENDING_CONFIRMATION: 2, EXPIRED: 1 } }).success).toBe(true);
  });

  test("still fails closed on an unknown status key, a non-integer count or a missing counts key", () => {
    expect(adminRegistrationRequestPageSchema.safeParse({ items: [], next_cursor: null, counts: { BOGUS: 1 } }).success).toBe(false);
    expect(adminRegistrationRequestPageSchema.safeParse({ items: [], next_cursor: null, counts: { CONFIRMED: 1.5 } }).success).toBe(false);
    expect(adminRegistrationRequestPageSchema.safeParse({ items: [], next_cursor: null }).success).toBe(false);
  });
});
