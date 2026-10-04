import React from "react";
import Link from "next/link";
import { cn } from "@/lib/client/cn";

export type EditionSection = "resumen" | "configuracion" | "modalidades";

const SECTIONS: readonly { key: EditionSection; label: string; href: (editionId: string) => string }[] = [
  { key: "resumen", label: "Resumen y estado", href: (id) => `/admin/eventos/${id}` },
  { key: "configuracion", label: "Datos y fechas", href: (id) => `/admin/eventos/${id}/configuracion` },
  { key: "modalidades", label: "Modalidades y precios", href: (id) => `/admin/eventos/${id}/modalidades` },
];

/** Section links of one Edition (plain links: each section is its own server-rendered page). */
export function EditionSubnav({ editionId, current }: { editionId: string; current: EditionSection }) {
  return (
    <nav aria-label="Secciones de la edición" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {SECTIONS.map((section) => {
          const active = section.key === current;
          return (
            <li key={section.key}>
              <Link
                href={section.href(editionId)}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center rounded-control border px-4 text-body-sm font-semibold transition-colors duration-fast ease-standard",
                  active ? "border-ink bg-ink text-paper" : "border-control bg-paper-raised text-ink hover:border-ink-60",
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
