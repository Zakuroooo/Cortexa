/**
 * Runner: the durable loop. ONE call to tick() does at most ONE step:
 *
 *   claim lease → read task + steps from Postgres → decide (nextAction)
 *   → run that one step → save output + events → release lease
 *
 * Everything lives in the database, so if a request dies half-way the next
 * tick simply picks up from the saved state. That is how a 5-minute task runs
 * on a platform that kills every request at 60 seconds.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextAction, LIMITS } from "./policy";
import { executeStep, StepCancelled } from "./executor";
import { makePlan } from "./planner";
import { toolsForKind, needsApproval } from "./policy";
import type { PlanStepInput, StepEvent, StepRow, TaskRow } from "./types";
import { truncate } from "@/lib/utils";
import { retryAfterMs } from "./backoff";

/** Longer than the 60 s function limit, so a killed request's lease can't be stolen early. */
export const LEASE_SECONDS = 70;
/** After a rate-limited step, wait at least this long (Groq's window is per minute). */
const RATE_LIMIT_COOLDOWN_MS = 20_000;

export type TickResult =
  | { ran: false; reason: string }
  /** delayMs: wait this long before the next tick (provider rate limit cool-down) */
  | { ran: true; did: string; more: boolean; delayMs?: number };

async function loadSteps(supabase: SupabaseClient, taskId: string): Promise<StepRow[]> {
  const { data, error } = await supabase
    .from("task_steps")
    .select("*")
    .eq("task_id", taskId)
    .order("idx", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StepRow[];
}

async function finishTask(
  supabase: SupabaseClient,
  taskId: string,
  status: "succeeded" | "failed" | "cancelled",
  error: string | null = null
) {
  await supabase
    .from("tasks")
    .update({ status, error, finished_at: new Date().toISOString(), lease_until: null })
    .eq("id", taskId);
  if (status === "cancelled") {
    await supabase
      .from("task_steps")
      .update({ status: "skipped" })
      .eq("task_id", taskId)
      .in("status", ["pending", "waiting_approval", "running"]);
  }
}

/** Save plan steps, with tools + approval flags decided by code (policy.ts). */
export async function savePlanSteps(
  supabase: SupabaseClient,
  task: { id: string; user_id: string },
  steps: PlanStepInput[]
) {
  const rows = steps.map((s, i) => {
    const tools = toolsForKind(s.kind);
    return {
      task_id: task.id,
      user_id: task.user_id,
      idx: i,
      title: s.title,
      instruction: s.instruction,
      kind: s.kind,
      tools,
      needs_approval: needsApproval(tools),
    };
  });
  const { error: delErr } = await supabase.from("task_steps").delete().eq("task_id", task.id);
  if (delErr) throw new Error(delErr.message);
  const { error } = await supabase.from("task_steps").insert(rows);
  if (error) throw new Error(error.message);
}

/** Planning step: goal → plan rows → status awaiting_approval. */
export async function planTask(supabase: SupabaseClient, task: TaskRow): Promise<void> {
  try {
    const plan = await makePlan(task.goal);
    await savePlanSteps(supabase, task, plan.steps);
    await supabase
      .from("tasks")
      .update({ status: "awaiting_approval", title: plan.title })
      .eq("id", task.id);
  } catch (e: any) {
    await finishTask(supabase, task.id, "failed", String(e?.message || e));
  }
}

export async function tick(supabase: SupabaseClient, taskId: string): Promise<TickResult> {
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_task", {
    p_task_id: taskId,
    p_seconds: LEASE_SECONDS,
  });
  if (claimErr) return { ran: false, reason: claimErr.message };
  const task = (claimed as TaskRow[] | null)?.[0];
  if (!task) return { ran: false, reason: "not running, or another tick holds the lease" };

  let keepLease = false;
  try {
    const steps = await loadSteps(supabase, taskId);
    const decision = nextAction(task, steps);

    switch (decision.action) {
      case "cancel":
        await finishTask(supabase, taskId, "cancelled", "Stopped by user");
        return { ran: true, did: "cancelled", more: false };

      case "finish":
        await finishTask(supabase, taskId, "succeeded");
        return { ran: true, did: "succeeded", more: false };

      case "fail":
        await finishTask(supabase, taskId, "failed", decision.reason);
        return { ran: true, did: "failed", more: false };

      case "idle":
        return { ran: false, reason: decision.reason };

      case "wait_approval":
        await supabase.from("task_steps").update({ status: "waiting_approval" }).eq("id", decision.step.id);
        await supabase.from("tasks").update({ status: "waiting_approval" }).eq("id", taskId);
        return { ran: true, did: `waiting for approval: ${decision.step.title}`, more: false };

      case "run": {
        const cooldownMs = await runOneStep(supabase, task, decision.step, steps);
        if (cooldownMs) {
          // Keep holding the lease for the cool-down, so nobody retries early.
          keepLease = true;
          await supabase
            .from("tasks")
            .update({ lease_until: new Date(Date.now() + cooldownMs).toISOString() })
            .eq("id", taskId);
          return { ran: true, did: "rate limited — cooling down", more: true, delayMs: cooldownMs };
        }
        return { ran: true, did: `ran step ${decision.step.idx + 1}`, more: true };
      }
    }
    return { ran: false, reason: "unknown decision" };
  } finally {
    if (!keepLease) await supabase.rpc("release_task", { p_task_id: taskId });
  }
}

