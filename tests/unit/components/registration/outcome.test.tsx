import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { blockedState } from "@/components/registration/logic/availability";
import { RequestOutcome, type OutcomeRequest } from "@/components/registration/request-outcome";
import { BlockedView, ExistingRegistrations } from "@/components/registration/status-views";
import { buildWhatsAppUrl } from "@/lib/shared/whatsapp";
import { registrationRequestSchema } from "@/lib/shared/registration-views";
import { baseContext, ID } from "../../registration/fixtures";

const PASS = "80000000-0000-4000-8000-0000000c0001";

function participant(overrides: Record<string, unknown> = {}) {
  return {
    request_participant_id: "81000000-0000-4000-8000-0000000c0001",
    participant_kind: "PROFILE",
    public_profile_id: ID.selfProfile,
    guest_participant_id: null,
    is_buyer: true,
    display_name: "Ana Prueba",
    modality: { modality_id: ID.m5k, name: "5K" },
    category: null,
    price_snapshot_minor: 25000,
    legal_acceptance_status: "ACCEPTED",
    kit_selection: null,
    registration: null,
    ...overrides,
  };
}

function request(input: Record<string, unknown> = {}): OutcomeRequest {
  const { whatsapp_url: overrideUrl, ...patch } = input;
  const parsed = registrationRequestSchema.parse({
    registration_request_id: ID.request,
    public_reference: "R-AB12-CD34",
    edition: { edition_id: ID.edition, name: "Demo WhatsApp 10K", slug: "demo-whatsapp" },
    status: "PENDING_CONFIRMATION",
    effective_status: "PENDING_CONFIRMATION",
    registration_mode: "EXTERNAL_WHATSAPP",
    currency: "MXN",
    total_snapshot_minor: 60000,
    created_at: "2026-10-03T12:00:00+00:00",
    expires_at: "2026-10-04T12:00:00+00:00",
    confirmed_at: null,
    canceled_at: null,
    revalidated_from_expired: false,
    whatsapp_phone_e164: "+525555550100",
    server_time: "2026-10-03T12:00:05+00:00",
    participants: [participant(), participant({ request_participant_id: "81000000-0000-4000-8000-0000000c0002", participant_kind: "GUEST", public_profile_id: null, guest_participant_id: ID.guest, is_buyer: false, display_name: "Caro Invitada", modality: { modality_id: ID.m10k, name: "10K" }, price_snapshot_minor: 35000, legal_acceptance_status: "PENDING" })],
    ...patch,
  });
  return { ...parsed, whatsapp_url: overrideUrl !== undefined ? (overrideUrl as string | null) : buildWhatsAppUrl({ phoneE164: "+525555550100", editionName: "Demo WhatsApp 10K", publicReference: "R-AB12-CD34" }) };
}

function render(req: OutcomeRequest, alreadyExisting = false) {
  return renderToStaticMarkup(<RequestOutcome request={req} alreadyExisting={alreadyExisting} onCanceled={() => {}} onRestart={() => {}} />);
}

