import { birthDateForAge, fetchOtpCode, resetAuthIpBuckets, uniqueEmail } from "../support/account";
import { expect, gotoAndSettle, test, unexpectedConsoleErrors } from "./support";

test.describe.configure({ timeout: 120_000 });

function toDisplay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

async function requestCode(page: import("@playwright/test").Page, email: string) {
  resetAuthIpBuckets();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByRole("status").filter({ hasText: email })).toBeVisible({ timeout: 30_000 });
}

async function fillOnboarding(page: import("@playwright/test").Page, name: string, dobIso: string) {
  await page.locator("#onboarding-full_name").fill(name);
  await page.locator("#onboarding-date_of_birth").fill(toDisplay(dobIso));
  await page.getByRole("radio", { name: "Mujer" }).check();
  await page.locator("#onboarding-phone_e164").fill("81 1234 5678");
  await page.locator("#onboarding-emergency_contact_name").fill("Contacto Sintético");
  await page.locator("#onboarding-emergency_contact_phone_e164").fill("8187654321");
  await page.locator("#onboarding-emergency_contact_relationship").fill("Madre");
  const legal = page.locator("#onboarding-legal");
  if (await legal.count()) await legal.check();
}

test("guards: a signed-out visitor is sent to /entrar with a safe return path", async ({ page, a11y, evidence }) => {
  await page.goto("/cuenta/amigos");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fcuenta%2Famigos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Entra a RUNIIS" })).toBeVisible();
  await expect(page.getByText("Inicia sesión para continuar")).toBeVisible();
  // Google is disabled in local Docker: the button is shown but disabled with honest copy.
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeDisabled();
  await evidence("entrar");
  await a11y();

  // The robots meta keeps sign-in out of search engines.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("OTP sign-in: invalid email, wrong code, resend cooldown, then adult onboarding", async ({ page, a11y, evidence, consoleErrors }) => {
  const email = uniqueEmail("signin");
  await gotoAndSettle(page, "/entrar?next=%2Fcuenta%2Fpases");

  await page.getByLabel("Correo electrónico").fill("no-es-correo");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByText("Escribe un correo válido")).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeFocused();

  await requestCode(page, email);
  await expect(page.getByLabel("Código de 6 dígitos")).toBeFocused();
  await expect(page.getByText("Podrás pedir otro código en")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reenviar código" })).toHaveCount(0);
  await evidence("entrar-codigo");

  const code = await fetchOtpCode(email);
  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByLabel("Código de 6 dígitos").fill(wrong);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("El código no es correcto o ya expiró")).toBeVisible();
  await expect(page.getByLabel("Código de 6 dígitos")).toHaveValue("");

  await page.getByLabel("Código de 6 dígitos").fill(code);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fcuenta%2Fpases/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "Completa tu perfil" })).toBeVisible();
  await a11y();

  // Empty submit: every field is flagged and focus lands on the first one.
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page.getByText("Revisa los datos marcados.")).toBeVisible();
  await expect(page.getByLabel("Nombre completo")).toBeFocused();
  await expect(page.getByLabel("Nombre completo")).toHaveAttribute("aria-invalid", "true");
  await evidence("onboarding-errores");

  await fillOnboarding(page, `Adulta Prueba ${Date.now()}`, "1991-03-14");
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page).toHaveURL(/\/cuenta\/pases$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pases" })).toBeAttached();

  // Resumable/one-shot: a READY profile never sees onboarding again.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/cuenta$/);
  expect(unexpectedConsoleErrors(consoleErrors, [400])).toEqual([]);
});

test("onboarding: 15-17 is admitted as a minor, under 15 is stopped", async ({ page, evidence }) => {
  const email = uniqueEmail("minor");
  await gotoAndSettle(page, "/entrar");
  await requestCode(page, email);
  await page.getByLabel("Código de 6 dígitos").fill(await fetchOtpCode(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.waitForLoadState("networkidle");

  await page.locator("#onboarding-date_of_birth").fill(toDisplay(birthDateForAge(12)));
  await expect(page.getByText("RUNIIS requiere tener al menos 15 años")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar y continuar" })).toHaveCount(0);
  await expect(page.locator("#onboarding-phone_e164")).toHaveCount(0);
  await evidence("onboarding-menor-15");

  await fillOnboarding(page, `Menor Prueba ${Date.now()}`, birthDateForAge(16));
  await expect(page.getByText("Tu perfil será de corredor menor de edad")).toBeVisible();
  await evidence("onboarding-menor");
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByText("Tienes un perfil de corredor menor de edad")).toBeVisible();
});
