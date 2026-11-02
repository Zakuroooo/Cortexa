import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, limitHeaders, friendlyWait } from "@/lib/ratelimit";
import { chatCompletion } from "@/lib/agent/server/llm";
import type { ChatMessage, ToolSpec } from "@/lib/agent/types";

export const runtime = "nodejs";
// One model call per request — the agent loop itself lives in the browser tab.
export const maxDuration = 60;

const MAX_BODY_CHARS = 200_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS)
    return NextResponse.json({ error: "Request too large — the agent should shorten its context" }, { status: 413 });

  // Every call spends free quota shared by all visitors, so it is metered per user.
  const limit = await checkRateLimit(supabase, user.id, "agent", request);
  if (!limit.allowed)
    return NextResponse.json(
      { error: `Agent limit reached — ${limit.limit} model calls per hour. Try again in ${friendlyWait(limit.resetSeconds)}.` },
      { status: 429, headers: limitHeaders(limit) }
    );

  let body: { messages?: ChatMessage[]; tools?: ToolSpec[]; maxTokens?: number; light?: boolean };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || !body.messages.length)
    return NextResponse.json({ error: "messages are required" }, { status: 400 });

  try {
    const reply = await chatCompletion({ messages: body.messages, tools: body.tools, maxTokens: body.maxTokens, light: Boolean(body.light) });
    return NextResponse.json(reply);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