describe("P2-AC-09.b WhatsApp pending screen", () => {
  const html = render(request());

  test("shows the reference, 'Apartado', the participants with the server price snapshot and the total", () => {
    expect(html).toContain("R-AB12-CD34");
    expect(html).toContain("Apartado");
    expect(html).toContain("Tus lugares están apartados");
    expect(html).toContain("Ana Prueba".replace("Ana Prueba", "Tú"));
    expect(html).toContain("Caro Invitada");
    expect(html).toContain("$250");
    expect(html).toContain("$350");
    expect(html).toContain("$600");
  });

  test("has the absolute countdown (timer from the server expires_at), the WhatsApp handoff and cancel", () => {
    expect(html).toContain('data-testid="hold-panel"');
    expect(html).toContain("El apartado vence en");
    expect(html).toContain('role="timer"');
    expect(html).toContain('data-testid="whatsapp-handoff"');
    expect(html).toContain("Continuar por WhatsApp");
    expect(html).toContain("Cancelar solicitud");
  });

  test("the wa.me link comes from the server handoff and carries only the edition name and the public reference", () => {
    const href = html.match(/data-testid="whatsapp-handoff"/) ? html.match(/href="(https:\/\/wa\.me\/[^"]+)"/)![1].replaceAll("&amp;", "&") : "";
    const url = new URL(href);
    expect(url.hostname).toBe("wa.me");
    expect(decodeURIComponent(url.search)).toBe("?text=Hola. Quiero completar mi inscripción a Demo WhatsApp 10K. Referencia: R-AB12-CD34.");
    expect(href).not.toMatch(/Ana|Caro|@|1991/);
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("never presents a request as paid or confirmed; says apartar is not paying and nothing extends the time", () => {
    expect(html).not.toMatch(/pagad|Confirmada|confirmó/i);
    expect(html).toContain("Apartar no es pagar");
    expect(html).toContain("no se extiende por abrir WhatsApp ni por recargar");
  });

  test("shows each person's document status: the buyer's own and 'Pendiente de aceptación de <nombre>'", () => {
    expect(html).toContain("Documentos aceptados");
    expect(html).toContain("Pendiente de aceptación de Caro Invitada");
  });

  test("a request that was already pending before this visit says so (one pending request per edition)", () => {
    expect(render(request(), true)).toContain("Ya tienes una solicitud pendiente para este evento");
  });

  test("effective expiry wins over the stored status: no countdown, no WhatsApp, no cancel, retry offered", () => {
    const expired = render(request({ status: "PENDING_CONFIRMATION", effective_status: "EXPIRED", whatsapp_url: null }));
    expect(expired).not.toContain('role="timer"');
    expect(expired).not.toContain('data-testid="whatsapp-handoff"');
    expect(expired).not.toContain("Cancelar solicitud");
    expect(expired).toContain("El apartado venció");
    expect(expired).toContain("Hacer una nueva solicitud");
  });

  test("a canceled request offers a new one and never a countdown", () => {
    const canceled = render(request({ status: "CANCELED_BY_BUYER", effective_status: "CANCELED_BY_BUYER", whatsapp_url: null, canceled_at: "2026-10-03T13:00:00+00:00" }));
    expect(canceled).toContain("Cancelada por ti");
    expect(canceled).not.toContain('role="timer"');
    expect(canceled).toContain("Hacer una nueva solicitud");
  });
});

describe("P2-AC-08.b FREE confirmation screen", () => {
  const free = request({
    registration_mode: "FREE",
    status: "CONFIRMED",
    effective_status: "CONFIRMED",
    expires_at: null,
    whatsapp_phone_e164: null,
    confirmed_at: "2026-10-03T12:00:01+00:00",
    total_snapshot_minor: 0,
    edition: { edition_id: ID.edition, name: "Demo Gratis", slug: "demo-gratis" },
    participants: [
      participant({ price_snapshot_minor: 0, registration: { registration_id: "82000000-0000-4000-8000-0000000c0001", registration_number: "I-AAAA-BBBB", status: "CONFIRMED", participant_pass_id: PASS } }),
      participant({
        request_participant_id: "81000000-0000-4000-8000-0000000c0003",
        public_profile_id: ID.friendProfile,
        is_buyer: false,
        display_name: "Beto Amigo",
        price_snapshot_minor: 0,
        registration: { registration_id: "82000000-0000-4000-8000-0000000c0002", registration_number: "I-CCCC-DDDD", status: "CONFIRMED", participant_pass_id: null },
      }),
    ],
    whatsapp_url: null,
  });
  const html = render({ ...free, whatsapp_url: null });

  test("confirms immediately with registration numbers and a link to the buyer's pass, no hold, no WhatsApp, no payment", () => {
    expect(html).toContain("¡Listo! Tu inscripción está confirmada");
    expect(html).toContain("I-AAAA-BBBB");
    expect(html).toContain(`href="/cuenta/pases/${PASS}"`);
    expect(html).toContain('href="/cuenta/pases"');
    expect(html).not.toContain('role="timer"');
    expect(html).not.toContain("WhatsApp");
    expect(html).not.toMatch(/pagad|Apartado|apartad/i);
    expect(html).toContain("Gratis");
  });

  test("a Friend's pass is never offered to the buyer: it says the Friend gets it in their own account", () => {
    expect(html).toContain("I-CCCC-DDDD");
    expect(html).toContain("Recibirá su pase en su propia cuenta.");
    expect(html.match(/Ver pase/g)).toHaveLength(1);
  });

  test("links to the request and back to the event", () => {
    expect(html).toContain(`href="/cuenta/solicitudes/${ID.request}"`);
    expect(html).toContain('href="/eventos/demo-gratis"');
  });
});

describe("P2-AC-04 closed / sold-out / not-open view and existing registrations", () => {
  test("renders the blocked state with a refresh when it may change and a way back to the event", () => {
    const ctx = baseContext("FREE", { registration: { ...baseContext().registration, can_register: false, blocking_code: "REGISTRATION_NOT_OPEN" }, edition: { ...baseContext().edition, registration_state: "PAUSED" } });
    const state = blockedState(ctx)!;
    const html = renderToStaticMarkup(<BlockedView state={state} onRefresh={() => {}} refreshing={false} edition={ctx.edition} />);
    expect(html).toContain('data-testid="registration-blocked"');
    expect(html).toContain("Las inscripciones están en pausa");
    expect(html).toContain("Actualizar disponibilidad");
    expect(html).toContain('href="/eventos/demo-gratis"');
  });

  test("a closed edition offers no refresh", () => {
    const ctx = baseContext("FREE", { registration: { ...baseContext().registration, can_register: false, blocking_code: "REGISTRATION_CLOSED" } });
    const html = renderToStaticMarkup(<BlockedView state={blockedState(ctx)!} onRefresh={() => {}} refreshing={false} edition={ctx.edition} />);
    expect(html).not.toContain("Actualizar disponibilidad");
    expect(html).toContain("Las inscripciones ya cerraron");
  });

  test("existing registrations list the person, modality, number and only the passes the buyer may open", () => {
    const html = renderToStaticMarkup(
      <ExistingRegistrations
        registrations={[
          { registration_id: "82000000-0000-4000-8000-0000000c0001", registration_number: "I-AAAA-BBBB", status: "CONFIRMED", registration_request_id: ID.request, confirmed_at: null, is_titular: true, participant_display_name: "Ana", modality: { modality_id: ID.m5k, name: "5K" }, participant_pass_id: PASS },
          { registration_id: "82000000-0000-4000-8000-0000000c0002", registration_number: "I-CCCC-DDDD", status: "CONFIRMED", registration_request_id: ID.request, confirmed_at: null, is_titular: false, participant_display_name: "Beto", modality: { modality_id: ID.m5k, name: "5K" }, participant_pass_id: null },
        ]}
      />,
    );
    expect(html).toContain("Ya tienes inscripciones en este evento");
    expect(html.match(/Ver pase/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<ExistingRegistrations registrations={[]} />)).toBe("");
  });
});
