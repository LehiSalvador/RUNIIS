import { LOCAL_DB_ONLY } from "../support/account";
import { e2eEnv } from "../support/env";
import {
  createFixtureEdition,
  expect,
  expectNoHorizontalScroll,
  futureDate,
  gotoAndSettle,
  postTransition,
  signInAs,
  test,
  uniqueSlug,
} from "./events-support";

/**
 * P3-E1 event management: staff create an Edition, configure it (modalities, prices, capacity), see the server's
 * readiness and publish it; an invalid publish is blocked with every missing item listed; transitions show their
 * preconditions and the server's refusals. Local stack only (seeded staff accounts, Mailpit, local DB).
 */
test.describe.configure({ timeout: 300_000 });
test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);

test.describe("create, configure and publish", () => {
  test("an admin creates an Edition, configures it, and publishes it once the server says it is ready", async ({ page, a11y, shot }, testInfo) => {
    await signInAs(page, "admin");
    const slug = uniqueSlug("e1-flow", testInfo.project.name);
    const editionName = `E1 Flujo ${slug.slice(-8)}`;
    const eventName = `E1 Evento ${slug.slice(-8)}`;

    // ---- list -> new edition form
    await gotoAndSettle(page, "/admin/eventos");
    await page.getByRole("link", { name: "Nueva edición" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Nueva edición" })).toBeAttached();
    await expect(page.getByLabel("Nombre del evento")).toBeHidden();
    await page.locator("#event-choice").selectOption({ label: "Crear un evento nuevo…" });
    await expect(page.getByTestId("new-event-fields")).toBeVisible();

    // client-side validation first: nothing is sent, the first invalid field takes focus
    await page.getByRole("button", { name: "Crear edición como borrador" }).click();
    await expect(page.getByText("Este campo es obligatorio.").first()).toBeVisible();
    await shot("new-edition-validation");
    await a11y();

    await page.getByLabel("Nombre del evento").fill(eventName);
    await page.getByLabel("Nombre de la edición").fill(editionName);
    await page.getByLabel("Enlace público (slug)").fill(slug);
    await page.getByLabel("Ciudad").fill("Monterrey");
    await page.getByRole("textbox", { name: "Estado", exact: true }).fill("Nuevo León");
    await page.getByLabel("Fecha de la carrera").fill(futureDate(75));
    await page.getByLabel("Hora de inicio").fill("06:30");
    await page.getByLabel("Capacidad total de la edición").fill("400");
    await shot("new-edition-filled");
    await page.getByRole("button", { name: "Crear edición como borrador" }).click();

    await expect(page).toHaveURL(/\/admin\/eventos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: editionName })).toBeAttached();
    const editionId = page.url().split("/").pop() as string;
    await expect(page.getByRole("group", { name: "Estado de la edición" })).toContainText("Borrador");

    // ---- blocked publish: the server's own missing items, listed, and a disabled button
    const blocked = page.getByTestId("blocked-publish");
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText("Al menos una modalidad");
    await expect(blocked).toContainText("Descripción mínima");
    await expect(page.getByRole("button", { name: "Publicar edición" })).toBeDisabled();
    await shot("overview-blocked-publish");
    await a11y();

    // the server refuses the same publish on its own (not just a disabled button)
    const refused = await postTransition(page, editionId, "publish");
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("not_ready");

    // ---- configure: modality, price, capacity
    await page.getByRole("navigation", { name: "Secciones de la edición" }).getByRole("link", { name: "Modalidades y precios" }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Modalidades y precios · ${editionName}`) })).toBeAttached();
    await expect(page.getByTestId("modalities-empty")).toBeVisible();
    await expect(page.getByTestId("live-counts").first()).toContainText("Capacidad configurada: 400");

    await page.getByRole("button", { name: "Agregar modalidad" }).first().click();
    const modalityDialog = page.getByRole("dialog", { name: "Agregar modalidad" });
    await modalityDialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("10K");
    await expect(modalityDialog.getByLabel("Clave")).toHaveValue("10k");
    await modalityDialog.getByLabel("Distancia oficial (km)").fill("10");
    await modalityDialog.getByLabel("Capacidad").fill("150");
    await shot("modality-dialog");
    await a11y();
    await modalityDialog.getByRole("button", { name: "Agregar modalidad" }).click();
    const card = page.locator('article[data-modality-key="10k"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText("10 km");
    await expect(card).toContainText("Capacidad configurada: 150");

    await card.getByRole("button", { name: /Agregar precio/ }).click();
    const priceDialog = page.getByRole("dialog", { name: /Agregar precio a 10K/ });
    await priceDialog.getByLabel("Monto (MXN)").fill("350");
    await priceDialog.getByRole("button", { name: "Agregar precio" }).click();
    await expect(card).toContainText("$350.00");

    await page.getByRole("button", { name: "Cambiar capacidad total" }).click();
    const capacityDialog = page.getByRole("dialog", { name: "Capacidad total de la edición" });
    await capacityDialog.getByLabel("Capacidad total de la edición").fill("500");
    await capacityDialog.getByRole("button", { name: "Guardar capacidad" }).click();
    await expect(page.getByTestId("live-counts").first()).toContainText("Capacidad configurada: 500");
    await shot("modalities-configured");
    await a11y();

    // the published description (content blocks have their own screens, P3-E2): through the same API the UI would use
    const description = await page.request.post(`/api/v1/admin/editions/${editionId}/content-blocks`, {
      data: { block_type: "RICH_TEXT", status: "PUBLISHED", payload: { title: "Sobre la carrera", markdown: "Carrera urbana de 10K por las calles del centro de Monterrey." } },
    });
    expect(description.ok()).toBe(true);

    // ---- ready: publish enabled; registration stays blocked by what is still missing (forms, legal)
    await gotoAndSettle(page, `/admin/eventos/${editionId}`);
    await expect(page.getByTestId("blocked-publish")).toHaveCount(0);
    const publish = page.getByRole("button", { name: "Publicar edición" });
    await expect(publish).toBeEnabled();
    await expect(page.getByTestId("blocked-open-registration")).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir inscripciones" })).toBeDisabled();
    await shot("overview-ready-to-publish");

    await publish.click();
    const confirm = page.getByRole("dialog", { name: "Publicar edición" });
    await shot("publish-confirm");
    await confirm.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(page.getByRole("group", { name: "Estado de la edición" })).toContainText("Publicada");
    await expect(page.getByRole("link", { name: /Ver en el sitio/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar edición" })).toHaveCount(0);
    await shot("overview-published");
    await a11y();

    // the new Edition is listed and filterable
    await gotoAndSettle(page, `/admin/eventos?search=${encodeURIComponent(editionName)}`);
    await expect(page.getByRole("table").getByText(editionName).first()).toBeVisible();
  });
});

test.describe("an invalid publish is blocked", () => {
  test("a draft with nothing configured lists every missing item and cannot be published", async ({ page, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { label: "blocked" });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}`);

    const blocked = page.getByTestId("blocked-publish");
    await expect(blocked).toContainText("No se puede todavía. Falta resolver 2 requisitos");
    await expect(blocked.getByRole("listitem")).toHaveText(["Al menos una modalidad", "Descripción mínima"]);
    const publish = page.getByRole("button", { name: "Publicar edición" });
    await expect(publish).toBeDisabled();
    // the server's own checklist agrees with what the action panel lists
    await expect(page.getByText("Pendiente: Al menos una modalidad", { exact: true })).toBeAttached();
    await shot("blocked-publish");

    // the unavailable actions are explained, not offered
    await page.getByText(/Otras acciones que no aplican ahora/).click();
    await expect(page.getByText("Solo se oculta una edición publicada (está Borrador).")).toBeVisible();
    await expect(page.getByText("Publica la edición antes de iniciar la carrera.")).toBeVisible();

    const refusal = await postTransition(page, fixture.editionId, "publish");
    expect(refusal.status).toBe(422);
    expect(JSON.stringify(refusal.json)).toMatch(/MODALITY_PRESENT[\s\S]*DESCRIPTION_PRESENT|DESCRIPTION_PRESENT[\s\S]*MODALITY_PRESENT/);
  });
});

