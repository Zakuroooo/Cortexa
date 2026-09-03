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
    .from("chats")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chats: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const mode =
    body.mode === "agent" || body.mode === "ask" ? body.mode : "auto";

  let { data, error } = await supabase
    .from("chats")
    .insert({ user_id: user.id, title: "New chat", mode })
    .select("*")
    .single();

  // A database created before the router existed still has the old
  // mode check constraint. Degrade to "ask" instead of blocking the user,
  // and point them at the migration.
  if (error && mode === "auto" && /constraint|check/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("chats")
      .insert({ user_id: user.id, title: "New chat", mode: "ask" })
      .select("*")
      .single());
    if (!error)
      return NextResponse.json({
        chat: data,
        warning:
          "Auto mode needs a schema update — re-run supabase/schema.sql. Falling back to ask mode.",
      });
  }

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chat: data });
}
