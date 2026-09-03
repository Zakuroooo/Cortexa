import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // Chunks cascade via the FK, but delete them explicitly so the vector count
  // is right even if the cascade is ever dropped from the schema.
  await supabase.from("chunks").delete().eq("document_id", id).eq("user_id", user.id);

  // `.select()` matters: under RLS a delete that matches no policy row deletes
  // NOTHING and reports no error. Without asking which rows came back we'd
  // report success for a delete that never happened.
  const { data, error } = await supabase
    .from("documents")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data || data.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nothing was deleted — that document either no longer exists or belongs to a different account.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, deleted: data.length });
}
