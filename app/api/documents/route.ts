import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chunkText } from "@/lib/ai/chunking";
import { embedTexts } from "@/lib/ai/embeddings";
import { fetchUrlText } from "@/lib/ai/tools";
import { truncate } from "@/lib/utils";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;

export const runtime = "nodejs";
// Hobby-plan ceiling (see the note in app/api/chat/stream/route.ts).
// Very large PDFs may need this raised on a paid plan.
export const maxDuration = 60;

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return typeof text === "string" ? text : String(text ?? "");
}

function deriveTitle(candidate: string | undefined | null, fallback: string) {
  const t = candidate?.trim();
  return t ? truncate(t, 120) : fallback;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let docId: string | null = null;
  let providedTitle: string | undefined;
  try {
    let rawText = "";
    let sourceType: "pdf" | "text" | "url" = "text";
    let sourceUrl: string | null = null;
    let titleFallback = "Untitled";

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      if (file.size > MAX_FILE_BYTES)
        return NextResponse.json(
          { error: "File too large (max 10 MB)" },
          { status: 413 }
        );

      const name = file.name || "upload";
      titleFallback = name.replace(/\.[^.]+$/, "");
      const buffer = await file.arrayBuffer();

      const isPdf =
        file.type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        sourceType = "pdf";
        rawText = await extractPdf(buffer);
      } else if (
        file.type.startsWith("text/") ||
        /\.(txt|md|markdown|csv|json)$/i.test(name)
      ) {
        rawText = new TextDecoder().decode(buffer);
      } else {
        return NextResponse.json(
          { error: "Unsupported file type. Use PDF, TXT or MD." },
          { status: 415 }
        );
      }

      const formTitle = form.get("title");
      if (typeof formTitle === "string" && formTitle.trim())
        providedTitle = formTitle;
    } else {
      const body = await request.json();
      if (body.url) {
        sourceType = "url";
        sourceUrl = String(body.url);
        if (!/^https?:\/\//i.test(sourceUrl))
          return NextResponse.json(
            { error: "URL must start with http(s)://" },
            { status: 400 }
          );
        const extracted = await fetchUrlText(sourceUrl);
        rawText = extracted.text;
        titleFallback = extracted.title || new URL(sourceUrl).hostname;
      } else if (typeof body.text === "string" && body.text.trim()) {
        sourceType = "text";
        rawText = body.text;
      } else {
        return NextResponse.json(
          { error: "Provide a file, text, or url" },
          { status: 400 }
        );
      }
      providedTitle =
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : undefined;
    }

    if (!rawText.trim())
      throw new Error(
        "No readable text found (scanned/image PDFs are not supported yet)."
      );
    if (rawText.length > MAX_TEXT_CHARS)
      rawText = rawText.slice(0, MAX_TEXT_CHARS);

    const { data: doc, error: insErr } = await supabase
      .from("documents")
      .insert({
        user_id: user.id,
        title: deriveTitle(providedTitle, truncate(titleFallback, 100)),
        source_type: sourceType,
        source_url: sourceUrl,
        status: "processing",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    docId = doc.id;

    const chunks = chunkText(rawText);
    if (!chunks.length) throw new Error("Document produced no indexable text");

    const embeddings = await embedTexts(chunks);

    const rows = chunks.map((content, i) => ({
      user_id: user.id,
      document_id: docId!,
      idx: i,
      content,
      embedding: embeddings[i],
    }));

    const { error: chunkErr } = await supabase.from("chunks").insert(rows);
    if (chunkErr) throw new Error(`Indexing failed: ${chunkErr.message}`);

    const { error: updErr } = await supabase
      .from("documents")
      .update({
        status: "ready",
        char_count: rawText.length,
        chunk_count: chunks.length,
        error: null,
      })
      .eq("id", docId);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({
      ok: true,
      document: {
        id: docId,
        title: deriveTitle(providedTitle, truncate(titleFallback, 100)),
        status: "ready",
        chunk_count: chunks.length,
        char_count: rawText.length,
      },
    });
  } catch (e: any) {
    const message = String(e?.message || e);
    if (docId) {
      await supabase
        .from("documents")
        .update({ status: "failed", error: truncate(message, 300) })
        .eq("id", docId);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Wipe the whole library — needed when switching embedding providers, since
 *  vectors from two different models can't be compared. */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase.from("chunks").delete().eq("user_id", user.id);

  const { data, error } = await supabase
    .from("documents")
    .delete()
    .eq("user_id", user.id)
    .select("id");

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
}
