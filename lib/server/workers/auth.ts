import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

const BEARER = /^Bearer (\S+)$/;

/** Constant-time check of `Authorization: Bearer <INTERNAL_CRON_SECRET>`. */
export function isAuthorizedWorkerRequest(headers: Headers, secret: string): boolean {
  const presented = BEARER.exec(headers.get("authorization") ?? "")?.[1];
  if (!presented || !secret) return false;
  // Hashing first gives equal-length inputs, so neither length nor content leaks through timing.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(secret));
}
