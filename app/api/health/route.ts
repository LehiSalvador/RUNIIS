const environment = process.env.APP_ENV === "production" ? "production" : "staging";

export async function GET(): Promise<Response> {
  return Response.json({
    status: "ok",
    environment,
    checks: { app: "ok" },
  });
}
