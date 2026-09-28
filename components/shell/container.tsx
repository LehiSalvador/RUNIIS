import React from "react";
import { cn } from "@/lib/client/cn";

/** ui-spec §2.7 containers, as explicit max-width wrappers with the standard page-margin gutter. */
const WIDTH: Record<string, string> = {
  public: "max-w-[var(--container-public)]",
  reading: "max-w-[var(--container-reading)]",
  registration: "max-w-[var(--container-registration)]",
  "modal-form": "max-w-[var(--container-modal-form)]",
};

export function Container({
  width = "public",
  className,
  children,
}: {
  width?: keyof typeof WIDTH;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6 md:px-8", WIDTH[width], className)}>{children}</div>
  );
}
