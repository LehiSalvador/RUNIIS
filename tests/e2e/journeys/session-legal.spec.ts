import { createReadyUser, psql, uniqueEmail } from "../support/account";
import { protectBypass } from "../support/bypass";
import { e2eEnv } from "../support/env";
import { settleNetwork } from "../support/settle";
import {
  chooseParticipants,
  continueButton,
  expect,
  fillDetails,
  openRegistration,
  registerThroughUi,
  requestData,
  signInThroughUi,
  skipWithoutFixtureAdmin,
  submitAndWait,
  test,
  waitForHydration,
} from "../support/journey";

// Phase 2 participant journeys (Roadmap 8.22), part 4: session recovery and legal acceptance (OWN-05).
// TERMS/PRIVACY are accepted by each person in onboarding (and again when a version changes); event documents are
// accepted per participant at the registration (people.spec covers who accepts for whom).
test.describe.configure({ timeout: 300_000 });
test.beforeEach(() => skipWithoutFixtureAdmin());

const REAUTH_LOCAL = "re-acceptance rewrites one fixture user's acceptance rows in the local DB; publishing a new global version on a remote target would affect every user there";

function onboardingDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

test("Session recovery: an anonymous visit and an expired session both resume /inscripcion through next=", async ({ page, browser, baseURL, playwright, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const path = `/inscripcion/${edition.slug}`;
  const user = await createReadyUser(page, "session");

  // Anonymous: a real redirect (never a streamed 200) carrying this page as the return path.
  const anonymous = await playwright.request.newContext({ baseURL: e2eEnv().baseURL, extraHTTPHeaders: e2eEnv().bypassHeaders });
  const redirect = await anonymous.get(path, { maxRedirects: 0 });
  expect(redirect.status()).toBeGreaterThanOrEqual(300);
  expect(redirect.status()).toBeLessThan(400);
  const location = new URL(redirect.headers()["location"] ?? "", e2eEnv().baseURL);
  expect(location.pathname).toBe("/entrar");
  expect(location.searchParams.get("next")).toBe(path);
  await anonymous.dispose();

  // The same visit in a browser, then a real sign-in: back on the registration, not on the account home.
  const visitor = await browser.newContext({ baseURL });
  await protectBypass(visitor);
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(path);
  await expect(visitorPage).toHaveURL(new RegExp(`/entrar\\?next=${encodeURIComponent(path)}$`));
  await expect(visitorPage.getByRole("heading", { level: 1, name: "Entra a RUNIIS" })).toBeVisible();
  await signInThroughUi(visitorPage, user.email);
  await expect(visitorPage).toHaveURL(new RegExp(`${path}$`), { timeout: 30_000 });
  await expect(visitorPage.getByRole("heading", { name: "¿Quién se inscribe?" })).toBeVisible();
  await visitor.close();

  // Expired session in the middle of the flow: the buyer is told, keeps their choices, signs in and continues.
  await registerThroughUi(page, edition, { details: { modality: /^5K/, shirt: "M", club: "Club Humo" }, accept: [user.name], stopAtReview: true });
  await page.context().clearCookies();
  const refused = await submitAndWait(page, "FREE");
  expect(refused.status()).toBe(401);
  // (the page shows this twice, as the failure banner and as the sign-in alert: see the P2-E findings)
  await expect(page.getByRole("alert").filter({ hasText: "Tu sesión terminó" }).first()).toBeVisible();
  await expect(page.getByText("los documentos legales los aceptas otra vez")).toBeVisible();
  await a11y();
  await evidence("sesion-expirada");
  const signIn = page.getByRole("link", { name: "Iniciar sesión" });
  await expect(signIn).toHaveAttribute("href", `/entrar?next=${encodeURIComponent(path)}`);
  await signIn.click();
  await expect(page).toHaveURL(new RegExp(`/entrar\\?next=`));
  await signInThroughUi(page, user.email);
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "¿Quién se inscribe?" })).toBeVisible();
  await waitForHydration(page);

  // What was chosen survives; what the person must do explicitly (the documents) does not.
  await expect(page.getByRole("checkbox", { name: /\(tú\)/ })).toHaveAttribute("aria-checked", "true");
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^5K/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel(/Club/)).toHaveValue("Club Humo");
  await expect(page.getByRole("combobox", { name: /Talla de playera/ })).toContainText("M");
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();
  for (const box of await page.getByTestId("legal-card").getByRole("checkbox").all()) {
    await expect(box).toHaveAttribute("aria-checked", "false");
    await box.click();
  }
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  expect((await requestData(await submitAndWait(page, "FREE"))).status).toBe("CONFIRMED");
});

