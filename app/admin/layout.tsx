import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { template: "%s · Administración | RUNIIS", default: "Administración | RUNIIS" },
  robots: { index: false, follow: false },
};

/**
 * Route-group layout for /admin/*. Isolated bundle, never loads the public-site chrome (ADR-001 decision 13).
 * Each page composes the shell through <AdminPage> (components/admin/admin-page.tsx) after its own server guard
 * (app/admin/_lib/session.tsx requireStaff), so the redirect back from /entrar carries that page's path and
 * the role check is made per page, not once per layout. Pages read the session cookie, so they render per
 * request. There is deliberately no loading.tsx here: a loading boundary would make the anonymous redirect a
 * streamed meta refresh instead of a real 307 (AUD-033); pages stream their data regions with <Suspense>.
 */
export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
