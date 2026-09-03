"use client";

import { useEffect, useMemo, useState } from "react";
import {
  StickyNote,
  Plus,
  Trash2,
  Bot,
  User,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import type { NoteRow } from "@/types";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Overline,
  Spinner,
  Textarea,
} from "@/components/ui";
import { timeAgo } from "@/lib/utils";

interface QuizQuestion {
  question: string;
  options: string[];
  answer_index: number;
  explanation?: string;
}

export default function NotesManager() {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId]
  );

  async function load() {
    try {
      const res = await fetch("/api/notes");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load notes");
      setNotes(json.notes ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openEditor(note: NoteRow) {
    setSelectedId(note.id);
    setDraft({ title: note.title, content: note.content });
  }

  function closeEditor() {
    setSelectedId(null);
    setDraft(null);
  }

  async function createNote() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled note", content: "" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Create failed");
      setNotes((n) => [json.note, ...n]);
      openEditor(json.note);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function save() {
    if (!selected || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setNotes((n) => n.map((x) => (x.id === json.note.id ? json.note : x)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this note?")) return;
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that note");
      load();
      return;
    }
    if (selectedId === id) closeEditor();
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  return (
    <div className="mx-auto max-w-6xl px-10 py-12">
      <Overline>Knowledge output</Overline>
      <div className="mt-3 flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <Button onClick={createNote} disabled={creating} className="h-9">
          {creating ? <Spinner /> : <Plus className="h-4 w-4" />} New note
        </Button>
      </div>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-mut">
        Your own writing, plus anything the agent produces — summaries, briefs
        and practice quizzes land here automatically.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-4 py-2.5 text-sm text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-dim">
          <Spinner className="h-5 w-5" />
        </div>
      ) : notes.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<StickyNote className="h-8 w-8" />}
            title="No notes yet"
            hint="Write one yourself, or brief the Agent in Chat — its research lands here as structured notes."
          />
        </div>
      ) : selected && draft ? (
        <div className="mt-8 rounded-xl border border-line bg-panel p-6">
          <div className="mb-5 flex items-center gap-2">
            <Input
              className="flex-1 border-transparent bg-transparent px-0 text-base font-medium focus:border-transparent"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <Badge tone={selected.kind === "quiz" ? "blue" : "gray"}>
              {selected.kind}
            </Badge>
            <Button onClick={save} disabled={saving} variant="secondary" className="h-9">
              {saving ? <Spinner /> : null} Save
            </Button>
            <Button onClick={closeEditor} variant="ghost" className="h-9 px-3">
              Close
            </Button>
          </div>
          <Textarea
            rows={13}
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder="Write in markdown…"
            className="font-mono text-[13px]"
          />
          {selected.kind === "quiz" && draft.content.trim().startsWith("{") && (
            <QuizViewer raw={draft.content} />
          )}
        </div>
      ) : (
        <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2 xl:grid-cols-3">
          {notes.map((n) => (
            <article key={n.id} className="group relative bg-canvas p-6 transition-colors hover:bg-panel">
              <div
                className="cursor-pointer"
                onClick={() => openEditor(n)}
              >
                <div className="mb-2.5 flex items-start justify-between gap-3">
                  <h3 className="line-clamp-2 text-[15px] font-medium leading-snug tracking-tight">
                    {n.title}
                  </h3>
                  {n.kind === "quiz" && (
                    <span className="shrink-0 pt-1 font-mono text-[10px] uppercase tracking-wider text-sky-400">
                      quiz
                    </span>
                  )}
                </div>
                <p className="line-clamp-4 text-[13px] leading-relaxed text-dim">
                  {n.content.replace(/[#*`>\-\[\]]/g, "").slice(0, 200) ||
                    "(empty)"}
                </p>
              </div>
              <footer className="mt-5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                  {n.created_by === "ai" ? (
                    <>
                      <Bot className="h-3 w-3 text-acid" /> agent
                    </>
                  ) : (
                    <>
                      <User className="h-3 w-3" /> you
                    </>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-dim">
                    {timeAgo(n.updated_at)}
                  </span>
                  <button
                    onClick={() => remove(n.id)}
                    className="rounded-md p-1.5 text-dim opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                    aria-label={`Delete ${n.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function QuizViewer({ raw }: { raw: string }) {
  let questions: QuizQuestion[] = [];
  try {
    const parsed = JSON.parse(raw);
    questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  } catch {}

  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);

  if (!questions.length)
    return (
      <p className="mt-4 text-xs text-dim">
        Marked as a quiz but no parseable questions found.
      </p>
    );

  const score = questions.reduce(
    (acc, q, i) => acc + (answers[i] === q.answer_index ? 1 : 0),
    0
  );
  const pct = Math.round((score / questions.length) * 100);

  return (
    <div className="mt-8 space-y-5 border-t border-line pt-7">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
          Practice · {questions.length} questions
        </p>
        <div className="flex items-center gap-2">
          {checked && (
            <Badge tone={pct >= 70 ? "green" : "amber"}>
              score {score}/{questions.length}
            </Badge>
          )}
          <Button
            variant="secondary"
            className="h-8"
            onClick={() => setChecked(true)}
            disabled={!Object.keys(answers).length || checked}
          >
            Check answers
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-3"
            onClick={() => {
              setAnswers({});
              setChecked(false);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {questions.map((q, i) => (
        <div key={i} className="rounded-xl border border-line p-5">
          <p className="text-sm font-medium leading-relaxed">
            <span className="mr-2 font-mono text-acid">
              {String(i + 1).padStart(2, "0")}
            </span>
            {q.question}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {q.options.map((opt, oi) => {
              const picked = answers[i] === oi;
              const correct = checked && oi === q.answer_index;
              const wrong = checked && picked && oi !== q.answer_index;
              return (
                <button
                  key={oi}
                  onClick={() =>
                    !checked && setAnswers((a) => ({ ...a, [i]: oi }))
                  }
                  className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${
                    correct
                      ? "border-acid/50 bg-acid/[0.07] text-acid"
                      : wrong
                        ? "border-red-500/50 bg-red-500/[0.07] text-red-300"
                        : picked
                          ? "border-line-strong text-fg"
                          : "border-line text-mut hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <span className="font-mono text-[10px] opacity-60">
                    {String.fromCharCode(65 + oi)}
                  </span>
                  <span className="min-w-0 flex-1">{opt}</span>
                  {correct && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>
          {checked && q.explanation && (
            <p className="mt-3.5 border-l-2 border-acid/40 pl-3 text-xs leading-relaxed text-mut">
              {q.explanation}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
