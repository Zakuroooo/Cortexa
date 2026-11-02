import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, limitHeaders, friendlyWait } from "@/lib/ratelimit";
import { validateGoal, LIMITS } from "@/lib/cowork/policy";
import { planTask } from "@/lib/cowork/runner";
import type { TaskRow } from "@/lib/cowork/types";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, goal, status, error, tokens_used, created_at, updated_at, finished_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

/** Create a task and plan it. Nothing runs until the user approves the plan. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const goal = validateGoal(body.goal);
  if (!goal.ok) return NextResponse.json({ error: goal.error }, { status: 400 });

  const limit = await checkRateLimit(supabase, user.id, "task", request);
  if (!limit.allowed)
    return NextResponse.json(
      { error: `Task limit reached — ${limit.limit} tasks per hour. Try again in ${friendlyWait(limit.resetSeconds)}.` },
      { status: 429, headers: limitHeaders(limit) }
    );

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      goal: goal.goal,
      title: truncate(goal.goal, 60),
      budget_steps: LIMITS.maxSteps,
      token_budget: LIMITS.defaultTokenBudget,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await planTask(supabase, task as TaskRow);

  const { data: fresh } = await supabase.from("tasks").select("*").eq("id", task.id).single();
  return NextResponse.json({ task: fresh }, { status: 201 });
}
