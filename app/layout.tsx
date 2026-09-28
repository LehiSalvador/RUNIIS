import React from "react";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo_Narrow, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/use-toast";

const archivoNarrow = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
  variable: "--font-archivo-narrow",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const siteUrl = process.env.APP_BASE_URL ?? "http://localhost:3100";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "RUNIIS",
    template: "%s | RUNIIS",
  },
  description: "RUNIIS: descubre carreras, inscríbete y consulta tu ranking verificado.",
  applicationName: "RUNIIS",
  openGraph: { siteName: "RUNIIS", locale: "es_MX", type: "website" },
};

// No dark theme in V1 (Master §181): the browser UI matches the paper canvas.
export const viewport: Viewport = {
  themeColor: "#F6F7F3",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-MX" className={`${archivoNarrow.variable} ${inter.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
