import { LOCAL_DB_ONLY } from "../support/account";
import { e2eEnv } from "../support/env";
import {
  createEditionToConfigure,
  createEventWithoutEditions,
  ensureLegalPublished,
  expect,
  expectNoHorizontalScroll,
  futureDate,
  gotoAndSettle,
  postTransition,
  signInAs,
  test,
} from "./config-support";

/**
 * P3-E2 edition content and configuration: staff configure the registration form, locations, agenda and content of an Edition, then
 * open registration, start and finish it through the UI; schedule revisions, the Events catalogue and the stale-state refusals
 * (P3-L) are exercised against the real APIs. Local stack only (seeded staff accounts, Mailpit, local DB).
 */
test.describe.configure({ timeout: 420_000 });
test.use({ actionTimeout: 30_000 });
test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);

test.describe("configure an Edition end to end", () => {
  test("forms, locations, agenda and content are configured in the UI, then registration opens and the race starts and finishes", async ({ page, axe, shot }, testInfo) => {
    await signInAs(page, "admin");
    await ensureLegalPublished(page);
    const fixture = await createEditionToConfigure(page, testInfo.project.name, "journey");
    const base = `/admin/eventos/${fixture.editionId}`;

    // ---- the overview says what is still missing, and where each missing thing is resolved
    await gotoAndSettle(page, base);
    const summary = page.getByTestId("config-summary");
    await expect(summary).toBeVisible();
    await expect(summary.locator('[data-summary-key="formularios"]')).toContainText("Falta un formulario publicado");
    await expect(summary.locator('[data-summary-key="contenido"]')).toContainText("Falta una descripción publicada");
    await expect(summary.locator('[data-summary-key="configuracion"]')).toContainText("Falta el número de WhatsApp");
    await expect(page.getByTestId("blocked-publish")).toContainText("Descripción mínima");
    await expect(page.getByTestId("blocked-publish").getByRole("link", { name: /Resolver en Contenido/ })).toBeVisible();
    await shot("overview-before-configuration");
    await axe("overview-before-configuration");

    // ---- WhatsApp number through the Edition form (sends expected_updated_at)
    await page.getByRole("link", { name: "Datos y fechas" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Datos y fechas · ${fixture.name}`) })).toBeAttached();
    await expect(page.getByRole("region", { name: "Evento", exact: true })).toBeVisible();
    await page.getByLabel("WhatsApp de la edición").fill("+528110814941");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados.")).toBeVisible();

    // ---- content: the description (a published text of 30+ characters)
    await page.getByRole("navigation", { name: "Secciones de la edición" }).getByRole("link", { name: "Contenido" }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Contenido · ${fixture.name}`) })).toBeAttached();
    await expect(page.getByTestId("description-note")).toContainText("Falta la descripción mínima");
    await expect(page.getByTestId("content-empty")).toBeVisible();
    await expect(page.getByTestId("media-note")).toContainText("no existe una función de carga");
    await shot("content-empty");
    await axe("content-empty");

    await page.getByRole("button", { name: "Agregar bloque" }).first().click();
    const textDialog = page.getByRole("dialog", { name: "Agregar bloque de contenido" });
    await shot("content-dialog");
    await axe("content-dialog-text");
    // client validation first: nothing is sent; HTML is refused with the reason
    await textDialog.getByRole("button", { name: "Agregar bloque" }).click();
    await expect(textDialog.getByText("Este campo es obligatorio.")).toBeVisible();
    await textDialog.getByLabel("Texto (Markdown)").fill("<b>negritas</b> en HTML");
    await textDialog.getByRole("button", { name: "Agregar bloque" }).click();
    await expect(textDialog.getByText("No se permite HTML")).toBeVisible();
    await textDialog.getByLabel("Título (opcional)").fill("Sobre la carrera");
    await textDialog.getByLabel("Texto (Markdown)").fill("Carrera urbana de 10K por las calles del centro de Monterrey, para toda la familia.");
    await textDialog.getByLabel("Estado").selectOption("PUBLISHED");
    await textDialog.getByRole("button", { name: "Agregar bloque" }).click();
    await expect(page.getByTestId("description-note")).toContainText("La descripción mínima ya está publicada");
    const block = page.locator('[data-block-type="RICH_TEXT"]');
    await expect(block).toContainText("Publicado");

    // an FAQ block and a link block, then archive and delete one
    await page.getByRole("button", { name: "Agregar bloque" }).first().click();
    const faqDialog = page.getByRole("dialog", { name: "Agregar bloque de contenido" });
    await faqDialog.getByLabel("Tipo de bloque").selectOption("FAQ");
    await faqDialog.getByLabel(/^Pregunta 1/).fill("¿Hay regaderas en la meta?");
    await faqDialog.getByLabel("Respuesta 1 (Markdown)").fill("Sí, junto a la zona de hidratación.");
    await axe("content-dialog-faq");
    await faqDialog.getByRole("button", { name: "Agregar bloque" }).click();
    await expect(page.locator('[data-block-type="FAQ"]')).toContainText("1 pregunta");

    await page.getByRole("button", { name: "Agregar bloque" }).first().click();
    const linkDialog = page.getByRole("dialog", { name: "Agregar bloque de contenido" });
    await linkDialog.getByLabel("Tipo de bloque").selectOption("DOCUMENT_LINK");
    await linkDialog.getByLabel("Etiqueta del enlace").fill("Reglamento");
    await linkDialog.getByLabel("Dirección (URL)").fill("http://inseguro.example/reglamento");
    await linkDialog.getByRole("button", { name: "Agregar bloque" }).click();
    await expect(linkDialog.getByText(/https, mailto, tel/)).toBeVisible();
    await linkDialog.getByLabel("Dirección (URL)").fill("https://runiis.example/reglamento.pdf");
    await linkDialog.getByRole("button", { name: "Agregar bloque" }).click();
    await expect(page.locator('[data-block-type="DOCUMENT_LINK"]')).toContainText("Reglamento");

    await page.locator('[data-block-type="DOCUMENT_LINK"]').getByRole("button", { name: /^Publicar/ }).click();
    await expect(page.locator('[data-block-type="DOCUMENT_LINK"]')).toContainText("Publicado");
    await page.locator('[data-block-type="DOCUMENT_LINK"]').getByRole("button", { name: /^Archivar/ }).click();
    await expect(page.locator('[data-block-type="DOCUMENT_LINK"]')).toContainText("Archivado");
    await page.locator('[data-block-type="DOCUMENT_LINK"]').getByRole("button", { name: /^Eliminar/ }).click();
    await page.getByRole("dialog", { name: "Eliminar el bloque" }).getByRole("button", { name: "Eliminar bloque" }).click();
    await expect(page.locator('[data-block-type="DOCUMENT_LINK"]')).toHaveCount(0);
    await shot("content-configured");
    await axe("content-configured");

    // ---- locations
    await page.getByRole("navigation", { name: "Secciones de la edición" }).getByRole("link", { name: "Ubicaciones" }).click();
    await expect(page.getByTestId("locations-empty")).toBeVisible();
    await shot("locations-empty");
    await axe("locations-empty");
    await page.getByRole("button", { name: "Agregar ubicación" }).first().click();
    const locationDialog = page.getByRole("dialog", { name: "Agregar ubicación" });
    await expect(locationDialog.getByLabel("Ciudad")).toHaveValue("Monterrey");
    await expect(locationDialog.getByLabel("Ubicación principal")).toBeChecked();
    await axe("location-dialog");
    await locationDialog.getByRole("button", { name: "Agregar ubicación" }).click();
    await expect(locationDialog.getByText("Este campo es obligatorio.")).toBeVisible();
    await locationDialog.getByLabel("Nombre del lugar").fill("Parque Fundidora");
    await locationDialog.locator("#location-type").selectOption("START");
    await locationDialog.getByLabel("Dirección").fill("Av. Fundidora 501");
    await locationDialog.getByLabel("Latitud").fill("25.6781");
    await locationDialog.getByRole("button", { name: "Agregar ubicación" }).click();
    await expect(locationDialog.getByText("Indica latitud y longitud juntas")).toBeVisible();
    await locationDialog.getByLabel("Longitud").fill("-100.2844");
    await locationDialog.getByRole("button", { name: "Agregar ubicación" }).click();
    const fundidora = page.locator('[data-location-name="Parque Fundidora"]');
    await expect(fundidora).toContainText("Principal");
    await expect(fundidora).toContainText("Salida");
    await expect(fundidora).toContainText("25.67810, -100.28440");

    await page.getByRole("button", { name: "Agregar ubicación" }).first().click();
    const second = page.getByRole("dialog", { name: "Agregar ubicación" });
    await second.getByLabel("Nombre del lugar").fill("Plaza de entrega de kits");
    await second.locator("#location-type").selectOption("KIT_PICKUP");
    await second.getByLabel("Ubicación principal").check();
    await second.getByRole("button", { name: "Agregar ubicación" }).click();
    // only one is primary: the previous one lost the mark
    await expect(page.locator('[data-location-name="Plaza de entrega de kits"]')).toContainText("Principal");
    await expect(fundidora).not.toContainText("Principal");

    // edit: the primary place moves back; a saved value cannot be emptied (and the way out is said)
    await fundidora.getByRole("button", { name: /^Editar/ }).click();
    const edit = page.getByRole("dialog", { name: "Editar Parque Fundidora" });
    await edit.getByLabel("Dirección").fill("");
    await edit.getByRole("button", { name: "Guardar ubicación" }).click();
    await expect(edit.getByText(/no se puede dejar vacío/)).toBeVisible();
    await edit.getByLabel("Dirección").fill("Av. Fundidora 501, Col. Obrera");
    await edit.getByLabel("Ubicación principal").check();
    await edit.getByRole("button", { name: "Guardar ubicación" }).click();
    await expect(page.locator('[data-location-name="Parque Fundidora"]')).toContainText("Col. Obrera");
    await expect(page.locator('[data-location-name="Parque Fundidora"]')).toContainText("Principal");
    await shot("locations-configured");
    await axe("locations-configured");

    // ---- agenda
    await page.getByRole("navigation", { name: "Secciones de la edición" }).getByRole("link", { name: "Agenda" }).click();
    await expect(page.getByTestId("agenda-empty")).toBeVisible();
    await axe("agenda-empty");
    await page.getByRole("button", { name: "Agregar entrada" }).first().click();
    const agendaDialog = page.getByRole("dialog", { name: "Agregar entrada a la agenda" });
    await expect(agendaDialog.locator("#agenda-date")).toHaveValue(futureDate());
    await agendaDialog.locator("#agenda-title").fill("Salida 10K");
    await agendaDialog.locator("#agenda-start").fill("06:30");
    await agendaDialog.locator("#agenda-end").fill("06:00");
    await agendaDialog.getByRole("button", { name: "Agregar entrada" }).click();
    await expect(agendaDialog.getByText("La hora de término debe ser posterior")).toBeVisible();
    await agendaDialog.locator("#agenda-end").fill("09:00");
    await agendaDialog.locator("#agenda-location").selectOption({ label: "Parque Fundidora" });
    await agendaDialog.locator("#agenda-modality").selectOption({ label: "10K" });
    await axe("agenda-dialog");
    await agendaDialog.getByRole("button", { name: "Agregar entrada" }).click();
    await expect(page.locator('[data-agenda-title="Salida 10K"]')).toContainText("06:30 – 09:00");
    await expect(page.locator('[data-agenda-title="Salida 10K"]')).toContainText("Parque Fundidora");

    await page.getByRole("button", { name: "Agregar entrada" }).first().click();
    const early = page.getByRole("dialog", { name: "Agregar entrada a la agenda" });
    await early.locator("#agenda-title").fill("Entrega de kits");
    await early.locator("#agenda-date").fill(futureDate(89));
    await early.locator("#agenda-start").fill("16:00");
    await early.getByRole("button", { name: "Agregar entrada" }).click();
    const days = page.locator("[data-agenda-date]");
    await expect(days).toHaveCount(2);
    await expect(days.first()).toHaveAttribute("data-agenda-date", futureDate(89));

    // cancel an entry (it stays, marked) and delete the other one
    await page.locator('[data-agenda-title="Entrega de kits"]').getByRole("button", { name: /^Editar/ }).click();
    const cancel = page.getByRole("dialog", { name: "Editar Entrega de kits" });
    await cancel.locator("#agenda-status").selectOption("CANCELED");
    await cancel.getByRole("button", { name: "Guardar entrada" }).click();
    await expect(page.locator('[data-agenda-title="Entrega de kits"]')).toContainText("Cancelada");
    await page.locator('[data-agenda-title="Entrega de kits"]').getByRole("button", { name: /^Eliminar/ }).click();
    await page.getByRole("dialog", { name: /Eliminar «Entrega de kits»/ }).getByRole("button", { name: "Eliminar entrada" }).click();
    await expect(page.locator("[data-agenda-date]")).toHaveCount(1);
    await shot("agenda-configured");
    await axe("agenda-configured");

    // a location used by the agenda cannot be deleted: the server's reason is shown
    await page.getByRole("navigation", { name: "Secciones de la edición" }).getByRole("link", { name: "Ubicaciones" }).click();
    await page.locator('[data-location-name="Parque Fundidora"]').getByRole("button", { name: /^Eliminar/ }).click();
    const inUse = page.getByRole("dialog", { name: /Eliminar «Parque Fundidora»/ });
    await inUse.getByRole("button", { name: "Eliminar ubicación" }).click();
    await expect(inUse.getByTestId("refusal-notice")).toContainText("Todavía se usa");
    await expect(inUse.getByTestId("refusal-notice")).toContainText("Ya se usa en otro registro");
    await expect(inUse.getByTestId("refusal-notice")).not.toContainText("Alguien más lo cambió");
    await shot("location-in-use-refused");
    await inUse.getByRole("button", { name: "Cancelar" }).click();

    // ---- forms: create, build, preview, save, publish; an edit creates a new draft; the published version is immutable
    await page.getByRole("navigation", { name: "Secciones de la edición" }).getByRole("link", { name: "Formularios" }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Formularios de inscripción · ${fixture.name}`) })).toBeAttached();
    await expect(page.getByTestId("form-readiness-note")).toContainText("Falta un formulario publicado");
    await expect(page.getByTestId("legal-status")).toBeVisible();
    await expect(page.locator('[data-legal-type="SPORT_WAIVER"]')).toContainText("Publicado");
    await shot("forms-empty");
    await axe("forms-empty");

    const everyone = page.locator('[data-form-scope="edition"]');
    await everyone.getByRole("button", { name: "Crear formulario" }).click();
    await expect(everyone.getByTestId("form-draft")).toContainText("Borrador v1");
    await expect(everyone.getByTestId("fields-empty")).toBeVisible();

    const draft = everyone.getByTestId("form-draft");
    // publishing is blocked while there is nothing to save... and an invalid field is refused locally
    await draft.getByRole("button", { name: "Agregar pregunta" }).click();
    await draft.getByRole("button", { name: "Agregar pregunta" }).click();
    await draft.getByRole("button", { name: "Agregar pregunta" }).click();
    await draft.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(draft.getByText("Escribe la pregunta tal como la verá la persona.").first()).toBeVisible();

    const labels = draft.getByLabel("Pregunta (como la verá la persona)");
    const keys = draft.getByLabel("Clave interna");
    await labels.nth(0).fill("Talla de playera");
    await expect(keys.nth(0)).toHaveValue("talla_de_playera");
    await draft.getByLabel("Tipo de respuesta").nth(0).selectOption("SELECT");
    // a list field starts with one empty option; the stored value follows the label until it is edited by hand
    await expect(draft.getByLabel("Etiqueta de la opción 1")).toBeVisible();
    await draft.getByLabel("Etiqueta de la opción 1").fill("Chica");
    await expect(draft.getByLabel("Valor guardado de la opción 1")).toHaveValue("chica");
    await draft.getByRole("button", { name: "Agregar opción" }).click();
    await draft.getByLabel("Etiqueta de la opción 2").fill("Mediana");
    await draft.getByLabel("Respuesta obligatoria").nth(0).check();

    await labels.nth(1).fill("Club o equipo");
    await draft.getByLabel("Máximo de caracteres").first().fill("60");

    await labels.nth(2).fill("¿Tienes alguna condición médica?");
    await draft.getByLabel("Tipo de respuesta").nth(2).selectOption("BOOLEAN");
    await draft.getByLabel("Dato sensible").nth(2).check();
    // two fields with the same key are refused
    await keys.nth(1).fill("talla_de_playera");
    await draft.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(draft.getByText("Otra pregunta ya usa esta clave.")).toBeVisible();
    await keys.nth(1).fill("club");
    await axe("forms-draft-editor");
    await shot("forms-draft-editor");

    // preview: the participant's own field components
    await draft.getByRole("button", { name: "Vista previa" }).click();
    const preview = page.getByRole("region", { name: /Vista previa del borrador/ });
    await expect(preview.getByText("Talla de playera")).toBeVisible();
    await expect(preview.getByText("Club o equipo")).toBeVisible();
    await expect(preview.getByText("¿Tienes alguna condición médica?")).toBeVisible();
    await shot("forms-preview");
    await axe("forms-preview");

    // reorder, then the order is the one saved
    await draft.getByRole("button", { name: "Subir la pregunta 3" }).click();
    await expect(labels.nth(1)).toHaveValue("¿Tienes alguna condición médica?");
    await draft.getByRole("button", { name: "Bajar la pregunta 2" }).click();
    await expect(labels.nth(2)).toHaveValue("¿Tienes alguna condición médica?");

    // unsaved changes block publishing
    await expect(draft.getByRole("button", { name: "Publicar v1" })).toBeDisabled();
    await draft.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado").first()).toBeVisible();
    await expect(everyone.getByTestId("form-draft").getByRole("button", { name: "Publicar v1" })).toBeEnabled();

    await everyone.getByTestId("form-draft").getByRole("button", { name: "Publicar v1" }).click();
    const publish = page.getByRole("dialog", { name: "Publicar la versión 1" });
    await expect(publish).toContainText("No se puede editar después");
    await shot("forms-publish-confirm");
    await publish.getByRole("button", { name: "Publicar formulario" }).click();
    await expect(everyone).toContainText("Versión publicada v1");
    await expect(everyone.getByTestId("form-draft")).toHaveCount(0);
    await expect(everyone.locator('[data-field-key="talla_de_playera"]')).toContainText("Lista (una opción) · obligatorio · 2 opciones");
    await expect(everyone.locator('[data-field-key="tienes_alguna_condicion_medica"]')).toBeAttached();
    await expect(page.getByTestId("form-readiness-note")).toContainText("Cada modalidad activa tiene un formulario publicado");
    // the published version has no field controls: it is immutable
    await expect(everyone.getByRole("button", { name: "Agregar pregunta" })).toHaveCount(0);
    await expect(everyone.getByRole("button", { name: "Guardar borrador" })).toHaveCount(0);
    await shot("forms-published");
    await axe("forms-published");

    // the API itself refuses to touch a published form's fields
    const publishedForm = await page.request.get(`/api/v1/admin/editions/${fixture.editionId}`);
    const published = ((await publishedForm.json()) as { data: { registration_forms: { registration_form_id: string; status: string }[] } }).data.registration_forms.find((form) => form.status === "PUBLISHED");
    const direct = await page.request.put(`/api/v1/admin/forms/${published?.registration_form_id}/fields`, { data: { fields: [] } });
    expect(direct.status()).toBe(409);

    // editing creates the next draft from the published one; publishing it supersedes v1 and keeps it as history
    await everyone.getByRole("button", { name: /Editar \(crea un borrador v2\)/ }).click();
    await expect(everyone.getByTestId("form-draft")).toContainText("Borrador v2");
    await expect(everyone.getByTestId("form-draft")).toContainText("basado en v1");
    await expect(everyone.getByTestId("form-draft").getByLabel("Pregunta (como la verá la persona)")).toHaveCount(3);
    await everyone.getByTestId("form-draft").getByRole("button", { name: "Agregar pregunta" }).click();
    await everyone.getByTestId("form-draft").getByLabel("Pregunta (como la verá la persona)").nth(3).fill("Contacto de emergencia");
    await everyone.getByTestId("form-draft").getByLabel("Máximo de caracteres").last().fill("80");
    await everyone.getByTestId("form-draft").getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado").first()).toBeVisible();
    await everyone.getByTestId("form-draft").getByRole("button", { name: "Publicar v2" }).click();
    await expect(page.getByRole("dialog", { name: "Publicar la versión 2" })).toContainText("reemplaza a la 1");
    await page.getByRole("dialog", { name: "Publicar la versión 2" }).getByRole("button", { name: "Publicar formulario" }).click();
    await expect(everyone).toContainText("Versión publicada v2");
    await expect(everyone.locator('[data-field-key="contacto_de_emergencia"]')).toBeAttached();
    await everyone.getByText("Versiones anteriores (1)").click();
    await expect(everyone).toContainText("v1");
    await expect(everyone).toContainText("reemplazada");
    await shot("forms-two-versions");

    // ---- publication and registration through the UI, now that everything is configured
    await gotoAndSettle(page, base);
    await expect(page.getByTestId("blocked-publish")).toHaveCount(0);
    await page.getByRole("button", { name: "Publicar edición" }).click();
    await page.getByRole("dialog", { name: "Publicar edición" }).getByRole("button", { name: "Publicar", exact: true }).click();
    const states = page.getByRole("group", { name: "Estado de la edición" });
    await expect(states).toContainText("Publicada");

    await expect(page.getByTestId("blocked-open-registration")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Abrir inscripciones" })).toBeEnabled();
    await shot("overview-ready-to-open-registration");
    await axe("overview-configured");
    await page.getByRole("button", { name: "Abrir inscripciones" }).click();
    await page.getByRole("dialog", { name: "Abrir inscripciones" }).getByRole("button", { name: "Abrir inscripciones" }).click();
    await expect(states).toContainText("Abierta");

    // the public page shows what staff configured
    await page.goto(`/eventos/${fixture.slug}`);
    await expect(page.getByText("Carrera urbana de 10K por las calles del centro de Monterrey")).toBeVisible();

    // start and finish the race
    await gotoAndSettle(page, base);
    await page.getByRole("button", { name: "Iniciar carrera" }).click();
    await page.getByRole("dialog", { name: "Iniciar carrera" }).getByRole("button", { name: "Iniciar carrera" }).click();
    await expect(states).toContainText("En curso");
    await page.getByRole("button", { name: "Finalizar carrera" }).click();
    const finish = page.getByRole("dialog", { name: "Finalizar carrera" });
    await expect(finish).toContainText("el cierre administrativo queda pendiente");
    await finish.getByRole("button", { name: "Finalizar carrera" }).click();
    await expect(states).toContainText("Realizada");
    await expect(page.getByRole("button", { name: "Finalizar carrera" })).toHaveCount(0);
    await shot("overview-finished");
    await axe("overview-finished");

    // a finished Edition: the structural configuration is frozen and the screens say so; the form tool refuses new drafts
    await gotoAndSettle(page, `${base}/formularios`);
    await expect(page.getByRole("note").filter({ hasText: "ya terminó o se canceló" })).toBeVisible();
    await expect(page.locator('[data-form-scope="edition"]').getByRole("button", { name: /Editar \(crea un borrador/ })).toBeDisabled();
  });
});

test.describe("schedule revisions", () => {
  test("reschedule and postpone add numbered revisions, in the Edition's own timezone", async ({ page, axe, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createEditionToConfigure(page, testInfo.project.name, "revisions");
    const base = `/admin/eventos/${fixture.editionId}`;
    await gotoAndSettle(page, base);

    const panel = page.getByTestId("schedule-revision");
    await expect(panel).toContainText("Revisión 1");
    await expect(page.getByTestId("schedule-earlier")).toContainText("calendario original");
    await expect(panel).toContainText("06:30");
    await shot("schedule-revision-1");
    await axe("schedule-revision-1");

    // a time change on the same date through Datos y fechas is a revision too
    await gotoAndSettle(page, `${base}/configuracion`);
    await page.getByLabel("Hora de inicio").fill("07:15");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados.")).toBeVisible();
    await gotoAndSettle(page, base);
    await expect(page.getByTestId("schedule-revision")).toContainText("Revisión 2");
    await expect(page.getByTestId("schedule-revision")).toContainText("07:15");

    // postpone: no date, then reschedule: a new date and time; every step is a revision
    await page.locator('[data-transition="postpone"]').getByRole("button", { name: "Aplazar carrera" }).click();
    const postpone = page.getByRole("dialog", { name: "Aplazar carrera" });
    await postpone.getByLabel("Motivo").fill("Clima adverso en la fecha original");
    await postpone.getByRole("button", { name: "Aplazar", exact: true }).click();
    await expect(page.getByRole("group", { name: "Estado de la edición" })).toContainText("Aplazada");
    await expect(page.getByTestId("schedule-revision")).toContainText("Revisión 3");
    await expect(page.getByTestId("schedule-revision")).toContainText("Aplazada, sin nueva fecha");
    await expect(page.getByTestId("schedule-revision")).toContainText("Sin fecha");
    await expect(page.getByTestId("schedule-earlier")).toContainText("hubo 2 revisiones");
    await shot("schedule-revision-postponed");

    await page.locator('[data-transition="reschedule"]').getByRole("button", { name: "Reprogramar fecha" }).click();
    const reschedule = page.getByRole("dialog", { name: "Reprogramar fecha" });
    await reschedule.getByLabel("Motivo").fill("Nueva fecha confirmada con el municipio");
    await reschedule.getByLabel("Nueva fecha").fill(futureDate(150));
    await reschedule.getByLabel("Hora de inicio").fill("08:00");
    await reschedule.getByRole("button", { name: "Reprogramar", exact: true }).click();
    await expect(page.getByRole("group", { name: "Estado de la edición" })).toContainText("Programada");
    const after = page.getByTestId("schedule-revision");
    await expect(after).toContainText("Revisión 4");
    await expect(after).toContainText("Fecha y hora confirmadas");
    await expect(after).toContainText("08:00");
    await expect(page.getByTestId("schedule-earlier")).toContainText("hubo 3 revisiones");
    await expect(page.getByTestId("schedule-history-note")).toContainText("todavía no se puede consultar");
    await shot("schedule-revision-4");
    await axe("schedule-revision-4");
  });
});

test.describe("stale state (P3-L)", () => {
  test("a save refused as stale refetches, lists what changed, keeps the operator's text and applies on retry", async ({ page, axe, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createEditionToConfigure(page, testInfo.project.name, "stale");
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/configuracion`);
    await expect(page.getByLabel("Ciudad")).toHaveValue("Monterrey");

    // someone else changes the Edition name and WhatsApp while this tab is open
    const other = await page.request.patch(`/api/v1/admin/editions/${fixture.editionId}`, { data: { name: `${fixture.name} (renombrada)`, whatsapp_phone_e164: "+528181234567" } });
    expect(other.status()).toBe(200);

    // the operator edits another field and saves with the version they loaded
    await page.getByLabel("Ciudad").fill("San Pedro Garza García");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    const refusal = page.getByTestId("refusal-notice");
    await expect(refusal).toContainText("La edición cambió mientras la editabas");
    await expect(refusal).toContainText("No se aplicó nada");
    await expect(refusal.getByTestId("error-reference")).toContainText("Referencia:");
    await expect(refusal).not.toContainText("STALE_STATE");
    // the page refetched: what changed is listed, the operator's own text survived
    const note = page.getByTestId("changed-by-others");
    await expect(note).toContainText("Nombre");
    await expect(note).toContainText("WhatsApp de la edición");
    await expect(note).toContainText("Tus cambios sin guardar se conservaron");
    await expect(page.getByLabel("Nombre de la edición")).toHaveValue(`${fixture.name} (renombrada)`);
    await expect(page.getByLabel("WhatsApp de la edición")).toHaveValue("+528181234567");
    await expect(page.getByLabel("Ciudad")).toHaveValue("San Pedro Garza García");
    await shot("stale-save-refused");
    await axe("stale-save-refused");

    // nothing was applied yet
    const before = await page.request.get(`/api/v1/admin/editions/${fixture.editionId}`);
    expect(((await before.json()) as { data: { edition: { city: string } } }).data.edition.city).toBe("Monterrey");

    // retry on the fresh version: it applies, and the other person's change is intact
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados.")).toBeVisible();
    const after = await page.request.get(`/api/v1/admin/editions/${fixture.editionId}`);
    const edition = ((await after.json()) as { data: { edition: { city: string; name: string; whatsapp_phone_e164: string } } }).data.edition;
    expect(edition.city).toBe("San Pedro Garza García");
    expect(edition.name).toBe(`${fixture.name} (renombrada)`);
    expect(edition.whatsapp_phone_e164).toBe("+528181234567");
  });

  test("a schedule save with a stale version is refused too, and a save sends the version the form was loaded with", async ({ page }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createEditionToConfigure(page, testInfo.project.name, "stale-schedule");
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/configuracion`);
    const requests: { url: string; body: string }[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/v1/admin/editions/")) requests.push({ url: request.url(), body: request.postData() ?? "" });
    });
    const loaded = await page.request.get(`/api/v1/admin/editions/${fixture.editionId}`);
    const updatedAt = ((await loaded.json()) as { data: { edition: { updated_at: string } } }).data.edition.updated_at;

    // PATCH + schedule in one save: the second call carries the version the first one returned, not the loaded one
    await page.getByLabel("Ciudad").fill("Apodaca");
    await page.getByLabel("Hora de inicio").fill("07:45");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados.")).toBeVisible();
    const patch = requests.find((request) => request.url.endsWith(`/editions/${fixture.editionId}`));
    const schedule = requests.find((request) => request.url.endsWith("/schedule"));
    expect(patch).toBeDefined();
    expect(schedule).toBeDefined();
    expect(JSON.parse(patch!.body).expected_updated_at).toBe(updatedAt);
    const afterPatch = JSON.parse(schedule!.body).expected_updated_at as string;
    expect(afterPatch).not.toBe(updatedAt);

    // the server refuses an old token on the schedule endpoint
    const refused = await page.request.post(`/api/v1/admin/editions/${fixture.editionId}/schedule`, {
      data: { local_date: futureDate(90), local_start_time: "08:30", expected_updated_at: updatedAt },
    });
    expect(refused.status()).toBe(409);
    expect(JSON.stringify(await refused.json())).toContain("STALE_STATE");
  });

  test("a transition refused as stale refetches behind the dialog, and succeeds once the operator retries on the new state", async ({ page, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createEditionToConfigure(page, testInfo.project.name, "stale-transition");
    await page.request.post(`/api/v1/admin/editions/${fixture.editionId}/content-blocks`, {
      data: { block_type: "RICH_TEXT", status: "PUBLISHED", payload: { markdown: "Una carrera urbana para toda la familia por el centro." } },
    });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}`);
    await expect(page.getByRole("button", { name: "Publicar edición" })).toBeEnabled();

    // another person edits the Edition (any change moves its version), then this tab tries to publish
    const other = await page.request.patch(`/api/v1/admin/editions/${fixture.editionId}`, { data: { name: `${fixture.name} v2` } });
    expect(other.status()).toBe(200);
    await page.getByRole("button", { name: "Publicar edición" }).click();
    const dialog = page.getByRole("dialog", { name: "Publicar edición" });
    await dialog.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(dialog.getByTestId("refusal-notice")).toContainText("La edición cambió mientras la editabas");
    await shot("stale-transition-refused");
    // the page behind the dialog was refetched: the new name is already the heading
    // (the dialog hides the page from the accessibility tree, so the heading is found by element, not by role)
    await expect(page.locator("h1", { hasText: `${fixture.name} v2` })).toBeAttached();

    // retrying from the same dialog now carries the fresh version and applies
    await dialog.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(page.getByRole("group", { name: "Estado de la edición" })).toContainText("Publicada");
  });
});

