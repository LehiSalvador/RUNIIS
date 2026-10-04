import { LOCAL_DB_ONLY } from "../support/account";
import { e2eEnv } from "../support/env";
import {
  apiPost,
  clickMap,
  createFixtureEdition,
  dragOnMap,
  expect,
  expectNoHorizontalScroll,
  gotoAndSettle,
  gpxUpload,
  gpxXml,
  isWide,
  signInAs,
  test,
  waitMapReady,
} from "./routes-support";

/**
 * P3-F staff route editor: select or create a Route, import a GPX within the platform body limit, inspect it on the map and in text,
 * edit a draft, validate, publish and keep published revisions immutable. Local stack only (seeded staff accounts, local DB). The map is
 * a real MapLibre canvas; editing is desktop/tablet first, so the mobile project checks the read-only behaviour instead of the tools.
 */
test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 30_000 });
test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);

type RouteRow = { route_id: string; active_revision_id: string | null; revisions?: { route_revision_id: string; status: string; revision: number }[] };

test.describe("route editor journey", () => {
  test("create a route, import a GPX, inspect, validate, publish, and change it only through a new revision", async ({ page, axe, shot }, testInfo) => {
    const wide = isWide(testInfo.project.name);
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "routes" });
    const base = `/admin/eventos/${fixture.editionId}`;

    // ---- the section is reachable from the Edition and starts empty
    await gotoAndSettle(page, base);
    await page.getByRole("link", { name: "Rutas" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Rutas · ${fixture.name}`) })).toBeAttached();
    await expect(page.getByRole("navigation", { name: "Secciones de la edición" }).getByRole("link", { name: "Rutas" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Esta edición aún no tiene rutas" })).toBeVisible();
    await shot("01-empty");
    await axe("empty");
    await expectNoHorizontalScroll(page);

    // ---- create the route: client validation first, nothing is sent
    await page.getByRole("button", { name: "Crear la primera ruta" }).click();
    const create = page.getByRole("dialog", { name: "Nueva ruta" });
    await create.getByRole("button", { name: "Crear ruta" }).click();
    await expect(create.getByText("Este campo es obligatorio.")).toBeVisible();
    await expect(create.getByText("Elige al menos una modalidad")).toBeVisible();
    await axe("create-dialog-errors");
    await create.getByLabel("Nombre de la ruta").fill("Ruta 10K Centro");
    await create.getByLabel("10K").check();
    await create.getByRole("button", { name: "Crear ruta" }).click();
    await expect(page.getByText("Ruta creada", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/[?&]route=/);
    await expect(page.getByRole("heading", { level: 2, name: "Ruta 10K Centro" })).toBeVisible();
    await expect(page.getByTestId("route-header")).toContainText("ninguna publicada");
    await expect(page.getByTestId("route-header")).toContainText("10K 10.0 km");
    await expect(page.getByText("Esta ruta aún no tiene revisiones")).toBeVisible();
    await expect(page.getByText("Nueva revisión (sin guardar)")).toBeVisible();

    // ---- import a GPX: it creates a DRAFT revision and the official distance stays what the modality says
    await page.getByRole("button", { name: "Importar GPX" }).click();
    const importDialog = page.getByRole("dialog", { name: "Importar GPX" });
    await importDialog.getByLabel("Archivo GPX").setInputFiles(gpxUpload(gpxXml()));
    await expect(importDialog.getByTestId("gpx-file-chosen")).toContainText("ruta-sintetica.gpx");
    await axe("import-dialog");
    await importDialog.getByRole("button", { name: "Importar GPX" }).click();
    await expect(page.getByText("GPX importado como borrador", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/[?&]revision=/);
    const workbench = page.getByTestId("revision-workbench");
    await expect(workbench).toHaveAttribute("data-revision-status", "DRAFT");
    await expect(page.getByRole("heading", { name: "Revisión 1" })).toBeVisible();
    await expect(page.getByTestId("revision-source")).toContainText("GPX importado: ruta-sintetica.gpx");
    await expect(page.getByTestId("revision-meta")).toContainText(/Creada el .* por /);
    await expect(page.getByTestId("summary-vertices")).toHaveText("400");
    await expect(page.getByTestId("summary-server")).toContainText(/\d+\.\d+ km/);
    await expect(page.getByTestId("route-summary")).toContainText("Distancia oficial");
    await expect(page.getByTestId("route-summary")).toContainText("10K: 10.0 km");
    await expect(page.getByTestId("route-summary")).toContainText("No disponible: la ruta guarda solo latitud y longitud");
    await expect(page.getByTestId("poi-panel")).toContainText("Agua km 5");
    await expect(page.getByTestId("revisions-panel")).toContainText("Revisión 1");
    await waitMapReady(page);
    await expect(page.getByTestId("route-editor-map")).toHaveAttribute("data-vertices", "400");
    if (wide) {
      await expect(page.getByTestId("route-toolbar")).toBeVisible();
      await expect(page.getByTestId("route-editor-map")).toHaveAttribute("data-editable", "true");
    } else {
      await expect(page.getByTestId("route-toolbar")).toHaveCount(0);
      await expect(page.getByTestId("mobile-note")).toBeVisible();
      await expect(page.getByTestId("route-editor-map")).toHaveAttribute("data-editable", "false");
    }
    await shot("02-imported-draft");
    await axe("imported-draft");
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    // ---- publishing needs a validation first: the server does it, the UI shows its verdict
    await expect(page.getByRole("button", { name: "Publicar revisión" })).toBeDisabled();
    await expect(page.getByTestId("publish-blocked")).toContainText("Valida la revisión antes de publicar");
    await expect(page.getByTestId("validation-none")).toBeVisible();
    await page.getByRole("button", { name: "Validar" }).click();
    await expect(page.getByText("Sin errores bloqueantes")).toBeVisible();
    await expect(page.getByTestId("live-message")).toContainText("Validación terminada");
    await expect(page.getByRole("button", { name: "Publicar revisión" })).toBeEnabled();
    await shot("03-validated");
    await axe("validated");

    // ---- publish through the confirm dialog (consequence stated, key per intent)
    await page.getByRole("button", { name: "Publicar revisión" }).click();
    const confirm = page.getByRole("dialog", { name: "Publicar la revisión 1" });
    await expect(confirm).toContainText("La revisión publicada no se puede editar después");
    await axe("publish-dialog");
    await confirm.getByRole("button", { name: "Publicar revisión" }).click();
    await expect(page.getByText("Revisión publicada", { exact: true })).toBeVisible();
    await expect(workbench).toHaveAttribute("data-revision-status", "PUBLISHED");
    await expect(page.getByTestId("immutable-note")).toBeVisible();
    await expect(page.getByTestId("route-header")).toContainText("Revisión 1");
    await expect(page.getByRole("button", { name: "Guardar borrador" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Publicar revisión" })).toHaveCount(0);
    await expect(page.getByTestId("route-toolbar")).toHaveCount(0);
    await shot("04-published-immutable");
    await axe("published-immutable");

    // ---- the server, not the UI, keeps it immutable
    const routeId = new URL(page.url()).searchParams.get("route") as string;
    const revisionId = new URL(page.url()).searchParams.get("revision") as string;
    const patch = await page.request.patch(`/api/v1/admin/route-revisions/${revisionId}`, { data: { pois: [] } });
    expect(patch.status()).toBe(409);
    expect(JSON.stringify(await patch.json())).toContain("revision_not_draft");

    // ---- change = a new revision made from it (a copy), published later; the old one is superseded
    await page.getByRole("button", { name: "Crear borrador a partir de esta revisión" }).click();
    await expect(page.getByText("Borrador creado a partir de la revisión", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Revisión 2" })).toBeVisible();
    await expect(page.getByTestId("revision-workbench")).toHaveAttribute("data-revision-status", "DRAFT");
    await expect(page.getByTestId("revision-source")).toContainText("Manual");
    await expect(page.getByTestId("summary-vertices")).toHaveText("400");
    await page.getByRole("button", { name: "Validar" }).click();
    await expect(page.getByText("Sin errores bloqueantes")).toBeVisible();
    await page.getByRole("button", { name: "Publicar revisión" }).click();
    const confirmTwo = page.getByRole("dialog", { name: "Publicar la revisión 2" });
    await expect(confirmTwo).toContainText("La revisión 1 (publicada hoy) pasará a «Reemplazada»");
    await confirmTwo.getByRole("button", { name: "Publicar revisión" }).click();
    await expect(page.getByText("Revisión publicada", { exact: true })).toBeVisible();
    const history = page.getByTestId("revisions-panel");
    await expect(history).toContainText("Reemplazada");
    await expect(history).toContainText("Publicada");
    const detail = (await (await page.request.get(`/api/v1/admin/routes/${routeId}`)).json()) as { data: RouteRow };
    expect(detail.data.revisions?.map((r) => `${r.revision}:${r.status}`).sort()).toEqual(["1:SUPERSEDED", "2:PUBLISHED"]);
    await shot("05-two-revisions");
  });
});

test.describe("GPX import refusals", () => {
  test("an oversize file is refused in the browser without any request; other bad files get the server's reason", async ({ page, axe, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "gpx" });
    const route = await apiPost<{ route_id: string }>(page, `/api/v1/admin/editions/${fixture.editionId}/routes`, { name: "Ruta GPX", modality_ids: [fixture.modalityId] });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/rutas?route=${route.route_id}`);

    const imports: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/import-gpx")) imports.push(request.method());
    });

    await page.getByRole("button", { name: "Importar GPX" }).click();
    const dialog = page.getByRole("dialog", { name: "Importar GPX" });
    const input = dialog.getByLabel("Archivo GPX");

    // over the cap: refused before anything is sent, with the figures
    await input.setInputFiles({ name: "grande.gpx", mimeType: "application/gpx+xml", buffer: Buffer.alloc(3_300_000, 32) });
    await expect(dialog.getByTestId("gpx-problem")).toContainText("El archivo pesa 3.3 MB");
    await expect(dialog.getByTestId("gpx-problem")).toContainText("máximo para importar es 3.25 MB");
    await expect(dialog.getByTestId("gpx-problem")).toContainText("4.5 MB");
    await dialog.getByRole("button", { name: "Importar GPX" }).click();
    await expect(dialog.getByTestId("gpx-problem")).toBeVisible();
    await shot("10-gpx-too-large");
    await axe("gpx-too-large");
    expect(imports).toEqual([]);

    // wrong extension
    await input.setInputFiles({ name: "ruta.kml", mimeType: "application/xml", buffer: Buffer.from("<kml/>") });
    await expect(dialog.getByTestId("gpx-problem")).toContainText("extensión .gpx");

    // no file at all
    await input.setInputFiles([]);
    await dialog.getByRole("button", { name: "Importar GPX" }).click();
    await expect(dialog.getByTestId("gpx-problem")).toContainText("Elige un archivo .gpx");
    expect(imports).toEqual([]);

    // refused by the server, each with its own reason and the support reference
    const refusals: [string, string, RegExp][] = [
      ["roto.gpx", "<gpx><trk>", /XML válido/],
      ["doctype.gpx", '<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY a "b">]><gpx></gpx>', /DOCTYPE/],
      ["vacio.gpx", '<gpx version="1.1"><wpt lat="25.6" lon="-100.3"><name>Solo waypoint</name></wpt></gpx>', /ningún track/],
      ["otro.gpx", "<kml><Placemark/></kml>", /no es un GPX/],
    ];
    for (const [name, content, reason] of refusals) {
      await input.setInputFiles({ name, mimeType: "application/gpx+xml", buffer: Buffer.from(content) });
      await expect(dialog.getByTestId("gpx-file-chosen")).toContainText(name);
      await dialog.getByRole("button", { name: "Importar GPX" }).click();
      await expect(dialog.getByTestId("gpx-problem")).toContainText(reason);
      await expect(dialog.getByTestId("refusal-notice")).toContainText("Revisa los datos");
      await expect(dialog.getByTestId("refusal-notice")).toContainText(/Referencia/i);
    }
    await shot("11-gpx-server-refusal");
    await axe("gpx-server-refusal");
    // nothing was created
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    const detail = (await (await page.request.get(`/api/v1/admin/routes/${route.route_id}`)).json()) as { data: RouteRow };
    expect(detail.data.revisions).toEqual([]);
  });
});

