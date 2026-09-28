import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcCall = { fn: string; scope?: string; subject?: string };
const calls: RpcCall[] = [];

const fakeProfile = {
  runner_profile_id: "00000000-0000-4000-8000-000000000001",
  profile_readiness: "READY",
  account_state: "ACTIVE",
  full_name: null,
  date_of_birth: null,
  sex_code: null,
  phone_e164: null,
  emergency_contact_name: null,
  emergency_contact_phone_e164: null,
  emergency_contact_relationship: null,
};

vi.mock("@/lib/server/rpc", () => ({
  callRpc: vi.fn(async (_client: unknown, fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, scope: typeof args.p_scope === "string" ? args.p_scope : undefined, subject: typeof args.p_subject === "string" ? args.p_subject : undefined });
    if (fn === "consume_subject_rate_limit" || fn === "consume_actor_rate_limit") return { allowed: true };
    return fakeProfile;
  }),
}));

vi.mock("@/lib/server/supabase/clients", () => ({
  createAnonClient: () => ({ auth: { signInWithOtp: vi.fn(async () => ({ error: null })) } }),
  createSystemClient: () => ({}),
  createSessionClient: async () => ({ auth: { verifyOtp: vi.fn(async () => ({ data: { session: { access_token: "x" } }, error: null })) } }),
}));

const { requestOtp, verifyOtp } = await import("@/lib/server/domain/auth/service");

beforeEach(() => {
  calls.length = 0;
});

function subjectsFor(scope: string): (string | undefined)[] {
  return calls.filter((c) => c.scope === scope).map((c) => c.subject);
}

// F3: a third party who knows a victim's email must not be able to exhaust the victim's OTP
// request/verify quota from a single IP. The tight per-hour bucket is keyed on (email, IP); a
// higher email-only ceiling is the backstop against a distributed attacker.
describe("F3: OTP rate-limit subjects are keyed to stop a single attacker IP locking a victim email", () => {
  it("requestOtp consumes the combined (email, IP) bucket plus the higher email-only ceiling", async () => {
    await requestOtp("victim@example.test", "203.0.113.9");
    expect(subjectsFor("auth.otp.ip")).toEqual(["203.0.113.9"]);
    expect(subjectsFor("auth.otp.email")).toEqual(["victim@example.test"]);
    expect(subjectsFor("auth.otp.email.hour")).toEqual(["victim@example.test|203.0.113.9"]);
    expect(subjectsFor("auth.otp.email.hour.global")).toEqual(["victim@example.test"]);
  });

  it("a different attacker IP produces a different tight-bucket subject for the same victim email", async () => {
    await requestOtp("victim@example.test", "203.0.113.9");
    await requestOtp("victim@example.test", "198.51.100.4");
    const subjects = subjectsFor("auth.otp.email.hour");
    expect(new Set(subjects).size).toBe(2);
    // The email-only backstop is still shared across both IPs, so a distributed attacker is
    // eventually caught by it.
    expect(subjectsFor("auth.otp.email.hour.global")).toEqual(["victim@example.test", "victim@example.test"]);
  });

  it("verifyOtp consumes the combined (email, IP) bucket plus the higher email-only ceiling", async () => {
    await verifyOtp("victim@example.test", "123456", "203.0.113.9");
    expect(subjectsFor("auth.verify.ip")).toEqual(["203.0.113.9"]);
    expect(subjectsFor("auth.verify.email")).toEqual(["victim@example.test|203.0.113.9"]);
    expect(subjectsFor("auth.verify.email.global")).toEqual(["victim@example.test"]);
  });
});
