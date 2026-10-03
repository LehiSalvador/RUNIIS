import React from "react";
import Link from "next/link";
import { availableLinks } from "@/components/shell/nav-availability";
import { Wordmark } from "@/components/shell/wordmark";
import { Container } from "@/components/shell/container";

/** Every planned footer entry; only those whose route is built are rendered (nav-availability.ts). */
type FooterLink = { readonly href: string; readonly label: string };

const FOOTER_CANDIDATES: readonly { readonly label: string; readonly links: readonly FooterLink[] }[] = [
  {
    label: "Explora",
    links: [
      { href: "/eventos", label: "Eventos" },
      { href: "/ranking", label: "Ranking" },
      { href: "/runiis", label: "Sobre RUNIIS" },
    ],
  },
  {
    label: "Ayuda",
    links: [
      { href: "/contacto", label: "Contacto" },
      { href: "/legal/terminos", label: "Términos y condiciones" },
      { href: "/legal/privacidad", label: "Aviso de privacidad" },
    ],
  },
];

export const FOOTER_GROUPS = FOOTER_CANDIDATES.map((group) => ({
  label: group.label,
  links: availableLinks(group.links),
}));

/** ui-spec §4.1 footer: an ink-surface section (§2.2) with nav groups, legal links, contact and the
 * repeated small wordmark; links use paper/80 on ink and a lime focus ring via `.surface-ink`. */
export function PublicFooter() {
  return (
    <footer className="surface-ink bg-ink text-paper">
      <Container className="grid gap-10 py-12 md:grid-cols-12 md:py-16">
        <div className="md:col-span-5">
          <Wordmark surface="ink" />
          <p className="mt-4 max-w-xs text-body-sm text-paper/70">
            Carreras, inscripciones y ranking verificado.
          </p>
        </div>
        {FOOTER_GROUPS.map((group) => (
          <nav key={group.label} aria-label={group.label} className="md:col-span-3">
            <h2 className="text-label font-semibold text-paper">{group.label}</h2>
            <ul className="mt-2">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center text-body-sm text-paper/80 transition-colors duration-fast ease-standard hover:text-paper"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <div className="border-t border-paper/15">
        <Container className="py-5">
          <p className="text-caption text-paper/70">© {new Date().getFullYear()} RUNIIS</p>
        </Container>
      </div>
    </footer>
  );
}
