"use client";

import React from "react";
import { ScanSearch } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";

/**
 * ui-spec §4.15 scanner shell: full-viewport ink surface, no site/admin chrome, one-handed use.
 * A slim top bar carries the fixed session context (Edition, station, operation) and the manual
 * lookup button, which opens a bottom Drawer instead of navigating away. `children` fill the scan
 * area; `feedback` (ScannerFeedback, a later task) is rendered full-bleed on the z-scanner-feedback
 * layer, above everything, including the safe areas.
 */
export function ScannerShell({
  title = "Scanner de acceso",
  sessionContext,
  manualLookup,
  manualLookupTitle = "Búsqueda manual",
  feedback,
  children,
}: {
  /** Page h1, visually hidden: the session context bar is the visible heading area. */
  title?: string;
  sessionContext: React.ReactNode;
  manualLookup?: React.ReactNode;
  manualLookupTitle?: string;
  feedback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [lookupOpen, setLookupOpen] = React.useState(false);

  return (
    <div className="surface-ink relative flex h-dvh flex-col overflow-hidden bg-ink text-paper">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-paper/15 pt-[env(safe-area-inset-top)] pr-2 pl-4">
        <div className="min-w-0 flex-1 text-body-sm">{sessionContext}</div>
        {manualLookup ? (
          <Drawer open={lookupOpen} onOpenChange={setLookupOpen}>
            <DrawerTrigger asChild>
              <IconButton aria-label={manualLookupTitle} variant="inverse" size="lg">
                <ScanSearch className="size-6" aria-hidden="true" />
              </IconButton>
            </DrawerTrigger>
            <DrawerContent title={manualLookupTitle} side="bottom">
              {manualLookup}
            </DrawerContent>
          </Drawer>
        ) : null}
      </header>

      <main id="main-content" className="relative min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
        <h1 className="sr-only">{title}</h1>
        {children}
      </main>

      {feedback ? <div className="fixed inset-0 z-scanner-feedback">{feedback}</div> : null}
    </div>
  );
}
