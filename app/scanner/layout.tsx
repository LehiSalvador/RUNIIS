import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Placeholder route-group layout for /scanner. ScannerShell (components/shell/scanner-shell.tsx)
 * owns the full-viewport chrome directly since the scanner is a single screen, not a nav-driven
 * section; the actual scan page (a later task) renders <ScannerShell> itself.
 */
export default function ScannerLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
