// AUD-028: reports the real deployment environment. Reads APP_ENV directly (not getServerEnv) so a
// health probe never depends on unrelated secrets and never echoes a configuration value: an unset or
// unrecognised APP_ENV is reported as unhealthy "unknown", never silently as "staging".
export const dynamic = "force-dynamic";

const KNOWN_ENVIRONMENTS = ["local", "staging", "production"] as const;

export async function GET(): Promise<Response> {
  const environment = KNOWN_ENVIRONMENTS.find((candidate) => candidate === process.env.APP_ENV);
  if (!environment) {
    return Response.json({ status: "error", environment: "unknown", checks: { app: "invalid_app_env" } }, { status: 503 });
  }
  return Response.json({ status: "ok", environment, checks: { app: "ok" } });
}
