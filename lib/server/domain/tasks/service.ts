import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { cursorTimestampSchema, decodeCursor, encodeCursor } from "../../http/pagination";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import {
  refreshTasksResultSchema,
  taskDetailSchema,
  taskListPageSchema,
  taskRoot,
  taskSchema,
  type TaskDetailView,
  type TaskListQuery,
  type TaskView,
} from "./contracts";

// Thin RPC layer over the Task Center commands (supabase/migrations/20261005100000_720_task_center.sql). Authorisation (ADMIN_TASK_READ /
// ADMIN_TASK_MANAGE, Edition scope from the task row, SEC-020; role-scoped visibility), per-actor rate limiting, idempotent replay, locking
// and the CLOSURE_BLOCKER rule (the root condition is re-evaluated, the task row is never trusted) live in the database. This layer
// validates the RPC result shape, encodes cursors, adds the root-object link hint and logs ids only (never reasons).

const cursorSchema = z.strictObject({ rank: z.int(), detected_at: cursorTimestampSchema, id: z.guid() });

function withRoot<T extends z.output<typeof taskSchema>>(task: T): T & { root: TaskView["root"] } {
  return { ...task, root: taskRoot(task) };
}

export async function listTasks(supabase: SupabaseClient, query: TaskListQuery) {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor, cursorSchema);
  const page = await callRpc(
    supabase,
    "admin_list_tasks",
    {
      p_edition_id: query.edition_id ?? null,
      p_status: query.status ?? null,
      p_category: query.category ?? null,
      p_blocking_level: query.blocking_level ?? null,
      p_assigned: query.assigned ?? null,
      p_cursor_rank: after?.rank ?? null,
      p_cursor_detected_at: after?.detected_at ?? null,
      p_cursor_id: after?.id ?? null,
      p_limit: query.limit ?? 25,
    },
    taskListPageSchema,
  );
  return {
    items: page.items.map(withRoot),
    nextCursor: page.next_cursor ? encodeCursor(page.next_cursor) : null,
    counts: page.counts,
  };
}

export async function getTask(supabase: SupabaseClient, taskId: string): Promise<TaskDetailView> {
  const task = await callRpc(supabase, "admin_get_task", { p_admin_task_id: taskId }, taskDetailSchema);
  return withRoot(task);
}

export async function startTask(supabase: SupabaseClient, taskId: string, idempotencyKey: string | null): Promise<TaskView> {
  const task = await callRpc(supabase, "start_admin_task", { p_admin_task_id: taskId, p_idempotency_key: idempotencyKey }, taskSchema);
  logEvent("info", "admin_task_started", { admin_task_id: taskId, source_rule: task.source_rule });
  return withRoot(task);
}

export async function assignTask(
  supabase: SupabaseClient,
  taskId: string,
  body: { assignee_id?: string | null; assigned_role?: string | null },
  idempotencyKey: string | null,
): Promise<TaskView> {
  const task = await callRpc(
    supabase,
    "assign_admin_task",
    { p_admin_task_id: taskId, p_assignee_id: body.assignee_id ?? null, p_assigned_role: body.assigned_role ?? null, p_idempotency_key: idempotencyKey },
    taskSchema,
  );
  logEvent("info", "admin_task_assigned", { admin_task_id: taskId, source_rule: task.source_rule });
  return withRoot(task);
}

export async function resolveTask(supabase: SupabaseClient, taskId: string, reason: string, idempotencyKey: string | null): Promise<TaskView> {
  const task = await callRpc(
    supabase,
    "resolve_admin_task",
    { p_admin_task_id: taskId, p_reason: reason, p_idempotency_key: idempotencyKey },
    taskSchema,
  );
  logEvent("info", "admin_task_resolved", { admin_task_id: taskId, source_rule: task.source_rule, blocking_level: task.blocking_level });
  return withRoot(task);
}

export async function waiveTask(supabase: SupabaseClient, taskId: string, reason: string, idempotencyKey: string | null): Promise<TaskView> {
  const task = await callRpc(
    supabase,
    "waive_admin_task",
    { p_admin_task_id: taskId, p_reason: reason, p_idempotency_key: idempotencyKey },
    taskSchema,
  );
  logEvent("info", "admin_task_waived", { admin_task_id: taskId, source_rule: task.source_rule, blocking_level: task.blocking_level });
  return withRoot(task);
}

/** Recomputes the projected tasks of one Edition from their sources (the 5-minute cron job covers the platform). */
export async function refreshTasks(supabase: SupabaseClient, editionId: string, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "refresh_admin_tasks",
    { p_edition_id: editionId, p_idempotency_key: idempotencyKey },
    refreshTasksResultSchema,
  );
  logEvent("info", "admin_tasks_refreshed", { edition_id: editionId, opened: result.opened, cleared: result.cleared });
  return result;
}
