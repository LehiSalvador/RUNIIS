/**
 * Single source of truth for which public routes exist in this build. A shell nav item (header,
 * mobile drawer, footer) may only link to a route listed here: a link to a route that is not built
 * 404s on click and, in production, on Next's viewport prefetch of every public page.
 *
 * To ship a route: add its path here in the same change that adds its page. Routes planned for a
 * later phase stay in the candidate lists in public-header.tsx / public-footer.tsx and simply
 * appear once they are listed here (e.g. "/ranking" -> Phase 4).
 */
export const AVAILABLE_PUBLIC_ROUTES: readonly string[] = [
  "/eventos",
  "/runiis",
  "/contacto",
  "/legal/terminos",
  "/legal/privacidad",
];

export function isRouteAvailable(href: string): boolean {
  return AVAILABLE_PUBLIC_ROUTES.includes(href);
}

/** Keeps only the links whose route exists in this build, preserving order. */
export function availableLinks<T extends { readonly href: string }>(links: readonly T[]): T[] {
  return links.filter((link) => isRouteAvailable(link.href));
}
