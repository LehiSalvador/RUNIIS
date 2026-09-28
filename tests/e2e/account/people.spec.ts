import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { birthDateForAge, createReadyUser } from "../support/account";
import { expect, gotoAndSettle, test, unexpectedConsoleErrors } from "./support";

test.describe.configure({ timeout: 180_000 });

async function secondUser(browser: Browser, baseURL: string | undefined, label: string, dob?: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const user = await createReadyUser(page, label, dob ? { date_of_birth: dob } : undefined);
  return { context, page, user };
}

async function befriend(requester: Page, requesterName: string, addressee: Page, addresseeName: string) {
  await gotoAndSettle(requester, "/cuenta/amigos?tab=buscar");
  await requester.getByLabel("Buscar por nombre").fill(addresseeName);
  const row = requester.getByTestId("search-row").filter({ hasText: addresseeName });
  await row.getByRole("button", { name: /^Agregar/ }).click();
  await expect(row.getByRole("button", { name: "Solicitud enviada" })).toBeDisabled();

  await gotoAndSettle(addressee, "/cuenta/amigos");
  const incoming = addressee.getByTestId("incoming-row").filter({ hasText: requesterName });
  await incoming.getByRole("button", { name: /^Aceptar/ }).click();
  await expect(addressee.getByText(`Ahora eres amistad de ${requesterName}`).first()).toBeVisible();
}

