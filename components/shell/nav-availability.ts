/**
 * Single source of truth for which shell-navigable routes exist in this build (public, account and
 * admin shells). A shell nav item (header, drawer, sidebar, footer) may only link to a route listed
 * here: a link to a route that is not built 404s on click and, in production, on Next's viewport
 * prefetch of every page that renders it. The admin shell lists only the "/admin/*" pages that exist
 * (later Phase 3 units add their path here in the same change as their page); admin sections that are not
 * built stay hidden in real use and are shown as non-navigating, aria-disabled entries in the
 * design-system preview only (AdminShell `navMode="preview"`). Dynamic routes are listed by their folder
 * pattern ("/admin/eventos/[editionId]") and are checked through isRouteAvailable by whoever links to them
 * (components/admin/edition-links.ts).
 *
 * To ship a route: add its path here in the same change that adds its page. Routes planned for a
 * later phase stay in the candidate lists in public-header.tsx / public-footer.tsx and simply
 * appear once they are listed here (e.g. "/ranking" -> Phase 4).
 */
export const AVAILABLE_ROUTES: readonly string[] = [
  "/eventos",
  "/runiis",
  "/contacto",
  "/legal/terminos",
  "/legal/privacidad",
  "/cuenta",
  "/cuenta/perfil",
  "/cuenta/amigos",
  "/cuenta/invitados",
  "/cuenta/menores",
  "/cuenta/solicitudes",
  "/cuenta/pases",
  "/cuenta/favoritos",
  "/cuenta/comunicaciones",
  "/admin",
  "/admin/eventos",
  "/admin/eventos/nuevo",
  "/admin/eventos/[editionId]",
  "/admin/eventos/[editionId]/configuracion",
  "/admin/eventos/[editionId]/modalidades",
  "/admin/eventos/[editionId]/formularios",
  "/admin/eventos/[editionId]/ubicaciones",
  "/admin/eventos/[editionId]/agenda",
  "/admin/eventos/[editionId]/contenido",
  "/admin/eventos/[editionId]/kits",
  "/admin/eventos/[editionId]/tutores",
  "/scanner",
];

export function isRouteAvailable(href: string): boolean {
  return AVAILABLE_ROUTES.includes(href);
}

/** Keeps only the links whose route exists in this build, preserving order. */
export function availableLinks<T extends { readonly href: string }>(links: readonly T[]): T[] {
  return links.filter((link) => isRouteAvailable(link.href));
}
