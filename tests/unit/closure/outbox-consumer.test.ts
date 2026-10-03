import { describe, expect, it } from "vitest";
import { outboxConsumerRegistry } from "@/lib/server/workers/outbox/consumers";

describe("outbox consumer registry (OWN-04)", () => {
  it("routes RegistrationCanceled to the cancellation email consumer", () => {
    expect(outboxConsumerRegistry.RegistrationCanceled).toEqual({ rpc: "enqueue_registration_canceled_messages", maxAttempts: 10 });
  });

  it("keeps the T35 consumers", () => {
    expect(Object.keys(outboxConsumerRegistry)).toEqual(
      expect.arrayContaining(["RegistrationConfirmed", "EditionRegistrationOpened", "EditionPostponed", "EditionRescheduled", "EditionCanceled"]),
    );
  });
});
