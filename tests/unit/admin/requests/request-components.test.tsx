import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { HoldAlert } from "@/components/admin/requests/hold-alert";
import { RequestFailureNotice } from "@/components/admin/requests/failure-notice";
import { ExpiryCell, StatusCell } from "@/components/admin/requests/request-cells";
import { RequestDetail } from "@/components/admin/requests/request-detail";
import { RequestQueue } from "@/components/admin/requests/request-queue";
import type { QueueRequest } from "@/components/admin/requests/request-logic";
import { describeFailure } from "@/components/admin/errors";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/eventos/e/solicitudes",
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const EDITION = "5a000000-0000-4000-8000-00000000000a";
const ZONE = "America/Monterrey";
const NOW = Date.parse("2026-10-04T18:00:00Z");

function request(id: string, overrides: Partial<QueueRequest> = {}): QueueRequest {
  return {
    registration_request_id: id,
    public_reference: `R-${id.slice(0, 4).toUpperCase()}-0001`,
    edition: { edition_id: EDITION, name: "Carrera", slug: "carrera" },
    status: "PENDING_CONFIRMATION",
    effective_status: "PENDING_CONFIRMATION",
    registration_mode: "EXTERNAL_WHATSAPP",
    currency: "MXN",
    total_snapshot_minor: 70000,
    created_at: "2026-10-04T17:00:00Z",
    expires_at: "2026-10-04T19:30:00Z",
    confirmed_at: null,
    canceled_at: null,
    revalidated_from_expired: false,
    whatsapp_phone_e164: "+528110000099",
    server_time: "2026-10-04T18:00:00Z",
    buyer: { public_profile_id: null, full_name: "Beatriz Compradora", phone_e164: "+528110001111", is_new_account: true },
    participants: [
      {
        request_participant_id: "p1",
        participant_kind: "PROFILE",
        public_profile_id: null,
        guest_participant_id: null,
        is_buyer: true,
        display_name: "Beatriz Compradora",
        modality: { modality_id: "m", name: "10K" },
        category: null,
        price_snapshot_minor: 35000,
        legal_acceptance_status: "ACCEPTED",
        kit_selection: null,
        registration: null,
      },
      {
        request_participant_id: "p2",
        participant_kind: "PROFILE",
        public_profile_id: null,
        guest_participant_id: null,
        is_buyer: false,
        display_name: "Carlos Amigo",
        modality: { modality_id: "m", name: "10K" },
        category: null,
        price_snapshot_minor: 35000,
        legal_acceptance_status: "PENDING",
        kit_selection: null,
        registration: null,
      },
    ],
    whatsapp_url: "https://wa.me/528110000099?text=x",
    ...overrides,
  } as QueueRequest;
}

