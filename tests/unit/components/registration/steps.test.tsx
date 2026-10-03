import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DynamicField } from "@/components/registration/dynamic-field";
import {
  initialDraft,
  setAccepted,
  setModality,
  setResponse,
  toggleCandidate,
  validateDetails,
  type Draft,
} from "@/components/registration/logic/model";
import { StepDetails } from "@/components/registration/step-details";
import { StepLegal } from "@/components/registration/step-legal";
import { StepParticipants } from "@/components/registration/step-participants";
import { StepReview } from "@/components/registration/step-review";
import { baseContext, candidate, ID, peopleContext, verdict } from "../../registration/fixtures";

const noop = () => {};
const FRIEND = `profile:${ID.friendProfile}`;
const GUEST = `guest:${ID.guest}`;
const MINOR = `profile:${ID.minorProfile}`;

function participants(ctx = peopleContext(), draft: Draft = initialDraft(ctx), rowErrors: Record<string, string[]> = {}) {
  return renderToStaticMarkup(<StepParticipants ctx={ctx} draft={draft} rowErrors={rowErrors} headingRef={null} onToggle={noop} onRefresh={noop} refreshing={false} />);
}

describe("P2-AC-06.b participant builder (component)", () => {
  test("offers exactly the candidates of the context; the ineligible one is disabled with its reason tied by aria-describedby", () => {
    const html = participants();
    expect(html.match(/data-testid="candidate-row"/g)).toHaveLength(4);
    expect(html).toContain("Ana Prueba (tú)");
    expect(html).toContain("Beto Amigo");
    expect(html).toContain("Caro Invitada");
    expect(html).toContain("Dani Menor");
    // the minor without an active guardian: disabled checkbox + visible reason referenced by the control
    const minorRow = html.split('data-testid="candidate-row"').find((chunk) => chunk.includes("Dani Menor"))!;
    expect(minorRow).toMatch(/disabled/);
    expect(minorRow).toContain(`aria-describedby="reason-${MINOR}"`);
    expect(minorRow).toContain(`id="reason-${MINOR}"`);
    expect(minorRow).toContain("Necesita un adulto responsable asignado antes de continuar.");
    // self is preselected, friend is not
    const selfRow = html.split('data-testid="candidate-row"').find((chunk) => chunk.includes("Ana Prueba"))!;
    expect(selfRow).toContain('aria-checked="true"');
  });

  test("kind badges stay consistent: Cuenta for profiles, Invitado for guests (UX F6)", () => {
    const html = participants();
    const guestRow = html.split('data-testid="candidate-row"').find((chunk) => chunk.includes("Caro Invitada"))!;
    expect(guestRow).toContain("Invitado");
    const friendRow = html.split('data-testid="candidate-row"').find((chunk) => chunk.includes("Beto Amigo"))!;
    expect(friendRow).toContain("Cuenta");
    expect(friendRow).toContain("Amistad");
  });

  test("server row errors are announced on the row", () => {
    const html = participants(peopleContext(), initialDraft(peopleContext()), { self: ["Ya tienes un lugar en este evento."] });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ya tienes un lugar en este evento.");
  });

  test("when the request is full, unselected people are disabled with the limit explained", () => {
    const ctx = baseContext("FREE", {
      registration: { ...baseContext().registration, max_participants_per_request: 1 },
      candidates: [candidate({ candidate_key: "self", relation: "SELF" }), candidate({ candidate_key: GUEST, relation: "GUEST", display_name: "Caro" })],
    });
    const html = participants(ctx);
    expect(html).toContain("Una solicitud admite máximo 1 participantes.");
  });

  test("empty state: nothing to offer says so (no silent blank)", () => {
    const html = participants(baseContext("FREE", { candidates: [] }));
    expect(html).toContain("Todavía no hay personas para inscribir");
    expect(html).toContain("Nadie puede inscribirse por ahora.");
  });

  test("offers inline ways to add friends, guests and minors, then refresh", () => {
    const html = participants();
    expect(html).toContain('href="/cuenta/amigos"');
    expect(html).toContain('href="/cuenta/invitados"');
    expect(html).toContain('href="/cuenta/menores"');
    expect(html).toContain("Actualizar lista");
  });
});

