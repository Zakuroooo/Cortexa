export type SourceType = "pdf" | "text" | "url";
export type DocStatus = "processing" | "ready" | "failed";
export type ChatMode = "ask" | "agent" | "auto";
export type NoteKind = "note" | "quiz";
export type MemoryKind = "fact" | "preference" | "goal" | "event" | "skill";
export type MemorySource = "auto" | "agent" | "user";
export type Route = "direct" | "documents" | "memory" | "hybrid" | "agent";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  title: string;
  source_type: SourceType;
  source_url: string | null;
  status: DocStatus;
  error: string | null;
  char_count: number;
  chunk_count: number;
  created_at: string;
}

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  kind: NoteKind;
  created_by: "user" | "ai";
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  created_at: string;
  updated_at: string;
}

export interface MemoryRow {
  id: string;
  user_id: string;
  kind: MemoryKind;
  content: string;
  source: MemorySource;
  source_chat_id: string | null;
  confidence: number;
  pinned: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A memory returned by semantic recall (embedding column omitted). */
export interface RecalledMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  pinned: boolean;
  confidence: number;
  updated_at: string;
  similarity: number;
}

export interface RouteDecision {
  route: Route;
  searchQuery: string;
  reason: string;
  /** Whether an LLM chose this, or the deterministic fallback did. */
  source: "llm" | "heuristic";
}

export interface MemoryEventItem {
  status: "created" | "merged" | "skipped";
  content?: string;
}

export interface Citation {
  n: number;
  document_id: string;
  document_title: string;
  snippet: string;
  similarity?: number;
}

export interface TraceStep {
  type: "thinking" | "tool_call" | "tool_result" | "error" | "route" | "memory";
  label?: string;
  detail?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  at: number;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  trace: TraceStep[];
  created_at: string;
}
