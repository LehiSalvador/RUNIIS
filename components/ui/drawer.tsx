"use client";

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { IconButton } from "@/components/ui/icon-button";

/**
 * ui-spec §3.1 Drawer: bottom sheet below lg, 360px side sheet at lg+ ("responsive"), or forced to
 * one side. Same focus rules as Modal (Radix trap, return to trigger); an explicit close button is
 * always present. 240ms slide; reduced motion makes it instant via the global rule. `footer` is a
 * fixed action bar (e.g. FilterDrawer "Limpiar filtros" / "Ver resultados") that stays reachable
 * without scrolling the body.
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export type DrawerContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  /** "responsive": bottom sheet below lg, side sheet at lg+. */
  side?: "responsive" | "bottom" | "side";
  footer?: React.ReactNode;
};

const BOTTOM = "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-panel border-t";
const SIDE = "inset-y-0 right-0 h-dvh w-[360px] max-w-[calc(100vw-2rem)] rounded-l-panel border-l";
const RESPONSIVE = `${BOTTOM} lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:h-dvh lg:max-h-none lg:w-[360px] lg:rounded-l-panel lg:rounded-t-none lg:border-t-0 lg:border-l`;

const SLIDE_BOTTOM =
  "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom";
const SLIDE_SIDE = "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right";
const SLIDE_RESPONSIVE = `${SLIDE_BOTTOM} lg:data-[state=open]:slide-in-from-right lg:data-[state=closed]:slide-out-to-right lg:data-[state=open]:slide-in-from-bottom-0 lg:data-[state=closed]:slide-out-to-bottom-0`;

export function DrawerContent({
  className,
  children,
  title,
  description,
  side = "responsive",
  footer,
  ...props
}: DrawerContentProps) {
  return (
    <DialogPrimitive.Portal>
      {/* Overlay and panel share the drawer layer; DOM order puts the panel on top. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-drawer bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out duration-panel" />
      <DialogPrimitive.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed z-drawer flex flex-col border-divider bg-paper-raised shadow-lg",
          side === "bottom" ? BOTTOM : side === "side" ? SIDE : RESPONSIVE,
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:ease-exit duration-panel ease-standard",
          side === "bottom" ? SLIDE_BOTTOM : side === "side" ? SLIDE_SIDE : SLIDE_RESPONSIVE,
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-4 pb-2">
          <div className="pt-2.5">
            <DialogPrimitive.Title className="text-h4 font-body font-bold text-ink">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-body-sm text-ink-80">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton aria-label="Cerrar" variant="ghost" size="sm" className="-mr-2">
              <X className="size-5" aria-hidden="true" />
            </IconButton>
          </DialogPrimitive.Close>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-6 pt-1",
            footer ? "pb-4" : "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          )}
        >
          {children}
        </div>
        {footer ? (
          <div className="flex gap-2 border-t border-divider px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>*]:flex-1">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
