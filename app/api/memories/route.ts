import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveMemory } from "@/lib/ai/memory";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("memories")
    .select(
      "id, user_id, kind, content, source, source_chat_id, confidence, pinned, use_count, last_used_at, created_at, updated_at"
    )
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memories: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const result = await saveMemory(supabase, user.id, {
    content: String(body.content ?? ""),
    kind: body.kind,
    pinned: Boolean(body.pinned),
    source: "user",
    confidence: 1,
  });

  if (result.status === "skipped")
    return NextResponse.json({ error: result.reason }, { status: 400 });

  const { data } = await supabase
    .from("memories")
    .select(
      "id, user_id, kind, content, source, source_chat_id, confidence, pinned, use_count, last_used_at, created_at, updated_at"
    )
    .eq("id", result.id)
    .single();

  return NextResponse.json({ memory: data, status: result.status });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Wipe everything the assistant has learned. Pinned memories are kept —
  // the user put those there deliberately.
  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("user_id", user.id)
    .eq("pinned", false);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

