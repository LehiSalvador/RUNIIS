import { createReadyUser, psql } from "../support/account";
import { e2eEnv } from "../support/env";
import { settleNetwork } from "../support/settle";
import { expect, LOCAL_SQL_ONLY, registerSelfViaApi, skipWithoutFixtureAdmin, test, waitForHydration } from "../support/journey";

// Phase 2 participant journeys (Roadmap 8.22), part 5: what the participant holds after registering.
// Pass display (QR modal, revoked never valid), credential replacement when exposed (staff, through the admin API),
// and the communication preferences of the account.
test.describe.configure({ timeout: 240_000 });
test.beforeEach(() => skipWithoutFixtureAdmin());

test("Pass display: public code always visible, QR on demand in a modal that returns focus, no token in the URL", async ({ page, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  await createReadyUser(page, "passview");
  const request = await registerSelfViaApi(page, edition.slug);
  const passId = request.participants[0].registration!.participant_pass_id!;

  await page.goto("/cuenta/pases");
  await settleNetwork(page);
  const row = page.getByTestId("pass-row").first();
  await expect(row).toHaveAttribute("data-pass-state", "VALID");
  await expect(row.getByText("Tu pase", { exact: true })).toBeVisible();
  const code = (await row.getByTestId("pass-public-code").innerText()).trim();
  expect(code).toMatch(/^P-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(page.getByText(/reemplazar/i)).toHaveCount(0);
  await a11y();
  await evidence("pases-lista");

  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/cuenta/pases/${passId}$`));
  expect(page.url()).not.toMatch(/token|RN1|credential/i);
  await expect(page.getByTestId("pass-public-code")).toHaveText(code);
  await waitForHydration(page);

  // QR on demand: opened and closed with the keyboard, rendered by the server (a private SVG), never part of the page.
  const open = page.getByRole("button", { name: "Ver código QR" });
  await open.focus();
  const rendered = page.waitForResponse((response) => response.url().includes(`/api/v1/me/passes/${passId}/render-qr`));
  await page.keyboard.press("Enter");
  const render = await rendered;
  expect(render.status()).toBe(200);
  expect(render.headers()["content-type"]).toContain("image/svg+xml");
  expect(render.headers()["cache-control"]).toContain("no-store");
  const dialog = page.getByRole("dialog");
  const qr = dialog.getByRole("img", { name: `Código QR del pase ${code}` });
  await expect(qr).toBeVisible();
  expect(await qr.getAttribute("src")).toMatch(/^blob:/);
  await expect(dialog.getByText(code)).toBeVisible();
  await a11y();
  await evidence("pase-qr");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("Credential replacement when exposed: staff replaces it, the old QR stops being the pass's QR, a new one renders", async ({ page, world, evidence }) => {
  const edition = await world.edition("free");
  await createReadyUser(page, "passreplace");
  const request = await registerSelfViaApi(page, edition.slug);
  const passId = request.participants[0].registration!.participant_pass_id!;

  // The participant has no replace action of their own: it is staff-only and the page says where to ask.
  await page.goto(`/cuenta/pases/${passId}`);
  await expect(page.getByTestId("pass-renewing")).toHaveCount(0);
  await expect(page.getByText(/reemplazar/i)).toHaveCount(0);
  await expect(page.getByText("¿Crees que alguien más vio tu código?")).toBeVisible();
  const before = await page.request.post(`/api/v1/me/passes/${passId}/render-qr`);
  expect(before.status()).toBe(200);
  const oldSvg = await before.text();

  const replaced = await world.staff.replaceCredential(passId, "QA E2E: codigo expuesto en una captura");
  expect(replaced, "staff replaces the credential through the admin API").toEqual({ ok: true, refusal: null });

  // The participant's view says the previous QR no longer works and still lets them open the pass.
  await page.reload();
  await expect(page.getByTestId("pass-renewing")).toContainText("Cualquier QR anterior ya no sirve");
  await expect(page.getByText("Código en preparación")).toBeVisible();
  await evidence("pase-credencial-reemplazada");
  const after = await page.request.post(`/api/v1/me/passes/${passId}/render-qr`);
  expect(after.status()).toBe(200);
  const newSvg = await after.text();
  expect(newSvg, "the new credential renders a different QR").not.toBe(oldSvg);

  // Rendering issues the fresh credential: the pass is valid again and the public code did not change.
  await page.reload();
  await expect(page.getByTestId("pass-renewing")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ver código QR" })).toBeVisible();
  await expect(page.getByTestId("pass-public-code")).toHaveText(/^P-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
});

test("Revoked pass is never valid: no QR, the server refuses to render one, the list says so", async ({ page, world, a11y, evidence }) => {
  test.skip(!e2eEnv().localDb, LOCAL_SQL_ONLY);
  const edition = await world.edition("free");
  await createReadyUser(page, "passrevoked");
  const request = await registerSelfViaApi(page, edition.slug);
  const passId = request.participants[0].registration!.participant_pass_id!;
  psql(`update app.participant_pass set status = 'REVOKED' where participant_pass_id = '${passId}'`);

  await page.goto(`/cuenta/pases/${passId}`);
  await expect(page.getByTestId("pass-invalid")).toContainText("ya no es válido");
  await expect(page.getByText("Revocado").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Ver código QR/ })).toHaveCount(0);
  await expect(page.getByAltText(/Código QR/)).toHaveCount(0);
  await a11y();
  await evidence("pase-revocado");

  const refused = await page.request.post(`/api/v1/me/passes/${passId}/render-qr`);
  expect(refused.status()).toBeGreaterThanOrEqual(400);
  expect(refused.headers()["content-type"] ?? "").not.toContain("image/svg+xml");

  await page.goto("/cuenta/pases");
  const row = page.getByTestId("pass-row").first();
  await expect(row).toHaveAttribute("data-pass-state", "REVOKED");
  await expect(row.getByRole("button")).toHaveCount(0);
  await expect(row).toContainText("Revocado");
});

test("Communication preference: nothing is pre-ticked, a choice is saved per purpose and survives a reload", async ({ page, a11y, evidence, consoleErrors }) => {
  await createReadyUser(page, "comms");
  await page.goto("/cuenta/comunicaciones");
  await settleNetwork(page);
  await expect(page.getByRole("heading", { level: 1, name: "Comunicaciones" })).toBeVisible();
  await waitForHydration(page);

  const purposes = ["Recordatorios de carreras", "Novedades de RUNIIS", "Otras comunicaciones opcionales"];
  for (const purpose of purposes) {
    await expect(page.getByRole("checkbox", { name: purpose })).not.toBeChecked();
    await expect(page.getByTestId(/^preference-/).filter({ hasText: purpose })).toContainText("Desactivado");
  }
  await a11y();

  const news = page.getByRole("checkbox", { name: "Novedades de RUNIIS" });
  const saved = page.waitForResponse((response) => response.url().includes("/api/v1/me/communication-preferences") && response.request().method() === "PATCH");
  await news.click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Activaste: Novedades de RUNIIS").first()).toBeVisible();
  await expect(news).toBeChecked();
  await expect(page.getByTestId("preference-general_marketing")).toContainText("Activado");
  // Only the purpose that was chosen changed.
  await expect(page.getByRole("checkbox", { name: "Recordatorios de carreras" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Otras comunicaciones opcionales" })).not.toBeChecked();
  await evidence("comunicaciones-activada");

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Novedades de RUNIIS" })).toBeChecked();
  const stored = await page.request.get("/api/v1/me/communication-preferences");
  expect(stored.status()).toBe(200);
  expect(JSON.stringify(await stored.json())).toContain("GENERAL_MARKETING");

  await waitForHydration(page);
  await page.getByRole("checkbox", { name: "Novedades de RUNIIS" }).click();
  await expect(page.getByText("Desactivaste: Novedades de RUNIIS").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Novedades de RUNIIS" })).not.toBeChecked();
  expect(consoleErrors).toEqual([]);
});
