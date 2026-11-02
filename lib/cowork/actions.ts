/**
 * User actions on a task: approve plan, approve/reject a gated step, stop,
 * retry, edit plan. Each one is a small, checked state change in Postgres.
 * The API route and the eval harness both call these.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizePlan, isFinal } from "./policy";
import { savePlanSteps } from "./runner";
import type { StepRow, TaskRow } from "./types";

export type ActionResult = { ok: true; tick: boolean } | { ok: false; status: number; error: string };

const bad = (status: number, error: string): ActionResult => ({ ok: false, status, error });

async function getTask(supabase: SupabaseClient, id: string): Promise<TaskRow | null> {
  const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  return (data as TaskRow) ?? null;
}

export async function approvePlan(supabase: SupabaseClient, taskId: string): Promise<ActionResult> {
  const task = await getTask(supabase, taskId);
  if (!task) return bad(404, "Task not found");
  if (task.status !== "awaiting_approval") return bad(409, `Plan can't be approved while task is ${task.status}`);
  // the status check in the WHERE makes a double click harmless
  const { data } = await supabase
    .from("tasks")
    .update({ status: "running" })
    .eq("id", taskId)
    .eq("status", "awaiting_approval")
    .select("id");
  if (!data?.length) return bad(409, "Plan was already approved");
  await supabase.from("task_approvals").insert({ task_id: taskId, user_id: task.user_id, kind: "plan", decision: "approved" });
  return { ok: true, tick: true };
}

export async function decideStep(
  supabase: SupabaseClient,
  taskId: string,
  stepId: string,
  decision: "approved" | "rejected"
): Promise<ActionResult> {
  const task = await getTask(supabase, taskId);
  if (!task) return bad(404, "Task not found");
  const { data: step } = await supabase.from("task_steps").select("*").eq("id", stepId).eq("task_id", taskId).maybeSingle();
  if (!step) return bad(404, "Step not found");
  if ((step as StepRow).status !== "waiting_approval") return bad(409, "This step is not waiting for approval");

  await supabase.from("task_approvals").insert({
    task_id: taskId,
    step_id: stepId,
    user_id: task.user_id,
    kind: "step",
    decision,
  });

  if (decision === "approved") {
    // needs_approval=false so the runner goes ahead; the approval row keeps the audit trail
    await supabase.from("task_steps").update({ status: "pending", needs_approval: false }).eq("id", stepId);
    await supabase.from("tasks").update({ status: "running" }).eq("id", taskId).eq("status", "waiting_approval");
    return { ok: true, tick: true };
  }

  await supabase.from("task_steps").update({ status: "skipped" }).eq("id", stepId);
  await supabase
    .from("task_steps")
    .update({ status: "skipped" })
    .eq("task_id", taskId)
    .in("status", ["pending", "waiting_approval"]);
  await supabase
    .from("tasks")
    .update({ status: "cancelled", error: `You rejected step "${(step as StepRow).title}"`, finished_at: new Date().toISOString() })
    .eq("id", taskId);
  return { ok: true, tick: false };
}

export async function cancelTask(supabase: SupabaseClient, taskId: string): Promise<ActionResult> {
  const task = await getTask(supabase, taskId);
  if (!task) return bad(404, "Task not found");
  if (isFinal(task.status)) return bad(409, `Task is already ${task.status}`);

  if (task.status === "running") {
    // A step may be running right now; it checks this flag between tool calls,
    // and the next tick marks the task cancelled.
    await supabase.from("tasks").update({ cancel_requested: true }).eq("id", taskId);
    return { ok: true, tick: true };
  }
  await supabase
    .from("tasks")
    .update({ status: "cancelled", cancel_requested: true, error: "Stopped by user", finished_at: new Date().toISOString() })
    .eq("id", taskId);
  await supabase
    .from("task_steps")
    .update({ status: "skipped" })
    .eq("task_id", taskId)
    .in("status", ["pending", "waiting_approval"]);
  return { ok: true, tick: false };
}

/** Failed task → reset failed steps (fresh attempts) and run again from there. */
export async function retryTask(supabase: SupabaseClient, taskId: string): Promise<ActionResult> {
  const task = await getTask(supabase, taskId);
  if (!task) return bad(404, "Task not found");
  if (task.status !== "failed") return bad(409, "Only a failed task can be retried");
  const { count } = await supabase
    .from("task_steps")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  if (!count) return bad(409, "This task has no plan to retry — create it again");

  await supabase
    .from("task_steps")
    .update({ status: "pending", attempts: 0 })
    .eq("task_id", taskId)
    .in("status", ["failed", "running"]);
  await supabase
    .from("tasks")
    .update({ status: "running", error: null, finished_at: null, lease_until: null })
    .eq("id", taskId);
  return { ok: true, tick: true };
}

export async function editPlan(supabase: SupabaseClient, taskId: string, rawSteps: unknown): Promise<ActionResult> {
  const task = await getTask(supabase, taskId);
  if (!task) return bad(404, "Task not found");
  if (task.status !== "awaiting_approval") return bad(409, "The plan can only be edited before you approve it");
  const steps = sanitizePlan(rawSteps);
  if (!steps) return bad(400, "Plan needs at least one valid step");
  await savePlanSteps(supabase, task, steps);
  return { ok: true, tick: false };
}