test.describe("drawing and editing a draft (tablet and desktop)", () => {
  test("draw from scratch with the map tools and the keyboard equivalents, then save, validate and see the server's warnings", async ({ page, axe, shot }, testInfo) => {
    test.skip(!isWide(testInfo.project.name), "Route geometry editing is a tablet/desktop task (UX mobile-limited rule); mobile is covered by the journey test");
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "draw" });
    const route = await apiPost<{ route_id: string }>(page, `/api/v1/admin/editions/${fixture.editionId}/routes`, { name: "Ruta dibujada", modality_ids: [fixture.modalityId] });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/rutas?route=${route.route_id}`);

    await expect(page.getByText("Nueva revisión (sin guardar)")).toBeVisible();
    await waitMapReady(page);
    const map = page.getByTestId("route-editor-map");
    const toolbar = page.getByTestId("route-toolbar");
    await expect(page.getByRole("button", { name: "Crear borrador" })).toBeDisabled();

    // ---- add vertices on the map
    await toolbar.getByRole("button", { name: "Agregar punto" }).click();
    await expect(toolbar.getByRole("button", { name: "Agregar punto" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tool-hint")).toContainText("haz clic en el mapa para añadir un punto al final");
    await clickMap(page, 0.2, 0.7);
    await clickMap(page, 0.5, 0.3);
    await clickMap(page, 0.8, 0.65);
    await expect(map).toHaveAttribute("data-vertices", "3");
    await expect(page.getByTestId("summary-vertices")).toHaveText("3");
    await expect(page.getByTestId("dirty-note")).toBeVisible();
    await expect(page.getByTestId("computed-distance")).not.toContainText("0.00 km");

    // ---- undo and redo
    await toolbar.getByRole("button", { name: "Deshacer" }).click();
    await expect(map).toHaveAttribute("data-vertices", "2");
    await toolbar.getByRole("button", { name: "Rehacer" }).click();
    await expect(map).toHaveAttribute("data-vertices", "3");
    await toolbar.getByRole("button", { name: "Calcular distancia" }).press("Control+z");
    await expect(map).toHaveAttribute("data-vertices", "2");
    await toolbar.getByRole("button", { name: "Calcular distancia" }).press("Control+y");
    await expect(map).toHaveAttribute("data-vertices", "3");

    // ---- insert a vertex near a segment, then move a vertex by dragging it
    await toolbar.getByRole("button", { name: "Insertar punto" }).click();
    await clickMap(page, 0.35, 0.5);
    await expect(map).toHaveAttribute("data-vertices", "4");
    await toolbar.getByRole("button", { name: "Mover punto" }).click();
    const before = await page.getByTestId("computed-distance").innerText();
    await dragOnMap(page, [0.8, 0.65], [0.85, 0.8]);
    await expect(page.getByTestId("computed-distance")).not.toHaveText(before);
    await expect(map).toHaveAttribute("data-vertices", "4");

    // ---- delete a vertex
    await toolbar.getByRole("button", { name: "Eliminar punto" }).click();
    await clickMap(page, 0.35, 0.5);
    await expect(map).toHaveAttribute("data-vertices", "3");

    // ---- keyboard / form equivalents: coordinates of the selected point, a point by coordinates
    await page.getByRole("button", { name: "Seleccionar el punto 2" }).click();
    const selected = page.getByTestId("selected-vertex");
    await expect(selected).toContainText("Punto 2 de 3");
    await selected.getByLabel("Latitud").fill("999");
    await selected.getByRole("button", { name: "Aplicar coordenadas" }).click();
    await expect(selected.getByText("Latitud entre -90 y 90")).toBeVisible();
    await selected.getByLabel("Latitud").fill("25.7001");
    await selected.getByLabel("Longitud").fill("-100.3001");
    await selected.getByRole("button", { name: "Aplicar coordenadas" }).click();
    await expect(page.getByTestId("vertex-table")).toContainText("25.700100");
    const add = page.getByTestId("add-vertex-form");
    await add.getByLabel("Latitud").fill("25.69");
    await add.getByLabel("Longitud").fill("-100.28");
    await add.getByRole("button", { name: "Agregar al final de la ruta" }).click();
    await expect(map).toHaveAttribute("data-vertices", "4");

    // ---- start, finish and a point of interest
    await page.getByRole("button", { name: "Seleccionar el punto 1" }).click();
    await page.getByTestId("selected-vertex").getByRole("button", { name: "Usar como salida" }).click();
    await page.getByRole("button", { name: "Seleccionar el punto 4" }).click();
    await page.getByTestId("selected-vertex").getByRole("button", { name: "Usar como meta" }).click();
    await expect(page.getByTestId("route-summary")).toContainText("Salida");
    await expect(page.getByTestId("poi-editor")).toHaveCount(2);
    await toolbar.getByLabel("Tipo de punto de interés a colocar").selectOption("MEDICAL");
    await toolbar.getByRole("button", { name: "Puntos de interés" }).click();
    await clickMap(page, 0.5, 0.45);
    await expect(page.getByTestId("poi-editor")).toHaveCount(3);
    const medical = page.locator('[data-testid="poi-editor"][data-poi-type="MEDICAL"]');
    await medical.getByLabel("Nombre").fill("Puesto médico");
    await medical.getByLabel("Descripción (opcional)").fill("Ambulancia y paramédicos");
    await medical.getByLabel("Nombre").blur();
    await axe("drawing-with-tools");
    await shot("20-drawing");

    // ---- a POI without a name is refused locally, with the field named
    await medical.getByLabel("Nombre").fill("");
    await medical.getByLabel("Descripción (opcional)").focus();
    await page.getByRole("button", { name: "Crear borrador" }).click();
    await expect(medical.getByText("Escribe un nombre para el punto.")).toBeVisible();
    await medical.getByLabel("Nombre").fill("Puesto médico");
    await medical.getByLabel("Descripción (opcional)").focus();

    // ---- nothing is "saved" until the server says so
    await page.getByRole("button", { name: "Crear borrador" }).click();
    await expect(page.getByText("Revisión creada como borrador", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/[?&]revision=/);
    await expect(page.getByRole("heading", { name: "Revisión 1" })).toBeVisible();
    await expect(page.getByTestId("revision-source")).toContainText("Manual");
    await expect(page.getByTestId("dirty-note")).toHaveCount(0);
    await expect(page.getByTestId("summary-vertices")).toHaveText("4");
    await expect(page.getByTestId("summary-server")).toContainText(/\d+\.\d+ km/);

    // ---- the server's validation: the short hand-drawn route is far from the 10K the modality promises
    await page.getByRole("button", { name: "Validar" }).click();
    await expect(page.getByTestId("validation-warnings")).toContainText(/difiere de la oficial de 10K/);
    await expect(page.getByText("Sin errores bloqueantes")).toBeVisible();
    // warnings do not block publishing
    await expect(page.getByRole("button", { name: "Publicar revisión" })).toBeEnabled();
    await expect(page.getByRole("link", { name: /Advertencias: \d+/ })).toBeVisible();
    await shot("21-draft-with-warnings");
    await axe("draft-with-warnings");

    // ---- an edit after validating invalidates the verdict: save first, validate again
    await page.getByRole("button", { name: "Seleccionar el punto 2" }).click();
    await page.getByTestId("selected-vertex").getByLabel("Latitud").fill("25.7101");
    await page.getByTestId("selected-vertex").getByRole("button", { name: "Aplicar coordenadas" }).click();
    await expect(page.getByRole("button", { name: "Validar" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Publicar revisión" })).toBeDisabled();
    await expect(page.getByTestId("publish-blocked")).toContainText("Guarda los cambios antes de publicar");
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado", { exact: true })).toBeVisible();
    await expect(page.getByTestId("validation-none")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar revisión" })).toBeDisabled();
  });
});

test.describe("server decides, errors are actionable", () => {
  test("a blocking validation verdict from the server disables publishing and is shown as a danger list", async ({ page, axe, shot }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "blocking" });
    const route = await apiPost<{ route_id: string }>(page, `/api/v1/admin/editions/${fixture.editionId}/routes`, { name: "Ruta con error", modality_ids: [fixture.modalityId] });
    const imported = await apiPost<{ route_revision_id: string }>(page, `/api/v1/admin/routes/${route.route_id}/import-gpx`, {
      source_filename: "error.gpx",
      gpx_base64: Buffer.from(gpxXml({ points: 40 })).toString("base64"),
    });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/rutas?route=${route.route_id}&revision=${imported.route_revision_id}`);
    // The API refuses to create a revision that would fail a blocking check (degenerate, out of range), so a blocking verdict cannot be
    // produced from real data on a healthy stack: the verdict is stubbed here to prove how the UI treats it (the real publish gate is the server's).
    await page.route(`**/api/v1/admin/route-revisions/${imported.route_revision_id}/validate`, (request) =>
      request.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { valid: false, errors: [{ code: "INVALID_GEOMETRY" }], warnings: [{ code: "SELF_INTERSECTION" }, { code: "IMPROBABLE_JUMP", detail: { max_jump_m: 2500 } }], validated_at: new Date().toISOString() },
        }),
      }),
    );
    await page.getByRole("button", { name: "Validar" }).click();
    await expect(page.getByTestId("validation-errors")).toContainText("La geometría de la ruta no es válida");
    await expect(page.getByTestId("validation-warnings")).toContainText("salto improbable entre dos puntos seguidos (2,500 m)");
    await expect(page.getByRole("button", { name: "Publicar revisión" })).toBeDisabled();
    await expect(page.getByTestId("publish-blocked")).toContainText("Resuelve los errores");
    if (isWide(testInfo.project.name)) await expect(page.getByRole("link", { name: "Errores: 1" })).toBeVisible();
    await shot("30-blocking-error");
    await axe("blocking-error");
  });

  test("a failed save keeps the edits and says so; success is shown only after the server confirms the retry", async ({ page, shot }, testInfo) => {
    test.skip(!isWide(testInfo.project.name), "Geometry editing is a tablet/desktop task");
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "network" });
    const route = await apiPost<{ route_id: string }>(page, `/api/v1/admin/editions/${fixture.editionId}/routes`, { name: "Ruta red", modality_ids: [fixture.modalityId] });
    const imported = await apiPost<{ route_revision_id: string }>(page, `/api/v1/admin/routes/${route.route_id}/import-gpx`, {
      source_filename: "red.gpx",
      gpx_base64: Buffer.from(gpxXml({ points: 60 })).toString("base64"),
    });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/rutas?route=${route.route_id}&revision=${imported.route_revision_id}`);
    await page.getByRole("button", { name: "Seleccionar el punto 5" }).click();
    await page.getByTestId("selected-vertex").getByRole("button", { name: "Eliminar punto" }).click();
    await expect(page.getByTestId("summary-vertices")).toHaveText("59");

    const pattern = `**/api/v1/admin/route-revisions/${imported.route_revision_id}`;
    await page.route(pattern, (request) => request.abort("failed"));
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    const notice = page.getByTestId("refusal-notice");
    await expect(notice).toContainText("Sin conexión con el servidor");
    await expect(page.getByText("Borrador guardado", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("dirty-note")).toBeVisible();
    await shot("31-save-network-failure");

    await page.unroute(pattern);
    await notice.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByText("Borrador guardado", { exact: true })).toBeVisible();
    await expect(page.getByTestId("dirty-note")).toHaveCount(0);
    await expect(page.getByTestId("summary-vertices")).toHaveText("59");
    await expect(page.getByTestId("refusal-notice")).toHaveCount(0);
  });

  test("a route too big for one save is explained before sending, and can be simplified explicitly", async ({ page, shot }, testInfo) => {
    test.skip(!isWide(testInfo.project.name), "Geometry editing is a tablet/desktop task");
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "oversize" });
    const route = await apiPost<{ route_id: string }>(page, `/api/v1/admin/editions/${fixture.editionId}/routes`, { name: "Ruta grande", modality_ids: [fixture.modalityId] });
    const imported = await apiPost<{ route_revision_id: string }>(page, `/api/v1/admin/routes/${route.route_id}/import-gpx`, {
      source_filename: "grande.gpx",
      gpx_base64: Buffer.from(gpxXml({ points: 5000, waypoints: false })).toString("base64"),
    });
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/rutas?route=${route.route_id}&revision=${imported.route_revision_id}`);
    await expect(page.getByTestId("summary-vertices")).toHaveText("5,000");

    const patches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/route-revisions/")) patches.push(request.url());
    });
    await page.getByTestId("add-vertex-form").getByLabel("Latitud").fill("25.7");
    await page.getByTestId("add-vertex-form").getByLabel("Longitud").fill("-100.2");
    await page.getByTestId("add-vertex-form").getByRole("button", { name: "Agregar al final de la ruta" }).click();
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByTestId("oversize-note")).toContainText("el servidor acepta hasta");
    expect(patches).toEqual([]);
    await shot("32-oversize");
    await page.getByRole("button", { name: "Simplificar la ruta para poder guardarla" }).click();
    await expect(page.getByTestId("oversize-note")).toHaveCount(0);
    const count = Number((await page.getByTestId("summary-vertices").innerText()).replace(/\D/g, ""));
    expect(count).toBeLessThan(5001);
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado", { exact: true })).toBeVisible();
    expect(patches).toHaveLength(1);
  });

  test("roles and URLs: operator works, check-in is refused, anonymous is sent to sign in, a route of another edition is ignored", async ({ page, browser }, testInfo) => {
    await signInAs(page, "admin");
    const fixture = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "roles" });
    const other = await createFixtureEdition(page, testInfo.project.name, { configured: true, label: "roles-b" });
    const route = await apiPost<{ route_id: string }>(page, `/api/v1/admin/editions/${fixture.editionId}/routes`, { name: "Ruta del operador", modality_ids: [fixture.modalityId] });
    await page.context().clearCookies();
    await signInAs(page, "operator");
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/rutas?route=${route.route_id}`);
    await expect(page.getByRole("heading", { level: 2, name: "Ruta del operador" })).toBeVisible();

    // another Edition's page never shows this Edition's route, even when the URL names it
    await gotoAndSettle(page, `/admin/eventos/${other.editionId}/rutas?route=${route.route_id}`);
    await expect(page.getByRole("heading", { name: "Esta edición aún no tiene rutas" })).toBeVisible();
    await expect(page.getByText("Ruta del operador")).toHaveCount(0);

    // malformed ids
    await gotoAndSettle(page, `/admin/eventos/${fixture.editionId}/rutas?route=no-es-un-id&revision=tampoco`);
    await expect(page.getByRole("heading", { level: 2, name: "Ruta del operador" })).toBeVisible();

    const checkin = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const checkinPage = await checkin.newPage();
    await signInAs(checkinPage, "checkin");
    await gotoAndSettle(checkinPage, `/admin/eventos/${fixture.editionId}/rutas`);
    await expect(checkinPage.getByTestId("route-workspace")).toHaveCount(0);
    await expect(checkinPage.getByText("Acceso restringido").first()).toBeVisible();
    expect((await checkinPage.request.get(`/api/v1/admin/routes/${route.route_id}`)).status()).toBe(403);
    await checkin.close();

    const anonymous = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto(`/admin/eventos/${fixture.editionId}/rutas`);
    await expect(anonymousPage).toHaveURL(/\/entrar\?next=/);
    await anonymous.close();
  });
});
