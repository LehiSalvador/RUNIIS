import React from "react";

/** First focusable element of every shell; targets the shell's <main id="main-content">. */
export function SkipLink({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-skip-link focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-control focus:bg-ink focus:px-4 focus:text-body-sm focus:font-semibold focus:text-paper"
    >
      Saltar al contenido
    </a>
  );
}
