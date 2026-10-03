import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LegalBanner } from "@/components/account/legal-banner";
import { LegalConsent, LegalReacceptance } from "@/components/account/legal-acceptance";
import { OnboardingForm } from "@/components/account/onboarding-form";
import { PassDetail } from "@/components/account/pass-detail";
import { PassRow } from "@/components/account/pass-row";
import { RequestCard } from "@/components/account/request-card";
import { ExpiredNotice, HoldPanel, RequestParticipants, RequestStages } from "@/components/registration/request-parts";
import type { PassView, RequestView } from "@/lib/client/account-types";
import { accountLegalStatusResponseSchema, type AccountLegalStatusResponse } from "@/lib/shared/legal";
import { buildWhatsAppUrl } from "@/lib/shared/whatsapp";

const ID = {
  edition: "50000000-0000-4000-8000-0000000d0001",
  request: "72000000-0000-4000-8000-0000000d0001",
  pass: "80000000-0000-4000-8000-0000000d0001",
  terms: "64000000-0000-4000-8000-0000000d0003",
  privacy: "64000000-0000-4000-8000-0000000d0004",
};

function request(overrides: Partial<RequestView> = {}): RequestView {
  return {
    registration_request_id: ID.request,
    public_reference: "R-AB12-CD34",
    edition: { edition_id: ID.edition, name: "Demo WhatsApp 10K", slug: "demo-whatsapp" },
    status: "PENDING_CONFIRMATION",
    effective_status: "PENDING_CONFIRMATION",
    registration_mode: "EXTERNAL_WHATSAPP",
    currency: "MXN",
    total_snapshot_minor: 35000,
    created_at: "2026-10-03T12:00:00+00:00",
    expires_at: "2026-10-04T12:00:00+00:00",
    confirmed_at: null,
    canceled_at: null,
    server_time: "2026-10-03T12:00:05+00:00",
    whatsapp_url: buildWhatsAppUrl({ phoneE164: "+525555550100", editionName: "Demo WhatsApp 10K", publicReference: "R-AB12-CD34" }),
    participants: [
      {
        request_participant_id: "81000000-0000-4000-8000-0000000d0001",
        participant_kind: "PROFILE",
        is_buyer: true,
        display_name: "Ana Prueba",
        modality: { modality_id: "60000000-0000-4000-8000-0000000d0001", name: "10K" },
        category: null,
        price_snapshot_minor: 35000,
        legal_acceptance_status: "PENDING",
        kit_selection: null,
        registration: null,
      },
    ],
    ...overrides,
  };
}

