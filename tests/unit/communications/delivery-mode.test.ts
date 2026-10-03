import { describe, expect, it } from "vitest";
import {
  allowlistClaimFilter,
  dispatchQuotaPool,
  isSuppressedByAllowlist,
  resolveEmailDeliveryMode,
  selectEmailProvider,
} from "@/lib/server/providers/email/delivery-mode";
import type { EmailProvider } from "@/lib/server/providers/email/types";

const brevo: EmailProvider = { name: "brevo", send: async () => ({ outcome: "ACCEPTED", providerMessageId: "brevo-id" }) };
const capture: EmailProvider = { name: "capture", send: async () => ({ outcome: "ACCEPTED", providerMessageId: "capture-id" }) };

describe("resolveEmailDeliveryMode (A9 matrix)", () => {
  it("defaults to capture outside production when unset", () => {
    expect(resolveEmailDeliveryMode({ EMAIL_DELIVERY_MODE: undefined, APP_ENV: "local" })).toBe("capture");
    expect(resolveEmailDeliveryMode({ EMAIL_DELIVERY_MODE: undefined, APP_ENV: "staging" })).toBe("capture");
  });

  it("refuses to send when unset in production", () => {
    expect(resolveEmailDeliveryMode({ EMAIL_DELIVERY_MODE: undefined, APP_ENV: "production" })).toBe("refuse");
  });

  it("honors an explicit mode regardless of APP_ENV", () => {
    expect(resolveEmailDeliveryMode({ EMAIL_DELIVERY_MODE: "live", APP_ENV: "local" })).toBe("live");
    expect(resolveEmailDeliveryMode({ EMAIL_DELIVERY_MODE: "allowlist", APP_ENV: "production" })).toBe("allowlist");
  });

  it("F5: refuses an explicit capture in production instead of honouring it (fail closed)", () => {
    expect(resolveEmailDeliveryMode({ EMAIL_DELIVERY_MODE: "capture", APP_ENV: "production" })).toBe("refuse");
    expect(resolveEmailDeliveryMode({ EMAIL_DELIVERY_MODE: "capture", APP_ENV: "staging" })).toBe("capture");
    expect(resolveEmailDeliveryMode({ EMAIL_DELIVERY_MODE: "capture", APP_ENV: "local" })).toBe("capture");
  });
});

describe("selectEmailProvider", () => {
  it("capture mode never selects brevo", () => {
    const selected = selectEmailProvider("anyone@example.test", { EMAIL_DELIVERY_MODE: "capture", APP_ENV: "local", EMAIL_ALLOWLIST: undefined }, brevo, capture);
    expect(selected?.name).toBe("capture");
  });

  it("live mode always selects brevo", () => {
    const selected = selectEmailProvider("anyone@example.test", { EMAIL_DELIVERY_MODE: "live", APP_ENV: "production", EMAIL_ALLOWLIST: undefined }, brevo, capture);
    expect(selected?.name).toBe("brevo");
  });

  it("refuse mode selects no provider", () => {
    const selected = selectEmailProvider("anyone@example.test", { EMAIL_DELIVERY_MODE: undefined, APP_ENV: "production", EMAIL_ALLOWLIST: undefined }, brevo, capture);
    expect(selected).toBeNull();
  });

  it("allowlist mode routes an allowlisted address to brevo and, with an explicit capture sink, everyone else to capture", () => {
    const env = {
      EMAIL_DELIVERY_MODE: "allowlist" as const,
      APP_ENV: "staging" as const,
      EMAIL_ALLOWLIST: "qa@example.test, Other@Example.test",
      MAILPIT_URL: "http://127.0.0.1:54624",
    };
    expect(selectEmailProvider("qa@example.test", env, brevo, capture)?.name).toBe("brevo");
    expect(selectEmailProvider("OTHER@example.test", env, brevo, capture)?.name).toBe("brevo"); // case-insensitive match
    expect(selectEmailProvider("stranger@example.test", env, brevo, capture)?.name).toBe("capture");
  });

  it("P2-G9: allowlist mode without a capture sink never selects any transport for a non-allowlisted address", () => {
    const env = { EMAIL_DELIVERY_MODE: "allowlist" as const, APP_ENV: "staging" as const, EMAIL_ALLOWLIST: "qa@example.test, Other@Example.test" };
    expect(selectEmailProvider("qa@example.test", env, brevo, capture)?.name).toBe("brevo");
    expect(selectEmailProvider(" OTHER@example.test ", env, brevo, capture)?.name).toBe("brevo");
    expect(selectEmailProvider("stranger@example.test", env, brevo, capture)).toBeNull();
  });
});

