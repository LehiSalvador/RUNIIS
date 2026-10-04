import React from "react";
import { CircleCheck, CircleDashed, History } from "lucide-react";
import { AdminBadge } from "@/components/admin/status-badges";
import type { RevisionSource, RevisionStatus, RouteStatus } from "@/components/admin/routes/route-geometry";

/** Icon + label always (never colour alone). */
export function RevisionStatusBadge({ value }: { value: RevisionStatus }) {
  if (value === "PUBLISHED") return <AdminBadge icon={CircleCheck} tone="success">Publicada</AdminBadge>;
  if (value === "SUPERSEDED") return <AdminBadge icon={History} tone="neutral">Reemplazada</AdminBadge>;
  return <AdminBadge icon={CircleDashed} tone="warning">Borrador</AdminBadge>;
}

export function RouteStatusBadge({ value }: { value: RouteStatus }) {
  if (value === "PUBLISHED") return <AdminBadge icon={CircleCheck} tone="success">Publicada</AdminBadge>;
  if (value === "ARCHIVED") return <AdminBadge icon={History} tone="neutral">Archivada</AdminBadge>;
  return <AdminBadge icon={CircleDashed} tone="neutral">Borrador</AdminBadge>;
}

export const SOURCE_LABEL: Record<RevisionSource, string> = {
  MANUAL: "Manual (dibujada o copiada en el editor)",
  GPX_IMPORT: "GPX importado",
  DUPLICATED: "Copiada de otra revisión o ruta",
};
