import React from "react";
import type { Metadata } from "next";
import { PublicHeader } from "@/components/shell/public-header";
import { PublicFooter } from "@/components/shell/public-footer";
import { SkipLink } from "@/components/shell/skip-link";
import { NotFoundContent } from "@/components/public/not-found-content";

export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false, follow: true } };

/** Unmatched URLs render outside every route group, so this carries the public chrome itself. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <PublicHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <NotFoundContent />
      </main>
      <PublicFooter />
    </div>
  );
}
