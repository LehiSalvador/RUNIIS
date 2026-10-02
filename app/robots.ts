import type { MetadataRoute } from "next";
import { absoluteUrl, isIndexableEnvironment } from "@/app/(public)/_lib/seo";

const PRIVATE_PATHS = ["/admin", "/cuenta", "/scanner", "/inscripcion", "/api", "/design-system", "/onboarding", "/entrar"];

export default function robots(): MetadataRoute.Robots {
  // AUD-015: staging/preview/local are public URLs but must never be indexed.
  if (!isIndexableEnvironment()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
