import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Placeholder route-group layout for /cuenta/*. Deliberately thin: AccountShell
 * (components/shell/account-shell.tsx) takes a per-page `pageTitle`, so each account page composes
 * it directly (`<AccountShell pageTitle="Perfil">...</AccountShell>`) rather than this layout
 * hard-coding one title for every page. Later tasks that build the account pages own that wiring.
 */
export default function CuentaLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
