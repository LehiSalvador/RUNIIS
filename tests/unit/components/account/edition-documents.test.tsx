import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { EditionDocuments } from "@/components/account/edition-documents";
import { buildEditionAcceptanceItems } from "@/components/account/logic/edition-documents";
import { StepLegal } from "@/components/registration/step-legal";
import { initialDraft, toggleCandidate } from "@/components/registration/logic/model";
import { candidate, ID, MINOR_DOC, peopleContext, WAIVER_DOC } from "../../registration/fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const edition = { edition_id: ID.edition, name: "Demo Gratis 5K/10K", slug: "demo-gratis" };
const ward = candidate({
  candidate_key: `profile:${ID.minorProfile}`,
  relation: "WARD",
  public_profile_id: ID.minorProfile,
  display_name: "Dani Menor",
  is_minor: true,
  acceptance: { required_document_version_ids: [ID.waiver, ID.minorTerms], missing_document_version_ids: [ID.waiver, ID.minorTerms], buyer_can_accept: true, acceptor: "GUARDIAN" },
});
const items = buildEditionAcceptanceItems({
  editionId: ID.edition,
  actions: [{ action_type: "LEGAL_ACCEPTANCE_REQUIRED", edition, subject: { kind: "SELF" }, documents: [{ legal_document_version_id: ID.waiver, document_type: "SPORT_WAIVER", version: 3 }] }],
  contextDocuments: [WAIVER_DOC, MINOR_DOC],
  candidates: [ward],
});

describe("P2-AC-03.c edition documents screen (component)", () => {
  const html = renderToStaticMarkup(<EditionDocuments edition={edition} items={items} registrationOpen />);

  test("one card per person: the adult accepts for themself, the guardian for the minor", () => {
    const cards = html.split('data-testid="edition-docs-card"').slice(1);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("Tus documentos");
    expect(cards[0]).toContain("nadie puede aceptar estos documentos por ti");
    expect(cards[1]).toContain("Documentos de Dani Menor");
    expect(cards[1]).toContain("Aceptas como su responsable");
  });

  test("never pre-ticked: one unchecked checkbox per document version, accept disabled until every one is ticked", () => {
    const boxes = html.match(/role="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(3); // waiver (self) + waiver and minor terms (minor)
    for (const box of boxes) {
      expect(box).toContain('aria-checked="false"');
      expect(box).not.toContain('aria-checked="true"');
    }
    expect(html).toContain("Leí y acepto: Deslinde de responsabilidad deportiva (versión 3)");
    expect(html).toContain("Leí y acepto como responsable: Términos para menores de edad (versión 1)");
    const buttons = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Aceptar documentos<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toContain("disabled");
  });

  test("each document can be read before accepting", () => {
    expect(html).toContain("Leer<span");
    expect(html).toContain("Deslinde de responsabilidad deportiva</span>");
  });

  test("nothing pending: says so and offers the way back, no cards", () => {
    const empty = renderToStaticMarkup(<EditionDocuments edition={edition} items={[]} registrationOpen />);
    expect(empty).toContain("No tienes documentos pendientes de este evento");
    expect(empty).not.toContain("edition-docs-card");
    expect(empty).toContain('href="/eventos/demo-gratis"');
  });

  test("registration not open is explained", () => {
    expect(renderToStaticMarkup(<EditionDocuments edition={edition} items={[]} registrationOpen={false} />)).toContain("no están abiertas");
  });
});

describe("P2-AC-03.d buyer's Friend / guardian block", () => {
  function legal(ctx: ReturnType<typeof peopleContext>, key: string) {
    return renderToStaticMarkup(
      <StepLegal ctx={ctx} draft={toggleCandidate(ctx, initialDraft(ctx), key, true)} rowErrors={{}} headingRef={null} onAcceptAccount={async () => null} onAccepted={() => {}} onRefresh={() => {}} refreshing={false} />,
    );
  }

  test("an adult Friend gets 'Copiar enlace'", () => {
    const ctx = peopleContext("FREE");
    expect(legal(ctx, `profile:${ID.friendProfile}`)).toContain("Copiar enlace");
  });
});