describe("request queue rendering", () => {
  const pending = request("aaaa0000-0000-4000-8000-000000000001");
  const expiredLagging = request("bbbb0000-0000-4000-8000-000000000002", {
    effective_status: "EXPIRED",
    expires_at: "2026-10-04T17:00:00Z",
  });
  const confirmed = request("cccc0000-0000-4000-8000-000000000003", { status: "CONFIRMED", effective_status: "CONFIRMED", confirmed_at: "2026-10-04T17:30:00Z" });
  const html = renderToStaticMarkup(<RequestQueue editionId={EDITION} timeZone={ZONE} requests={[pending, expiredLagging, confirmed]} />);

  test("each row carries the columns of the spec and the actions staff opened the table for", () => {
    for (const header of ["Referencia", "Estado", "Expiración efectiva", "Comprador", "Participantes"]) expect(html).toContain(header);
    expect(html).toContain("Beatriz Compradora");
    expect(html).toContain("$700"); // price snapshot
    expect(html).toContain(">Confirmar<");
    expect(html).toContain(">Revalidar<"); // the expired one: explicit revalidation, same slot as Confirm
    expect(html).toContain("Cancelar");
  });

  test("the effective expiry is shown on its own, absolute in the Edition zone, and the lagging stored status is explained", () => {
    expect(html).toContain("Expirada");
    expect(html).toContain("El sistema aún no la marca como expirada");
    // 2026-10-04T19:30Z is 13:30 in Monterrey (UTC-6)
    expect(html).toContain("13:30");
    expect(html).toContain("Pendiente de aceptación de Carlos Amigo.");
  });

  test("nothing is ever presented as paid", () => {
    expect(html).not.toMatch(/pagad[oa]/i);
  });

  test("a confirmed request cannot be selected for bulk cancel and has no commands", () => {
    expect(html).toContain("R-CCCC-0001: no se puede cancelar en lote");
    // exactly two commands rows (pending, expired): the confirmed one has none
    expect(html.match(/>Confirmar</g)).toHaveLength(1);
    expect(html.match(/>Revalidar</g)).toHaveLength(1);
    expect(html.match(/>Cancelar<span class="sr-only"> R-/g)).toHaveLength(2);
    // bulk action is disabled until something is selected, and says what to do
    expect(html).toContain("Elige solicitudes pendientes para cancelarlas en lote.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Cancelar seleccionadas/);
  });

  test("with nothing to cancel in bulk the bar says so", () => {
    const only = renderToStaticMarkup(<RequestQueue editionId={EDITION} timeZone={ZONE} requests={[confirmed]} />);
    expect(only).toContain("No hay solicitudes pendientes que se puedan cancelar en lote en esta página.");
  });

  test("an empty page is an inline empty state, not a blank table", () => {
    const empty = renderToStaticMarkup(<RequestQueue editionId={EDITION} timeZone={ZONE} requests={[]} />);
    expect(empty).toContain("No hay solicitudes con estos filtros");
  });
});

describe("cells and quick look", () => {
  test("the expiry cell counts down from the server's clock while pending and stops claiming a hold once expired", () => {
    const row = request("dddd0000-0000-4000-8000-000000000004");
    const live = renderToStaticMarkup(<ExpiryCell request={row} effective="PENDING_CONFIRMATION" nowMs={NOW} timeZone={ZONE} />);
    expect(live).toContain("Quedan 1 h 30 min");
    const dead = renderToStaticMarkup(<ExpiryCell request={row} effective="EXPIRED" nowMs={NOW} timeZone={ZONE} />);
    expect(dead).toContain("Expiró");
    expect(dead).toContain("Ya no retiene cupo");
    expect(renderToStaticMarkup(<ExpiryCell request={{ ...row, expires_at: null }} effective="CONFIRMED" nowMs={NOW} timeZone={ZONE} />)).toContain("Sin vencimiento");
  });

  test("status badges use icon plus label, with the full name for screen readers", () => {
    const row = request("eeee0000-0000-4000-8000-000000000005");
    const markup = renderToStaticMarkup(<StatusCell request={row} effective="PENDING_CONFIRMATION" />);
    expect(markup).toContain("Pendiente");
    expect(markup).toContain("Pendiente de confirmar");
    expect(markup).toContain("<svg");
  });

  test("the quick look lists every participant, spells out the missing acceptance and offers the buyer's WhatsApp", () => {
    const row = request("ffff0000-0000-4000-8000-000000000006");
    const markup = renderToStaticMarkup(<RequestDetail request={row} effective="PENDING_CONFIRMATION" nowMs={NOW} timeZone={ZONE} />);
    expect(markup).toContain("Bloquea la confirmación");
    expect(markup).toContain("Pendiente de aceptación de Carlos Amigo.");
    expect(markup).toContain("Participantes (2)");
    expect(markup).toContain("Beatriz Compradora");
    expect(markup).toContain("Carlos Amigo");
    expect(markup).toContain('href="https://wa.me/528110001111"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("+528110000099"); // the Edition's number snapshot
    expect(markup).not.toMatch(/pagad[oa]/i);
  });

  test("an expired request explains the revalidation before the click", () => {
    const row = request("abab0000-0000-4000-8000-000000000007", { effective_status: "EXPIRED" });
    expect(renderToStaticMarkup(<RequestDetail request={row} effective="EXPIRED" nowMs={NOW} timeZone={ZONE} />)).toContain("el servidor revalida precio, cupo y aceptaciones");
  });
});

describe("failure notice and hold alert", () => {
  test("a refused confirmation shows the specific reason, one line per blocking participant, and the support reference", () => {
    const failure = {
      code: "LEGAL_ACCEPTANCE_REQUIRED" as const,
      requestId: "req-123",
      details: { issues: [{ participant_index: 1, code: "LEGAL_ACCEPTANCE_REQUIRED" }] },
    };
    const markup = renderToStaticMarkup(<RequestFailureNotice failure={failure} participants={request("a1a10000-0000-4000-8000-000000000008").participants} />);
    expect(markup).toContain("Falta la aceptación de términos");
    expect(markup).toContain("Carlos Amigo: falta aceptar los documentos legales.");
    expect(markup).toContain("req-123");
    expect(markup).not.toContain("LEGAL_ACCEPTANCE_REQUIRED");
  });

  test("a 429 on a staff action reads as wait-and-retry, never as a server error", () => {
    const view = describeFailure({ code: "RATE_LIMITED", requestId: "req-429", details: { retry_after_seconds: 7 } });
    expect(view.title).toBe("Demasiadas acciones");
    expect(view.message).toContain("espera un momento");
    expect(view.action).toBe("retry");
    expect(view.retryAfterSeconds).toBe(7);
    const markup = renderToStaticMarkup(<RequestFailureNotice failure={{ code: "RATE_LIMITED", requestId: "req-429", details: { retry_after_seconds: 7 } }} onRetry={() => undefined} />);
    expect(markup).toContain("Reintentar");
    expect(markup).toContain("Vuelve a intentar en 7 s");
  });

  test("the alert links to the affected requests and states that nothing is cancelled automatically", () => {
    const markup = renderToStaticMarkup(
      <HoldAlert
        editionId={EDITION}
        timeZone={ZONE}
        task={{
          admin_task_id: "11111111-2222-4333-8444-555555555555",
          title: "Posible acaparamiento de cupo en solicitudes pendientes",
          description: "Hay 18 lugares retenidos por solicitudes pendientes.",
          detected_at: "2026-10-04T18:00:00Z",
          status: "OPEN",
          metadata: {
            pending_places: 18,
            pending_requests: 4,
            top_buyer_places: 10,
            capacity: 200,
            triggers: ["SINGLE_BUYER"],
            top_requests: [{ registration_request_id: "r1", public_reference: "R-AAAA-0001", places: 10, new_account: true }],
          },
        }}
      />,
    );
    expect(markup).toContain("Nada se cancela automáticamente");
    expect(markup).toContain(`/admin/eventos/${EDITION}/solicitudes?status=PENDING_CONFIRMATION&amp;search=R-AAAA-0001`);
    expect(markup).toContain("Una sola cuenta retiene muchos lugares.");
    expect(markup).toContain("18 de 200 (9 %)");
    expect(markup).toContain("Recalcular alerta");
  });

  test("without a task the page says there is no alert, and still offers to recompute", () => {
    const markup = renderToStaticMarkup(<HoldAlert editionId={EDITION} timeZone={ZONE} task={null} />);
    expect(markup).toContain("Sin alerta de acaparamiento");
    expect(markup).toContain("Recalcular alerta");
    expect(markup).not.toContain("Nada se cancela automáticamente");
  });
});
