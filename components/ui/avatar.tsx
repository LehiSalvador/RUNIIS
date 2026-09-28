"use client";

import React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { Lock, UserRound } from "lucide-react";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 Avatar: circular image or initials fallback at 24/32/40/64/96. Pending review = a
 * dashed warning ring; suspended = desaturated with an ink overlay and lock glyph. The wrapper is a
 * single labelled image (display name plus status), so initials are never read out letter by letter.
 * Pass `decorative` when the name is already visible next to the avatar. */
export type AvatarStatus = "none" | "pending" | "suspended";

const SIZE_CLASS = { 24: "size-6 text-caption", 32: "size-8 text-caption", 40: "size-10 text-label", 64: "size-16 text-h4", 96: "size-24 text-h3" } as const;

const STATUS_TEXT: Record<AvatarStatus, string> = {
  none: "",
  pending: " (foto en revisión)",
  suspended: " (foto suspendida)",
};

export type AvatarProps = {
  src?: string | null;
  displayName: string;
  size?: keyof typeof SIZE_CLASS;
  status?: AvatarStatus;
  decorative?: boolean;
  className?: string;
};

export function getInitials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("es-MX"))
    .join("");
}

export function Avatar({ src, displayName, size = 40, status = "none", decorative = false, className }: AvatarProps) {
  const initials = getInitials(displayName);

  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `${displayName.trim() || "Persona sin nombre"}${STATUS_TEXT[status]}` })}
      className={cn(
        "relative inline-flex shrink-0 rounded-full",
        SIZE_CLASS[size],
        status === "pending" && "outline-2 outline-offset-2 outline-dashed outline-warning",
        className,
      )}
    >
      <AvatarPrimitive.Root
        className={cn(
          "flex size-full items-center justify-center overflow-hidden rounded-full bg-paper-sunken font-semibold text-ink-80",
          status === "suspended" && "grayscale",
        )}
      >
        {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
        <AvatarPrimitive.Fallback delayMs={src ? 400 : 0} className="flex size-full items-center justify-center">
          {initials || <UserRound className="size-1/2" aria-hidden="true" />}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {status === "suspended" ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-ink/70 text-paper">
          <Lock className="size-1/3" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}
