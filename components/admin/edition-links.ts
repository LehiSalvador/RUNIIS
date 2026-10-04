import { isRouteAvailable } from "@/components/shell/nav-availability";
import { canAccessSection, hasRoleForEdition, NAV_ACCESS, type StaffAssignment, type StaffRole } from "@/components/admin/access";
import type { AdminNavKey } from "@/components/shell/admin-nav-items";

/**
 * Quick links from the Edition overview to the sections later Work Units build. Each candidate declares
 * the route PATTERN that must exist in this build (AVAILABLE_ROUTES) and the nav key whose role matrix gates
 * it. A link appears only when its route is built AND the viewer's role can open it, so a later unit ships
 * a section by (1) adding its page, (2) adding its pattern to AVAILABLE_ROUTES: no link ever points at a
 * missing page, and none is shown to a role that cannot use it.
 */
export type EditionLinkCandidate = {
  key: string;
  label: string;
  description: string;
  /** Route pattern checked against AVAILABLE_ROUTES (dynamic segments in [brackets]). */
  route: string;
  /** Nav section whose role matrix gates the link. */
  section: AdminNavKey;
  /**
   * Race day surfaces are used by roles that have no nav section of their own (the scanner and the guardian desk are open to CHECKIN). When
   * set, THIS list gates the link (any assignment of one of these roles covering the Edition) instead of the section's matrix.
   */
  roles?: readonly StaffRole[];
  href: (editionId: string) => string;
};

export const EDITION_LINK_CANDIDATES: readonly EditionLinkCandidate[] = [
  {
    key: "configuracion",
    label: "Datos y fechas",
    description: "Nombre, sede, fechas clave, zona horaria e inscripción.",
    route: "/admin/eventos/[editionId]/configuracion",
    section: "eventos",
    href: (id) => `/admin/eventos/${id}/configuracion`,
  },
  {
    key: "modalidades",
    label: "Modalidades y precios",
    description: "Modalidades, precios, capacidad y categorías.",
    route: "/admin/eventos/[editionId]/modalidades",
    section: "eventos",
    href: (id) => `/admin/eventos/${id}/modalidades`,
  },
  {
    key: "formularios",
    label: "Formularios",
    description: "Preguntas extra de la inscripción, versiones y vista previa.",
    route: "/admin/eventos/[editionId]/formularios",
    section: "eventos",
    href: (id) => `/admin/eventos/${id}/formularios`,
  },
  {
    key: "ubicaciones",
    label: "Ubicaciones",
    description: "Sede, salida, meta, entrega de kits y estacionamiento.",
    route: "/admin/eventos/[editionId]/ubicaciones",
    section: "eventos",
    href: (id) => `/admin/eventos/${id}/ubicaciones`,
  },
  {
    key: "agenda",
    label: "Agenda",
    description: "Programa del evento por día y hora.",
    route: "/admin/eventos/[editionId]/agenda",
    section: "eventos",
    href: (id) => `/admin/eventos/${id}/agenda`,
  },
  {
    key: "contenido",
    label: "Contenido",
    description: "Descripción, avisos, preguntas frecuentes, enlaces y patrocinadores.",
    route: "/admin/eventos/[editionId]/contenido",
    section: "eventos",
    href: (id) => `/admin/eventos/${id}/contenido`,
  },
  {
    key: "ruta",
    label: "Rutas",
    description: "GPX, inicio, meta y puntos de interés.",
    route: "/admin/eventos/[editionId]/rutas",
    section: "eventos",
    href: (id) => `/admin/eventos/${id}/rutas`,
  },
  {
    key: "solicitudes",
    label: "Solicitudes",
    description: "Apartados pendientes de confirmar o cancelar.",
    route: "/admin/eventos/[editionId]/solicitudes",
    section: "solicitudes",
    href: (id) => `/admin/eventos/${id}/solicitudes`,
  },
  {
    key: "participantes",
    label: "Participantes",
    description: "Inscripciones confirmadas y su estado.",
    route: "/admin/eventos/[editionId]/participantes",
    section: "participantes",
    href: (id) => `/admin/eventos/${id}/participantes`,
  },
  {
    key: "kits",
    label: "Kits",
    description: "Definiciones, tallas, inventario y entrega.",
    route: "/admin/eventos/[editionId]/kits",
    section: "kits",
    href: (id) => `/admin/eventos/${id}/kits`,
  },
  {
    key: "tutores",
    label: "Mesa de tutores",
    description: "Verificar en persona al guardián de cada menor.",
    route: "/admin/eventos/[editionId]/tutores",
    section: "eventos",
    roles: ["ADMIN", "OPERATOR", "CHECKIN"],
    href: (id) => `/admin/eventos/${id}/tutores`,
  },
  {
    key: "escaner",
    label: "Escáner de acceso",
    description: "Check-in y entrega de kits con la cámara o un lector.",
    route: "/scanner",
    section: "eventos",
    roles: ["ADMIN", "OPERATOR", "CHECKIN"],
    href: () => "/scanner",
  },
  {
    key: "asistencia",
    label: "Asistencia",
    description: "Resolución de asistencia y elegibilidad.",
    route: "/admin/eventos/[editionId]/asistencia",
    section: "asistencia",
    href: (id) => `/admin/eventos/${id}/asistencia`,
  },
  {
    key: "cierre",
    label: "Cierre",
    description: "Finalización y cierre administrativo.",
    route: "/admin/eventos/[editionId]/cierre",
    section: "cierre",
    href: (id) => `/admin/eventos/${id}/cierre`,
  },
];

export type EditionLink = { key: string; label: string; description: string; href: string };

export function editionQuickLinks(
  editionId: string,
  assignments: readonly StaffAssignment[],
  routeAvailable: (route: string) => boolean = isRouteAvailable,
  candidates: readonly EditionLinkCandidate[] = EDITION_LINK_CANDIDATES,
): EditionLink[] {
  return candidates
    .filter((candidate) => routeAvailable(candidate.route))
    .filter((candidate) =>
      candidate.roles
        ? hasRoleForEdition(assignments, candidate.roles, editionId)
        : canAccessSection(assignments, candidate.section) && hasRoleForEdition(assignments, NAV_ACCESS[candidate.section], editionId),
    )
    .map((candidate) => ({
      key: candidate.key,
      label: candidate.label,
      description: candidate.description,
      href: candidate.href(editionId),
    }));
}