describe("dispatchQuotaPool", () => {
  it("capture mode claims under the capture pool", () => {
    expect(dispatchQuotaPool({ EMAIL_DELIVERY_MODE: "capture", APP_ENV: "local" })).toBe("capture");
  });
  it("live and allowlist modes both claim under the brevo pool", () => {
    expect(dispatchQuotaPool({ EMAIL_DELIVERY_MODE: "live", APP_ENV: "production" })).toBe("brevo");
    expect(dispatchQuotaPool({ EMAIL_DELIVERY_MODE: "allowlist", APP_ENV: "staging" })).toBe("brevo");
  });
  it("refuse mode claims nothing", () => {
    expect(dispatchQuotaPool({ EMAIL_DELIVERY_MODE: undefined, APP_ENV: "production" })).toBeNull();
  });
  it("F5: an explicit capture in production is refused, so it claims nothing either", () => {
    expect(dispatchQuotaPool({ EMAIL_DELIVERY_MODE: "capture", APP_ENV: "production" })).toBeNull();
  });
});

describe("allowlist suppression without a capture sink (P2-G9)", () => {
  const staging = { EMAIL_DELIVERY_MODE: "allowlist" as const, APP_ENV: "staging" as const, EMAIL_ALLOWLIST: "Owner@Example.test, ops@example.test", MAILPIT_URL: undefined };

  it("hands SQL the normalized allowlist only in allowlist mode with no explicit MAILPIT_URL", () => {
    expect(allowlistClaimFilter(staging)).toEqual(["owner@example.test", "ops@example.test"]);
    expect(allowlistClaimFilter({ ...staging, EMAIL_ALLOWLIST: undefined })).toEqual([]); // empty list suppresses everyone
  });

  it("applies no restriction when a capture sink is configured, or in any other mode", () => {
    expect(allowlistClaimFilter({ ...staging, MAILPIT_URL: "http://127.0.0.1:54624" })).toBeNull();
    expect(allowlistClaimFilter({ ...staging, EMAIL_DELIVERY_MODE: "capture" })).toBeNull();
    expect(allowlistClaimFilter({ ...staging, EMAIL_DELIVERY_MODE: "live", APP_ENV: "production" })).toBeNull();
    expect(allowlistClaimFilter({ ...staging, EMAIL_DELIVERY_MODE: undefined, APP_ENV: "local" })).toBeNull();
    expect(allowlistClaimFilter({ ...staging, EMAIL_DELIVERY_MODE: undefined, APP_ENV: "production" })).toBeNull(); // refuse, not suppress
  });

  it("flags exactly the recipients outside the allowlist", () => {
    expect(isSuppressedByAllowlist("owner@example.test", staging)).toBe(false);
    expect(isSuppressedByAllowlist(" OPS@example.test", staging)).toBe(false);
    expect(isSuppressedByAllowlist("qa-participant-1@example.com", staging)).toBe(true);
    expect(isSuppressedByAllowlist("qa-participant-1@example.com", { ...staging, MAILPIT_URL: "http://127.0.0.1:54624" })).toBe(false);
    expect(isSuppressedByAllowlist("qa-participant-1@example.com", { ...staging, EMAIL_DELIVERY_MODE: "live" })).toBe(false);
  });

  it("production live and local capture behaviour are unchanged", () => {
    const live = { EMAIL_DELIVERY_MODE: "live" as const, APP_ENV: "production" as const, EMAIL_ALLOWLIST: undefined };
    expect(selectEmailProvider("anyone@example.test", live, brevo, capture)?.name).toBe("brevo");
    const local = { EMAIL_DELIVERY_MODE: "capture" as const, APP_ENV: "local" as const, EMAIL_ALLOWLIST: undefined };
    expect(selectEmailProvider("anyone@example.test", local, brevo, capture)?.name).toBe("capture");
  });
});
