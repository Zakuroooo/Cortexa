import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tick } from "@/lib/cowork/runner";
import { fireNextTick } from "@/lib/cowork/chain";

export const runtime = "nodejs";
// One step must fit in here. The executor stops calling tools at 35 s.
export const maxDuration = 60;

/** Run at most ONE step of the task, then (if there is more) chain the next tick. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await tick(supabase, id);
  if (result.ran && result.more)
    after(async () => {
      // rate-limit cool-down: wait, then chain. If this request is killed first,
      // the open Tasks page (or, later, the cron) picks the task up again.
      if (result.delayMs) await new Promise((r) => setTimeout(r, Math.min(result.delayMs!, 25_000)));
      await fireNextTick(request, id);
    });
  return NextResponse.json(result);
}