describe("P2-AC-09.c / P2-AC-10.b account request card and parts", () => {
  test("pending: reference, absolute countdown from the server, server-built wa.me, no 'paid'", () => {
    const html = renderToStaticMarkup(<RequestCard request={request()} />);
    expect(html).toContain("R-AB12-CD34");
    expect(html).toContain("Apartado");
    expect(html).toContain('role="timer"');
    expect(html).toContain("El apartado vence en");
    expect(html).toContain("Completar por WhatsApp");
    expect(html).toMatch(/href="https:\/\/wa\.me\/525555550100\?text=/);
    expect(html).not.toMatch(/pagad/i);
  });

  test("effective expiry wins over the stored PENDING status: no countdown or wa.me, and the next step is a NEW request (the place is not restored)", () => {
    const html = renderToStaticMarkup(<RequestCard request={request({ effective_status: "EXPIRED", whatsapp_url: null })} />);
    expect(html).not.toContain('role="timer"');
    expect(html).not.toContain("wa.me");
    expect(html).toContain("Expirada");
    expect(html).toContain("El lugar anterior no se restaura");
    expect(html).toContain('href="/inscripcion/demo-whatsapp"');
  });

  test("a stored PENDING request already past expires_at on the server clock renders as expired even if effective_status lags", () => {
    const html = renderToStaticMarkup(<RequestCard request={request({ server_time: "2026-10-04T12:00:01+00:00" })} />);
    expect(html).toContain("Expirada");
    expect(html).not.toContain('role="timer"');
  });

  test("HoldPanel never extends the hold and says apartar is not paying", () => {
    const html = renderToStaticMarkup(<HoldPanel request={request()} onExpire={() => {}} />);
    expect(html).toContain("Apartar no es pagar");
    expect(html).toContain("no se extiende por abrir WhatsApp ni por recargar");
    expect(renderToStaticMarkup(<HoldPanel request={request({ expires_at: null })} onExpire={() => {}} />)).toBe("");
  });

  test("ExpiredNotice links to a new request and to the event, and can hide its own restart when the caller has one", () => {
    const html = renderToStaticMarkup(<ExpiredNotice request={request()} />);
    expect(html).toContain("Hacer una nueva solicitud");
    expect(html).toContain("/inscripcion/demo-whatsapp");
    expect(html).toContain("/eventos/demo-whatsapp");
    expect(html).toContain("no se restaura");
    expect(renderToStaticMarkup(<ExpiredNotice request={request()} restart="none" />)).not.toContain("Hacer una nueva solicitud");
  });

  test("participants: buyer is 'Tú', document status per person, price snapshot and total", () => {
    const guest = { ...request().participants[0], request_participant_id: "81000000-0000-4000-8000-0000000d0002", participant_kind: "GUEST" as const, is_buyer: false, display_name: "Caro Invitada", legal_acceptance_status: "PENDING" as const };
    const html = renderToStaticMarkup(<RequestParticipants request={{ ...request(), participants: [request().participants[0], guest], total_snapshot_minor: 70000 }} status="PENDING_CONFIRMATION" />);
    expect(html).toContain("Tú");
    expect(html).toContain("Te falta aceptar los documentos");
    expect(html).toContain("Pendiente de aceptación de Caro Invitada");
    expect(html).toContain("$700");
    expect(html).toContain("Invitado");
  });

  test("stages separate REQUEST, HOLD and REGISTRATION", () => {
    const html = renderToStaticMarkup(<RequestStages status="PENDING_CONFIRMATION" mode="EXTERNAL_WHATSAPP" />);
    expect(html).toContain("1. Solicitud");
    expect(html).toContain("2. Apartado");
    expect(html).toContain("3. Inscripción");
    expect(html).not.toMatch(/Confirmada/);
    expect(renderToStaticMarkup(<RequestStages status="CONFIRMED" mode="FREE" />)).not.toContain("Apartado");
  });
});

function pass(overrides: Partial<PassView> = {}): PassView {
  return {
    participant_pass_id: ID.pass,
    public_code: "PS-ABCD-1234",
    status: "ACTIVE",
    issued_at: "2026-10-03T12:00:00+00:00",
    canceled_at: null,
    has_active_credential: true,
    registration: { registration_id: "82000000-0000-4000-8000-0000000d0001", registration_number: "I-AAAA-BBBB", status: "CONFIRMED", confirmed_at: "2026-10-03T12:00:00+00:00" },
    participant: { participant_kind: "PROFILE", is_self: true, display_name: "Ana Prueba" },
    edition: { edition_id: ID.edition, name: "Demo Gratis", slug: "demo-gratis", event_date: "2026-11-15" },
    modality: { modality_id: "60000000-0000-4000-8000-0000000d0001", name: "5K" },
    category: null,
    ...overrides,
  };
}

describe("P2-AC-12 pass views", () => {
  test("a valid pass shows event, holder, modality, registration number, public code and the QR button", () => {
    const html = renderToStaticMarkup(<PassDetail pass={pass()} />);
    expect(html).toContain("Demo Gratis");
    expect(html).toContain("Tu pase");
    expect(html).toContain("I-AAAA-BBBB");
    expect(html).toContain("PS-ABCD-1234");
    expect(html).toContain("Ver código QR");
    expect(html).toContain('data-pass-state="VALID"');
  });

  test("a revoked pass is not valid: badge, explanation, and no QR button in the detail or the list", () => {
    for (const html of [renderToStaticMarkup(<PassDetail pass={pass({ status: "REVOKED" })} />), renderToStaticMarkup(<ul><PassRow pass={pass({ status: "REVOKED" })} /></ul>)]) {
      expect(html).toContain("Revocado");
      expect(html).toContain("ya no es válido");
      expect(html).not.toContain("Ver código QR");
    }
  });

  test("a registration that is no longer confirmed also never offers a QR", () => {
    const html = renderToStaticMarkup(<PassDetail pass={pass({ registration: { ...pass().registration, status: "CANCELED" } })} />);
    expect(html).not.toContain("Ver código QR");
    expect(html).toContain("no está confirmada");
  });

  test("a replaced credential (no active credential yet) tells the previous QR is no longer valid but still allows the fresh render", () => {
    const html = renderToStaticMarkup(<PassDetail pass={pass({ has_active_credential: false })} />);
    expect(html).toContain("Código en preparación");
    expect(html).toContain("QR anterior ya no sirve");
    expect(html).toContain("Ver código QR");
  });

  test("the pass never renders a QR image or token by itself: the QR is a private on-demand render", () => {
    const html = renderToStaticMarkup(<PassDetail pass={pass()} />);
    expect(html).not.toMatch(/<img|RN1\.|render-qr/i);
  });

  test("a guest pass is labelled as the buyer's responsibility", () => {
    const html = renderToStaticMarkup(<ul><PassRow pass={pass({ participant: { participant_kind: "GUEST", is_self: false, display_name: "Caro Invitada" } })} /></ul>);
    expect(html).toContain("Pase de Caro Invitada");
    expect(html).toContain("A tu cargo");
  });
});

function legalStatus(overrides: Partial<AccountLegalStatusResponse> = {}): AccountLegalStatusResponse {
  return accountLegalStatusResponseSchema.parse({
    needs_acceptance: true,
    needs_reacceptance: false,
    missing_document_version_ids: [ID.terms, ID.privacy],
    server_time: "2026-10-03T12:00:00+00:00",
    documents: [
      { document_type: "TERMS_OF_SERVICE", document_key: "TERMS_OF_SERVICE", legal_document_version_id: ID.terms, version: 3, published_at: "2026-10-01T00:00:00Z", status: "NEVER_ACCEPTED", accepted_at: null, accepted_version: null },
      { document_type: "PRIVACY_NOTICE", document_key: "PRIVACY_NOTICE", legal_document_version_id: ID.privacy, version: 2, published_at: "2026-10-01T00:00:00Z", status: "NEVER_ACCEPTED", accepted_at: null, accepted_version: null },
    ],
    ...overrides,
  });
}

const profile = { full_name: null, date_of_birth: null, sex_code: null, phone_e164: null, emergency_contact_name: null, emergency_contact_phone_e164: null, emergency_contact_relationship: null };

describe("P2-AC-02.c OWN-05 onboarding legal acceptance", () => {
  test("onboarding shows the current versions with links to the public pages and an UNTICKED control", () => {
    const html = renderToStaticMarkup(<OnboardingForm profile={profile} next="/cuenta" legal={legalStatus().documents} />);
    expect(html).toContain('id="onboarding-legal"');
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('aria-checked="true"');
    expect(html).toContain('href="/legal/terminos"');
    expect(html).toContain("Términos y condiciones (versión 3)");
    expect(html).toContain('href="/legal/privacidad"');
    expect(html).toContain("Aviso de privacidad (versión 2)");
    expect(html).toContain("He leído y acepto");
  });

  test("with nothing published there is no control and nothing is demanded (no invented text)", () => {
    const html = renderToStaticMarkup(<OnboardingForm profile={profile} next="/cuenta" legal={[]} />);
    expect(html).not.toContain("onboarding-legal");
  });

  test("LegalConsent reports a missing acceptance accessibly", () => {
    const html = renderToStaticMarkup(<LegalConsent id="x" documents={legalStatus().documents} checked={false} onCheckedChange={() => {}} error="Debes aceptar los documentos para continuar." />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="x-error"');
  });

  test("re-acceptance: names the new version, says what was accepted before, has no dismiss and starts unticked with the action disabled", () => {
    const status = legalStatus({
      needs_reacceptance: true,
      documents: [{ ...legalStatus().documents[0], status: "NEW_VERSION", accepted_version: 2, accepted_at: "2026-09-01T00:00:00Z" }, { ...legalStatus().documents[1], status: "ACCEPTED", accepted_version: 2, accepted_at: "2026-09-01T00:00:00Z" }],
    });
    const html = renderToStaticMarkup(<LegalReacceptance initial={status} next="/cuenta" />);
    expect(html).toContain("Actualizamos nuestros documentos");
    expect(html).toContain("versión 3");
    expect(html).toContain("Aceptaste antes la versión 2");
    expect(html).toContain('aria-checked="false"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*Aceptar y continuar/);
    expect(html).not.toMatch(/Cerrar|Omitir|Después|Más tarde/);
    // The already-accepted document is not asked again.
    expect(html).not.toContain("Aviso de privacidad (versión 2)");
  });

  test("re-acceptance with everything accepted says the account is up to date", () => {
    const upToDate = legalStatus({
      needs_acceptance: false,
      missing_document_version_ids: [],
      documents: legalStatus().documents.map((d) => ({ ...d, status: "ACCEPTED" as const, accepted_version: d.version, accepted_at: "2026-10-02T00:00:00Z" })),
    });
    expect(renderToStaticMarkup(<LegalReacceptance initial={upToDate} next="/cuenta" />)).toContain("Tus documentos están al día");
  });

  test("account banner: says what is missing, links to the acceptance screen, has no dismiss, and is silent when everything is accepted", () => {
    const html = renderToStaticMarkup(<LegalBanner documents={legalStatus().documents} reacceptance />);
    expect(html).toContain("Actualizamos tus documentos legales");
    expect(html).toContain("Revisar y aceptar");
    expect(html).toContain("/cuenta/documentos?next=");
    expect(html).not.toMatch(/Cerrar aviso|dismiss/i);
    const accepted = legalStatus().documents.map((d) => ({ ...d, status: "ACCEPTED" as const }));
    expect(renderToStaticMarkup(<LegalBanner documents={accepted} reacceptance={false} />)).toBe("");
  });
});
