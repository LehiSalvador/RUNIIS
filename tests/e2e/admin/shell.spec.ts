import { LOCAL_DB_ONLY, psql } from "../support/account";
import { e2eEnv } from "../support/env";
import { SEED_EDITION_ID, apiStatus, expect, gotoAndSettle, navLinks, signInAs, signInAsNewUser, test } from "./support";

/**
 * Admin shell smoke (P3-B): role-gated pages and navigation, direct URL, the Events list and the Edition
 * overview, on the three viewports. Needs the seeded staff accounts and Mailpit of the local stack.
 */
test.describe.configure({ timeout: 120_000 });
test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);

test.describe("anonymous visitors", () => {
  test("a direct /admin URL is a real redirect to sign-in that keeps the destination", async ({ request }) => {
    const dashboard = await request.get("/admin", { maxRedirects: 0 });
    expect(dashboard.status()).toBe(307);
    expect(dashboard.headers().location).toContain("/entrar?next=%2Fadmin");

    const deep = await request.get("/admin/eventos?search=demo", { maxRedirects: 0 });
    expect(deep.status()).toBe(307);
    expect(deep.headers().location).toContain("next=%2Fadmin%2Feventos%3Fsearch%3Ddemo");

    const edition = await request.get(`/admin/eventos/${SEED_EDITION_ID}`, { maxRedirects: 0 });
    expect(edition.status()).toBe(307);
  });
});

test.describe("role-gated navigation and direct URLs", () => {
  // Phase 3 builds only the dashboard and the events list so far; the matrix itself is unit-tested.
  const MATRIX = {
    admin: { nav: ["Dashboard", "Eventos"], events: true },
    operator: { nav: ["Dashboard", "Eventos"], events: true },
    checkin: { nav: ["Dashboard"], events: false },
    moderator: { nav: ["Dashboard"], events: false },
  } as const;

  for (const account of ["admin", "operator", "checkin", "moderator"] as const) {
    test(`${account}: nav shows only what the role can use, direct URLs are enforced on the server`, async ({ page }, testInfo) => {
      await signInAs(page, account);
      await gotoAndSettle(page, "/admin");
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeAttached();
      await expect(page.getByRole("heading", { name: "Tu acceso" })).toBeVisible();

      const links = await navLinks(page, testInfo.project.name);
      expect(links.map((link) => link.name)).toEqual([...MATRIX[account].nav]);
      // never an unbuilt route, never a disabled placeholder
      for (const link of links) expect(["/admin", "/admin/eventos"]).toContain(link.href);
      await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);

      // direct URL: allowed roles get the list, the others get the refusal (the nav hiding is not the control)
      await gotoAndSettle(page, "/admin/eventos");
      if (MATRIX[account].events) {
        await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeAttached();
        await expect(page.getByTestId("admin-forbidden")).toHaveCount(0);
      } else {
        await expect(page.getByTestId("admin-forbidden")).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, name: "Acceso restringido" })).toBeAttached();
        await expect(page.getByRole("table")).toHaveCount(0);
      }

      await gotoAndSettle(page, `/admin/eventos/${SEED_EDITION_ID}`);
      if (MATRIX[account].events) await expect(page.getByRole("heading", { level: 1, name: "Seed Carrera Registro 2026" })).toBeAttached();
      else await expect(page.getByTestId("admin-forbidden")).toBeVisible();

      // the API refuses the same roles on its own (server authority beyond the page guard)
      expect(await apiStatus(page.request, `/api/v1/admin/editions/${SEED_EDITION_ID}`)).toBe(MATRIX[account].events ? 200 : 403);
    });
  }

  test("a signed-in account without a staff role gets the refusal and no admin navigation", async ({ page, evidence }, testInfo) => {
    await signInAsNewUser(page, "nostaff");
    for (const path of ["/admin", "/admin/eventos", `/admin/eventos/${SEED_EDITION_ID}`]) {
      await gotoAndSettle(page, path);
      await expect(page.getByTestId("admin-forbidden")).toBeVisible();
      await expect(page.getByRole("link", { name: "Ir a mi cuenta" })).toHaveAttribute("href", "/cuenta");
      expect((await navLinks(page, testInfo.project.name)).filter((link) => link.href?.startsWith("/admin/"))).toEqual([]);
    }
    await evidence("runner-forbidden");
    expect(await apiStatus(page.request, "/api/v1/admin/events")).toBe(403);
    // the shell never lies about who is signed in
    await expect(page.getByText("Tu rol no tiene")).toHaveCount(0);
  });
});

