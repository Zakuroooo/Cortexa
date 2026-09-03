import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const title = String(body.title ?? "").trim() || "Untitled note";
  const content = String(body.content ?? "");
  const kind = body.kind === "quiz" ? "quiz" : "note";

  const { data, error } = await supabase
    .from("notes")
    .insert({ user_id: user.id, title, content, kind, created_by: "user" })
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}
