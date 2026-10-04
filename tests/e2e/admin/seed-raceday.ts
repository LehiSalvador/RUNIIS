import { LOCAL_DB_ONLY } from "../support/account";
import { e2eEnv } from "../support/env";
import { seedRaceday } from "./raceday-support";

/**
 * Local manual rehearsal of the scanner (P3-H): seeds one fresh set of race day fixtures into the LOCAL Docker database and prints how
 * to reach each of the scan outcomes. The printed codes are throwaway credentials of synthetic participants that exist only in this
 * local database; never run this against anything else (the helper refuses a remote target).
 *
 *   pnpm exec tsx tests/e2e/admin/seed-raceday.ts
 *
 * Then sign in as checkin@runiis.test (seeded CHECKIN), open /scanner, choose the printed Edition and paste a code into "Código del pase".
 * The same fixtures back tests/e2e/admin/raceday.spec.ts; see .salvaops-agent-evidence/P3-H-raceday-kits-guardian-scanner-checkin/scanner-outcomes.md.
 */
if (!e2eEnv().localDb) throw new Error(LOCAL_DB_ONLY);

const seed = seedRaceday();
const rows: [string, string, string][] = [
  ["VALID (then again: ALREADY_CHECKED_IN)", "Edición principal, Check-in", seed.tokens.valid],
  ["REVOKED_CREDENTIAL", "Edición principal, Check-in", seed.tokens.revoked],
  ["REPLACED_CREDENTIAL (old code)", "Edición principal, Check-in", seed.tokens.replacedOld],
  ["WRONG_EVENT", "Edición principal, Check-in", seed.tokens.other],
  ["UNKNOWN_PASS", "Edición principal, Check-in", seed.unknownToken],
  ["CANCELED_REGISTRATION", "Edición principal, Check-in", seed.tokens.canceled],
  ["NOT_YET_ALLOWED", "Edición futura, Check-in", seed.tokens.future],
  ["GUARDIAN_VERIFICATION_REQUIRED (Verificar -> VALID)", "Edición principal, Check-in", seed.tokens.minor],
  ["GUARDIAN rejected, then OTHER_REVIEW on re-scan", "Edición principal, Check-in", seed.tokens.minorReject],
  ["Kit: VALID (then ALREADY_CHECKED_IN)", `Edición principal, Entrega de kits, ${seed.kitMainName}`, seed.tokens.kitScan],
  ["Kit: OTHER_REVIEW (no kit allocated)", `Edición principal, Entrega de kits, ${seed.kitMainName}`, seed.tokens.kitNone],
  ["Kit: NOT_YET_ALLOWED (window not open)", `Edición principal, Entrega de kits, ${seed.kitFutureName}`, seed.tokens.kitEarly],
];

console.log(`Edición principal : ${seed.editionName}  (${seed.editionId})`);
console.log(`Edición futura    : ${seed.futureEditionName}  (${seed.futureEditionId})`);
console.log("");
for (const [outcome, where, code] of rows) console.log(`${outcome}\n  sesión: ${where}\n  código: ${code}\n`);
console.log("REGISTRATION_NOT_CONFIRMED has no real data path (a registration is only CONFIRMED or CANCELED); the E2E spec injects the server answer.");
console.log("Manual lookup names (search 'QA <label> " + seed.suffix + "'): " + Object.values(seed.names).slice(0, 4).join(", ") + ", ...");
