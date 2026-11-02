import { createClient } from "@/lib/supabase/server";
import { parseCsv } from "@/lib/cowork/csv";
import { buildXlsx } from "@/lib/cowork/xlsx";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Download an artifact. ?as=xlsx turns a CSV artifact into a real Excel file. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { id, artifactId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: a } = await supabase
    .from("task_artifacts")
    .select("name, format, content")
    .eq("id", artifactId)
    .eq("task_id", id)
    .maybeSingle();
  if (!a) return Response.json({ error: "Artifact not found" }, { status: 404 });

  const as = new URL(request.url).searchParams.get("as");
  if (as === "xlsx") {
    if (a.format !== "csv") return Response.json({ error: "Only table (CSV) artifacts convert to Excel" }, { status: 400 });
    const bytes = buildXlsx(parseCsv(a.content), a.name);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": TYPES.xlsx,
        "Content-Disposition": `attachment; filename="${a.name}.xlsx"`,
      },
    });
  }

  return new Response(a.content, {
    headers: {
      "Content-Type": TYPES[a.format] ?? "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${a.name}.${a.format}"`,
    },
  });
}
