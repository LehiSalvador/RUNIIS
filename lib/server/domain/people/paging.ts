import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../../http/pagination";
import { callRpc } from "../../rpc";
import { keysetCursorSchema } from "./contracts";

export type Keyset = { sortKey: string; id: string } | null;

export function readKeyset(cursor: string | undefined): Keyset {
  if (cursor === undefined) return null;
  const { k, id } = decodeCursor(cursor, keysetCursorSchema);
  return { sortKey: k, id };
}

export function writeKeyset(next: { sort_key: string; id: string } | null): string | null {
  return next ? encodeCursor({ k: next.sort_key, id: next.id }) : null;
}

const precheckSchema = z.object({ allowed: z.literal(true) });

/** Committed rate-limit pre-check (ADR-001 A6): runs in its own transaction so failed attempts count. */
export async function consumeRateLimit(supabase: SupabaseClient, scope: string): Promise<void> {
  await callRpc(supabase, "consume_actor_rate_limit", { p_scope: scope }, precheckSchema);
}
