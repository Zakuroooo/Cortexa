"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BrainCircuit,
  Pin,
  PinOff,
  Trash2,
  Plus,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import type { MemoryRow, MemoryKind } from "@/types";
import { Button, Input } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";

const KINDS: MemoryKind[] = ["fact", "preference", "goal", "event", "skill"];

const KIND_STYLES: Record<MemoryKind, string> = {
  fact: "border-sky-400/30 text-sky-300",
  preference: "border-violet-400/30 text-violet-300",
  goal: "border-acid/30 text-acid",
  event: "border-amber-400/30 text-amber-300",
  skill: "border-pink-400/30 text-pink-300",
};

const SOURCE_LABEL: Record<string, string> = {
  auto: "learned from chat",
  agent: "saved by agent",
  user: "added by you",
};

export default function MemoryManager() {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<MemoryKind>("fact");
  const [filter, setFilter] = useState<MemoryKind | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memories");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load memories");
      setMemories(json.memories ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load memories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, kind }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save");
      setContent("");
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setMemories((m) =>
      m.map((x) => (x.id === id ? { ...x, ...(body as Partial<MemoryRow>) } : x))
    );
    try {
      const res = await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that memory");
    }
    load();
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setMemories((m) => m.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not forget that memory");
      load();
    }
  }

  async function forgetAll() {
    if (
      !confirm(
        "Delete every memory that wasn't pinned? Pinned memories are kept. This can't be undone."
      )
    )
      return;
    try {
      const res = await fetch("/api/memories", { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear memory");
    }
    load();
  }

  const shown =
    filter === "all" ? memories : memories.filter((m) => m.kind === filter);
  const autoCount = memories.filter((m) => m.source !== "user").length;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
          Knowledge
        </p>
        <h1 className="flex items-center gap-2.5 text-2xl font-medium tracking-tight">
          <BrainCircuit className="h-5 w-5 text-sky-400" />
          Memory
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mut">
          What Cortexa remembers about <em>you</em> — separate from your
          documents. It writes here automatically after conversations and reads
          from it before answering. Pinned memories are included in every turn.
        </p>
      </header>

      <form
        onSubmit={add}
        className="mb-8 rounded-xl border border-line bg-panel p-4"
      >
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-dim">
          Teach it something
        </p>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="The user is a 2nd-year CS student preparing for placements."
            className="flex-1"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MemoryKind)}
            className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-fg outline-none focus:border-acid/50"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={!content.trim() || busy}>
            <Plus className="h-3.5 w-3.5" />
            {busy ? "Saving…" : "Remember"}
          </Button>
        </div>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["all", ...KINDS] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
              filter === k
                ? "border-acid/40 text-acid"
                : "border-line text-dim hover:border-line-strong hover:text-mut"
            )}
          >
            {k}
            {k !== "all" && (
              <span className="ml-1.5 opacity-60">
                {memories.filter((m) => m.kind === k).length}
              </span>
            )}
          </button>
        ))}
        {autoCount > 0 && (
          <button
            onClick={forgetAll}
            className="ml-auto rounded-full border border-red-500/25 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-red-400 transition-colors hover:bg-red-500/[0.08]"
          >
            forget all unpinned
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-dim">Loading memory…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-16 text-center">
          <Sparkles className="mx-auto mb-4 h-7 w-7 text-dim" />
          <p className="text-sm text-mut">
            {memories.length === 0
              ? "Nothing remembered yet."
              : `No ${filter} memories.`}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-dim">
            Chat normally — durable facts are extracted and stored on their own.
            Or add one above to seed it.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((m) => (
            <div
              key={m.id}
              className={cn(
                "group flex items-start gap-3 rounded-xl border bg-panel px-4 py-3 transition-colors",
                m.pinned ? "border-acid/25" : "border-line hover:border-line-strong"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]",
                  KIND_STYLES[m.kind]
                )}
              >
                {m.kind}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed text-fg">{m.content}</p>
                <p className="mt-1 font-mono text-[10px] text-dim">
                  {SOURCE_LABEL[m.source] ?? m.source} · {timeAgo(m.created_at)}
                  {m.use_count > 0 && ` · used ${m.use_count}×`}
                  {m.confidence < 1 &&
                    ` · ${Math.round(m.confidence * 100)}% confidence`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  onClick={() => patch(m.id, { pinned: !m.pinned })}
                  className={cn(
                    "rounded-md p-1.5 transition-colors hover:bg-hvr1",
                    m.pinned ? "text-acid" : "text-dim hover:text-fg"
                  )}
                  aria-label={m.pinned ? "Unpin memory" : "Pin memory"}
                  title={
                    m.pinned
                      ? "Pinned — included in every answer"
                      : "Pin to always include this"
                  }
                >
                  {m.pinned ? (
                    <Pin className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <PinOff className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  onClick={() => remove(m.id)}
                  className="rounded-md p-1.5 text-dim transition-colors hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Forget this"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {m.pinned && (
                <Pin className="h-3 w-3 shrink-0 self-center fill-current text-acid group-hover:hidden" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
