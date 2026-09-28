"use client";

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { IconButton } from "@/components/ui/icon-button";

/**
 * ui-spec §3.1 Modal: backdrop ink/40, panel radius-overlay shadow-lg, container-modal-form width.
 * 240ms scale+fade in, reduced motion = no transform. Radix traps focus, moves it to the first
 * focusable element on open and returns it to the trigger on close. Content scrolls inside the
 * panel when taller than the viewport. Confirm dialogs state the consequence and affected count in
 * `description`.
 */
export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;

export type ModalContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  hideClose?: boolean;
  widthClassName?: string;
};

export function ModalContent({
  className,
  children,
  title,
  description,
  hideClose,
  widthClassName = "max-w-[var(--container-modal-form)]",
  ...props
}: ModalContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-modal-backdrop bg-ink/40",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out",
          "duration-panel",
        )}
      />
      <DialogPrimitive.Content
        // Radix warns when no description is linked; an explicit undefined opts out knowingly.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed left-1/2 top-1/2 z-modal flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-overlay border border-divider bg-paper-raised shadow-lg",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
          "duration-panel ease-standard motion-reduce:zoom-in-100 motion-reduce:zoom-out-100",
          widthClassName,
          className,
        )}
        {...props}
      >
        <div className="px-6 pt-6 pr-16">
          <DialogPrimitive.Title className="text-h4 font-body font-bold text-ink">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1 text-body-sm text-ink-80">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        {/* pt-1 keeps the first control's focus ring inside the scroll clip. */}
        <div className="mt-3 overflow-y-auto px-6 pt-1 pb-6">{children}</div>
        {!hideClose ? (
          <DialogPrimitive.Close asChild>
            <IconButton aria-label="Cerrar" variant="ghost" size="sm" className="absolute right-3 top-3">
              <X className="size-5" aria-hidden="true" />
            </IconButton>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Standard action row for Modal/Drawer footers: stacked full-width on mobile, right-aligned on sm+. */
export function ModalActions({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>{children}</div>
  );
}
