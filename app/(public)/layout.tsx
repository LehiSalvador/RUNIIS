import React from "react";
import type { ReactNode } from "react";
import { PublicHeader } from "@/components/shell/public-header";
import { PublicFooter } from "@/components/shell/public-footer";
import { SkipLink } from "@/components/shell/skip-link";

/** Public route group chrome (ui-spec §4.1-§4.7). Session-free on the server (ADR-001 A9): the
 * header resolves the account chip in the browser. Pages own their <Container> widths. */
export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <PublicHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
