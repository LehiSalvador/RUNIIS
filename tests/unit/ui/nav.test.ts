import { describe, expect, test } from "vitest";
import { isNavItemActive } from "@/lib/client/nav";

describe("isNavItemActive", () => {
  test("matches the item path and its nested paths", () => {
    expect(isNavItemActive("/cuenta/pases", "/cuenta/pases", "/cuenta")).toBe(true);
    expect(isNavItemActive("/cuenta/pases/abc", "/cuenta/pases", "/cuenta")).toBe(true);
    expect(isNavItemActive("/cuenta/pases/", "/cuenta/pases", "/cuenta")).toBe(true);
  });

  test("does not match sibling paths sharing a prefix", () => {
    expect(isNavItemActive("/cuenta/pasesx", "/cuenta/pases", "/cuenta")).toBe(false);
  });

  test("section roots and home match only exactly", () => {
    expect(isNavItemActive("/cuenta", "/cuenta", "/cuenta")).toBe(true);
    expect(isNavItemActive("/cuenta/perfil", "/cuenta", "/cuenta")).toBe(false);
    expect(isNavItemActive("/eventos", "/")).toBe(false);
    expect(isNavItemActive(null, "/eventos")).toBe(false);
  });
});
