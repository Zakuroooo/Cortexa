/**
 * Tools that must run on the server: they need API keys (search), network
 * access with an SSRF guard (web pages) or the user's database (documents).
 * Results go back to the browser, which wraps them as untrusted data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { webSearch } from "@/lib/ai/tools";
import { embedQuery } from "@/lib/ai/embeddings";
import { readWebpage } from "./webpage";
import { truncate } from "@/lib/utils";

export const SERVER_TOOLS = ["web_search", "read_webpage", "search_docs"] as const;
export type ServerToolName = (typeof SERVER_TOOLS)[number];

export async function runServerTool(
  name: ServerToolName,
  args: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<Record<string, unknown>> {
  if (name === "web_search") {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query is required");
    return { query, results: await webSearch(query, Math.min(Number(args.max_results) || 5, 8)) };
  }
  if (name === "read_webpage") {
    return await readWebpage(String(args.url ?? ""));
  }
  if (name === "search_docs") {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query is required");
    const { data, error } = await supabase.rpc("match_chunks", {
      query_embedding: await embedQuery(query),
      match_count: Math.min(Number(args.match_count) || 6, 10),
    });
    if (error) throw new Error(error.message);
    return {
      results: (data ?? []).map((d: any) => ({
        document: d.document_title,
        similarity: Number(Number(d.similarity).toFixed(3)),
        text: truncate(d.content, 900),
      })),
    };
  }
  throw new Error(`Unknown server tool: ${name}`);
}