describe("P2-AC-07 dynamic form + modality/category step (component)", () => {
  function details(ctx = baseContext(), draft: Draft, errors = {}) {
    return renderToStaticMarkup(
      <StepDetails ctx={ctx} draft={draft} errors={errors} rowErrors={{}} headingRef={null} onModality={noop} onCategory={noop} onResponse={noop} />,
    );
  }

  test("shows modalities with price/distance, the category select when the buyer must pick, and the server form fields with labels", () => {
    const ctx = baseContext("EXTERNAL_WHATSAPP");
    let draft = setModality(ctx, initialDraft(ctx), "self", ID.m10k);
    draft = setResponse(draft, "self", "shirt_size", "M");
    const html = details(ctx, draft);
    expect(html).toContain("10 km");
    expect(html).toContain("$350");
    expect(html).toContain("Talla de playera");
    expect(html).toContain("Club");
    expect(html).toContain("Ritmo (min/km)"); // the 10K form is appended to the edition-wide one
    expect(html).toContain("Categoría");
    expect(html).toMatch(/for="p-self-field-shirt_size"/);
  });

  test("a modality closed or sold out stays visible, disabled, with its reason", () => {
    const ctx = baseContext();
    const sold = { ...ctx, modalities: ctx.modalities.map((m) => (m.modality_id === ID.m10k ? { ...m, registrable: false, availability_state: "SOLD_OUT" as const, unavailable_reason: "SOLD_OUT" as const } : m)) };
    const html = details(sold, initialDraft(sold));
    expect(html).toContain("Agotado");
    expect(html).toContain(`aria-describedby="p-self-modality-${ID.m10k}-reason"`);
  });

  test("hold-caused unavailability is never worded as sold out", () => {
    const ctx = baseContext();
    const held = { ...ctx, modalities: ctx.modalities.map((m) => (m.modality_id === ID.m10k ? { ...m, registrable: false, availability_state: "TEMPORARILY_UNAVAILABLE" as const, unavailable_reason: "TEMPORARILY_UNAVAILABLE" as const } : m)) };
    const html = details(held, initialDraft(held));
    expect(html).toContain("Temporalmente no disponible");
    expect(html).not.toContain("Agotado");
  });

  test("a SYSTEM_DERIVES modality shows the derived category read-only with the hint", () => {
    const base = baseContext();
    const ctx = baseContext("FREE", {
      modalities: base.modalities.map((m) => (m.modality_id === ID.m10k ? { ...m, category_mode: "SYSTEM_DERIVES" } : m)),
      candidates: [candidate({ candidate_key: "self", relation: "SELF", modalities: [verdict(ID.m5k), verdict(ID.m10k, { derived_category_id: ID.catMaster })] })],
    });
    const html = details(ctx, setModality(ctx, initialDraft(ctx), "self", ID.m10k));
    expect(html).toContain('data-testid="derived-category"');
    expect(html).toContain("Máster 40+");
    expect(html).toContain("se asigna automáticamente");
    expect(html).not.toContain('id="p-self-category"');
  });

  test("inline errors are associated to their control and announced; the summary counts participants", () => {
    const ctx = baseContext();
    const draft = setModality(ctx, initialDraft(ctx), "self", ID.m10k);
    const errors = validateDetails(ctx, draft);
    const html = details(ctx, draft, errors);
    expect(html).toContain('id="p-self-field-shirt_size-error"');
    expect(html).toContain('aria-describedby="p-self-field-shirt_size-error"');
    expect(html).toContain("Este campo es obligatorio.");
    expect(html).toContain("Hay un participante con datos por corregir.");
  });
});

