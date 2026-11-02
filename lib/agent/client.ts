"use client";

/**
 * Browser wiring for the agent: model calls and server tools go through our
 * own API routes (keys stay on the server), and task history is saved to
 * Supabase with the user's session (RLS: own rows only).
 */
import { createClient } from "@/lib/supabase/client";
import type { AgentDeps } from "./tools";
import type { AgentEvent, ChatMessage, LlmReply, Todo, ToolSpec } from "./types";

export async function callLlm(messages: ChatMessage[], tools?: ToolSpec[], opts?: { light?: boolean; maxTokens?: number }): Promise<LlmReply> {
  const res = await fetch("/api/agent/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools, ...opts }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Model call failed (${res.status})`);
  return json as LlmReply;
}

export const callServerTool: AgentDeps["serverTool"] = async (name, args) => {
  const res = await fetch("/api/agent/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: name, args }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { error: json.error || `Tool failed (${res.status})` };
  return json;
};

/** Saves one task and its timeline. Events are batched once a second. */
export class TaskHistory {
  private sb = createClient();
  private queue: { type: string; data: AgentEvent }[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  id: string | null = null;
  userId: string | null = null;

  async start(goal: string, folderName: string, folderKind: "folder" | "virtual") {
    const { data: auth } = await this.sb.auth.getUser();
    if (!auth.user) return;
    this.userId = auth.user.id;
    const { data } = await this.sb
      .from("cowork_tasks")
      .insert({ user_id: auth.user.id, goal, folder_name: folderName, folder_kind: folderKind })
      .select("id")
      .single();
    this.id = data?.id ?? null;
    this.timer = setInterval(() => this.flush(), 1000);
  }

  add(e: AgentEvent) {
    if (e.type === "status") return; // transient, not worth storing
    this.queue.push({ type: e.type, data: e });
  }

  async flush() {
    if (!this.id || !this.userId || !this.queue.length) return;
    const batch = this.queue.splice(0);
    await this.sb.from("cowork_events").insert(
      batch.map((b) => ({ task_id: this.id, user_id: this.userId, seq: ++this.seq, type: b.type, data: b.data }))
    );
  }

  async finish(r: { status: string; summary: string; outputs: string[]; tokens: number; turns: number; verified: boolean; error?: string; todos: Todo[] }) {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
    if (!this.id) return;
    await this.sb
      .from("cowork_tasks")
      .update({
        status: r.status,
        summary: r.summary,
        outputs: r.outputs,
        tokens_used: r.tokens,
        turns: r.turns,
        verified: r.verified,
        error: r.error ?? null,
        todos: r.todos,
        finished_at: new Date().toISOString(),
      })
      .eq("id", this.id);
  }
}

export interface PastTask {
  id: string;
  goal: string;
  status: string;
  summary: string;
  outputs: string[];
  folder_name: string;
  tokens_used: number;
  created_at: string;
}

export async function loadHistory(): Promise<PastTask[]> {
  const { data } = await createClient()
    .from("cowork_tasks")
    .select("id, goal, status, summary, outputs, folder_name, tokens_used, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as PastTask[];
}

export async function loadTaskEvents(taskId: string): Promise<AgentEvent[]> {
  const { data } = await createClient().from("cowork_events").select("data").eq("task_id", taskId).order("seq");
  return (data ?? []).map((r: any) => r.data as AgentEvent);
}
