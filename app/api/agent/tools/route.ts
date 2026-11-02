import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, limitHeaders, friendlyWait } from "@/lib/ratelimit";
import { runServerTool, SERVER_TOOLS, type ServerToolName } from "@/lib/agent/server/tools";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Body: { tool: "web_search" | "read_webpage" | "search_docs", args: {...} } */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(supabase, user.id, "agent_tool", request);
  if (!limit.allowed)
    return NextResponse.json(
      { error: `Tool limit reached. Try again in ${friendlyWait(limit.resetSeconds)}.` },
      { status: 429, headers: limitHeaders(limit) }
    );

  const body = await request.json().catch(() => ({}));
  if (!SERVER_TOOLS.includes(body.tool))
    return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
  try {
    const result = await runServerTool(body.tool as ServerToolName, body.args ?? {}, supabase);
    return NextResponse.json({ result });
  } catch (e: any) {
    // tool errors are normal (404 page, blocked URL) — the agent reads them and adapts
    return NextResponse.json({ error: String(e?.message || e) }, { status: 200 });
  }
}