test("friends: search with debounce, request, accept, remove", async ({ page, browser, baseURL, a11y, evidence, consoleErrors }) => {
  const tag = randomUUID().slice(0, 6);
  const a = await createReadyUser(page, "fa", { full_name: `Alba Amiga ${tag}` });
  const b = await secondUser(browser, baseURL, "fb");
  const bName = b.user.name;

  await gotoAndSettle(page, "/cuenta/amigos");
  await expect(page.getByRole("heading", { name: "Todavía no tienes amistades" })).toBeVisible();
  await page.getByRole("tab", { name: "Buscar personas" }).click();
  await page.getByLabel("Buscar por nombre").fill("z");
  await expect(page.getByTestId("search-row")).toHaveCount(0);
  await page.getByLabel("Buscar por nombre").fill(`sin-coincidencias-${tag}`);
  await expect(page.getByRole("heading", { name: "No encontramos a nadie con ese nombre" })).toBeVisible();
  await a11y();

  await befriend(page, a.name, b.page, bName);
  await evidence("amigos-busqueda");

  await b.page.getByRole("tab", { name: /^Amigos/ }).click();
  await expect(b.page.getByTestId("friend-row").filter({ hasText: a.name })).toBeVisible();
  await gotoAndSettle(page, "/cuenta/amigos");
  const friendRow = page.getByTestId("friend-row").filter({ hasText: bName });
  await expect(friendRow).toBeVisible();
  await evidence("amigos-lista");

  await friendRow.getByRole("button", { name: /^Eliminar/ }).click();
  await expect(page.getByRole("dialog", { name: "¿Eliminar esta amistad?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(friendRow.getByRole("button", { name: /^Eliminar/ })).toBeFocused();
  await friendRow.getByRole("button", { name: /^Eliminar/ }).click();
  await page.getByRole("button", { name: "Eliminar amistad" }).click();
  await expect(page.getByText("Amistad eliminada").first()).toBeVisible();
  await expect(page.getByTestId("friend-row")).toHaveCount(0);

  await b.context.close();
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

test("guests: create, validate, edit, archive, reactivate; minor guest gets a guardian", async ({ page, a11y, evidence, consoleErrors }) => {
  await createReadyUser(page, "guests");
  await gotoAndSettle(page, "/cuenta/invitados");
  await expect(page.getByRole("heading", { name: "Aún no tienes invitados" })).toBeVisible();

  await page.getByRole("button", { name: "Agregar invitado" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Agregar invitado" });
  await dialog.getByRole("button", { name: "Agregar invitado" }).click();
  await expect(dialog.getByText("Revisa los datos marcados.")).toBeVisible();
  await expect(dialog.locator("#guest-full_name")).toBeFocused();
  await dialog.locator("#guest-full_name").fill("Invitado Adulto");
  await dialog.locator("#guest-date_of_birth").fill("05/05/1990");
  await dialog.getByRole("radio", { name: "Hombre" }).check();
  await dialog.locator("#guest-phone_e164").fill("8111112222");
  await dialog.locator("#guest-emergency_contact_name").fill("Contacto Uno");
  await dialog.locator("#guest-emergency_contact_phone_e164").fill("8133334444");
  await dialog.locator("#guest-emergency_contact_relationship").fill("Hermana o hermano");
  await a11y();
  await dialog.getByRole("button", { name: "Agregar invitado" }).click();
  await expect(page.getByText("Agregamos a Invitado Adulto").first()).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // Minor guest (16): admitted with the guardian notice; under 15 rejected client-side.
  await page.getByRole("button", { name: "Agregar invitado" }).first().click();
  const [y, m, d] = birthDateForAge(16).split("-");
  await dialog.locator("#guest-full_name").fill("Invitada Menor");
  await dialog.locator("#guest-date_of_birth").fill(`${d}/${m}/${y}`);
  await expect(dialog.getByText("Invitado menor de edad")).toBeVisible();
  await dialog.getByRole("radio", { name: "Mujer" }).check();
  await dialog.locator("#guest-phone_e164").fill("8111113333");
  await dialog.locator("#guest-emergency_contact_name").fill("Contacto Dos");
  await dialog.locator("#guest-emergency_contact_phone_e164").fill("8133335555");
  await dialog.locator("#guest-emergency_contact_relationship").fill("Madre");
  await dialog.getByRole("button", { name: "Agregar invitado" }).click();
  await expect(page.getByText("Agregamos a Invitada Menor").first()).toBeVisible();
  const minorRow = page.getByTestId("guest-row").filter({ hasText: "Invitada Menor" });
  await expect(minorRow.getByText("Menor sin adulto responsable")).toBeVisible();
  await evidence("invitados");

  // Edit phone.
  const adultRow = page.getByTestId("guest-row").filter({ hasText: "Invitado Adulto" });
  await adultRow.getByRole("button", { name: /^Editar/ }).click();
  const edit = page.getByRole("dialog", { name: "Editar a Invitado Adulto" });
  await edit.locator("#guest-phone_e164").fill("8199990000");
  await edit.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados").first()).toBeVisible();
  await expect(adultRow.getByText("+52 81 9999 0000")).toBeVisible();

  // Archive -> archived tab -> reactivate.
  await adultRow.getByRole("button", { name: /^Archivar/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archivar" }).click();
  await expect(page.getByText("Archivamos a Invitado Adulto").first()).toBeVisible();
  await page.getByRole("tab", { name: "Archivados" }).click();
  const archivedRow = page.getByTestId("guest-row").filter({ hasText: "Invitado Adulto" });
  await archivedRow.getByRole("button", { name: /^Reactivar/ }).click();
  await expect(page.getByText("Reactivamos a Invitado Adulto").first()).toBeVisible();

  // Guardian for the minor guest: the owner becomes guardian, ACTIVE at once.
  await gotoAndSettle(page, "/cuenta/menores");
  await page.getByRole("button", { name: "Nueva vinculación" }).click();
  const link = page.getByRole("dialog", { name: "Nueva vinculación" });
  await link.getByRole("combobox", { name: /Invitado menor/ }).click();
  await page.getByRole("option", { name: "Invitada Menor" }).click();
  await link.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByText("Vinculación activa").first()).toBeVisible();
  const guardianRow = page.getByTestId("guardian-row").filter({ hasText: "Invitada Menor" });
  await expect(guardianRow.getByText("Activa")).toBeVisible();
  await a11y();
  await evidence("menores");

  await gotoAndSettle(page, "/cuenta/invitados");
  await expect(page.getByTestId("guest-row").filter({ hasText: "Invitada Menor" }).getByText("Menor con adulto responsable")).toBeVisible();
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

test("guardian between accounts: a 16-year-old links an adult friend, both confirm", async ({ page, browser, baseURL, evidence }) => {
  const minor = await createReadyUser(page, "gm", { date_of_birth: birthDateForAge(16) });
  const adult = await secondUser(browser, baseURL, "ga");

  // The minor is not searchable, so the minor finds the adult and sends the friend request.
  await befriend(page, minor.name, adult.page, adult.user.name);

  await gotoAndSettle(page, "/cuenta/menores");
  await page.getByRole("button", { name: "Nueva vinculación" }).click();
  const link = page.getByRole("dialog", { name: "Nueva vinculación" });
  await link.getByRole("combobox", { name: /Tu adulto responsable/ }).click();
  await page.getByRole("option", { name: adult.user.name }).click();
  await link.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByText("Solicitud de vinculación enviada").first()).toBeVisible();
  await expect(page.getByTestId("guardian-row").getByText("Esperando a la otra persona")).toBeVisible();

  await gotoAndSettle(adult.page, "/cuenta/menores");
  const pending = adult.page.getByTestId("guardian-row").filter({ hasText: minor.name });
  await expect(pending.getByText("Falta tu confirmación")).toBeVisible();
  await pending.getByRole("button", { name: "Confirmar" }).click();
  await expect(adult.page.getByText("Vinculación confirmada").first()).toBeVisible();

  await gotoAndSettle(page, "/cuenta/menores");
  await expect(page.getByTestId("guardian-row").filter({ hasText: adult.user.name }).getByText("Activa")).toBeVisible();
  await evidence("menores-cuentas");
  await adult.context.close();
});
