import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/app/(public)/_lib/seo";

const PRIVATE_PATHS = ["/admin", "/cuenta", "/scanner", "/inscripcion", "/api", "/design-system", "/onboarding", "/entrar"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
