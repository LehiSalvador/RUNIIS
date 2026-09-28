import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Thin route-group layout for /cuenta/*. Each page composes AccountShell with its own `pageTitle`
 * and runs the server guard (app/cuenta/_lib/session.ts) itself, so the redirect back from /entrar
 * can carry that page's path. Pages read the session cookie, so they always render per request.
 */
export default function CuentaLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
