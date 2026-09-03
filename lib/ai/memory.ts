/**
 * Persistent memory layer.
 *
 * This is the piece that separates "RAG over a static corpus" from an agent
 * that actually remembers: a durable, per-user store of learned facts that is
 * READ before answering and WRITTEN after answering. Documents are what the
 * user uploaded; memories are what the assistant figured out.
 */
import { embedQuery, embedTexts, embeddingProvider } from "./embeddings";
import { completeOnce, type Msg } from "./provider";
import { truncate } from "@/lib/utils";
import type { MemoryKind, MemoryRow, RecalledMemory } from "@/types";

const KINDS: MemoryKind[] = ["fact", "preference", "goal", "event", "skill"];

/**
 * Cosine floors are NOT comparable across embedding models. Measured on this
 * project's own data: real dense models (jina/gemini/ollama) score two totally
 * unrelated sentences around 0.55, so a 0.3 floor would admit everything — the
 * useful signal sits above ~0.65. The hashed local fallback lives on a
 * completely different scale (unrelated ≈ 0.13, and it scores paraphrases at
 * 0.00), so it needs a floor near zero to return anything at all.
 */
function recallFloor(): number {
  return embeddingProvider() === "local" ? 0.08 : 0.65;
}

/** Near-identical memories are merged instead of duplicated. */
function dedupeFloor(): number {
  return embeddingProvider() === "local" ? 0.9 : 0.93;
}
/** Hard cap so a runaway extraction can never flood the table. */
const MAX_PER_TURN = 4;
const MAX_CONTENT = 400;

function normalizeKind(v: unknown): MemoryKind {
  const s = String(v ?? "").toLowerCase();
  return (KINDS as string[]).includes(s) ? (s as MemoryKind) : "fact";
}

// ---------------------------------------------------------------- recall ---

const SELECT = "id, kind, content, pinned, confidence, updated_at";

export async function recallMemories(
  supabase: any,
  query: string,
  k = 6
): Promise<RecalledMemory[]> {
  const out = new Map<string, RecalledMemory>();

  // Pinned memories are unconditional context — they bypass similarity.
  const { data: pinned } = await supabase
    .from("memories")
    .select(SELECT)
    .eq("pinned", true)
    .order("updated_at", { ascending: false })
    .limit(8);
  for (const m of pinned ?? []) out.set(m.id, { ...m, similarity: 1 });

  try {
    const embedding = await embedQuery(query);
    const { data } = await supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_count: k,
      min_similarity: recallFloor(),
    });
    for (const m of data ?? []) {
      if (!out.has(m.id)) out.set(m.id, { ...m, similarity: Number(m.similarity) });
    }
  } catch {
    // Recall is best-effort — never fail a turn because memory search broke.
  }

  // Semantic recall alone is fragile: the local fallback embedder barely
  // matches paraphrases, and a brand-new memory may not be embedded yet. A
  // personal memory store is tens of rows, not millions — so top up with the
  // most recent ones rather than silently forgetting things.
  if (out.size < k) {
    const { data: recent } = await supabase
      .from("memories")
      .select(SELECT)
      .order("updated_at", { ascending: false })
      .limit(k * 2);
    for (const m of recent ?? []) {
      if (out.size >= k + 4) break;
      if (!out.has(m.id)) out.set(m.id, { ...m, similarity: 0 });
    }
  }

  return [...out.values()].slice(0, k + 8);
}

export function formatMemoryBlock(memories: RecalledMemory[]): string {
  if (!memories.length) return "";
  const lines = memories.map(
    (m) => `- (${m.kind}${m.pinned ? ", pinned" : ""}) ${m.content}`
  );
  return `What you already know about this user, remembered from earlier sessions:\n${lines.join("\n")}`;
}

export async function markMemoriesUsed(
  supabase: any,
  memories: RecalledMemory[]
): Promise<void> {
  if (!memories.length) return;
  try {
    await supabase.rpc("touch_memories", {
      memory_ids: memories.map((m) => m.id),
    });
  } catch {}
}

// ----------------------------------------------------------------- write ---

export interface SaveMemoryInput {
  content: string;
  kind?: MemoryKind | string;
  confidence?: number;
  source?: "auto" | "agent" | "user";
  sourceChatId?: string | null;
  pinned?: boolean;
}

export type SaveResult =
  | { status: "created"; id: string; content: string }
  | { status: "merged"; id: string; content: string }
  | { status: "skipped"; reason: string };

/**
 * Write one memory, merging into a near-duplicate rather than piling up
 * restatements of the same fact.
 */
