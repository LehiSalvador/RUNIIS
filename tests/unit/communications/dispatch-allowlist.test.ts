import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// P2-G9: runCommunicationDispatch under EMAIL_DELIVERY_MODE=allowlist on a deployed host (no capture sink).
// The Supabase client, the RPC layer and `fetch` are faked: no network, no database.

const env = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const rpc = vi.hoisted(() => ({ calls: [] as { fn: string; args: Record<string, unknown> }[], claimed: [] as unknown[] }));

vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env.value }));
vi.mock("@/lib/server/rpc", () => ({
  callRpc: async (_client: unknown, fn: string, args: Record<string, unknown>) => {
    rpc.calls.push({ fn, args });
    if (fn === "claim_communication_messages") return rpc.claimed;
    if (fn === "complete_communication_attempt") return { applied: true, status: "ok" };
    throw new Error(`unexpected rpc ${fn}`);
  },
}));

import { runCommunicationDispatch } from "@/lib/server/domain/communications/dispatch";

const BASE_ENV = {
  APP_ENV: "staging",
  APP_BASE_URL: "https://staging.example.test",
  BREVO_API_KEY: "unit-test-brevo-key",
};

function claimedMessage(id: string, toEmail: string) {
  return {
    message_id: id,
    attempt_number: 1,
    priority: 1,
    category: "TRANSACTIONAL",
    template_key: "REGISTRATION_CONFIRMED",
    template_version: 1,
    campaign_id: null,
    recipient_type: "RUNNER",
    to_email: toEmail,
    subject: "Asunto",
    html_template: "<p>hola</p>",
    text_template: "hola",
    variable_schema: { variables: {} },
    variables: {},
    participant_pass_id: null,
  };
}

const system = {} as SupabaseClient;
const completions = () => rpc.calls.filter((c) => c.fn === "complete_communication_attempt").map((c) => c.args);
const claim = () => rpc.calls.find((c) => c.fn === "claim_communication_messages")!.args;

describe("runCommunicationDispatch: allowlist mode without a capture sink", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    rpc.calls = [];
    rpc.claimed = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: URL | string) => {
      if (String(url).includes("api.brevo.com")) return new Response(JSON.stringify({ messageId: "<brevo-1@x>" }), { status: 201 });
      throw new Error("capture transport must not be reached");
    });
    vi.stubGlobal("fetch", fetchMock);
    env.value = { ...BASE_ENV, EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: "Owner@Example.test" };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("claims under the brevo pool and hands SQL the normalized allowlist", async () => {
    await runCommunicationDispatch(system);
    expect(claim()).toMatchObject({ p_provider: "brevo", p_allowlist: ["owner@example.test"] });
  });

  it("an allowlisted recipient still goes through Brevo and is accepted", async () => {
    rpc.claimed = [claimedMessage("11111111-1111-4111-8111-111111111111", "owner@example.test")];
    const summary = await runCommunicationDispatch(system);
    expect(summary).toMatchObject({ claimed: 1, accepted: 1, retried: 0, failed: 0, suppressed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("api.brevo.com");
    expect(completions()).toEqual([expect.objectContaining({ p_outcome: "ACCEPTED", p_provider: "brevo" })]);
  });

  it("a recipient that slipped past the SQL filter is terminally blocked: no transport, no retry, no failure", async () => {
    rpc.claimed = [claimedMessage("22222222-2222-4222-8222-222222222222", "qa-participant@example.com")];
    const summary = await runCommunicationDispatch(system);
    expect(summary).toMatchObject({ claimed: 1, accepted: 0, retried: 0, failed: 0, suppressed: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    const [done] = completions();
    expect(done).toMatchObject({ p_outcome: "BLOCKED_BY_POLICY", p_error_code: "NOT_ALLOWLISTED", p_retry_at: null });
  });

  it("with an explicit MAILPIT_URL the claim carries no allowlist and non-allowlisted mail is captured as before", async () => {
    env.value = { ...env.value, MAILPIT_URL: "http://127.0.0.1:54624" };
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ID: "m1" }), { status: 200 }));
    rpc.claimed = [claimedMessage("33333333-3333-4333-8333-333333333333", "qa-participant@example.com")];
    const summary = await runCommunicationDispatch(system);
    expect(claim().p_allowlist).toBeNull();
    expect(summary).toMatchObject({ accepted: 1, suppressed: 0 });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("127.0.0.1:54624");
  });

  it("capture mode (local) is unchanged: no allowlist filter", async () => {
    env.value = { ...BASE_ENV, APP_ENV: "local", EMAIL_DELIVERY_MODE: "capture" };
    await runCommunicationDispatch(system);
    expect(claim()).toMatchObject({ p_provider: "capture", p_allowlist: null });
  });

  it("live mode (production) is unchanged: no allowlist filter, everything goes to Brevo", async () => {
    env.value = { ...BASE_ENV, APP_ENV: "production", EMAIL_DELIVERY_MODE: "live" };
    rpc.claimed = [claimedMessage("44444444-4444-4444-8444-444444444444", "someone@example.com")];
    const summary = await runCommunicationDispatch(system);
    expect(claim()).toMatchObject({ p_provider: "brevo", p_allowlist: null });
    expect(summary).toMatchObject({ accepted: 1, suppressed: 0 });
  });
});
