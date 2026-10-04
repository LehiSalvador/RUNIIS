import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { LifecyclePanel } from "@/components/admin/events/lifecycle-panel";
import { TRANSITION_ORDER, TRANSITIONS, editionTransitions, type EditionStates } from "@/components/admin/events/transitions";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/eventos/x",
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
}));

const ready = { ready: true, checks: [{ code: "MODALITY_PRESENT", ok: true }] };
const notReady = {
  ready: false,
  checks: [
    { code: "MODALITY_PRESENT", ok: false },
    { code: "DESCRIPTION_PRESENT", ok: false },
    { code: "SLUG_VALID", ok: true },
  ],
};
const draft: EditionStates = { publication_state: "DRAFT", registration_state: "NOT_OPEN", execution_state: "SCHEDULED" };

const byId = (states: EditionStates, publication = ready, registration = ready) =>
  Object.fromEntries(editionTransitions(states, { publication, registration }).map((item) => [item.spec.id, item]));

describe("transition catalogue", () => {
  test("every transition is listed once and points at its own API segment", () => {
    expect(new Set(TRANSITION_ORDER).size).toBe(11);
    for (const id of TRANSITION_ORDER) expect(TRANSITIONS[id].endpoint).toBe(id);
  });
});

describe("what each state allows", () => {
  test("a draft can be published, not hidden; registration can open or close; the race can be postponed, moved or canceled", () => {
    const items = byId(draft);
    expect(items.publish.applicable).toBe(true);
    expect(items.hide.applicable).toBe(false);
    expect(items["open-registration"].applicable).toBe(true);
    expect(items["pause-registration"].applicable).toBe(false);
    expect(items["close-registration"].applicable).toBe(true);
    for (const id of ["postpone", "reschedule", "cancel"]) expect(items[id].applicable, id).toBe(true);
    // a draft cannot start or finish, and the reason says to publish first
    expect(items.start.applicable).toBe(false);
    expect(items.start.stateReason).toContain("Publica");
    expect(items.finish.applicable).toBe(false);
  });

  test("a published, open edition can pause, hide, start and finish; it cannot publish again", () => {
    const items = byId({ publication_state: "PUBLISHED", registration_state: "OPEN", execution_state: "SCHEDULED" });
    expect(items.publish.applicable).toBe(false);
    expect(items.publish.stateReason).toContain("borrador");
    expect(items.hide.applicable).toBe(true);
    expect(items["pause-registration"].applicable).toBe(true);
    expect(items["resume-registration"].applicable).toBe(false);
    expect(items["open-registration"].applicable).toBe(false);
    expect(items.start.applicable).toBe(true);
    expect(items.finish.applicable).toBe(true);
  });

  test("paused registrations resume; postponed races reschedule or cancel but are not postponed again", () => {
    const paused = byId({ publication_state: "PUBLISHED", registration_state: "PAUSED", execution_state: "POSTPONED" });
    expect(paused["resume-registration"].applicable).toBe(true);
    expect(paused.postpone.applicable).toBe(false);
    expect(paused.reschedule.applicable).toBe(true);
    expect(paused.cancel.applicable).toBe(true);
    expect(paused.start.applicable).toBe(false);
  });

  test("a finished or canceled race allows no execution change", () => {
    for (const execution_state of ["FINISHED", "CANCELED"]) {
      const items = byId({ publication_state: "PUBLISHED", registration_state: "CLOSED", execution_state });
      for (const id of ["postpone", "reschedule", "cancel", "start", "finish", "close-registration"]) expect(items[id].applicable, `${execution_state}/${id}`).toBe(false);
    }
  });
});

describe("readiness blocks the guarded actions, using the server's own list", () => {
  test("publish is blocked while the server reports missing items, and lists exactly those", () => {
    const publish = byId(draft, notReady).publish;
    expect(publish.applicable).toBe(true);
    expect(publish.enabled).toBe(false);
    expect(publish.blockedBy.map((check) => check.code)).toEqual(["MODALITY_PRESENT", "DESCRIPTION_PRESENT"]);
    expect(publish.blockedBy[0].label).toBe("Al menos una modalidad");
  });

  test("publish is enabled when the server says ready; opening uses the registration readiness, not the publication one", () => {
    expect(byId(draft, ready, notReady).publish.enabled).toBe(true);
    const open = byId(draft, ready, notReady)["open-registration"];
    expect(open.enabled).toBe(false);
    expect(open.blockedBy).toHaveLength(2);
    expect(byId(draft, notReady, ready)["open-registration"].enabled).toBe(true);
  });

  test("actions that are not readiness-guarded are never blocked by it", () => {
    const items = byId(draft, notReady, notReady);
    expect(items["close-registration"].enabled).toBe(true);
    expect(items.cancel.enabled).toBe(true);
  });
});

describe("lifecycle panel", () => {
  const render = (isAdmin: boolean, publication = notReady) =>
    renderToStaticMarkup(
      <LifecyclePanel
        editionId="5a000000-0000-4000-8000-00000000000a"
        states={draft}
        readiness={{ publication, registration: notReady }}
        timezone="America/Monterrey"
        schedule={null}
        isAdmin={isAdmin}
      />,
    );

  test("a blocked publish is a disabled button with the missing items listed beside it", () => {
    const html = render(true);
    expect(html).toContain('data-testid="blocked-publish"');
    expect(html).toContain("Al menos una modalidad");
    expect(html).toContain("Descripción mínima");
    expect(html).toMatch(/<button[^>]*[ ]disabled=""[^>]*>Publicar edición<[/]button>/);
  });

  test("a ready edition gets an enabled publish button", () => {
    const html = render(true, ready);
    expect(html).not.toContain('data-testid="blocked-publish"');
    expect(html).toMatch(/<button(?![^>]*[ ]disabled="")[^>]*>Publicar edición<[/]button>/);
  });

  test("an operator sees what is missing but every action is disabled and says why", () => {
    const html = render(false, ready);
    expect(html).toContain("Solo un administrador puede cambiar el estado");
    expect(html).toMatch(/<button[^>]*[ ]disabled=""[^>]*>Publicar edición<[/]button>/);
  });

  test("actions that do not apply are explained in a collapsed list, not offered", () => {
    const html = render(true);
    expect(html).toContain("Otras acciones que no aplican ahora");
    expect(html).toContain("Ocultar edición");
    expect(html).not.toMatch(/<button[^>]*>Ocultar edición<\/button>/);
  });
});