describe("DynamicField renders every server field type with an accessible name", () => {
  const field = (type: string, extra: Record<string, unknown> = {}) =>
    ({ field_key: "f", label: "Mi campo", field_type: type, required: true, validation_config: {}, options_config: {}, sort_order: 1, ...extra }) as never;
  const render = (type: string, extra: Record<string, unknown> = {}, error?: string, value?: never) =>
    renderToStaticMarkup(<DynamicField scope="s" field={field(type, extra)} value={value} error={error} onChange={noop} />);

  test.each(["TEXT", "TEXTAREA", "NUMBER", "DATE"])("%s has a visible label and required marker", (type) => {
    const html = render(type);
    expect(html).toContain("Mi campo");
    expect(html).toContain('for="s-field-f"');
    expect(html).toContain('id="s-field-f"');
  });
  test("SELECT shows the chosen option label, MULTISELECT a checkbox per option, BOOLEAN Sí/No", () => {
    const options = { options_config: { options: [{ value: "a", label: "Opción A" }, { value: "b", label: "Opción B" }] } };
    expect(render("SELECT", options, undefined, "a" as never)).toContain("Opción A");
    const multi = render("MULTISELECT", options);
    expect(multi).toContain("Opción A");
    expect(multi).toContain("Opción B");
    expect(multi).toContain("<legend");
    const bool = render("BOOLEAN");
    expect(bool).toContain("Sí");
    expect(bool).toContain("No");
    expect(bool).toContain("radiogroup");
  });
  test("an error is announced and wired for TEXT", () => {
    const html = render("TEXT", {}, "Este campo es obligatorio.");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="s-field-f-error"');
  });
});

