import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { GuardianPanel } from "@/components/scanner/guardian-panel";
import { GuardianDesk, type GuardianRow } from "@/components/admin/raceday/guardian-desk";
import { scannerEditionDetail } from "@/components/scanner/session";
import { formatStaffLabel, staffIdSuffix } from "@/components/admin/staff-label";
import type { ParticipantMinimal } from "@/components/scanner/scan-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/x" }));

const minor: ParticipantMinimal = {
  registration_id: "72000000-0000-4000-8000-000000000001",
  registration_number: "I-ABCD-0001",
  registration_status: "CONFIRMED",
  participant_kind: "GUEST",
  display_name: "Mateo Prueba",
  modality: { modality_id: "m1", name: "5K" },
  category: null,
  is_minor: true,
  guardian_state: "PENDING",
  guardian: { display_name: "María Pérez", relationship_type: "PARENT" },
};

describe("guardian panel (scanner dialog)", () => {
  test("shows the guardian's name and relationship, and no other guardian field", () => {
    const html = renderToStaticMarkup(<GuardianPanel participant={minor} onDecided={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('data-testid="guardian-identity"');
    expect(html).toContain("María Pérez · Madre o padre");
    expect(html).not.toMatch(/@|tel[eé]fono|nacimiento|correo/i);
  });

  test("without a guardian object the identity block is absent (the decision still goes to the server)", () => {
    const html = renderToStaticMarkup(<GuardianPanel participant={{ ...minor, guardian: null }} onDecided={() => undefined} onCancel={() => undefined} />);
    expect(html).not.toContain("guardian-identity");
    expect(html).toContain("Verificar");
    expect(html).toContain("Rechazar");
  });
});

const row = (over: Partial<GuardianRow> & { status: GuardianRow["status"] }): GuardianRow => ({
  guardian_event_verification_id: `v-${over.status}`,
  is_final: over.status === "REJECTED",
  actions: over.status === "REJECTED" ? [] : ["VERIFY", "REJECT"],
  created_at: "2026-10-04T14:00:00.000Z",
  participant: {
    registration_id: `r-${over.status}`,
    registration_number: "I-ABCD-0001",
    display_name: over.status === "REJECTED" ? "Menor Rechazado" : "Menor Pendiente",
    modality: { name: "5K" },
    category: null,
    guardian: { display_name: "María Pérez", relationship_type: "PARENT" },
  },
  ...over,
});

describe("guardian desk", () => {
  test("a pending row offers exactly the actions the server lists and shows the guardian line", () => {
    const html = renderToStaticMarkup(<GuardianDesk rows={[row({ status: "PENDING" })]} timezone="America/Monterrey" />);
    expect(html).toContain("María Pérez · Madre o padre");
    expect(html).toContain("Verificar");
    expect(html).toContain("Rechazar");
  });

  test("a REJECTED row is final: listed with the trace, labelled 'Decisión final', and without any button", () => {
    const html = renderToStaticMarkup(<GuardianDesk rows={[row({ status: "REJECTED" })]} timezone="America/Monterrey" />);
    expect(html).toContain("Menor Rechazado");
    expect(html).toContain("Rechazada");
    expect(html).toContain("Decisión final");
    expect(html).not.toMatch(/>Verificar</);
    expect(html).not.toMatch(/>Rechazar</);
  });

  test("an action the server does not list is not drawn, whatever the status says", () => {
    const html = renderToStaticMarkup(<GuardianDesk rows={[row({ status: "PENDING", actions: ["VERIFY"] })]} timezone="America/Monterrey" />);
    expect(html).toContain("Verificar");
    expect(html).not.toMatch(/>Rechazar</);
  });

  test("a minor with no live assignment says so instead of inventing a guardian", () => {
    const base = row({ status: "PENDING" });
    const html = renderToStaticMarkup(<GuardianDesk rows={[{ ...base, participant: { ...base.participant, guardian: null } }]} timezone="America/Monterrey" />);
    expect(html).toContain("sin asignación vigente");
  });
});

describe("scanner Edition picker line", () => {
  test("date, Event (when its name differs from the Edition's) and a live state; nothing when there is none", () => {
    expect(scannerEditionDetail({ name: "10K 2026", event_name: "Carrera Regia", date: "2026-10-18", state: "IN_PROGRESS" })).toBe("18 oct 2026 · Carrera Regia · En curso");
    expect(scannerEditionDetail({ name: "Carrera Regia", event_name: "Carrera Regia", date: null, state: "SCHEDULED" })).toBeNull();
  });
});

describe("staff label with the opaque id suffix (P3SECA-11)", () => {
  test("the label is shown with the tail of the staff id so two same-named people can be told apart", () => {
    expect(staffIdSuffix("20000000-0000-4000-8000-0000003400AB")).toBe("3400ab");
    expect(formatStaffLabel("Ana R.", "20000000-0000-4000-8000-0000003400AB")).toBe("Ana R. · #3400ab");
    expect(formatStaffLabel("Ana R.", "20000000-0000-4000-8000-0000003400CD")).not.toBe(formatStaffLabel("Ana R.", "20000000-0000-4000-8000-0000003400AB"));
  });
  test("without an id the label stands alone; without a label there is nothing to show; the full id is never shown", () => {
    expect(formatStaffLabel("Staff #abc123", null)).toBe("Staff #abc123");
    expect(formatStaffLabel("  ", "20000000-0000-4000-8000-0000003400AB")).toBeNull();
    expect(formatStaffLabel(null, null)).toBeNull();
    expect(formatStaffLabel("Ana R.", "20000000-0000-4000-8000-0000003400AB")).not.toContain("20000000");
    expect(staffIdSuffix("zz")).toBeNull();
  });
});
