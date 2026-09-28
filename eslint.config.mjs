import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      "react/no-danger": "error",
    },
  },
  {
    // SEC-007: createSystemClient bypasses RLS (ADR-001 A/§6 -- workers, webhooks and provider
    // callbacks only). Route handlers must always resolve the caller's own session client through
    // defineRoute; never through the system client directly.
    files: ["app/api/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/server/supabase/clients",
              importNames: ["createSystemClient"],
              message: "Route handlers never use the system client directly (SEC-007). Go through a domain service or a worker.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    ".netlify/**",
    ".netlify-build-cache-*/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