describe("P2-AC-03.b legal step (component)", () => {
  function legal(ctx: ReturnType<typeof peopleContext>, draft: Draft, rowErrors: Record<string, string[]> = {}) {
    return renderToStaticMarkup(<StepLegal ctx={ctx} draft={draft} rowErrors={rowErrors} headingRef={null} onAcceptAccount={async () => null} onAccepted={noop} onRefresh={noop} refreshing={false} />);
  }

  test("self gets an acceptance checkbox; an adult Friend gets a status with 'Pendiente de aceptación de <nombre>', never a checkbox", () => {
    const ctx = peopleContext("EXTERNAL_WHATSAPP");
    const draft = toggleCandidate(ctx, initialDraft(ctx), FRIEND, true);
    const html = legal(ctx, draft);
    const cards = html.split('data-testid="legal-card"');
    const selfCard = cards.find((chunk) => chunk.includes("Ana Prueba"))!;
    const friendCard = cards.find((chunk) => chunk.includes("Beto Amigo"))!;
    expect(selfCard).toContain("Acepto: Deslinde de responsabilidad deportiva");
    expect(selfCard).toContain('role="checkbox"');
    expect(friendCard).not.toContain('role="checkbox"');
    expect(friendCard).toContain("Pendiente de aceptación de Beto Amigo");
    expect(friendCard).toContain("debe aceptar personalmente desde su cuenta");
  });

  test("FREE explains the block and offers 'Copiar enlace'; WhatsApp explains the request may be sent", () => {
    const free = peopleContext("FREE");
    const freeHtml = legal(free, toggleCandidate(free, initialDraft(free), FRIEND, true));
    expect(freeHtml).toContain("Copiar enlace");
    expect(freeHtml).toContain("necesitamos su aceptación antes de enviar");
    const wa = peopleContext("EXTERNAL_WHATSAPP");
    const waHtml = legal(wa, toggleCandidate(wa, initialDraft(wa), FRIEND, true));
    expect(waHtml).toContain("Puedes enviar la solicitud");
    expect(waHtml).toContain("antes de que venza el apartado");
  });

  test("the owner accepts for an adult Guest (explicit checkbox naming the guest)", () => {
    const ctx = peopleContext();
    const draft = toggleCandidate(ctx, initialDraft(ctx), GUEST, true);
    const html = legal(ctx, draft);
    expect(html).toContain("Acepto por Caro Invitada: Deslinde de responsabilidad deportiva");
    expect(html).toContain("Aceptas en nombre de Caro Invitada");
  });

  test("an already accepted document shows as accepted and is not asked again", () => {
    const ctx = peopleContext();
    const accepted = { ...ctx, candidates: ctx.candidates.map((c) => (c.candidate_key === "self" ? { ...c, acceptance: { ...c.acceptance, missing_document_version_ids: [] } } : c)) };
    const html = legal(accepted, initialDraft(accepted));
    expect(html).toContain("aceptado");
    expect(html).not.toContain("Acepto: Deslinde");
  });

  test("the account-level gate appears with the documents, never auto-accepted (checkbox unchecked, button disabled)", () => {
    const ctx = baseContext("FREE", {
      account_legal: {
        needs_acceptance: true,
        needs_reacceptance: true,
        missing_document_version_ids: [ID.terms],
        documents: [{ document_type: "TERMS_OF_SERVICE", document_key: "TERMS_OF_SERVICE", legal_document_version_id: ID.terms, version: 2, published_at: null, status: "NEW_VERSION", accepted_at: "2026-01-01T00:00:00+00:00", accepted_version: 1 }],
      },
    });
    const html = legal(ctx, initialDraft(ctx));
    expect(html).toContain('data-testid="account-legal-gate"');
    expect(html).toContain("Actualizamos nuestros documentos");
    expect(html).toContain("Términos y condiciones");
    expect(html).toContain('aria-checked="false"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Aceptar y continuar/s);
  });

  test("a participant-level server error is shown on the card", () => {
    const ctx = peopleContext();
    const html = legal(ctx, initialDraft(ctx), { self: ["Falta aceptar los documentos del evento."] });
    expect(html).toContain("Falta aceptar los documentos del evento.");
  });
});

describe("review step (component)", () => {
  function review(ctx: ReturnType<typeof peopleContext>, draft: Draft, blockedReason: string | null = null, retryAt: string | null = null) {
    return renderToStaticMarkup(
      <StepReview ctx={ctx} draft={draft} headingRef={null} submitting={false} retryAt={retryAt} onRetryReady={noop} blockedReason={blockedReason} onEdit={noop} onSubmit={noop} />,
    );
  }
  function ready(mode: "FREE" | "EXTERNAL_WHATSAPP") {
    const ctx = peopleContext(mode);
    let draft = initialDraft(ctx);
    draft = setModality(ctx, draft, "self", ID.m5k);
    draft = setResponse(draft, "self", "shirt_size", "M");
    draft = setAccepted(draft, "self", ID.waiver, true);
    return { ctx, draft };
  }

  test("WhatsApp: says it reserves (apartar), is not a payment, shows the projected 24 h limit and the estimate", () => {
    const { ctx, draft } = ready("EXTERNAL_WHATSAPP");
    const html = review(ctx, draft);
    expect(html).toContain("Esto aparta tus lugares, no es un pago");
    expect(html).toContain("Apartar mis lugares");
    expect(html).toContain("24 horas como máximo, sin prórrogas");
    expect(html).toContain("$250");
    expect(html).not.toMatch(/pagado|Confirmar inscripción/);
  });

  test("FREE: confirms at once, no hold language, no price", () => {
    const { ctx, draft } = ready("FREE");
    const html = review(ctx, draft);
    expect(html).toContain("Se confirma al instante");
    expect(html).toContain("Confirmar inscripción");
    expect(html).toContain("Gratis");
    expect(html).not.toMatch(/apartamos/);
  });

  test("a blocked submit is disabled and explains why", () => {
    const { ctx, draft } = ready("FREE");
    const html = review(ctx, draft, "Acepta los documentos de tu cuenta en el paso “Legal”.");
    expect(html).toContain("Todavía no puedes enviar");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Confirmar inscripción/s);
  });

  test("rate limited (5/10 min): the submit is disabled and a countdown is shown", () => {
    const { ctx, draft } = ready("FREE");
    const html = review(ctx, draft, null, new Date(Date.now() + 90_000).toISOString());
    expect(html).toContain("Podrás intentar de nuevo en");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Confirmar inscripción/s);
  });
});
