import React from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { Panel } from "@/components/admin/panel";
import type { SummaryItem } from "@/components/admin/edition-config/config-model";

const ICON = { ok: CircleCheck, attention: CircleAlert, info: CircleDashed } as const;
const ICON_CLASS = { ok: "text-success", attention: "text-danger", info: "text-ink-60" } as const;
const SR = { ok: "Completo: ", attention: "Requiere atención: ", info: "Sin datos todavía: " } as const;

/** What is configured for the Edition and which section to open, with the requirement the server still reports as missing. */
export function ConfigSummary({ items }: { items: readonly SummaryItem[] }) {
  return (
    <Panel title="Configuración de la edición" description="Lo que ya existe en cada sección. Los requisitos pendientes vienen del servidor.">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="config-summary">
        {items.map((item) => {
          const Icon = ICON[item.tone];
          return (
            <li key={item.key} data-summary-key={item.key}>
              <Link href={item.href} prefetch={false} className="block h-full rounded-control border border-divider p-3 hover:border-ink-60">
                <span className="flex items-center gap-2 font-semibold text-ink">
                  <Icon className={`size-4 shrink-0 ${ICON_CLASS[item.tone]}`} aria-hidden="true" />
                  <span className="sr-only">{SR[item.tone]}</span>
                  {item.label}
                </span>
                <span className="block text-caption text-ink-60">{item.value}</span>
                {item.pending ? <span className="mt-1 block text-caption font-semibold text-ink">{item.pending}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
