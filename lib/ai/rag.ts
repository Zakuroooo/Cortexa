import { embedQuery, embeddingProvider } from "./embeddings";
import type { Citation } from "@/types";
import { truncate } from "@/lib/utils";

export interface RetrievalResult {
  citations: Citation[];
  contextBlock: string;
  mode: "semantic" | "keyword" | "overview" | "empty";
}

const STOPWORDS = new Set([
  "what", "about", "documents", "document", "this", "that", "with", "from",
  "have", "has", "paragraph", "summarize", "summary", "tell", "please",
  "could", "would", "should", "there", "their", "them", "they", "your",
  "yours", "mine", "into", "onto", "does", "did", "done", "when", "where",
  "which", "while", "being", "been", "more", "most", "some", "such", "only",
  "also", "very", "just", "like", "make", "made", "give", "gimme", "show",
  "find", "list", "using", "based", "need", "want", "know", "think", "stuff",
  "things", "content", "library", "topic", "topics", "main", "key", "points",
]);

function extractKeywords(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    ),
  ].slice(0, 5);
}

interface RawChunk {
  id: string;
  document_id: string;
  document_title: string;
  content: string;
  similarity: number | null;
}

/**
 * Same scale problem as memory recall: dense models put unrelated text around
 * 0.55, the hashed fallback around 0.13. Chunks are ranked by distance and
 * capped at k, so this floor only decides when to admit that nothing matched —
 * keep it permissive enough to still fall through to keyword search.
 */
function chunkFloor(): number {
  return embeddingProvider() === "local" ? 0.05 : 0.45;
}

async function vectorSearch(
  supabase: any,
  query: string,
  k: number
): Promise<RawChunk[]> {
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: k,
    min_similarity: chunkFloor(),
  });
  if (error) throw new Error(`Vector search failed: ${error.message}`);
  return (data ?? []).map((r: any) => ({ ...r, similarity: Number(r.similarity) }));
}

async function keywordSearch(
  supabase: any,
  words: string[],
  k: number
): Promise<RawChunk[]> {
  if (!words.length) return [];
  const or = words.map((w) => `content.ilike.%${w}%`).join(",");
  const { data, error } = await supabase
    .from("chunks")
    .select("id, document_id, content, documents(title)")
    .or(or)
    .limit(k);
  if (error) return [];
  return (data ?? []).map((r: any) => ({
    id: r.id,
    document_id: r.document_id,
    document_title: r.documents?.title ?? "Untitled",
    content: r.content,
    similarity: null,
  }));
}

async function overviewChunks(supabase: any): Promise<RawChunk[]> {
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title")
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(3);
  if (!docs?.length) return [];

  const out: RawChunk[] = [];
  for (const d of docs) {
    const { data: chunks } = await supabase
      .from("chunks")
      .select("id, content, idx")
      .eq("document_id", d.id)
      .order("idx", { ascending: true })
      .limit(2);
    for (const c of chunks ?? []) {
      out.push({
        id: c.id,
        document_id: d.id,
        document_title: d.title,
        content: c.content,
        similarity: null,
      });
    }
  }
  return out.slice(0, 6);
}

export async function retrieveContext(
  supabase: any,
  query: string,
  k = 6
): Promise<RetrievalResult> {
  let mode: RetrievalResult["mode"] = "semantic";
  let rows = await vectorSearch(supabase, query, k);

  const seen = new Set(rows.map((r) => r.id));
  if (rows.length < 3) {
    mode = "keyword";
    for (const r of await keywordSearch(supabase, extractKeywords(query), k)) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        rows.push(r);
      }
    }
  }

  if (!rows.length) {
    mode = "overview";
    rows = await overviewChunks(supabase);
  }

  if (!rows.length) return { citations: [], contextBlock: "", mode: "empty" };

  const citations: Citation[] = rows.map((r, i) => ({
    n: i + 1,
    document_id: r.document_id,
    document_title: r.document_title,
    snippet: truncate(r.content, 280),
    ...(r.similarity !== null && r.similarity !== undefined
      ? { similarity: r.similarity }
      : {}),
  }));

  let contextBlock = rows
    .map(
      (r, i) =>
        `[${i + 1}] Source: "${r.document_title}"\n${truncate(r.content, 1400)}`
    )
    .join("\n\n---\n\n");

  if (mode === "overview") {
    contextBlock =
      "(These are OPENING excerpts of the user's most recent documents, provided as an overview.)\n\n" +
      contextBlock;
  } else if (mode === "keyword") {
    contextBlock =
      "(Matched by keyword search across the user's library.)\n\n" + contextBlock;
  }

  return { citations, contextBlock, mode };
}

export function buildHistoryMessage(
  role: "user" | "assistant",
  content: string
) {
  return { role, content };
}
