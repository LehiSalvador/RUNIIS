import type { NextConfig } from "next";

// ADR-001 Amendment 1 A9: cached public pages must never read cookies; no browser Supabase client.
// The nonce-based CSP for authenticated surfaces is added later by T20's proxy.ts. This file only
// carries the headers that do not need a per-request nonce.
const cloudinaryCloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

// AUD-015: staging.runiismty.com and Vercel previews are public URLs; anything that is not production
// is served with a blanket noindex (also covers non-HTML responses). Unset APP_ENV fails closed.
const noindexHeaders =
  process.env.APP_ENV === "production" ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Local QA (Playwright, shared dev server) browses http://127.0.0.1:3100; without this Next 16
  // rejects the dev HMR socket from that origin and the dev client never hydrates. Dev-only setting.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: cloudinaryCloud
      ? [
          {
            protocol: "https",
            hostname: "res.cloudinary.com",
            pathname: `/${cloudinaryCloud}/**`,
          },
        ]
      : [],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders, ...noindexHeaders, { key: "Permissions-Policy", value: "camera=()" }],
      },
      // Later entries override earlier ones for the same key: only the scanner may use the camera.
      {
        source: "/scanner/:path*",
        headers: [...securityHeaders, ...noindexHeaders, { key: "Permissions-Policy", value: "camera=(self)" }],
      },
      {
        source: "/design-system/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
