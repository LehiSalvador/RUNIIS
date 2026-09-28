import { describe, expect, test } from "vitest";
import { cn } from "@/lib/client/cn";
import { buttonVariants } from "@/components/ui/button";

describe("cn with the RUNIIS theme scales", () => {
  test("keeps a text color next to a custom text size token", () => {
    expect(cn("text-paper", "text-body")).toBe("text-paper text-body");
    expect(cn("text-button text-ink", "text-caption")).toBe("text-ink text-caption");
  });

  test("still resolves real conflicts inside each group", () => {
    expect(cn("text-ink", "text-danger")).toBe("text-danger");
    expect(cn("rounded-control", "rounded-full")).toBe("rounded-full");
    expect(cn("z-dropdown", "z-popover")).toBe("z-popover");
    expect(cn("duration-fast", "duration-panel")).toBe("duration-panel");
    expect(cn("font-display font-bold", "font-body")).toBe("font-bold font-body");
  });

  test("every Button variant/size keeps its label color", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      expect(cn(buttonVariants({ variant: "primary", size }))).toContain("text-paper");
      expect(cn(buttonVariants({ variant: "danger", size }))).toContain("text-paper");
      expect(cn(buttonVariants({ variant: "secondary", size }))).toContain("text-ink");
    }
  });
});