test.describe("dashboard", () => {
  test("indicators link through to the filtered list and the page passes axe", async ({ page, a11y, evidence }) => {
    await signInAs(page, "admin");
    await gotoAndSettle(page, "/admin");
    const tiles = page.getByRole("list", { name: "Indicadores de ediciones" });
    await expect(tiles).toBeVisible();
    await expect(tiles.getByRole("link", { name: /Inscripciones abiertas/ })).toHaveAttribute("href", "/admin/eventos?registration_state=OPEN");
    await expect(page.getByRole("heading", { name: "Próximas carreras" })).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await a11y();
    await evidence("dashboard");

    await tiles.getByRole("link", { name: /Inscripciones abiertas/ }).click();
    await expect(page).toHaveURL(/\/admin\/eventos\?registration_state=OPEN$/);
    await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeAttached();
  });
});

test.describe("events list", () => {
  test("search, status filters, URL state, empty state and back/forward", async ({ page, a11y, evidence }) => {
    await signInAs(page, "operator");
    await gotoAndSettle(page, "/admin/eventos");
    const rows = page.getByRole("table", { name: "Ediciones" }).locator("tbody tr");
    // the fixture set is shared with other suites and can exceed one page: assert shape, not exact rows
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(1);
    await a11y();
    await evidence("eventos-lista");

    // search applies on Enter and lands in the URL
    await page.getByRole("searchbox", { name: "Buscar" }).fill("Pospuesta");
    await page.getByRole("searchbox", { name: "Buscar" }).press("Enter");
    await expect(page).toHaveURL(/search=Pospuesta/);
    await expect(page.getByRole("link", { name: "RUNIIS Demo Pospuesta" }).first()).toBeVisible();
    await expect(page.getByRole("table", { name: "Ediciones" }).getByRole("link", { name: /Seed Carrera/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Quitar filtro Buscar: Pospuesta/ })).toBeVisible();

    // a status filter combines with it; the select is operable from the keyboard
    await page.getByRole("combobox", { name: "Ejecución" }).click();
    await page.getByRole("option", { name: "Aplazada" }).click();
    await expect(page).toHaveURL(/execution_state=POSTPONED/);
    await expect(page.getByRole("link", { name: "RUNIIS Demo Pospuesta" }).first()).toBeVisible();

    // nothing matches: inline empty state with a way out, not a blank table
    await page.getByRole("searchbox", { name: "Buscar" }).fill("zzzz-no-existe");
    await page.getByRole("searchbox", { name: "Buscar" }).press("Enter");
    await expect(page.getByRole("heading", { name: "No hay ediciones con estos filtros" })).toBeVisible();
    await evidence("eventos-vacio");

    await page.getByRole("button", { name: "Limpiar filtros" }).click();
    await expect(page).toHaveURL(/\/admin\/eventos$/);
    await expect.poll(() => rows.count()).toBeGreaterThan(1);

    // the filters survive back/forward and a reload (state lives in the URL)
    await page.goBack();
    await expect(page).toHaveURL(/search=zzzz/);
    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Buscar" })).toHaveValue("zzzz-no-existe");
  });

  test("status filter chips, hostile query values and a forged cursor are handled safely", async ({ page }) => {
    await signInAs(page, "admin");
    await gotoAndSettle(page, "/admin/eventos?publication_state=PUBLISHED&registration_state=OPEN");
    await expect(page.getByRole("button", { name: /Quitar filtro Publicación: Publicada/ })).toBeVisible();
    await page.getByRole("button", { name: /Quitar filtro Publicación/ }).click();
    await expect(page).toHaveURL(/registration_state=OPEN$/);

    // an unknown enum value is ignored (never reaches the API), no error page
    await gotoAndSettle(page, "/admin/eventos?publication_state=%27%3B%20drop%20table&cursor=!!not-base64!!");
    await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeAttached();
    await expect(page.getByRole("table", { name: "Ediciones" })).toBeVisible();
    await expect(page.getByText("drop table")).toHaveCount(0);
  });

  test("cursor pagination: next page, first page, rows are not repeated", async ({ page, a11y }) => {
    await signInAs(page, "operator");
    await gotoAndSettle(page, "/admin/eventos?limit=5");
    // Rows are identified by their link (edition ids are unique; names repeat in the integration fixtures).
    const names = async () => page.getByRole("table", { name: "Ediciones" }).locator("tbody tr td a[href^='/admin/eventos/']:not([aria-label])").evaluateAll((a) => a.map((x) => x.getAttribute("href") ?? ""));
    const first = [...new Set(await names())];
    expect(first).toHaveLength(5);
    await expect(page.getByRole("link", { name: "Primera página" })).toHaveCount(0);

    await page.getByRole("link", { name: "Siguiente página" }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(page).toHaveURL(/limit=5/);
    await expect(page.getByRole("link", { name: "Primera página" })).toBeVisible();
    const second = [...new Set(await names())];
    expect(second.length).toBeGreaterThanOrEqual(2);
    for (const name of second) expect(first, name).not.toContain(name);
    await a11y();

    await page.getByRole("link", { name: "Primera página" }).click();
    await expect(page).toHaveURL(/\/admin\/eventos\?limit=5$/);
    await expect(page.getByRole("link", { name: "Primera página" })).toHaveCount(0);
    // (the fixture set is shared with other suites, so assert the shape of the first page, not its exact rows)
    await expect.poll(async () => new Set(await names()).size).toBe(5);
    for (const name of second) expect(await names(), name).not.toContain(name);
  });

  test("keyboard: tab reaches the row actions and the quick-look drawer opens, traps focus and closes with Escape", async ({ page, a11y, evidence }, testInfo) => {
    await signInAs(page, "operator");
    await gotoAndSettle(page, "/admin/eventos?search=Seed");
    const table = page.getByRole("table", { name: "Ediciones" });
    if (testInfo.project.name !== "chromium-desktop" && testInfo.project.name !== "chromium-tablet") {
      // below md the row actions live inside the row detail
      await table.getByRole("button", { name: /Ver detalle de Seed Carrera Registro 2026/ }).click();
    }
    const quick = table.getByRole("button", { name: "Vista rápida de Seed Carrera Registro 2026" }).first();
    await quick.focus();
    await expect(quick).toBeFocused();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Seed Carrera Registro 2026" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Publicada")).toBeVisible();
    await a11y();
    await evidence("eventos-vista-rapida");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(quick).toBeFocused();
  });
});

