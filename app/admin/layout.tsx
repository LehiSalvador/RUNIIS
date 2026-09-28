import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Placeholder route-group layout for /admin/*. Isolated bundle, never loads the public-site chrome
 * (ADR-001 decision 13). AdminShell (components/shell/admin-shell.tsx) takes a per-page `pageTitle`
 * and RBAC-filtered `visibleNavKeys`, so each admin page composes it directly once T20's role
 * resolution exists; this layout stays a thin pass-through until then.
 */
export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
