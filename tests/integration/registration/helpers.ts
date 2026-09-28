import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createContentBlock,
  createEdition,
  createEvent,
  createModality,
  createPriceOffer,
  createRegistrationForm,
  publishRegistrationForm,
  setEditionGlobalCapacity,
  setModalityCapacity,
  transitionEdition,
} from "@/lib/server/domain/events/service";
import { queryValue, sql } from "../helpers";

// T34 registration/passes fixture builder. Reuses T30's real admin domain/service functions to
// stand up a registrable Edition (real RLS, real readiness gates) instead of poking app.edition
// rows directly, so these integration tests exercise the same path the admin UI would use.

let globalLegalDocsReady = false;

/**
 * The platform pages (TERMS_OF_SERVICE, PRIVACY_NOTICE) plus SPORT_WAIVER/MINOR_TERMS need a
 * PUBLISHED version for registration_readiness (OpenRegistration) and for the buyer-acceptance
 * gate (Master §124) to have something to accept. supabase/seeds/20_events.sql intentionally does
 * NOT seed these (see 020_seeds.test.sql: app.legal_document_version is empty post-reset, a
 * generic invariant) -- every consumer publishes what it needs, once, idempotently.
 */
export function ensureGlobalLegalDocumentsPublished(): void {
  if (globalLegalDocsReady) return;
  sql(`
    insert into app.legal_document_version (legal_document_version_id, legal_document_id, version, content_markdown, status, published_at)
    select gen_random_uuid(), d.legal_document_id, 1, '[TEST] ' || d.document_type, 'PUBLISHED', now()
    from app.legal_document d
    where d.document_key in ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE', 'SPORT_WAIVER', 'MINOR_TERMS')
      and not exists (select 1 from app.legal_document_version v where v.legal_document_id = d.legal_document_id);
  `);
  globalLegalDocsReady = true;
}

/** Current PUBLISHED version id for a global document_key (SPORT_WAIVER, MINOR_TERMS, ...). */
export function currentLegalVersionId(documentKey: string): string {
  ensureGlobalLegalDocumentsPublished();
  const id = queryValue(`
    select (private.current_legal_version(legal_document_id) ->> 'legal_document_version_id')
    from app.legal_document where document_key = '${documentKey}'
  `);
  if (!id) throw new Error(`no PUBLISHED legal_document_version for ${documentKey}`);
  return id;
}

export type EditionFixture = {
  editionId: string;
  modalityId: string;
  /** SPORT_WAIVER's current version id: what an adult PROFILE/GUEST participant must accept. */
  sportWaiverVersionId: string;
};

export type BuildEditionOptions = {
  mode: "FREE" | "EXTERNAL_WHATSAPP";
  /** effective_capacity on the single Modality created; omitted = generous (1000). */
  modalityCapacity?: number;
  /** Edition-wide global_capacity; omitted = unset (no global limit). */
  globalCapacity?: number;
  whatsappPhone?: string;
  priceAmountMinor?: number;
};

/** Event -> Edition -> Modality -> (capacity) -> Price -> Form (published) -> publish -> open-registration. */
export async function buildEdition(admin: SupabaseClient, options: BuildEditionOptions): Promise<EditionFixture> {
  ensureGlobalLegalDocumentsPublished();
  const eventTypeId = queryValue("select event_type_id::text from app.event_type where key = 'ROAD_RACE'");
  if (!eventTypeId) throw new Error("ROAD_RACE event_type not seeded");

  const event = await createEvent(admin, { event_type_key: "ROAD_RACE", name: "T34 Integración", canonical_key: `t34-${randomUUID()}` }, null);

  const edition = await createEdition(
    admin,
    event.event_id,
    {
      slug: `t34-${randomUUID().slice(0, 8)}`,
      name: "T34 Integración Edición",
      registration_mode: options.mode,
      city: "Monterrey",
      state_region: "NL",
      ...(options.mode === "EXTERNAL_WHATSAPP" ? { whatsapp_phone_e164: options.whatsappPhone ?? "+528110009000" } : {}),
      schedule: { local_date: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), local_start_time: "07:00:00" },
    },
    null,
  );

  const modality = await createModality(admin, edition.edition_id, { key: "5k", name: "5K", official_distance_m: 5000 }, null);
  await setModalityCapacity(admin, modality.modality_id, { effective_capacity: options.modalityCapacity ?? 1000 });
  if (options.globalCapacity !== undefined) {
    await setEditionGlobalCapacity(admin, edition.edition_id, { global_capacity: options.globalCapacity });
  }
  await createPriceOffer(admin, modality.modality_id, { name: "General", amount_minor: options.priceAmountMinor ?? 0 }, null);

  const form = await createRegistrationForm(admin, edition.edition_id, {});
  await publishRegistrationForm(admin, form.registration_form_id, null);

  // publication_readiness DESCRIPTION_PRESENT: a PUBLISHED RICH_TEXT/CUSTOM_SECTION block, >=30 chars.
  await createContentBlock(admin, edition.edition_id, {
    block_type: "RICH_TEXT",
    status: "PUBLISHED",
    payload: { markdown: "Contenido de prueba de integración T34 con más de treinta caracteres." },
  });

  await transitionEdition(admin, "publish", edition.edition_id, {}, null);
  await transitionEdition(admin, "open-registration", edition.edition_id, {}, null);

  return { editionId: edition.edition_id, modalityId: modality.modality_id, sportWaiverVersionId: currentLegalVersionId("SPORT_WAIVER") };
}

/** {kind:"PROFILE", public_profile_id, modality_id} + the matching legal_acceptances entry for an adult self/Guest. */
export function selfAcceptance(participantIndex: number, sportWaiverVersionId: string) {
  return { participant_index: participantIndex, legal_document_version_id: sportWaiverVersionId };
}