/** Runs the step. Returns a cool-down in ms if the provider rate-limited us, else 0. */
async function runOneStep(
  supabase: SupabaseClient,
  task: TaskRow,
  step: StepRow,
  steps: StepRow[]
): Promise<number> {
  const attempt = step.attempts + 1;
  await supabase.from("task_steps").update({ status: "running", attempts: attempt }).eq("id", step.id);

  const events: StepEvent[] = [{ type: "start", at: Date.now(), attempt }];
  const { data: run, error: runErr } = await supabase
    .from("step_runs")
    .insert({ task_id: task.id, step_id: step.id, user_id: task.user_id, attempt, events })
    .select("id")
    .single();
  if (runErr) throw new Error(runErr.message);

  // Flush the event log after every event, so the UI sees progress live.
  // Only the lease holder writes, so there is no race on this row.
  let flushing: Promise<unknown> = Promise.resolve();
  const emit = (e: StepEvent) => {
    events.push(e);
    const snapshot = [...events];
    flushing = flushing.then(() => supabase.from("step_runs").update({ events: snapshot }).eq("id", run.id));
  };

  const earlier = steps
    .filter((s) => s.idx < step.idx && s.status === "done" && s.output)
    .map((s) => ({ title: s.title, output: s.output as string }));

  try {
    const result = await executeStep({
      task,
      step,
      earlier,
      emit,
      ctx: {
        userId: task.user_id,
        supabase,
        taskId: task.id,
        stepId: step.id,
        onArtifact: (name, format) => emit({ type: "artifact", at: Date.now(), name, format }),
      },
      shouldStop: async () => {
        const { data } = await supabase.from("tasks").select("cancel_requested").eq("id", task.id).single();
        return Boolean(data?.cancel_requested);
      },
    });
    emit({ type: "done", at: Date.now() });
    await flushing;
    await supabase
      .from("step_runs")
      .update({ status: "done", tokens: result.tokens, finished_at: new Date().toISOString() })
      .eq("id", run.id);
    await supabase.from("task_steps").update({ status: "done", output: result.output }).eq("id", step.id);
    await supabase
      .from("tasks")
      .update({ tokens_used: task.tokens_used + result.tokens })
      .eq("id", task.id);
    return 0;
  } catch (e: any) {
    const cancelled = e instanceof StepCancelled;
    const message = truncate(String(e?.message || e), 500);
    const rateLimitMs = retryAfterMs(message);
    emit({ type: "error", at: Date.now(), message });
    await flushing;
    await supabase
      .from("step_runs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", run.id);
    // Rate limit: not the step's fault, so it doesn't use up an attempt.
    if (rateLimitMs !== null) {
      await supabase.from("task_steps").update({ status: "pending", attempts: step.attempts }).eq("id", step.id);
      return Math.min(Math.max(rateLimitMs, RATE_LIMIT_COOLDOWN_MS), 60_000);
    }
    // A cancelled step goes back to pending; the next tick sees cancel_requested and stops the task.
    await supabase
      .from("task_steps")
      .update({ status: cancelled ? "pending" : "failed" })
      .eq("id", step.id);
    if (!cancelled && attempt >= LIMITS.maxAttemptsPerStep) {
      await finishTask(supabase, task.id, "failed", `Step "${step.title}" failed: ${message}`);
    }
    return 0;
  }
}