test.describe("edition overview", () => {
  test("status, key dates, registration, capacity and readiness from the existing admin API", async ({ page, a11y, evidence }) => {
    await signInAs(page, "admin");
    await gotoAndSettle(page, `/admin/eventos/${SEED_EDITION_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Seed Carrera Registro 2026" })).toBeAttached();
    await expect(page.locator("h1")).toHaveCount(1);

    const state = page.getByRole("group", { name: "Estado de la edición" });
    await expect(state.getByText("Publicada")).toBeVisible();
    await expect(state.getByText("Abierta")).toBeVisible();
    await expect(state.getByText("Programada")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Fechas clave" })).toBeVisible();
    await expect(page.getByText("Cierre de inscripciones", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inscripción", exact: true })).toBeVisible();
    await expect(page.getByText("Por WhatsApp: el staff confirma cada solicitud")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Capacidad" })).toBeVisible();
    await expect(page.getByRole("meter").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Readiness" })).toBeVisible();
    await expect(page.locator("section:has(h2:text-is('Readiness')) li").first()).toBeVisible();
    await expect(page.getByText(/por resolver|Lista/).first()).toBeVisible();

    // no quick links to sections that do not exist yet: every link in main goes to a built route
    const hrefs = await page.locator("main a[href]").evaluateAll((a) => a.map((x) => x.getAttribute("href") ?? ""));
    for (const href of hrefs) expect(["/admin/eventos", "/admin", "/cuenta", "/"].includes(href) || href.startsWith("/eventos/"), href).toBe(true);
    await expect(page.getByRole("link", { name: "Ver en el sitio" })).toHaveAttribute("href", /\/eventos\/[a-z0-9-]+$/);
    await expect(page.getByText("Actualizado a las")).toBeVisible();
    await a11y();
    await evidence("edicion-resumen");

    await page.getByRole("link", { name: "Todas las ediciones" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeAttached();
  });

  test("an unknown or malformed Edition id is a clear not-found inside the shell, never a raw error", async ({ page, a11y }) => {
    await signInAs(page, "admin");
    for (const id of ["50000000-0000-4000-8000-0000deadbeef", "not-a-uuid"]) {
      await gotoAndSettle(page, `/admin/eventos/${id}`);
      await expect(page.getByTestId("admin-not-found")).toBeVisible();
      await expect(page.getByRole("link", { name: "Volver a eventos" })).toHaveAttribute("href", "/admin/eventos");
      await expect(page.getByText(/sql|stack|exception/i)).toHaveCount(0);
    }
    await a11y();
  });

  test("an Edition-scoped operator opens only its own Edition (page and API), the server decides", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "mutates a shared fixture role; one project is enough");
    // runner.b gets a temporary EDITION-scoped OPERATOR assignment on the seeded Edition, removed afterwards.
    const STAFF_ID = "20000000-0000-4000-8000-0000000b0001";
    const RUNNER_B_AUTH = "00000000-0000-4000-8000-000000200006";
    const OTHER = psql(`select edition_id from app.edition where edition_id <> '${SEED_EDITION_ID}' order by created_at limit 1`);
    expect(OTHER).toMatch(/^[0-9a-f-]{36}$/);
    const cleanup = () =>
      psql(`
        update app.staff_role_assignment set revoked_at = now() where staff_member_id = '${STAFF_ID}' and revoked_at is null;
        delete from app.staff_role_assignment where staff_member_id = '${STAFF_ID}';
        delete from app.staff_member where staff_member_id = '${STAFF_ID}'`);
    cleanup();
    psql(`
      insert into app.staff_member (staff_member_id, auth_user_id, status) values ('${STAFF_ID}', '${RUNNER_B_AUTH}', 'ACTIVE');
      insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id)
      values ('${STAFF_ID}', 'OPERATOR', 'EDITION', '${SEED_EDITION_ID}')`);
    try {
      await signInAs(page, "runnerB");
      await gotoAndSettle(page, "/admin");
      await expect(page.getByText("Operador · Una edición").first()).toBeVisible();
      await gotoAndSettle(page, "/admin/eventos");
      await expect(page.getByRole("link", { name: "Seed Carrera Registro 2026" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "RUNIIS Demo Pospuesta" })).toHaveCount(0);

      await gotoAndSettle(page, `/admin/eventos/${SEED_EDITION_ID}`);
      await expect(page.getByRole("heading", { level: 1, name: "Seed Carrera Registro 2026" })).toBeAttached();
      expect(await apiStatus(page.request, `/api/v1/admin/editions/${SEED_EDITION_ID}`)).toBe(200);

      await gotoAndSettle(page, `/admin/eventos/${OTHER}`);
      await expect(page.getByTestId("admin-forbidden")).toBeVisible();
      expect(await apiStatus(page.request, `/api/v1/admin/editions/${OTHER}`)).toBe(403);
    } finally {
      cleanup();
    }
  });
});

test.describe("shell chrome", () => {
  test("skip link first, one h1, sidebar at md+ and drawer below", async ({ page, a11y }, testInfo) => {
    await signInAs(page, "admin");
    await gotoAndSettle(page, "/admin");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();

    if (testInfo.project.name === "chromium-mobile") {
      await page.getByRole("button", { name: "Abrir menú de administración" }).click();
      const drawer = page.getByRole("dialog", { name: "Administración" });
      await expect(drawer.getByRole("link", { name: "Eventos" })).toBeVisible();
      await expect(drawer.getByText("Administrador · Global")).toBeVisible();
      await a11y();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Abrir menú de administración" })).toBeFocused();
    } else {
      await expect(page.getByRole("button", { name: "Abrir menú de administración" })).toBeHidden();
      await expect(page.getByRole("complementary").getByText("Administrador · Global")).toBeVisible();
    }
  });

  test("sign-out from the shell ends the session at the server", async ({ page }, testInfo) => {
    // The refusal view carries the same identity footer, so a non-staff account is enough and its session is disposable.
    await signInAsNewUser(page, "signout");
    await gotoAndSettle(page, "/admin");
    if (testInfo.project.name === "chromium-mobile") {
      await page.getByRole("button", { name: "Abrir menú de administración" }).click();
      await page.getByRole("dialog", { name: "Administración" }).getByRole("button", { name: "Cerrar sesión" }).click();
    } else {
      await page.getByRole("button", { name: "Cerrar sesión" }).click();
    }
    await page.waitForURL("**/");
    const after = await page.request.get("/admin", { maxRedirects: 0 });
    expect(after.status()).toBe(307);
  });
});
