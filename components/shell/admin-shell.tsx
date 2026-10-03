"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { isNavItemActive } from "@/lib/client/nav";
import { ADMIN_NAV_ITEMS, type AdminNavKey } from "@/components/shell/admin-nav-items";
import { isRouteAvailable } from "@/components/shell/nav-availability";
import { SkipLink } from "@/components/shell/skip-link";
import { Wordmark } from "@/components/shell/wordmark";
import { IconButton } from "@/components/ui/icon-button";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";

export { ADMIN_NAV_ITEMS };
export type { AdminNavKey };

/**
 * Defaults to "preview" on /design-system/* and "live" everywhere else.
 * "live": only items whose route exists are rendered (nav-availability.ts), so the shell never links
 * to, or prefetches, an unbuilt page. "preview": the design-system preview keeps showing the full
 * nav design; items whose route is not built render as non-navigating aria-disabled entries with
 * identical styling.
 */
export type AdminNavMode = "live" | "preview";

const NAV_ITEM_CLASS =
  "relative flex min-h-11 items-center rounded-control px-3 text-body-sm font-semibold transition-colors duration-fast ease-standard";

function AdminNav({
  visibleKeys,
  navMode,
  onNavigate,
}: {
  visibleKeys?: readonly AdminNavKey[];
  navMode?: AdminNavMode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // Default: the /design-system preview shows the full nav design; every real route is "live".
  const mode: AdminNavMode = navMode ?? (pathname?.startsWith("/design-system") ? "preview" : "live");
  // Fail closed: a live shell with no explicit permitted keys renders no section links. Only the
  // design-system preview (no role) shows the whole nav design.
  const permitted = visibleKeys
    ? ADMIN_NAV_ITEMS.filter((item) => visibleKeys.includes(item.key))
    : mode === "preview"
      ? ADMIN_NAV_ITEMS
      : [];
  const items = mode === "preview" ? permitted : permitted.filter((item) => isRouteAvailable(item.href));

  return (
    <nav aria-label="Administración" className="flex flex-col gap-0.5">
      {items.map((item) => {
        if (!isRouteAvailable(item.href)) {
          return (
            <a
              key={item.key}
              role="link"
              aria-disabled="true"
              className={cn(NAV_ITEM_CLASS, "cursor-default text-ink-80 hover:bg-paper-sunken hover:text-ink")}
            >
              {item.label}
            </a>
          );
        }
        const active = isNavItemActive(pathname, item.href, "/admin");
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              NAV_ITEM_CLASS,
              active ? "bg-paper-sunken text-ink" : "text-ink-80 hover:bg-paper-sunken hover:text-ink",
            )}
          >
            {active ? (
              <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-lime-deep" />
            ) : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * ui-spec §4.10 admin shell: isolated from public chrome. md+: fixed 240px sidebar; below md the nav
 * lives in a Drawer. Nav items outside `visibleNavKeys` are not rendered at all (RBAC hides, the
 * server still enforces); items whose route is not built follow `navMode`. Content is fluid up to
 * 1600px, body-sm by default. `actions` renders at the right of the page title (primary page actions).
 * `sidebarFooter` (staff identity + sign-out) sits at the bottom of the sidebar and of the mobile drawer.
 * A live shell without `visibleNavKeys` shows no section links (fail closed).
 */
export function AdminShell({
  pageTitle,
  visibleNavKeys,
  navMode,
  actions,
  sidebarFooter,
  children,
}: {
  pageTitle: string;
  visibleNavKeys?: readonly AdminNavKey[];
  navMode?: AdminNavMode;
  actions?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = React.useState(false);
  // The wordmark goes to the admin home once it exists; until then to the site home.
  const homeHref = isRouteAvailable("/admin") ? "/admin" : "/";

  return (
    <div className="min-h-dvh bg-paper text-body-sm">
      <SkipLink />
      <header className="sticky top-0 z-sticky-header flex h-14 items-center gap-2 border-b border-divider bg-paper/95 px-2 backdrop-blur-sm md:hidden">
        <Drawer open={navOpen} onOpenChange={setNavOpen}>
          <DrawerTrigger asChild>
            <IconButton aria-label="Abrir menú de administración" variant="ghost">
              <Menu className="size-6" aria-hidden="true" />
            </IconButton>
          </DrawerTrigger>
          <DrawerContent title="Administración" side="responsive">
            <AdminNav visibleKeys={visibleNavKeys} navMode={navMode} onNavigate={() => setNavOpen(false)} />
            {sidebarFooter ? <div className="mt-6">{sidebarFooter}</div> : null}
          </DrawerContent>
        </Drawer>
        <Wordmark href={homeHref} />
      </header>

      <div className="md:flex md:min-h-dvh">
        <aside className="hidden w-[240px] shrink-0 border-r border-divider bg-paper-raised md:block">
          <div className="sticky top-0 flex max-h-dvh flex-col gap-6 overflow-y-auto p-4">
            <div className="px-3 pt-2">
              <Wordmark href={homeHref} />
              <p className="mt-2 text-caption text-ink-60">Administración</p>
            </div>
            <AdminNav visibleKeys={visibleNavKeys} navMode={navMode} />
            {sidebarFooter ? <div className="mt-auto">{sidebarFooter}</div> : null}
          </div>
        </aside>
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-[1600px]">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-h3 font-body font-bold text-ink">{pageTitle}</h1>
              {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
