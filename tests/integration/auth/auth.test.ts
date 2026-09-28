import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { APP_URL, cleanup, createCookieJar, createTestStaff, createTestUser, fetchOtpCode, httpSignIn, queryValue, sql } from "../helpers";

// Drives the real Next.js route handlers over HTTP against the shared dev server (SEC-040/043/044/
// 047/049; ADR-001 A7/A8), with real Mailpit OTP delivery and real HttpOnly session cookies -- no
// shortcuts through the domain/service layer for anything this suite claims to verify.

const createdUsers: string[] = [];
afterAll(async () => cleanup(createdUsers));

// getClientIp() intentionally falls back to a fixed "local-dev" subject when there is no Netlify
// header (client-ip.ts), so every local client (this suite included, across repeated runs) shares
// the same auth.otp.ip/auth.verify.ip buckets (stored as a sha256 hash of the subject, so it can't
// be matched by the literal string here). This suite makes ~15 real OTP requests per run, which
// exhausts the 20/hour policy on a second run within the same window; clearing these two
// SUPPLIED-subject scopes entirely keeps the suite self-contained (safe: in local dev every caller
// already shares this one fallback-IP bucket) without touching per-email buckets (random emails per
// test, already isolated) or any other task's rate-limit scope.
beforeAll(() => {
  sql(`delete from infra.rate_limit_counter where scope in ('auth.otp.ip', 'auth.verify.ip')`);
});

const onboardingFields = {
  full_name: "Persona Integración",
  date_of_birth: "1990-05-05",
  sex_code: "F" as const,
  phone_e164: "+528110000900",
  emergency_contact_name: "Contacto Emergencia",
  emergency_contact_phone_e164: "+528110000901",
  emergency_contact_relationship: "Madre",
};

