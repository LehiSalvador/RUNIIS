"use client";

import React from "react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";

/**
 * Quick-look pattern for list rows: a side sheet (bottom sheet below lg) opened from a row action that
 * shows the row's summary and its primary action without leaving the list. Heavy work (editing, long
 * forms) belongs on a full page reached from the same row (the "detail page" pattern, e.g.
 * /admin/eventos/[editionId]); use the drawer only for read-mostly summaries and short confirmations.
 * Focus is trapped while open and returns to the row action on close (Radix via ui/Drawer).
 */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  // The row action that opens the drawer is a plain button (no Radix trigger), so focus return is explicit.
  const opener = React.useRef<HTMLElement | null>(null);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={title}
        description={description}
        side="responsive"
        footer={footer}
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
          opener.current = null;
        }}
      >
        {children}
      </DrawerContent>
    </Drawer>
  );
}
