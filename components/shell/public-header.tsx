"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { isNavItemActive } from "@/lib/client/nav";
import { fetchSessionChipState, type SessionChipState } from "@/lib/client/session-chip";
import { Wordmark } from "@/components/shell/wordmark";
import { Container } from "@/components/shell/container";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";

export const PUBLIC_NAV_LINKS = [
  { href: "/eventos", label: "Eventos" },
  { href: "/ranking", label: "Ranking" },
  { href: "/runiis", label: "RUNIIS" },
  { href: "/contacto", label: "Contacto" },
] as const;

function useSessionChip(): SessionChipState {
  const [state, setState] = React.useState<SessionChipState>({ status: "loading" });

  React.useEffect(() => {
    const controller = new AbortController();
    fetchSessionChipState(controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, []);

  return state;
}

/** Fixed-width slot so the header never shifts while the chip resolves. */
function SessionChip() {
  const me = useSessionChip();

  if (me.status === "loading") {
    return <Skeleton className="h-11 w-24 rounded-full" />;
  }

  if (me.status === "anonymous") {
    return (
      <Button asChild size="md" variant="primary" className="min-w-24">
        <Link href="/entrar">Entrar</Link>
      </Button>
    );
  }

  return (
    <Link
      href="/cuenta"
      className="flex h-11 min-w-24 items-center gap-2 rounded-full border border-divider bg-paper-raised pl-1.5 pr-4 transition-colors duration-fast ease-standard hover:border-ink-60"
    >
      <Avatar src={me.avatarUrl} displayName={me.displayName} size={32} decorative />
      <span className="text-body-sm font-semibold text-ink">Mi cuenta</span>
    </Link>
  );
}

/**
 * Public header (ui-spec §4.1, §6): wordmark, primary nav (drawer below md), session chip. The chip
 * is resolved client-side (lib/client/session-chip.ts) so the page itself stays cacheable.
 */
export function PublicHeader() {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-sticky-header border-b border-divider bg-paper/95 backdrop-blur-sm">
      <Container>
        <div className="flex h-16 items-center justify-between gap-4">
          <Wordmark />

          <nav aria-label="Principal" className="hidden h-full items-stretch gap-1 md:flex">
            {PUBLIC_NAV_LINKS.map((link) => {
              const active = isNavItemActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center px-3 text-body-sm font-semibold transition-colors duration-fast ease-standard",
                    active ? "text-ink" : "text-ink-80 hover:text-ink",
                  )}
                >
                  {link.label}
                  {active ? (
                    <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-lime" />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <SessionChip />
            <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <DrawerTrigger asChild>
                <IconButton aria-label="Abrir menú" variant="ghost" className="-mr-2 md:hidden">
                  <Menu className="size-6" aria-hidden="true" />
                </IconButton>
              </DrawerTrigger>
              <DrawerContent title="Menú" side="responsive">
                <nav aria-label="Principal" className="flex flex-col">
                  {PUBLIC_NAV_LINKS.map((link) => {
                    const active = isNavItemActive(pathname, link.href);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setMobileNavOpen(false)}
                        className={cn(
                          "flex min-h-12 items-center border-b border-divider px-1 text-body-lg font-semibold last:border-b-0",
                          active ? "text-ink" : "text-ink-80 hover:text-ink",
                        )}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </nav>
              </DrawerContent>
            </Drawer>
          </div>
        </div>
      </Container>
    </header>
  );
}
