import { describe, expect, test } from "vitest";
import {
  NAV_ACCESS,
  STAFF_ROLE_ORDER,
  canAccessSection,
  describeAssignment,
  hasRoleForEdition,
  rolesOf,
  visibleNavKeysFor,
  type StaffAssignment,
  type StaffRole,
} from "@/components/admin/access";
import { ADMIN_NAV_KEYS } from "@/components/shell/admin-nav-items";
import { assertAuthLevel } from "@/lib/server/auth/guards";
import { ANONYMOUS_ACTOR, STAFF_ROLES, type Actor } from "@/lib/server/auth/actor";

const EDITION_A = "5a000000-0000-4000-8000-00000000000a";
const EDITION_B = "5b000000-0000-4000-8000-00000000000b";

const global = (role: StaffRole): StaffAssignment => ({ role, scope_type: "GLOBAL", edition_id: null });
const scoped = (role: StaffRole, editionId: string): StaffAssignment => ({ role, scope_type: "EDITION", edition_id: editionId });

describe("admin RBAC matrix (Master 145)", () => {
  test("the role list mirrors the server's", () => {
    expect([...STAFF_ROLE_ORDER]).toEqual([...STAFF_ROLES]);
  });

  test("every nav section has an explicit role list, and ADMIN can open all of them", () => {
    expect(Object.keys(NAV_ACCESS).sort()).toEqual([...ADMIN_NAV_KEYS].sort());
    for (const key of ADMIN_NAV_KEYS) expect(NAV_ACCESS[key], key).toContain("ADMIN");
  });

  test.each<[StaffRole, string[]]>([
    ["ADMIN", [...ADMIN_NAV_KEYS]],
    ["OPERATOR", ["dashboard", "tareas", "eventos", "solicitudes", "participantes", "kits", "asistencia", "comunicaciones"]],
    ["CHECKIN", ["dashboard"]],
    ["MODERATOR", ["dashboard", "comunidad"]],
  ])("%s sees exactly its sections", (role, expected) => {
    expect(visibleNavKeysFor([global(role)], ADMIN_NAV_KEYS)).toEqual(expected);
  });

  test("OPERATOR never gets closure/reopen, staff roles, settings or audit; CHECKIN and MODERATOR never get operations", () => {
    for (const key of ["cierre", "usuarios", "ajustes", "auditoria"] as const) {
      expect(canAccessSection([global("OPERATOR")], key), key).toBe(false);
    }
    for (const key of ["eventos", "solicitudes", "participantes", "kits", "asistencia"] as const) {
      expect(canAccessSection([global("CHECKIN")], key), `CHECKIN ${key}`).toBe(false);
      expect(canAccessSection([global("MODERATOR")], key), `MODERATOR ${key}`).toBe(false);
    }
  });

  test("a person with no assignment sees nothing, not even the dashboard", () => {
    expect(visibleNavKeysFor([], ADMIN_NAV_KEYS)).toEqual([]);
  });

  test("roles are the union of assignments, in canonical order, any scope", () => {
    expect(rolesOf([scoped("OPERATOR", EDITION_A), global("ADMIN"), global("OPERATOR")])).toEqual(["ADMIN", "OPERATOR"]);
    expect(describeAssignment(scoped("OPERATOR", EDITION_A))).toBe("Operador · Una edición");
    expect(describeAssignment(global("CHECKIN"))).toBe("Check-in · Global");
  });
});

describe("edition scope", () => {
  const operatorA = [scoped("OPERATOR", EDITION_A)];

  test("an EDITION-scoped role opens only its own Edition (case-insensitive id)", () => {
    expect(hasRoleForEdition(operatorA, NAV_ACCESS.eventos, EDITION_A)).toBe(true);
    expect(hasRoleForEdition(operatorA, NAV_ACCESS.eventos, EDITION_A.toUpperCase())).toBe(true);
    expect(hasRoleForEdition(operatorA, NAV_ACCESS.eventos, EDITION_B)).toBe(false);
  });

  test("a GLOBAL role opens every Edition; a scoped role of the wrong kind opens none", () => {
    expect(hasRoleForEdition([global("OPERATOR")], NAV_ACCESS.eventos, EDITION_B)).toBe(true);
    expect(hasRoleForEdition([scoped("CHECKIN", EDITION_A)], NAV_ACCESS.eventos, EDITION_A)).toBe(false);
  });

  test("the nav shows sections to an EDITION-scoped operator (the server narrows rows)", () => {
    expect(canAccessSection(operatorA, "eventos")).toBe(true);
  });

  test("hasRoleForEdition agrees with the server guard used by the page and the API (assertAuthLevel)", () => {
    const samples: StaffAssignment[][] = [
      [],
      [global("ADMIN")],
      [global("OPERATOR")],
      [global("CHECKIN")],
      [scoped("OPERATOR", EDITION_A)],
      [scoped("ADMIN", EDITION_B)],
      [scoped("CHECKIN", EDITION_A), global("MODERATOR")],
    ];
    for (const assignments of samples) {
      const actor: Actor = {
        ...ANONYMOUS_ACTOR,
        auth_user_id: "00000000-0000-4000-8000-0000000000aa",
        staff_member_id: assignments.length > 0 ? "20000000-0000-4000-8000-0000000000bb" : null,
        staff_roles: assignments,
      };
      for (const key of ADMIN_NAV_KEYS) {
        const allowed = NAV_ACCESS[key];
        for (const editionId of [EDITION_A, EDITION_B]) {
          let server = true;
          try {
            assertAuthLevel(actor, { staff: allowed, editionParam: "editionId" }, { editionId });
          } catch {
            server = false;
          }
          expect(hasRoleForEdition(assignments, allowed, editionId), `${JSON.stringify(assignments)} ${key} ${editionId}`).toBe(server);
        }
        let any = true;
        try {
          assertAuthLevel(actor, { staff: allowed });
        } catch {
          any = false;
        }
        expect(canAccessSection(assignments, key), `${JSON.stringify(assignments)} ${key}`).toBe(any && assignments.length > 0);
      }
    }
  });
});
