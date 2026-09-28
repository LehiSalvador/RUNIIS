/** A nav item is current on its own path and on nested paths ("/cuenta/pases/123" -> "Pases"). A
 * section root such as "/cuenta" or "/admin" only matches exactly, or it would light up everywhere. */
export function isNavItemActive(pathname: string | null, href: string, sectionRoot?: string): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === sectionRoot || href === "/") return path === href;
  return path === href || path.startsWith(`${href}/`);
}
