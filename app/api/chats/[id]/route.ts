import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
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

  const { data: chat, error: chatErr } = await supabase
    .from("chats")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (chatErr)
    return NextResponse.json({ error: chatErr.message }, { status: 500 });
  if (!chat)
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const { data: messages, error: msgErr } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", id)
    .order("created_at", { ascending: true });
  if (msgErr)
    return NextResponse.json({ error: msgErr.message }, { status: 500 });

  return NextResponse.json({ chat, messages: messages ?? [] });
}

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

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim())
    updates.title = body.title.trim().slice(0, 120);

  const { data, error } = await supabase
    .from("chats")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chat: data });
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

  const { error } = await supabase.from("chats").delete().eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