test.describe("edit forms", () => {
  test("saving changes, the unsaved-changes guard and a server conflict on the slug", async ({ page, a11y, shot }, testInfo) => {
    await signInAs(page, "admin");
    const first = await createFixtureEdition(page, testInfo.project.name, { label: "edit" });
    const second = await createFixtureEdition(page, testInfo.project.name, { label: "edit2" });
    await gotoAndSettle(page, `/admin/eventos/${first.editionId}/configuracion`);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Datos y fechas · ${first.name}`) })).toBeAttached();
    await expect(page.getByLabel("Zona horaria de la edición")).toHaveValue("America/Monterrey");
    await expect(page.getByLabel("Fecha de la carrera")).toHaveValue(futureDate());
    await expect(page.getByLabel("Hora de inicio")).toHaveValue("06:30");
    await a11y();
    await shot("configuracion");

    // nothing changed: nothing to save
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();

    // a change, then trying to leave: the guard asks first
    await page.getByLabel("Ciudad").fill("San Pedro Garza García");
    await expect(page.getByText(/Sin guardar: Ciudad/)).toBeVisible();
    await page.getByRole("link", { name: "Volver a la edición" }).click();
    const guard = page.getByRole("dialog", { name: "Hay cambios sin guardar" });
    await expect(guard).toBeVisible();
    await shot("unsaved-guard");
    await guard.getByRole("button", { name: "Seguir editando" }).click();
    await expect(page).toHaveURL(new RegExp(`${first.editionId}/configuracion$`));
    await expect(page.getByLabel("Ciudad")).toHaveValue("San Pedro Garza García");

    // the server refuses a slug that belongs to another Edition, in plain language with a support reference
    await page.getByLabel("Enlace público (slug)").fill(second.slug);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    const refusal = page.getByTestId("refusal-notice");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("Ya existe");
    await expect(refusal.getByTestId("error-reference")).toContainText("Referencia:");
    await expect(refusal).not.toContainText("23505");
    await shot("slug-conflict");
    await a11y();

    // fix it and save: the baseline moves only after the server confirmed
    await page.getByLabel("Enlace público (slug)").fill(first.slug);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Ciudad")).toHaveValue("San Pedro Garza García");

    // leaving with nothing pending does not trigger the guard
    await page.getByRole("link", { name: "Volver a la edición" }).click();
    await expect(page).toHaveURL(new RegExp(`${first.editionId}$`));
    await expect(page.getByRole("dialog", { name: "Hay cambios sin guardar" })).toHaveCount(0);
  });
});

test.describe("state transitions", () => {
  test("postpone, reschedule and cancel show their preconditions, ask for a reason and apply only when the server confirms", async ({ page, a11y, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { published: true, label: "life" });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}`);
    const states = page.getByRole("group", { name: "Estado de la edición" });
    await expect(states).toContainText("Publicada");
    await expect(states).toContainText("Programada");

    // preconditions are visible before pressing anything
    const postponeRow = page.locator('[data-transition="postpone"]');
    await expect(postponeRow).toContainText("Requiere ejecución Programada");

    // postpone: the reason is required (nothing is sent without it)
    await postponeRow.getByRole("button", { name: "Aplazar carrera" }).click();
    const postpone = page.getByRole("dialog", { name: "Aplazar carrera" });
    await expect(postpone).toContainText("La carrera queda sin fecha");
    await postpone.getByRole("button", { name: "Aplazar", exact: true }).click();
    await expect(postpone.getByText("Indica el motivo (mínimo 3 caracteres).")).toBeVisible();
    await shot("postpone-needs-reason");
    await postpone.getByLabel("Motivo").fill("Clima adverso en la fecha original");
    await postpone.getByLabel("Inscripciones mientras no haya nueva fecha").selectOption("PAUSE");
    await postpone.getByRole("button", { name: "Aplazar", exact: true }).click();
    await expect(states).toContainText("Aplazada");
    await a11y();

    // reschedule from POSTPONED back to a dated race
    await page.locator('[data-transition="reschedule"]').getByRole("button", { name: "Reprogramar fecha" }).click();
    const reschedule = page.getByRole("dialog", { name: "Reprogramar fecha" });
    await reschedule.getByLabel("Motivo").fill("Nueva fecha confirmada con el municipio");
    await reschedule.getByLabel("Nueva fecha").fill(futureDate(120));
    await reschedule.getByLabel("Hora de inicio").fill("07:00");
    await shot("reschedule-dialog");
    await reschedule.getByRole("button", { name: "Reprogramar", exact: true }).click();
    await expect(states).toContainText("Programada");
    await expect(page.getByText("07:00").first()).toBeVisible();

    // stale screen: another operator hides the edition while this tab still offers "Ocultar"
    const hide = await postTransition(page, fixture.editionId, "hide", { reason: "Ocultada por otra persona" });
    expect(hide.status).toBe(200);
    await page.locator('[data-transition="hide"]').getByRole("button", { name: "Ocultar edición" }).click();
    const hideDialog = page.getByRole("dialog", { name: "Ocultar edición" });
    await hideDialog.getByLabel("Motivo").fill("Segundo intento");
    await hideDialog.getByRole("button", { name: "Ocultar edición" }).click();
    const refusal = hideDialog.getByTestId("refusal-notice");
    await expect(refusal).toContainText("La acción ya no aplica");
    await expect(refusal.getByRole("button", { name: "Actualizar datos" })).toBeVisible();
    await shot("stale-transition-refused");
    await hideDialog.getByRole("button", { name: "Cancelar" }).click();

    // cancel: terminal, with the consequence spelled out
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}`);
    await expect(states).toContainText("Oculta");
    await page.locator('[data-transition="cancel"]').getByRole("button", { name: "Cancelar edición" }).click();
    const cancel = page.getByRole("dialog", { name: "Cancelar edición" });
    await expect(cancel).toContainText("No se procesa ningún reembolso desde aquí");
    await cancel.getByLabel("Motivo").fill("Cancelada por causa mayor");
    await cancel.getByRole("button", { name: "Cancelar edición" }).click();
    await expect(states).toContainText("Cancelada");
    await expect(page.locator('[data-transition="cancel"]')).toHaveCount(0);
    await shot("canceled");
  });
});

test.describe("modalities, prices, capacity and categories", () => {
  test("edits, the capacity acknowledgement and category creation go through the APIs and show the server's answer", async ({ page, a11y, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "modal" });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/modalidades`);
    const card = page.locator('article[data-modality-key="10k"]');
    await expect(card).toContainText("$250.00");
    await expect(card).toContainText("Capacidad configurada: 100");
    await expect(card).toContainText("Confirmados 0");
    await a11y();
    await shot("modalidades-with-data");

    // a price of 0 is an explicit free offer
    await card.getByRole("button", { name: /Agregar precio/ }).click();
    const free = page.getByRole("dialog", { name: /Agregar precio a 10K/ });
    await free.getByLabel("Nombre del precio").fill("Cortesía");
    await free.getByLabel("Monto (MXN)").fill("0");
    await free.getByRole("button", { name: "Agregar precio" }).click();
    await expect(card).toContainText("Gratis");

    // a bad amount never leaves the browser
    await card.getByRole("button", { name: /Agregar precio/ }).click();
    const bad = page.getByRole("dialog", { name: /Agregar precio a 10K/ });
    await bad.getByLabel("Monto (MXN)").fill("12.345");
    await bad.getByRole("button", { name: "Agregar precio" }).click();
    await expect(bad.getByText(/Monto en pesos/)).toBeVisible();
    await bad.getByRole("button", { name: "Cancelar" }).click();

    // capacity: lowering it is a configuration change, shown with the live counts from the server
    await card.getByRole("button", { name: /Capacidad/ }).click();
    const capacity = page.getByRole("dialog", { name: "Capacidad de 10K" });
    await capacity.getByLabel("Capacidad de 10K").fill("80");
    await capacity.getByRole("button", { name: "Guardar capacidad" }).click();
    await expect(card).toContainText("Capacidad configurada: 80");

    // an edit that the server refuses stays open with the reason (distance required once registrations are open is a server rule;
    // here: a duplicate key)
    await page.getByRole("button", { name: "Agregar modalidad" }).first().click();
    const dup = page.getByRole("dialog", { name: "Agregar modalidad" });
    await dup.getByRole("textbox", { name: "Nombre", exact: true }).fill("Otra 10K");
    await dup.getByLabel("Clave").fill("10k");
    await dup.getByRole("button", { name: "Agregar modalidad" }).click();
    await expect(dup.getByTestId("refusal-notice")).toContainText("Ya existe");
    await shot("duplicate-modality-key");
    await dup.getByRole("button", { name: "Cancelar" }).click();

    // categories
    await page.getByRole("button", { name: "Agregar categoría" }).click();
    const category = page.getByRole("dialog", { name: "Agregar categoría" });
    await category.getByRole("textbox", { name: "Nombre", exact: true }).fill("Master 40+");
    await category.getByLabel("Edad mínima").fill("40");
    await category.getByLabel("10K").check();
    await category.getByRole("button", { name: "Agregar categoría" }).click();
    const row = page.locator('[data-category-key="master-40"]');
    await expect(row).toContainText("40 años o más");
    await expect(row).toContainText("Modalidades: 10K");
    await shot("category-added");

    // close the modality: the card says so and the status control changes
    await card.getByRole("button", { name: /^Cerrar/ }).click();
    const closeDialog = page.getByRole("dialog", { name: /Cerrar modalidad: 10K/ });
    await closeDialog.getByRole("button", { name: "Cerrar modalidad" }).click();
    await expect(card).toContainText("Cerrada");
    await expect(card.getByRole("button", { name: /^Reactivar/ })).toBeVisible();

    // a draft modality can be deleted; the server decides
    await card.getByRole("button", { name: /^Eliminar/ }).click();
    const del = page.getByRole("dialog", { name: "Eliminar 10K" });
    await del.getByRole("button", { name: "Eliminar modalidad" }).click();
    await expect(page.getByTestId("modalities-empty")).toBeVisible();
  });
});