test.describe("Events catalogue (P3-L)", () => {
  test("an Event without Editions can be picked, its type, key and status are shown, and the Event page reads it", async ({ page, axe, shot }, testInfo) => {
    await signInAs(page, "admin");
    const event = await createEventWithoutEditions(page, testInfo.project.name.replace("chromium-", ""));

    await gotoAndSettle(page, "/admin/eventos/nuevo");
    const picker = page.locator("#event-choice");
    const option = picker.locator("option", { hasText: event.name });
    await expect(option).toHaveCount(1);
    await expect(option).toContainText("Trail");
    await expect(option).toContainText("sin ediciones");
    await picker.selectOption({ label: await option.innerText() });
    const picked = page.getByTestId("picked-event");
    await expect(picked).toContainText("Trail");
    await expect(picked).toContainText(event.key);
    await expect(picked).toContainText("Activo");
    await expect(picked).toContainText("sin ediciones todavía");
    await shot("new-edition-catalogue-event");
    await axe("new-edition-catalogue-event");

    // create the first Edition of that Event through the UI
    const slug = `e2-cat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    await page.getByLabel("Nombre de la edición").fill(`E2 Edición del catálogo ${slug.slice(-6)}`);
    await page.getByLabel("Enlace público (slug)").fill(slug);
    await page.getByLabel("Ciudad").fill("Monterrey");
    await page.getByRole("textbox", { name: "Estado", exact: true }).fill("Nuevo León");
    await page.getByLabel("Fecha de la carrera").fill(futureDate(60));
    await page.getByRole("button", { name: "Crear edición como borrador" }).click();
    await expect(page).toHaveURL(/\/admin\/eventos\/[0-9a-f-]{36}$/);
    const editionId = page.url().split("/").pop() as string;

    // the Event read: type, key, status and edition count on Datos y fechas; the type is editable by an ADMIN
    await gotoAndSettle(page, `/admin/eventos/${editionId}/configuracion`);
    const panel = page.getByRole("region", { name: "Evento", exact: true });
    await expect(panel).toContainText(event.name);
    await expect(panel).toContainText("Trail");
    await expect(panel).toContainText(event.key);
    await expect(panel).toContainText("Activo");
    await expect(panel).toContainText("Ediciones del evento");
    await page.getByRole("button", { name: "Editar evento" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar evento" });
    await expect(dialog.getByLabel("Tipo de evento")).toHaveValue("TRAIL");
    await dialog.getByLabel("Tipo de evento").selectOption("WALK");
    await dialog.getByRole("button", { name: "Guardar evento" }).click();
    await expect(page.getByRole("region", { name: "Evento", exact: true })).toContainText("Caminata");

    // with the Event now having one Edition, the picker counts it
    await gotoAndSettle(page, "/admin/eventos/nuevo");
    await expect(page.locator("#event-choice option", { hasText: event.name })).toContainText("1 edición");
  });
});

test.describe("roles and layout", () => {
  test("an operator configures content; check-in staff cannot open the configuration screens", async ({ page, axe, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createEditionToConfigure(page, testInfo.project.name, "roles");
    await signInAs(page, "operator");
    for (const section of ["formularios", "ubicaciones", "agenda", "contenido"]) {
      await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/${section}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
      await expect(page.getByTestId("admin-forbidden")).toHaveCount(0);
    }
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/formularios`);
    // an operator does not see the global legal documents panel (ADMIN only) but can build the form
    await expect(page.getByTestId("legal-status")).toHaveCount(0);
    await expect(page.locator('[data-form-scope="edition"]').getByRole("button", { name: "Crear formulario" })).toBeEnabled();
    await shot("operator-forms");
    await axe("operator-forms");

    await signInAs(page, "checkin");
    for (const section of ["formularios", "ubicaciones", "agenda", "contenido"]) {
      await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/${section}`);
      await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    }
    // and the API refuses the same writes on its own
    const refused = await page.request.post(`/api/v1/admin/editions/${fixture.editionId}/locations`, { data: { location_type: "VENUE", name: "No debe crearse" } });
    expect(refused.status()).toBe(403);
    const refusedForm = await page.request.post(`/api/v1/admin/editions/${fixture.editionId}/forms`, { data: {} });
    expect(refusedForm.status()).toBe(403);
    const lifecycle = await postTransition(page, fixture.editionId, "open-registration");
    expect(lifecycle.status).toBe(403);
  });

  test("every configuration screen fits the viewport without sideways scrolling", async ({ page }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createEditionToConfigure(page, testInfo.project.name, "fit");
    for (const section of ["", "/configuracion", "/formularios", "/ubicaciones", "/agenda", "/contenido"]) {
      await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}${section}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
      await expectNoHorizontalScroll(page);
    }
  });
});
