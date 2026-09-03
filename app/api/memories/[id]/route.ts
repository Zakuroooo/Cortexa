import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { embedMemory } from "@/lib/ai/memory";
import { truncate } from "@/lib/utils";

const KINDS = ["fact", "preference", "goal", "event", "skill"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let newContent: string | null = null;

  if (typeof body.content === "string" && body.content.trim()) {
    newContent = truncate(body.content.trim(), 400);
    patch.content = newContent;
  }
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (KINDS.includes(body.kind)) patch.kind = body.kind;

  const { data, error } = await supabase
    .from("memories")
    .update(patch)
    .eq("id", id)
    .select(
      "id, user_id, kind, content, source, source_chat_id, confidence, pinned, use_count, last_used_at, created_at, updated_at"
    )
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Editing the text invalidates the old vector — re-embed so recall stays honest.
  if (newContent) await embedMemory(supabase, id, newContent);

  return NextResponse.json({ memory: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("memories").delete().eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
