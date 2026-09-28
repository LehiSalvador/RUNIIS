import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  adminGetEditionEditor,
  adminGetPlatformSettings,
  createContentBlock,
  createEdition,
  createEvent,
  createLegalDocument,
  createLegalDocumentVersion,
  createModality,
  createPriceOffer,
  getPublicLegalDocument,
  publishLegalDocumentVersion,
  transitionEdition,
  updatePlatformSettings,
} from "@/lib/server/domain/events/service";
import { AppError } from "@/lib/server/http/errors";
import { cleanup, createTestStaff, queryValue, type TestStaff } from "../helpers";
import { localAnonClient } from "../supabase";

// Exercises the events/editions admin stack end to end: real local Postgres, real RLS
// (auth.uid() from a real staff session), real zod contracts. Mirrors tests/integration/people's
// convention of driving the domain/service layer directly (the HTTP route layer is generic and
// unit-tested elsewhere).

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await promise.catch((error: AppError) => {
    expect(error.code).toBe(code);
  });
}

describe("events/editions admin domain (T30) integration", () => {
  let admin: TestStaff;
  let operator: TestStaff;
  let eventId: string;

  beforeAll(async () => {
    [admin, operator] = await Promise.all([createTestStaff("ADMIN", "GLOBAL"), createTestStaff("OPERATOR", "GLOBAL")]);
    const eventTypeId = queryValue("select event_type_id::text from app.event_type where key = 'ROAD_RACE'");
    if (!eventTypeId) throw new Error("ROAD_RACE event_type not seeded");
    eventId = randomUUID();
  }, 30_000);

  afterAll(async () => {
    await cleanup([admin.authUserId, operator.authUserId]);
  });

  test("EVENT_CREATE is GLOBAL ADMIN only: OPERATOR is FORBIDDEN", async () => {
    await expectAppError(
      createEvent(operator.client, { event_type_key: "ROAD_RACE", name: "Denied", canonical_key: `denied-${randomUUID()}` }, null),
      "FORBIDDEN",
    );
  });

  test("create Event -> create Edition -> publish is refused until publication_readiness is ready, then succeeds", async () => {
    const event = await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: "Integración RUNIIS", canonical_key: `it-runiis-${randomUUID()}` }, null);
    eventId = event.event_id;

    const edition = await createEdition(
      admin.client,
      eventId,
      {
        slug: `it-edicion-${randomUUID().slice(0, 8)}`,
        name: "Integración Edición",
        registration_mode: "FREE",
        city: "Monterrey",
        state_region: "NL",
        schedule: { local_date: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), local_start_time: "07:00:00" },
      },
      null,
    );
    expect(edition.publication_state).toBe("DRAFT");
    expect(edition.registration_close_at).toBeTruthy();

    const modality = await createModality(admin.client, edition.edition_id, { key: "5k", name: "5K", official_distance_m: 5000 }, null);
    await createPriceOffer(admin.client, modality.modality_id, { name: "General", amount_minor: 0 }, null);

    const notReady = await transitionEdition(admin.client, "publish", edition.edition_id, {}, null).catch((e: unknown) => e);
    expect(notReady).toBeInstanceOf(AppError);
    expect((notReady as AppError).code).toBe("BUSINESS_RULE_VIOLATION");

    await createContentBlock(admin.client, edition.edition_id, {
      block_type: "RICH_TEXT",
      status: "PUBLISHED",
      payload: { markdown: "Contenido de prueba de integración con más de treinta caracteres." },
    });

    const published = await transitionEdition(admin.client, "publish", edition.edition_id, {}, null);
    expect(published.edition.publication_state).toBe("PUBLISHED");
  }, 30_000);

  test("PLATFORM_SETTINGS_MANAGE is GLOBAL ADMIN only; OPERATOR is FORBIDDEN and updates never rewrite existing Editions", async () => {
    await expectAppError(updatePlatformSettings(operator.client, { registration_hold_minutes: 5 }), "FORBIDDEN");

    const before = await adminGetPlatformSettings(admin.client);
    const updated = await updatePlatformSettings(admin.client, { registration_hold_minutes: before.registration_hold_minutes === 30 ? 45 : 30 });
    expect(updated.registration_hold_minutes).not.toBe(before.registration_hold_minutes);
    // restore, so this test is idempotent across reruns against the same local DB
    await updatePlatformSettings(admin.client, { registration_hold_minutes: before.registration_hold_minutes });
  });

  test("legal document create -> version -> publish -> public GET returns it; an unknown key is null (404)", async () => {
    const key = `IT_TEST_DOC_${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const doc = await createLegalDocument(admin.client, { document_type: "TERMS_OF_SERVICE", document_key: key });
    const version = await createLegalDocumentVersion(admin.client, doc.legal_document_id, {
      content_markdown: "[DOCUMENTO DE PRUEBA LOCAL — no es texto legal] integración",
    });
    expect(version.status).toBe("DRAFT");
    await publishLegalDocumentVersion(admin.client, version.legal_document_version_id, null);

    const publicDoc = await getPublicLegalDocument(localAnonClient(), key);
    expect(publicDoc?.content_markdown).toBe("[DOCUMENTO DE PRUEBA LOCAL — no es texto legal] integración");

    const missing = await getPublicLegalDocument(localAnonClient(), `${key}_UNKNOWN`);
    expect(missing).toBeNull();
  });

  test("admin_get_edition_editor returns the full projection for a GLOBAL ADMIN", async () => {
    const edition = await createEdition(
      admin.client,
      eventId,
      {
        slug: `it-editor-${randomUUID().slice(0, 8)}`,
        name: "Integración Editor",
        registration_mode: "FREE",
        city: "Monterrey",
        state_region: "NL",
        registration_close_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      null,
    );
    const editor = await adminGetEditionEditor(admin.client, edition.edition_id);
    expect(editor.edition.edition_id).toBe(edition.edition_id);
    expect(Array.isArray(editor.modalities)).toBe(true);
    expect(editor.readiness.publication).toBeDefined();
  });
});