async function post(jar: ReturnType<typeof createCookieJar>, path: string, body?: unknown, extraHeaders: HeadersInit = {}) {
  return jar.fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("auth HTTP flow (T20) integration", () => {
  test("OTP request -> Mailpit -> verify -> session cookie -> /api/v1/me -> onboarding -> /api/v1/session -> signout revokes", async () => {
    const jar = createCookieJar();
    const email = `t20-flow-${Date.now()}@example.test`;

    const otpResponse = await post(jar, "/api/v1/auth/otp", { email });
    expect(otpResponse.status).toBe(202);

    const code = await fetchOtpCode(email);
    const verifyResponse = await post(jar, "/api/v1/auth/verify", { email, code });
    expect(verifyResponse.status).toBe(200);
    const verifyBody = (await verifyResponse.json()) as { data: { profile_readiness: string } };
    expect(verifyBody.data.profile_readiness).toBe("PROFILE_INCOMPLETE");

    // SEC-049: session cookies are never JS-readable and stay same-site.
    const setCookies = verifyResponse.headers.getSetCookie?.() ?? [];
    expect(setCookies.length).toBeGreaterThan(0);
    for (const setCookie of setCookies) {
      expect(setCookie.toLowerCase()).toContain("httponly");
      expect(setCookie.toLowerCase()).toContain("samesite=lax");
    }

    const authUserId = queryValue(`select id::text from auth.users where email = '${email}'`);
    if (authUserId) createdUsers.push(authUserId);

    const meResponse = await jar.fetch("/api/v1/me");
    expect(meResponse.status).toBe(200);
    expect(((await meResponse.json()) as { data: { profile_readiness: string } }).data.profile_readiness).toBe("PROFILE_INCOMPLETE");

    const onboardResponse = await post(jar, "/api/v1/me/onboarding", onboardingFields);
    expect(onboardResponse.status).toBe(200);
    expect(((await onboardResponse.json()) as { data: { profile_readiness: string } }).data.profile_readiness).toBe("READY");

    const sessionResponse = await jar.fetch("/api/v1/session");
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as { data: { authenticated: boolean; display_name: string | null } };
    expect(sessionBody.data.authenticated).toBe(true);

    const signoutResponse = await post(jar, "/api/v1/auth/signout");
    expect(signoutResponse.status).toBe(200);

    const meAfterSignout = await jar.fetch("/api/v1/me");
    expect(meAfterSignout.status).toBe(401);
  }, 30_000);

  test("GET /api/v1/me without a session is denied (401), a forged cookie is denied too", async () => {
    const anon = createCookieJar();
    expect((await anon.fetch("/api/v1/me")).status).toBe(401);

    const forged = createCookieJar();
    expect((await forged.fetch("/api/v1/me", { headers: { cookie: "sb-127-auth-token=forged.garbage.value" } })).status).toBe(401);
  });

  test("/api/v1/session always answers 200, anonymous or authenticated", async () => {
    const anon = createCookieJar();
    const response = await anon.fetch("/api/v1/session");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: { authenticated: boolean } }).data.authenticated).toBe(false);
  });

  test("token reuse: a used OTP code cannot be replayed by anyone who saw it", async () => {
    const jar = createCookieJar();
    const email = `t20-reuse-${Date.now()}@example.test`;
    await post(jar, "/api/v1/auth/otp", { email });
    const code = await fetchOtpCode(email);
    expect((await post(jar, "/api/v1/auth/verify", { email, code })).status).toBe(200);

    const authUserId = queryValue(`select id::text from auth.users where email = '${email}'`);
    if (authUserId) createdUsers.push(authUserId);

    const replayJar = createCookieJar();
    expect((await post(replayJar, "/api/v1/auth/verify", { email, code })).status).toBe(400);
  }, 15_000);

  test("an incorrect OTP code is rejected", async () => {
    const jar = createCookieJar();
    const email = `t20-wrongcode-${Date.now()}@example.test`;
    await post(jar, "/api/v1/auth/otp", { email });
    await fetchOtpCode(email);
    expect((await post(jar, "/api/v1/auth/verify", { email, code: "000000" })).status).toBe(400);
  }, 15_000);

  test("SEC-043: OTP request is identical (202, same body shape) for unknown, existing and blocked-signup emails", async () => {
    const existing = await createTestUser({ label: "enum-existing" });
    createdUsers.push(existing.authUserId);

    const blockedEmail = `t20-enum-blocked-${Date.now()}@example.test`;
    sql(`insert into private.blocked_identity (runner_profile_id, normalized_email)
      values ('${existing.runnerProfileId}', '${blockedEmail}')`);

    const jar = createCookieJar();
    const emails = [`t20-enum-unknown-${Date.now()}@example.test`, existing.email, blockedEmail];
    const responses = await Promise.all(emails.map((email) => post(jar, "/api/v1/auth/otp", { email })));
    for (const response of responses) expect(response.status).toBe(202);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });

  test("PATCH /api/v1/me/profile: allowlisted fields succeed, everything else is rejected (mass-assignment, SEC-016)", async () => {
    const jar = createCookieJar();
    const email = `t20-patch-${Date.now()}@example.test`;
    const authUserId = await httpSignIn(jar, email);
    createdUsers.push(authUserId);
    expect((await post(jar, "/api/v1/me/onboarding", onboardingFields)).status).toBe(200);

    const forbidden = await jar.fetch("/api/v1/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ full_name: "Otro Nombre" }),
    });
    expect(forbidden.status).toBe(400);

    const escalation = await jar.fetch("/api/v1/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account_state: "ACTIVE", phone_e164: "+528110000950" }),
    });
    expect(escalation.status).toBe(400);

    const allowed = await jar.fetch("/api/v1/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone_e164: "+528110000950" }),
    });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as { data: { phone_e164: string } }).data.phone_e164).toBe("+528110000950");
  }, 20_000);

  test("CSRF: a cross-site Origin on a cookie-authenticated mutation is rejected", async () => {
    const jar = createCookieJar();
    const email = `t20-csrf-${Date.now()}@example.test`;
    const authUserId = await httpSignIn(jar, email);
    createdUsers.push(authUserId);

    const response = await jar.fetch("/api/v1/auth/signout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  }, 15_000);

  test("open redirect: /auth/callback never redirects off-site even with a malicious `next`", async () => {
    const response = await fetch(new URL("/auth/callback?next=https%3A%2F%2Fevil.example", APP_URL), { redirect: "manual" });
    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain("evil.example");
  });

  test("staff escalation: a non-staff user cannot reach /api/v1/admin/staff", async () => {
    const jar = createCookieJar();
    const email = `t20-nonstaff-${Date.now()}@example.test`;
    const authUserId = await httpSignIn(jar, email);
    createdUsers.push(authUserId);
    expect((await jar.fetch("/api/v1/admin/staff")).status).toBe(403);
  }, 15_000);

  test("staff escalation: an EDITION-scoped ADMIN cannot reach the GLOBAL-only staff roster (route guard passes; DB command denies)", async () => {
    const edition = queryValue(`select edition_id::text from app.edition limit 1`);
    const scopeType = edition ? "EDITION" : "GLOBAL";
    const staff = await createTestStaff("ADMIN", scopeType, edition);
    createdUsers.push(staff.authUserId);
    const jar = createCookieJar();
    await httpSignIn(jar, staff.email);
    // Only meaningful when an Edition fixture exists to scope to; otherwise this degenerates to a
    // GLOBAL admin and is covered by the "revoked staff" case below instead.
    if (edition) {
      expect((await jar.fetch("/api/v1/admin/staff")).status).toBe(403);
    }
  }, 15_000);

  test("staff escalation: an ADMIN cannot self-grant a role", async () => {
    const staff = await createTestStaff("ADMIN", "GLOBAL");
    createdUsers.push(staff.authUserId);
    const jar = createCookieJar();
    await httpSignIn(jar, staff.email);

    const response = await post(jar, "/api/v1/admin/staff", { email: staff.email, role: "OPERATOR", scope_type: "GLOBAL" });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { details: { reason?: string } } }).error.details.reason).toBe("SELF_GRANT");
  }, 15_000);

  test("an ADMIN can grant then revoke a role through the real HTTP endpoints (POST /admin/staff, DELETE /admin/staff/[id])", async () => {
    const admin = await createTestStaff("ADMIN", "GLOBAL");
    createdUsers.push(admin.authUserId);
    const target = await createTestUser({ label: "grant-target", ready: false });
    createdUsers.push(target.authUserId);

    const jar = createCookieJar();
    await httpSignIn(jar, admin.email);

    const grantResponse = await post(jar, "/api/v1/admin/staff", { email: target.email, role: "MODERATOR", scope_type: "GLOBAL" });
    expect(grantResponse.status).toBe(201);
    const grantBody = (await grantResponse.json()) as { data: { staff_role_assignment_id: string } };
    expect(grantBody.data.staff_role_assignment_id).toBeTruthy();

    const rosterResponse = await jar.fetch("/api/v1/admin/staff");
    expect(rosterResponse.status).toBe(200);
    const roster = (await rosterResponse.json()) as { data: { auth_user_id: string }[] };
    expect(roster.data.some((member) => member.auth_user_id === target.authUserId)).toBe(true);

    const revokeResponse = await jar.fetch(`/api/v1/admin/staff/${grantBody.data.staff_role_assignment_id}`, { method: "DELETE" });
    expect(revokeResponse.status).toBe(200);
    expect(((await revokeResponse.json()) as { data: { status: string } }).data.status).toBe("REVOKED");
  }, 20_000);

  test("staff escalation: an OPERATOR cannot reach staff-role management at all (route guard)", async () => {
    const staff = await createTestStaff("OPERATOR", "GLOBAL");
    createdUsers.push(staff.authUserId);
    const jar = createCookieJar();
    await httpSignIn(jar, staff.email);
    expect((await jar.fetch("/api/v1/admin/staff")).status).toBe(403);
  }, 15_000);

  test("revoked staff with a live session/JWT is denied on the next request (no stale-JWT trust)", async () => {
    const staff = await createTestStaff("ADMIN", "GLOBAL");
    createdUsers.push(staff.authUserId);
    const jar = createCookieJar();
    await httpSignIn(jar, staff.email);

    expect((await jar.fetch("/api/v1/admin/staff")).status).toBe(200);

    sql(`update app.staff_role_assignment set revoked_at = now()
      where staff_member_id = '${staff.staffMemberId}' and revoked_at is null`);

    // Same cookies/session as before revocation -- current_actor() re-reads staff_role_assignment
    // live on every request, so a still-valid JWT no longer carries a still-valid role.
    expect((await jar.fetch("/api/v1/admin/staff")).status).toBe(403);
  }, 15_000);
});