export async function saveMemory(
  supabase: any,
  userId: string,
  input: SaveMemoryInput
): Promise<SaveResult> {
  const content = truncate(String(input.content ?? "").trim(), MAX_CONTENT);
  if (content.length < 8)
    return { status: "skipped", reason: "content too short to be a useful memory" };

  let embedding: number[] | null = null;
  try {
    embedding = await embedQuery(content);
  } catch {}

  if (embedding) {
    try {
      const { data: similar } = await supabase.rpc("match_memories", {
        query_embedding: embedding,
        match_count: 1,
        min_similarity: dedupeFloor(),
      });
      const hit = similar?.[0];
      if (hit) {
        // Keep the longer, more specific phrasing of the two.
        const merged = hit.content.length >= content.length ? hit.content : content;
        await supabase
          .from("memories")
          .update({
            content: merged,
            confidence: Math.min(
              1,
              Math.max(hit.confidence ?? 0.7, input.confidence ?? 0.7) + 0.05
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("id", hit.id);
        return { status: "merged", id: hit.id, content: merged };
      }
    } catch {}
  }

  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      kind: normalizeKind(input.kind),
      content,
      embedding,
      source: input.source ?? "auto",
      source_chat_id: input.sourceChatId ?? null,
      confidence: Math.min(1, Math.max(0, input.confidence ?? 0.7)),
      pinned: Boolean(input.pinned),
    })
    .select("id")
    .single();

  if (error) return { status: "skipped", reason: error.message };
  return { status: "created", id: data.id, content };
}

/** Backfill an embedding for a memory created without one (e.g. via the UI). */
export async function embedMemory(
  supabase: any,
  id: string,
  content: string
): Promise<void> {
  try {
    const [embedding] = await embedTexts([content]);
    await supabase.from("memories").update({ embedding }).eq("id", id);
  } catch {}
}

// ------------------------------------------------------------- extraction ---

const EXTRACT_SYSTEM = `You extract DURABLE memories from a conversation — facts worth recalling weeks later.

Return ONLY a JSON array (no prose, no code fence). Each item:
  { "content": string, "kind": "fact"|"preference"|"goal"|"event"|"skill", "confidence": 0-1 }

SAVE things like:
- stable facts about the user (their name, course, city, role, tools, constraints)
- preferences about how they want answers ("prefers short bullet answers", "explains in Hinglish")
- ongoing goals and projects ("preparing for GATE 2027", "building a delivery app")
- commitments and deadlines with concrete dates

DO NOT save:
- anything already obvious from the current question alone
- one-off trivia, the assistant's own output, or content that lives in their documents
- speculation, or anything the user did not actually state or clearly imply
- transient chatter ("said hello", "asked a follow-up")

Write each memory as a standalone sentence that makes sense with no surrounding
context, in the third person ("The user ..."). Prefer 0-2 items. Return [] when
nothing durable was said — that is the correct and common answer.`;

interface ExtractedMemory {
  content: string;
  kind: MemoryKind;
  confidence: number;
}

function parseExtraction(raw: string): ExtractedMemory[] {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
    .map((m) => ({
      content: String(m.content ?? "").trim(),
      kind: normalizeKind(m.kind),
      confidence: Math.min(1, Math.max(0, Number(m.confidence) || 0.7)),
    }))
    .filter((m) => m.content.length >= 8 && m.confidence >= 0.5)
    .slice(0, MAX_PER_TURN);
}

/**
 * The loop-back arrow: after a turn completes, decide what was worth keeping
 * and write it. Best-effort by design — a failure here must never surface as a
 * failed answer.
 */
export async function extractAndSaveMemories(opts: {
  supabase: any;
  userId: string;
  chatId: string;
  userMessage: string;
  assistantMessage: string;
  existing: RecalledMemory[];
}): Promise<SaveResult[]> {
  const { supabase, userId, chatId, userMessage, assistantMessage } = opts;
  if (userMessage.trim().length < 12) return [];

  const known = opts.existing.length
    ? `Already remembered (do NOT repeat these):\n${opts.existing
        .map((m) => `- ${m.content}`)
        .join("\n")}\n\n`
    : "";

  const messages: Msg[] = [
    { role: "system", content: EXTRACT_SYSTEM },
    {
      role: "user",
      content:
        `${known}Conversation turn:\n\nUSER: ${truncate(userMessage, 2000)}\n\n` +
        `ASSISTANT: ${truncate(assistantMessage, 1500)}\n\nJSON array:`,
    },
  ];

  let raw = "";
  try {
    raw = await completeOnce(messages, 400);
  } catch {
    return [];
  }

  const results: SaveResult[] = [];
  for (const m of parseExtraction(raw)) {
    results.push(
      await saveMemory(supabase, userId, {
        content: m.content,
        kind: m.kind,
        confidence: m.confidence,
        source: "auto",
        sourceChatId: chatId,
      })
    );
  }
  return results;
}

export type { MemoryRow };
