import { describe, expect, test } from "vitest";
import { mapCta } from "@/lib/server/domain/discovery/cta";

// Master §58 CTA mapping table, verbatim (UX spec J7 item 7). Every row of the table is exercised,
// plus the precedence rules between execution_state and registration_state that the table implies
// but does not spell out as pseudocode.

describe("mapCta: execution_state terminal/paused states win outright", () => {
  test("CANCELED -> Evento cancelado, regardless of registration_state", () => {
    expect(mapCta("OPEN", "CANCELED", "AVAILABLE")).toEqual({ code: "CANCELED", label: "Evento cancelado" });
    expect(mapCta("CLOSED", "CANCELED", null)).toEqual({ code: "CANCELED", label: "Evento cancelado" });
  });

  test("POSTPONED -> Evento aplazado, regardless of registration_state", () => {
    expect(mapCta("PAUSED", "POSTPONED", null)).toEqual({ code: "POSTPONED", label: "Evento aplazado" });
  });

  test("FINISHED -> Evento realizado, regardless of registration_state", () => {
    expect(mapCta("CLOSED", "FINISHED", null)).toEqual({ code: "FINISHED", label: "Evento realizado" });
  });
});

describe("mapCta: registration_state (execution_state SCHEDULED)", () => {
  test("CLOSED -> Inscripciones cerradas", () => {
    expect(mapCta("CLOSED", "SCHEDULED", null)).toEqual({ code: "CLOSED", label: "Inscripciones cerradas" });
  });

  test("NOT_OPEN -> Recordarme", () => {
    expect(mapCta("NOT_OPEN", "SCHEDULED", null)).toEqual({ code: "REMIND_ME", label: "Recordarme" });
  });

  test("PAUSED (not in the Master §58 table) falls back to the existing Temporalmente no disponible copy", () => {
    expect(mapCta("PAUSED", "SCHEDULED", null)).toEqual({ code: "TEMPORARILY_UNAVAILABLE", label: "Temporalmente no disponible" });
  });
});

describe("mapCta: OPEN + availability global_state (Master §36-37)", () => {
  test("AVAILABLE -> Inscribirme", () => {
    expect(mapCta("OPEN", "SCHEDULED", "AVAILABLE")).toEqual({ code: "REGISTER", label: "Inscribirme" });
  });

  test("LOW -> Inscribirme (still registrable, no false urgency copy change)", () => {
    expect(mapCta("OPEN", "SCHEDULED", "LOW")).toEqual({ code: "REGISTER", label: "Inscribirme" });
  });

  test("TEMPORARILY_UNAVAILABLE -> Temporalmente no disponible (never says Agotado for a holds-only block)", () => {
    expect(mapCta("OPEN", "SCHEDULED", "TEMPORARILY_UNAVAILABLE")).toEqual({
      code: "TEMPORARILY_UNAVAILABLE",
      label: "Temporalmente no disponible",
    });
  });

  test("SOLD_OUT -> Agotado", () => {
    expect(mapCta("OPEN", "SCHEDULED", "SOLD_OUT")).toEqual({ code: "SOLD_OUT", label: "Agotado" });
  });

  test("OPEN with a null availability (unexpected shape) still returns a safe REGISTER default, never throws", () => {
    expect(mapCta("OPEN", "SCHEDULED", null).code).toBe("REGISTER");
  });
});

describe("mapCta: IN_PROGRESS behaves like SCHEDULED for registration purposes", () => {
  test("OPEN + AVAILABLE during IN_PROGRESS still offers Inscribirme", () => {
    expect(mapCta("OPEN", "IN_PROGRESS", "AVAILABLE").code).toBe("REGISTER");
  });
});
