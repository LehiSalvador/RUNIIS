import { describe, expect, it } from "vitest";
import { dispatchQuotaPool, resolveEmailDeliveryMode, selectEmailProvider } from "@/lib/server/providers/email/delivery-mode";
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

  it("allowlist mode routes an allowlisted address to brevo and everyone else to capture", () => {
    const env = { EMAIL_DELIVERY_MODE: "allowlist" as const, APP_ENV: "staging" as const, EMAIL_ALLOWLIST: "qa@example.test, Other@Example.test" };
    expect(selectEmailProvider("qa@example.test", env, brevo, capture)?.name).toBe("brevo");
    expect(selectEmailProvider("OTHER@example.test", env, brevo, capture)?.name).toBe("brevo"); // case-insensitive match
    expect(selectEmailProvider("stranger@example.test", env, brevo, capture)?.name).toBe("capture");
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