test("Legal acceptance (onboarding): TERMS and PRIVACY are accepted explicitly by each person, then back to the registration", async ({ page, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const path = `/inscripcion/${edition.slug}`;
  const email = uniqueEmail("onboarding");

  await page.goto(`/entrar?next=${encodeURIComponent(path)}`);
  await signInThroughUi(page, email);
  await expect(page).toHaveURL(new RegExp(`/onboarding\\?next=${encodeURIComponent(path)}`), { timeout: 30_000 });
  await settleNetwork(page);
  await expect(page.getByRole("heading", { level: 1, name: "Completa tu perfil" })).toBeVisible();

  const posts: { legal_document_version_ids?: string[] }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/v1/me/onboarding")) posts.push(request.postDataJSON());
  });

  // The control exists, names both documents with their versions and starts UNTICKED.
  const legal = page.locator("#onboarding-legal");
  await expect(legal).toHaveAttribute("aria-checked", "false");
  const label = page.locator('label[for="onboarding-legal"]');
  await expect(label).toContainText(/Términos y condiciones \(versión \d+\)/);
  await expect(label).toContainText(/Aviso de privacidad \(versión \d+\)/);
  await expect(label.getByRole("link", { name: /Términos/ })).toHaveAttribute("href", "/legal/terminos");
  await expect(label.getByRole("link", { name: /privacidad/i })).toHaveAttribute("href", "/legal/privacidad");

  await page.locator("#onboarding-full_name").fill(`Persona Onboarding ${Math.random().toString(36).slice(2, 6)}`);
  await page.locator("#onboarding-date_of_birth").fill(onboardingDate("1991-03-14"));
  await page.getByRole("radio", { name: "Mujer" }).check();
  await page.locator("#onboarding-phone_e164").fill("81 1234 5678");
  await page.locator("#onboarding-emergency_contact_name").fill("Contacto Sintetico");
  await page.locator("#onboarding-emergency_contact_phone_e164").fill("8187654321");
  await page.locator("#onboarding-emergency_contact_relationship").fill("Madre");

  // Without the tick nothing is sent: acceptance is the person's explicit act.
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page.getByText("Debes aceptar los documentos para continuar.")).toBeVisible();
  await expect(legal).toBeFocused();
  await expect(legal).toHaveAttribute("aria-invalid", "true");
  expect(posts).toHaveLength(0);
  await a11y();
  await evidence("onboarding-sin-aceptar");

  await page.keyboard.press("Space");
  await expect(legal).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Guardar y continuar" }).click();

  // Back on the registration they came for.
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "¿Quién se inscribe?" })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0].legal_document_version_ids ?? []).toHaveLength(2);
  await waitForHydration(page);

  // The record: both current versions accepted, nothing pending, and the registration does not ask again.
  const status = await page.request.get("/api/v1/me/legal");
  const legalStatus = ((await status.json()) as { data: { needs_acceptance: boolean; documents: { document_type: string; status: string; accepted_at: string | null }[] } }).data;
  expect(legalStatus.needs_acceptance).toBe(false);
  expect(legalStatus.documents.map((document) => document.document_type).sort()).toEqual(["PRIVACY_NOTICE", "TERMS_OF_SERVICE"]);
  expect(legalStatus.documents.every((document) => document.status === "ACCEPTED" && document.accepted_at)).toBe(true);
  await chooseParticipants(page, [/\(tú\)/]);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await fillDetails(page, null, { modality: /^5K/, shirt: "M" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();
  await expect(page.getByTestId("account-legal-gate")).toHaveCount(0);
});

