import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { approvePlan, cancelTask, decideStep, editPlan, retryTask, type ActionResult } from "@/lib/cowork/actions";
import { fireNextTick } from "@/lib/cowork/chain";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Everything the Tasks page needs in one call (polled every 2 s while running). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: task } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const [steps, runs, artifacts, approvals] = await Promise.all([
    supabase.from("task_steps").select("*").eq("task_id", id).order("idx"),
    supabase.from("step_runs").select("*").eq("task_id", id).order("started_at"),
    supabase.from("task_artifacts").select("id, step_id, name, format, content, created_at").eq("task_id", id).order("created_at"),
    supabase.from("task_approvals").select("*").eq("task_id", id).order("created_at"),
  ]);

  return NextResponse.json({
    task,
    steps: steps.data ?? [],
    runs: runs.data ?? [],
    artifacts: (artifacts.data ?? []).map((a) => ({ ...a, content: a.content.slice(0, 200_000) })),
    approvals: approvals.data ?? [],
  });
}

/** Edit the plan (only before it is approved). Body: { steps: [{title, instruction, kind}] } */
export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  return respond(await editPlan(supabase, id, body.steps), request, id);
}

/** Body: { action: "approve" | "cancel" | "retry" | "approve_step" | "reject_step", stepId? } */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));

  let result: ActionResult;
  switch (body.action) {
    case "approve":
      result = await approvePlan(supabase, id);
      break;
    case "cancel":
      result = await cancelTask(supabase, id);
      break;
    case "retry":
      result = await retryTask(supabase, id);
      break;
    case "approve_step":
    case "reject_step":
      result = await decideStep(supabase, id, String(body.stepId ?? ""), body.action === "approve_step" ? "approved" : "rejected");
      break;
    default:
      result = { ok: false, status: 400, error: "Unknown action" };
  }
  return respond(result, request, id);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}

function respond(result: ActionResult, request: Request, id: string) {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  // start the background loop right away instead of waiting for the page to poll
  if (result.tick) after(() => fireNextTick(request, id));
  return NextResponse.json({ ok: true });
}
