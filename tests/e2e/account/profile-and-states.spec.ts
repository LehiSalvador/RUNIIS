import { createReadyUser, setAccountState } from "../support/account";
import { expect, gotoAndSettle, test, unexpectedConsoleErrors } from "./support";

test.describe.configure({ timeout: 120_000 });

test("perfil: identity is read-only, phone and emergency fields are editable", async ({ page, a11y, evidence, consoleErrors }) => {
  const user = await createReadyUser(page, "perfil");
  await gotoAndSettle(page, "/cuenta/perfil");

  await expect(page.getByRole("heading", { level: 1, name: "Perfil" })).toBeAttached();
  await expect(page.getByText(user.name).first()).toBeVisible();
  // Forbidden fields are not inputs at all (Master §160 allowlist).
  await expect(page.locator("#profile-full_name")).toHaveCount(0);
  await expect(page.locator("#profile-date_of_birth")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Mujer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  await a11y();
  await evidence("perfil");

  await page.locator("#profile-phone_e164").fill("12");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator("#profile-phone_e164")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#profile-phone_e164")).toBeFocused();

  await page.locator("#profile-phone_e164").fill("81 5555 0101");
  await page.locator("#profile-emergency_contact_relationship").fill("Pareja");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Datos actualizados").first()).toBeVisible();

  await page.reload();
  await expect(page.locator("#profile-phone_e164")).toHaveValue("+52 81 5555 0101");
  await expect(page.locator("#profile-emergency_contact_relationship")).toHaveValue("Pareja");
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

test("identity-locked and banned accounts see a restricted state with a support path", async ({ page, a11y, evidence }) => {
  const user = await createReadyUser(page, "locked");

  setAccountState(user.runnerProfileId, "IDENTITY_LOCKED");
  await gotoAndSettle(page, "/cuenta/amigos");
  await expect(page.getByTestId("restricted-account")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu cuenta está en revisión" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contactar a soporte" })).toHaveAttribute("href", "/contacto");
  await expect(page.getByLabel("Buscar por nombre")).toHaveCount(0);
  await a11y();
  await evidence("estado-bloqueado");

  setAccountState(user.runnerProfileId, "BANNED");
  await gotoAndSettle(page, "/cuenta");
  await expect(page.getByRole("heading", { name: "Esta cuenta no puede realizar acciones" })).toBeVisible();
  // The server refuses mutations regardless of the UI.
  const patch = await page.request.patch("/api/v1/me/profile", { data: { phone_e164: "+528110009999" } });
  expect(patch.status()).toBe(403);
  await evidence("estado-baneado");

  setAccountState(user.runnerProfileId, "ACTIVE");
});

test("sign out revokes the session server-side", async ({ page }) => {
  await createReadyUser(page, "signout");
  await gotoAndSettle(page, "/cuenta");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/cuenta/pases");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fcuenta%2Fpases$/);
  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(401);
});
