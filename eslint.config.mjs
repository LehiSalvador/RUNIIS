import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      "react/no-danger": "error",
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
