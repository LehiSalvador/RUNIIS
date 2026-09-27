import { afterEach, describe, expect, it, vi } from "vitest";

type CapturedOptions = {
  auth?: Record<string, boolean>;
  global: { fetch: typeof fetch };
  cookies?: {
    getAll: () => unknown;
    setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void;
  };
};

const mocks = vi.hoisted(() => ({
  createClient: vi.fn((url: string, key: string, options: unknown) => ({ url, key, options })),
  createServerClient: vi.fn((url: string, key: string, options: unknown) => ({ url, key, options })),
  cookieStore: { getAll: vi.fn(() => [{ name: "sb-auth", value: "v" }]), set: vi.fn() },
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: async () => mocks.cookieStore }));

const { createAnonClient, createSessionClient, createSystemClient, SUPABASE_REQUEST_TIMEOUT_MS } = await import(
  "@/lib/server/supabase/clients"
);

const optionsOf = (client: unknown) => (client as { options: CapturedOptions }).options;
const keyOf = (client: unknown) => (client as { key: string }).key;

afterEach(() => vi.unstubAllGlobals());

describe("Supabase clients", () => {
  it("anon client uses the publishable key without a persisted session and is reused", () => {
    const client = createAnonClient();
    expect(keyOf(client)).toBe(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(optionsOf(client).auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
    expect(createAnonClient()).toBe(client);
  });

  it("system client uses the secret key", () => {
    expect(keyOf(createSystemClient())).toBe(process.env.SUPABASE_SECRET_KEY);
  });

  it("session client reads and writes the Next cookie store with the publishable key", async () => {
    const client = await createSessionClient();
    const options = optionsOf(client);
    expect(keyOf(client)).toBe(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(options.cookies!.getAll()).toEqual([{ name: "sb-auth", value: "v" }]);

    options.cookies!.setAll([{ name: "sb-auth", value: "new", options: { httpOnly: true } }]);
    expect(mocks.cookieStore.set).toHaveBeenCalledWith("sb-auth", "new", { httpOnly: true });

    mocks.cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });
    expect(() => options.cookies!.setAll([{ name: "sb-auth", value: "x", options: {} }])).not.toThrow();
  });

  it("bounds every request with a timeout signal and keeps caller cancellation", async () => {
    const seen: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      seen.push(init!.signal!);
      return new Response("{}");
    }));
    const boundedFetch = optionsOf(createAnonClient()).global.fetch;
    const caller = new AbortController();

    await boundedFetch("http://127.0.0.1:54621/rest/v1/rpc/x");
    await boundedFetch("http://127.0.0.1:54621/rest/v1/rpc/x", { signal: caller.signal });
    caller.abort();

    expect(SUPABASE_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0].aborted).toBe(false);
    expect(seen[1].aborted).toBe(true);
  });
});