test("Legal re-acceptance (a new version): the banner, the acceptance screen, then the account is up to date", async ({ page, a11y, evidence }) => {
  test.skip(!e2eEnv().localDb, REAUTH_LOCAL);
  const user = await createReadyUser(page, "reaccept");
  // This ONE fixture user accepted an older TERMS version; the append-only trigger is bypassed for that user's rows only.
  psql(`set local session_replication_role = replica;
    delete from app.legal_acceptance where runner_profile_id = '${user.runnerProfileId}';
    insert into app.legal_document_version (legal_document_id, version, content_markdown, status, published_at)
      select legal_document_id, 2, 'QA superseded v2 (local journey only)', 'SUPERSEDED', now() from app.legal_document where document_key = 'TERMS_OF_SERVICE'
      on conflict (legal_document_id, version) do nothing;
    insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, acceptance_context)
      select '${user.runnerProfileId}', v.legal_document_version_id, '{"via":"journey-setup"}'::jsonb from app.legal_document_version v
      join app.legal_document d using (legal_document_id) where d.document_key = 'TERMS_OF_SERVICE' and v.version = 2;`);

  await page.goto("/cuenta/solicitudes");
  const banner = page.getByTestId("legal-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Actualizamos tus documentos legales");
  await expect(banner.getByRole("button")).toHaveCount(0);
  await a11y();
  await evidence("reaceptacion-banner");

  await banner.getByRole("link", { name: "Revisar y aceptar" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cuenta\/documentos\?next=%2Fcuenta%2Fsolicitudes$/);
  const panel = page.getByTestId("legal-reacceptance");
  await expect(panel).toContainText("Actualizamos nuestros documentos");
  await expect(panel).toContainText("Aceptaste antes la versión 2");
  const box = page.locator("#reaccept-legal");
  const accept = page.getByRole("button", { name: /Aceptar y continuar/ });
  await expect(box).toHaveAttribute("aria-checked", "false");
  await expect(accept).toBeDisabled();
  await panel.getByRole("button", { name: /Leer/ }).first().click();
  await expect(page.getByRole("dialog").getByTestId("legal-document-text")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toHaveAttribute("aria-checked", "false");
  await box.focus();
  await page.keyboard.press("Space");
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page).toHaveURL(/\/cuenta\/solicitudes$/, { timeout: 20_000 });
  await expect(page.getByTestId("legal-banner")).toHaveCount(0);
  const rows = psql(`select d.document_type || '|' || (la.acceptance_context->>'via') from app.legal_acceptance la join app.legal_document_version v using (legal_document_version_id) join app.legal_document d using (legal_document_id) where la.runner_profile_id = '${user.runnerProfileId}' and la.edition_id is null and v.status = 'PUBLISHED' order by 1`);
  expect(rows.split("\n")).toEqual(["PRIVACY_NOTICE|reacceptance", "TERMS_OF_SERVICE|reacceptance"]);
});

test("Legal re-acceptance inside the registration: an account that never accepted cannot go on until it does", async ({ page, world, a11y, evidence }) => {
  test.skip(!e2eEnv().localDb, REAUTH_LOCAL);
  const edition = await world.edition("free");
  const user = await createReadyUser(page, "reacceptflow");
  psql(`set local session_replication_role = replica; delete from app.legal_acceptance where runner_profile_id = '${user.runnerProfileId}';`);

  await openRegistration(page, edition.slug);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await fillDetails(page, null, { modality: /^5K/, shirt: "M" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();
  const gate = page.getByTestId("account-legal-gate");
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("Antes de inscribirte");
  await expect(page.getByTestId("legal-card").getByRole("checkbox").first()).toBeVisible();
  await a11y();
  await evidence("reaceptacion-en-inscripcion");

  // Event documents alone are not enough: the account documents come first.
  for (const box of await page.getByTestId("legal-card").getByRole("checkbox").all()) await box.click();
  await continueButton(page).click();
  await expect(page.getByTestId("step-error")).toContainText("Acepta los documentos de tu cuenta");
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();

  const accept = gate.getByRole("button", { name: "Aceptar y continuar" });
  await expect(accept).toBeDisabled();
  await gate.getByRole("checkbox").click();
  await accept.click();
  await expect(gate).toHaveCount(0);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  expect((await requestData(await submitAndWait(page, "FREE"))).status).toBe("CONFIRMED");
});
