"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { isNavItemActive } from "@/lib/client/nav";
import { SkipLink } from "@/components/shell/skip-link";
import { Wordmark } from "@/components/shell/wordmark";
import { IconButton } from "@/components/ui/icon-button";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";

export const ADMIN_NAV_ITEMS = [
  { key: "dashboard", href: "/admin", label: "Dashboard" },
  { key: "tareas", href: "/admin/tareas", label: "Tareas" },
  { key: "eventos", href: "/admin/eventos", label: "Eventos" },
  { key: "solicitudes", href: "/admin/solicitudes", label: "Solicitudes" },
  { key: "participantes", href: "/admin/participantes", label: "Participantes" },
  { key: "kits", href: "/admin/kits", label: "Kits" },
  { key: "asistencia", href: "/admin/asistencia", label: "Asistencia" },
  { key: "cierre", href: "/admin/cierre", label: "Cierre" },
  { key: "comunidad", href: "/admin/comunidad", label: "Comunidad" },
  { key: "usuarios", href: "/admin/usuarios", label: "Usuarios" },
  { key: "comunicaciones", href: "/admin/comunicaciones", label: "Comunicaciones" },
  { key: "auditoria", href: "/admin/auditoria", label: "Auditoría" },
  { key: "ajustes", href: "/admin/ajustes", label: "Ajustes" },
] as const;

export type AdminNavKey = (typeof ADMIN_NAV_ITEMS)[number]["key"];

function AdminNav({ visibleKeys, onNavigate }: { visibleKeys?: readonly AdminNavKey[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = visibleKeys ? ADMIN_NAV_ITEMS.filter((item) => visibleKeys.includes(item.key)) : ADMIN_NAV_ITEMS;

  return (
    <nav aria-label="Administración" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isNavItemActive(pathname, item.href, "/admin");
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "relative flex min-h-11 items-center rounded-control px-3 text-body-sm font-semibold transition-colors duration-fast ease-standard",
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
 * server still enforces). Content is fluid up to 1600px, body-sm by default. `actions` renders at
 * the right of the page title (primary page actions).
 */
export function AdminShell({
  pageTitle,
  visibleNavKeys,
  actions,
  children,
}: {
  pageTitle: string;
  visibleNavKeys?: readonly AdminNavKey[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = React.useState(false);

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
            <AdminNav visibleKeys={visibleNavKeys} onNavigate={() => setNavOpen(false)} />
          </DrawerContent>
        </Drawer>
        <Wordmark href="/admin" />
      </header>

      <div className="md:flex md:min-h-dvh">
        <aside className="hidden w-[240px] shrink-0 border-r border-divider bg-paper-raised md:block">
          <div className="sticky top-0 flex max-h-dvh flex-col gap-6 overflow-y-auto p-4">
            <div className="px-3 pt-2">
              <Wordmark href="/admin" />
              <p className="mt-2 text-caption text-ink-60">Administración</p>
            </div>
            <AdminNav visibleKeys={visibleNavKeys} />
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