test.describe("roles", () => {
  test("an operator configures but cannot create or change the lifecycle", async ({ page, a11y, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "oper" });
    await signInAs(page, "operator");

    await gotoAndSettle(page, "/admin/eventos");
    await expect(page.getByRole("link", { name: "Nueva edición" })).toHaveCount(0);
    await gotoAndSettle(page, "/admin/eventos/nuevo");
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();

    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}`);
    await expect(page.getByText("Solo un administrador puede cambiar el estado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar edición" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Aplazar carrera" })).toBeDisabled();
    await shot("operator-overview");

    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/configuracion`);
    await expect(page.getByLabel("Modo de inscripción")).toBeDisabled();
    await expect(page.getByLabel("Cierre de inscripciones")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Renombrar evento" })).toHaveCount(0);
    await page.getByLabel("Ciudad").fill("Guadalupe");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados.")).toBeVisible();
    await a11y();

    // the API refuses the lifecycle for the operator on its own
    const refused = await postTransition(page, fixture.editionId, "publish");
    expect(refused.status).toBe(403);

    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/modalidades`);
    await expect(page.locator('article[data-modality-key="10k"]')).toBeVisible();
  });
});

test.describe("layout", () => {
  test("every event screen fits the viewport without sideways scrolling", async ({ page }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "fit" });
    for (const path of ["/admin/eventos", "/admin/eventos/nuevo", `/admin/eventos/${fixture.editionId}`, `/admin/eventos/${fixture.editionId}/configuracion`, `/admin/eventos/${fixture.editionId}/modalidades`]) {
      await gotoAndSettle(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
      await expectNoHorizontalScroll(page);
    }
  });
});
