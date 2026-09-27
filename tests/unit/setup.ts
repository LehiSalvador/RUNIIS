// Synthetic, non-secret values so server modules can be exercised without any real .env file.
const syntheticEnv: Record<string, string> = {
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54621",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit-test-placeholder",
  SUPABASE_SECRET_KEY: "sb_secret_unit-test-placeholder",
  PASS_CREDENTIAL_ENCRYPTION_KEY_V1: "unit-test-pass-credential-key-v1-0000000000",
  INTERNAL_CRON_SECRET: "unit-test-internal-cron-secret-000000000000",
};

for (const [name, value] of Object.entries(syntheticEnv)) process.env[name] = value;
