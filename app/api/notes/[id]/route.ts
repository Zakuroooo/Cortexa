import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function guard(params: Promise<{ id: string }>) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { id, supabase, authorized: Boolean(user) };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id, supabase, authorized } = await guard(params);
  if (!authorized)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") updates.title = body.title.trim() || "Untitled";
  if (typeof body.content === "string") updates.content = body.content;

  const { data, error } = await supabase
    .from("notes")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id, supabase, authorized } = await guard(params);
  if (!authorized)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
