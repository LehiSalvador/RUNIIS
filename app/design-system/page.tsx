import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { DesignSystemPreview } from "@/components/dev/design-system-preview";

// Evaluated per request so the APP_ENV gate reflects the running environment, not the build's.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sistema de diseño",
  robots: { index: false, follow: false },
};

/** Internal visual-QA page (T15). noindex (meta + X-Robots-Tag in next.config.ts), never listed in
 * the sitemap, and a 404 whenever APP_ENV is "production". */
export default async function DesignSystemPage() {
  if (process.env.APP_ENV === "production") {
    notFound();
  }

  // A synthetic payload rendered the same way the pass route will (server-side SVG, shown via <img>).
  const svg = await QRCode.toString("RUNIIS-DESIGN-SYSTEM-SAMPLE", { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const sampleQrSrc = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return <DesignSystemPreview sampleQrSrc={sampleQrSrc} />;
}
