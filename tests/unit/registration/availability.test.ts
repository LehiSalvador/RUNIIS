import { describe, expect, test } from "vitest";
import { blockedState } from "@/components/registration/logic/availability";
import { baseContext } from "./fixtures";

const base = baseContext();
const withRegistration = (patch: Record<string, unknown>, edition: Record<string, unknown> = {}) =>
  ({ ...base, edition: { ...base.edition, ...edition }, registration: { ...base.registration, ...patch } }) as typeof base;

describe("P2-AC-04 closed / not-open / sold-out states render correctly (distinct copy, T12 section 5)", () => {
  test("open with registrable modalities is not blocked", () => {
    expect(blockedState(base)).toBeNull();
  });

  test("not open yet shows the opening date; paused is its own message", () => {
    const soon = blockedState(withRegistration({ can_register: false, blocking_code: "REGISTRATION_NOT_OPEN", opens_at: "2026-10-23T05:00:00+00:00" }, { registration_state: "NOT_OPEN" }), () => "22 de octubre")!;
    expect(soon.badge).toBe("NOT_OPEN");
    expect(soon.body).toContain("22 de octubre");
    const paused = blockedState(withRegistration({ can_register: false, blocking_code: "REGISTRATION_NOT_OPEN" }, { registration_state: "PAUSED" }))!;
    expect(paused.title).toBe("Las inscripciones están en pausa");
    const undated = blockedState(withRegistration({ can_register: false, blocking_code: "REGISTRATION_NOT_OPEN", opens_at: null }, { registration_state: "NOT_OPEN" }))!;
    expect(undated.body).toMatch(/aún no se publica/);
  });

  test("closed, canceled and postponed editions", () => {
    expect(blockedState(withRegistration({ can_register: false, blocking_code: "REGISTRATION_CLOSED" }))!.title).toBe("Las inscripciones ya cerraron");
    expect(blockedState(withRegistration({ can_register: false, blocking_code: "EDITION_NOT_REGISTRABLE" }, { execution_state: "CANCELED" }))!.badge).toBe("CANCELED");
    expect(blockedState(withRegistration({ can_register: false, blocking_code: "EDITION_NOT_REGISTRABLE" }, { execution_state: "POSTPONED" }))!.badge).toBe("POSTPONED");
    expect(blockedState(withRegistration({ can_register: false, blocking_code: "EDITION_NOT_REGISTRABLE" }))!.title).toBe("Este evento no admite inscripciones en este momento");
  });

  test("a hold-only block is 'Temporalmente no disponible', never 'Agotado'; true sold out is 'Agotado'", () => {
    const held = { ...base, modalities: base.modalities.map((m) => ({ ...m, registrable: false, availability_state: "TEMPORARILY_UNAVAILABLE" as const, unavailable_reason: "TEMPORARILY_UNAVAILABLE" as const })) };
    const heldState = blockedState(held)!;
    expect(heldState.badge).toBe("TEMPORARILY_UNAVAILABLE");
    expect(heldState.title).not.toMatch(/Agotado/);
    expect(heldState.canRefresh).toBe(true);
    const sold = { ...base, modalities: base.modalities.map((m) => ({ ...m, registrable: false, availability_state: "SOLD_OUT" as const, unavailable_reason: "SOLD_OUT" as const })) };
    expect(blockedState(sold)!.title).toBe("Agotado");
  });
});
