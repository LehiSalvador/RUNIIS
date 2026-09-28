"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { isNavItemActive } from "@/lib/client/nav";
import { Container } from "@/components/shell/container";
import { Wordmark } from "@/components/shell/wordmark";
import { SkipLink } from "@/components/shell/skip-link";
import { IconButton } from "@/components/ui/icon-button";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";

export const ACCOUNT_NAV_ITEMS = [
  { href: "/cuenta", label: "Resumen" },
  { href: "/cuenta/perfil", label: "Perfil" },
  { href: "/cuenta/amigos", label: "Amigos" },
  { href: "/cuenta/invitados", label: "Invitados" },
  { href: "/cuenta/menores", label: "Menores" },
  { href: "/cuenta/solicitudes", label: "Solicitudes" },
  { href: "/cuenta/pases", label: "Pases" },
  { href: "/cuenta/favoritos", label: "Favoritos" },
  { href: "/cuenta/comunicaciones", label: "Comunicaciones" },
] as const;

function AccountNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Mi cuenta" className="flex flex-col gap-0.5">
      {ACCOUNT_NAV_ITEMS.map((item) => {
        const active = isNavItemActive(pathname, item.href, "/cuenta");
        return (
          <Link
            key={item.href}
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
 * ui-spec §4.8 account shell. Below lg: a header with the menu button (opens the account nav in a
 * Drawer) and the current page title. lg+: persistent 3-column sidebar, content in the remaining 9
 * (text-heavy pages cap their own width at max-w-[var(--container-reading)]). The page title is the
 * only h1.
 */
export function AccountShell({ pageTitle, children }: { pageTitle: string; children: React.ReactNode }) {
  const [navOpen, setNavOpen] = React.useState(false);

  return (
    <div className="min-h-dvh bg-paper">
      <SkipLink />
      <header className="sticky top-0 z-sticky-header border-b border-divider bg-paper/95 backdrop-blur-sm">
        <Container className="flex h-16 items-center gap-2">
          <Drawer open={navOpen} onOpenChange={setNavOpen}>
            <DrawerTrigger asChild>
              <IconButton aria-label="Abrir menú de cuenta" variant="ghost" className="-ml-2 lg:hidden">
                <Menu className="size-6" aria-hidden="true" />
              </IconButton>
            </DrawerTrigger>
            <DrawerContent title="Mi cuenta" side="responsive">
              <AccountNav onNavigate={() => setNavOpen(false)} />
              <Link
                href="/"
                className="mt-4 flex min-h-11 items-center border-t border-divider px-3 text-body-sm font-semibold text-ink-80 hover:text-ink"
              >
                Ir al inicio de RUNIIS
              </Link>
            </DrawerContent>
          </Drawer>
          <Wordmark className="hidden lg:inline-flex" />
          <p className="truncate text-body font-semibold text-ink lg:hidden" aria-hidden="true">
            {pageTitle}
          </p>
        </Container>
      </header>

      <Container className="py-6 lg:py-12">
        <div className="lg:grid lg:grid-cols-12 lg:gap-6">
          <aside className="hidden lg:col-span-3 lg:block">
            <div className="sticky top-24">
              <AccountNav />
            </div>
          </aside>
          <main id="main-content" tabIndex={-1} className="outline-none lg:col-span-9">
            {/* Below lg the title is shown in the header bar; the h1 stays in <main> for AT. */}
            <h1 className="sr-only font-display text-h2 text-ink lg:not-sr-only lg:mb-8 lg:block">{pageTitle}</h1>
            {children}
          </main>
        </div>
      </Container>
    </div>
  );
}
