import React from "react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PublicHeader } from "@/components/shell/public-header";
import { PublicFooter } from "@/components/shell/public-footer";
import { SkipLink } from "@/components/shell/skip-link";

export const metadata: Metadata = {
  title: "Inscripción",
  robots: { index: false, follow: false },
};

/**
 * Chrome of the registration builder (ui-spec §4.9). It reuses the public header and footer so the person
 * can always get back to the event; the page itself runs the session guard (like /cuenta pages) so the
 * redirect to /entrar carries this page's path. Everything under it is private and never cached.
 */
export default function InscripcionLayout({ children }: Readonly<{ children: ReactNode }>) {
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
