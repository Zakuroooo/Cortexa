"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  CircleDot,
  CircleStop,
  Code2,
  Download,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  History,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { Button, Overline, Textarea } from "@/components/ui";
import Markdown from "@/components/Markdown";
import { runAgent, type AgentResult } from "@/lib/agent/agent";
import { createBrowserSandbox } from "@/lib/agent/sandbox-browser";
import { callLlm, callServerTool, loadHistory, loadTaskEvents, TaskHistory, type PastTask } from "@/lib/agent/client";
import { MemoryWorkspace, folderAccessSupported, pickFolder, toZip, type FileInfo, type Workspace } from "@/lib/agent/workspace";
import type { AgentEvent, Todo } from "@/lib/agent/types";
import { sampleFolder } from "@/lib/agent/samples";
import type { PythonSandbox } from "@/lib/agent/sandbox";
import { cn, formatBytes, timeAgo, truncate } from "@/lib/utils";

const EXAMPLES = [
  "Clean sales.csv (remove duplicates and empty rows, fix dates) and chart revenue by month.",
  "Read the PDFs in this folder and build an Excel risk matrix with a Total formula column.",
  "Turn notes.md into a 5-slide PowerPoint deck.",
  "Research what an HNSW index is and write a cited 1-page brief as brief.docx.",
  "Organise this folder into subfolders by file type. Don't delete anything.",
];

type Prompt =
  | { kind: "approval"; id: string; question: string; resolve: (ok: boolean) => void }
  | { kind: "ask"; id: string; question: string; resolve: (answer: string) => void };

export default function CoworkApp() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [goal, setGoal] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<PastTask[]>([]);
  const [viewing, setViewing] = useState<PastTask | null>(null);
  const [pyReady, setPyReady] = useState(false);
  const stopRef = useRef(false);
  const pyRef = useRef<PythonSandbox | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const python = () => (pyRef.current ??= createBrowserSandbox());

  useEffect(() => {
    loadHistory().then(setHistory).catch(() => {});
  }, []);

  async function refreshFiles(w = ws) {
    if (w) setFiles(await w.list());
  }

  async function openFolder() {
    try {
      const w = await pickFolder();
      setWs(w);
      await refreshFiles(w);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus(`Could not open the folder: ${(e as Error).message}`);
    }
  }

  async function openVirtual(withSamples = false) {
    const w = new MemoryWorkspace(withSamples ? "Sample folder" : "Virtual folder", withSamples ? sampleFolder() : {});
    setWs(w);
    await refreshFiles(w);
  }

  async function upload(list: FileList | null) {
    if (!list || !ws) return;
    for (const f of Array.from(list)) await ws.write(f.webkitRelativePath || f.name, new Uint8Array(await f.arrayBuffer()));
    await refreshFiles();
  }

  async function download(path: string) {
    const data = await ws?.read(path);
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data as BlobPart]));
    const a = Object.assign(document.createElement("a"), { href: url, download: path.split("/").pop() });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadZip() {
    if (!ws) return;
    const url = URL.createObjectURL(new Blob([(await toZip(ws)) as BlobPart], { type: "application/zip" }));
    Object.assign(document.createElement("a"), { href: url, download: `${ws.name}.zip` }).click();
    URL.revokeObjectURL(url);
  }

  async function warmup() {
    setStatus("Starting Python…");
    await python().warmup((s) => setStatus(s));
    setPyReady(true);
    setStatus("Python ready");
  }

  function emit(e: AgentEvent) {
    if (e.type === "status") {
      if (e.text === "Python ready") setPyReady(true);
      return setStatus(e.text);
    }
    if (e.type === "todos") setTodos(e.todos);
    if (e.type === "tool_result" && e.files?.length) {
      setTouched((t) => new Set([...t, ...e.files!]));
      refreshFiles();
    }
    setEvents((list) => [...list, e]);
  }

  async function run() {
    if (!ws || !goal.trim() || running) return;
    stopRef.current = false;
    setRunning(true);
    setResult(null);
    setEvents([]);
    setTodos([]);
    setTouched(new Set());
    setViewing(null);
    const hist = new TaskHistory();
    await hist.start(goal.trim(), ws.name, ws.kind).catch(() => {});
    let latestTodos: Todo[] = [];
    const record = (e: AgentEvent) => {
      if (e.type === "todos") latestTodos = e.todos;
      hist.add(e);
      emit(e);
    };

    const r = await runAgent(goal.trim(), {
      llm: callLlm,
      serverTool: callServerTool,
      workspace: ws,
      python: python(),
      approve: (question) =>
        new Promise<boolean>((resolve) => {
          const id = `ap_${Date.now()}`;
          record({ type: "approval", id, question, decision: "pending" });
          setPrompt({
            kind: "approval",
            id,
            question,
            resolve: (ok) => {
              setPrompt(null);
              record({ type: "approval", id, question, decision: ok ? "approved" : "denied" });
              resolve(ok);
            },
          });
        }),
      askUser: (question) =>
        new Promise<string>((resolve) => {
          const id = `ask_${Date.now()}`;
          setPrompt({
            kind: "ask",
            id,
            question,
            resolve: (answer) => {
              setPrompt(null);
              record({ type: "ask_user", id, question, answer });
              resolve(answer);
            },
          });
        }),
      emit: record,
      shouldStop: () => stopRef.current,
    }).catch((e): AgentResult => ({ status: "failed", summary: "", outputs: [], tokens: 0, turns: 0, verified: false, error: String(e?.message || e) }));

    setResult(r);
    setRunning(false);
    setStatus("");
    await refreshFiles();
    await hist.finish({ ...r, todos: latestTodos }).catch(() => {});
    loadHistory().then(setHistory).catch(() => {});
  }

  function stop() {
    stopRef.current = true;
    pyRef.current?.kill(); // kill a running Python script right away
    if (prompt?.kind === "approval") prompt.resolve(false);
    else if (prompt?.kind === "ask") prompt.resolve("Stop.");
    setStatus("Stopping…");
  }

  async function openPast(t: PastTask) {
    if (running) return;
    setViewing(t);
    setResult(null);
    const evs = await loadTaskEvents(t.id);
    setEvents(evs);
    setTodos([...evs].reverse().find((e): e is Extract<AgentEvent, { type: "todos" }> => e.type === "todos")?.todos ?? []);
  }

  const outputs = result?.outputs ?? (viewing?.outputs || []);

  return (
    <div className="flex h-full min-h-screen">
      {/* ------------------------------ folder ------------------------------ */}
      <aside className="w-72 shrink-0 border-r border-line px-4 py-8">
        <Overline>Folder</Overline>
        {!ws ? (
          <div className="mt-4 space-y-2">
            <Button className="w-full" onClick={openFolder} disabled={!folderAccessSupported()}>
              <FolderOpen className="h-4 w-4" /> Open a folder
            </Button>
            {!folderAccessSupported() && <p className="text-[11px] text-dim">Real folders need Chrome or Edge.</p>}
            <Button variant="secondary" className="w-full" onClick={() => openVirtual()}>
              <FolderPlus className="h-4 w-4" /> Virtual folder
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => openVirtual(true)}>
              <Sparkles className="h-4 w-4" /> Try sample files
            </Button>
            <p className="pt-2 text-[11px] leading-relaxed text-dim">
              The agent works only inside the folder you choose. Deleting or overwriting a file always asks you first.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-acid" />
              <p className="flex-1 truncate text-sm font-medium">{ws.name}</p>
              <span className="font-mono text-[10px] uppercase text-dim">{ws.kind === "folder" ? "on disk" : "virtual"}</span>
            </div>
            <div className="mt-3 flex gap-2">
              <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
              {ws.kind === "virtual" && (
                <Button variant="secondary" className="h-8 flex-1 px-2 text-xs" onClick={() => uploadRef.current?.click()} disabled={running}>
                  <Upload className="h-3.5 w-3.5" /> Add files
                </Button>
              )}
              <Button variant="secondary" className="h-8 flex-1 px-2 text-xs" onClick={downloadZip}>
                <Download className="h-3.5 w-3.5" /> Zip
              </Button>
            </div>
            <ul className="mt-4 max-h-[55vh] space-y-0.5 overflow-y-auto">
              {files.length === 0 && <li className="text-xs text-dim">Empty folder</li>}
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    onClick={() => download(f.path)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-hvr1",
                      touched.has(f.path) || outputs.includes(f.path) ? "text-acid" : "text-mut"
                    )}
                    title="Download"
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="flex-1 truncate">{f.path}</span>
                    <span className="font-mono text-[10px] text-dim">{formatBytes(f.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => !running && setWs(null)} className="mt-3 text-[11px] text-dim hover:text-fg">
              Change folder
            </button>
          </div>
        )}

        <div className="mt-8 border-t border-line pt-4">
          <Overline>Python</Overline>
          <p className="mt-2 text-[11px] leading-relaxed text-dim">
            Runs in your browser (WebAssembly). First start downloads ~30 MB, then it&apos;s cached.
          </p>
          {!pyReady && (
            <Button variant="secondary" className="mt-2 h-8 w-full text-xs" onClick={warmup}>
              <Code2 className="h-3.5 w-3.5" /> Load Python now
            </Button>
          )}
          {pyReady && <p className="mt-2 flex items-center gap-1.5 text-xs text-acid"><CheckCircle2 className="h-3.5 w-3.5" /> ready</p>}
        </div>
      </aside>

      {/* ------------------------------ main ------------------------------ */}
      <section className="min-w-0 flex-1 px-8 py-8">
        <Overline>Cowork</Overline>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Give it a job</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-mut">
          It plans a to-do list, writes and runs Python on your files, searches the web, asks before anything destructive, and checks its own output before it says done.
        </p>

        <div className="mt-5 rounded-xl border border-line p-4">
          <Textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should Cortexa do in this folder?" disabled={running} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setGoal(ex)} disabled={running} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-mut hover:text-fg">
                {truncate(ex, 48)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            {!running ? (
              <Button onClick={run} disabled={!ws || !goal.trim()}>
                <Play className="h-4 w-4" /> Start
              </Button>
            ) : (
              <Button variant="danger" onClick={stop}>
                <CircleStop className="h-4 w-4" /> Stop
              </Button>
            )}
            {!ws && <span className="text-xs text-dim">Pick a folder first.</span>}
            {status && (
              <span className="flex items-center gap-1.5 text-xs text-sky-400">
                {running && <Loader2 className="h-3 w-3 animate-spin" />} {status}
              </span>
            )}
            {running && <span className="ml-auto text-[11px] text-dim">Keep this tab open while it works.</span>}
          </div>
        </div>

        {prompt && <PromptCard prompt={prompt} />}

        {viewing && (
          <p className="mt-6 text-xs text-dim">
            Viewing a past task — <span className="text-mut">{truncate(viewing.goal, 90)}</span>
          </p>
        )}

        <Timeline events={events} />

        {result && (
          <div className={cn("mt-6 rounded-xl border px-4 py-3", result.status === "succeeded" ? "border-acid/30 bg-acid/[0.04]" : "border-line")}>
            <p className="text-sm font-medium">
              {result.status === "succeeded" ? "Done — checked and verified" : result.status === "stopped" ? "Stopped" : "Didn't finish"}
            </p>
            {result.summary && <p className="mt-1 text-sm text-mut">{result.summary}</p>}
            {result.error && <p className="mt-1 text-sm text-red-400">{result.error}</p>}
            <p className="mt-2 font-mono text-[11px] text-dim">
              {result.turns} turns · ~{result.tokens.toLocaleString()} tokens · outputs: {result.outputs.join(", ") || "—"}
            </p>
          </div>
        )}
      </section>

      {/* ------------------------------ right ------------------------------ */}
      <aside className="w-72 shrink-0 border-l border-line px-4 py-8">
        <Overline>To-do</Overline>
        <ul className="mt-3 space-y-1.5">
          {todos.length === 0 && <li className="text-xs text-dim">The agent writes its plan here.</li>}
          {todos.map((t) => (
            <li key={t.id} className="flex items-start gap-2 text-xs">
              {t.status === "done" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-acid" />
              ) : t.status === "doing" ? (
                <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-sky-400" />
              ) : t.status === "failed" ? (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
              ) : (
                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-dim" />
              )}
              <span className={cn(t.status === "done" ? "text-dim line-through" : "text-fg")}>{t.text}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 border-t border-line pt-4">
          <Overline className="flex items-center gap-1.5">
            <History className="h-3 w-3" /> Past tasks
          </Overline>
          <ul className="mt-3 space-y-1">
            {history.length === 0 && <li className="text-xs text-dim">None yet.</li>}
            {history.map((t) => (
              <li key={t.id}>
                <button onClick={() => openPast(t)} className="w-full rounded px-1.5 py-1 text-left hover:bg-hvr1" disabled={running}>
                  <p className="truncate text-xs text-fg">{t.goal}</p>
                  <p className="font-mono text-[10px] text-dim">
                    <span className={t.status === "succeeded" ? "text-acid" : t.status === "failed" ? "text-red-400" : ""}>{t.status}</span> · {timeAgo(t.created_at)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function PromptCard({ prompt }: { prompt: Prompt }) {
  const [answer, setAnswer] = useState("");
  return (
    <div className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-300">
        <ShieldAlert className="h-4 w-4" /> {prompt.kind === "approval" ? "Needs your OK" : "The agent has a question"}
      </p>
      <p className="mt-1 text-sm text-fg">{prompt.question}</p>
      {prompt.kind === "approval" ? (
        <div className="mt-3 flex gap-2">
          <Button className="h-8" onClick={() => prompt.resolve(true)}>Allow</Button>
          <Button variant="danger" className="h-8" onClick={() => prompt.resolve(false)}>Deny</Button>
        </div>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            prompt.resolve(answer || "No preference — use your judgment.");
          }}
        >
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} className="flex-1 rounded-lg border border-line bg-transparent px-3 text-sm" autoFocus />
          <Button className="h-8" type="submit">Answer</Button>
        </form>
      )}
    </div>
  );
}

/** Merge tool_call + tool_result by id, keep everything else in order. */
function Timeline({ events }: { events: AgentEvent[] }) {
  const items = useMemo(() => {
    const results = new Map<string, Extract<AgentEvent, { type: "tool_result" }>>();
    for (const e of events) if (e.type === "tool_result") results.set(e.id, e);
    const lastApproval = new Map<string, AgentEvent>();
    for (const e of events) if (e.type === "approval") lastApproval.set(e.id, e);
    return events.filter((e) => e.type !== "tool_result" && e.type !== "todos" && (e.type !== "approval" || lastApproval.get(e.id) === e)).map((e) => ({ e, result: e.type === "tool_call" ? results.get(e.id) : undefined }));
  }, [events]);

  if (!items.length) return null;
  return (
    <ol className="mt-6 space-y-2.5">
      {items.map(({ e, result }, i) => (
        <li key={i}>
          <EventRow e={e} result={result} />
        </li>
      ))}
    </ol>
  );
}

function EventRow({ e, result }: { e: AgentEvent; result?: Extract<AgentEvent, { type: "tool_result" }> }) {
  const [open, setOpen] = useState(true);
  switch (e.type) {
    case "thought":
      return <p className="text-sm leading-relaxed text-mut">{e.text}</p>;
    case "warning":
      return (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-xs text-amber-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e.text}
        </p>
      );
    case "approval":
      return (
        <p className={cn("flex items-center gap-2 text-xs", e.decision === "approved" ? "text-acid" : e.decision === "denied" ? "text-red-400" : "text-amber-300")}>
          <ShieldCheck className="h-3.5 w-3.5" /> {e.question} — {e.decision}
        </p>
      );
    case "ask_user":
      return <p className="text-xs text-mut">Asked: {e.question} → <span className="text-fg">{e.answer}</span></p>;
    case "verify":
      return (
        <p className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs", e.passed ? "border-acid/30 text-acid" : "border-red-500/30 text-red-400")}>
          {e.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} Verify: {e.text}
        </p>
      );
    case "subagent":
      return (
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="flex items-center gap-2 text-xs text-sky-400">
            <Users className="h-3.5 w-3.5" /> Helper {e.index + 1}: {e.question}
          </p>
          <div className="mt-1 max-h-48 overflow-y-auto text-xs">
            <Markdown>{e.text}</Markdown>
          </div>
        </div>
      );
    case "done":
      return null;
    case "error":
      return <p className="text-xs text-red-400">{e.text}</p>;
    case "tool_call": {
      const code = result?.code ?? (e.tool === "run_python" ? String(e.args.code ?? "") : "");
      return (
        <div className="rounded-lg border border-line">
          <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
            {e.tool === "run_python" ? <Code2 className="h-3.5 w-3.5 text-dim" /> : e.tool.includes("web") || e.tool.includes("research") ? <Globe className="h-3.5 w-3.5 text-dim" /> : <FileText className="h-3.5 w-3.5 text-dim" />}
            <span className="font-mono text-xs text-fg">{e.tool}</span>
            <span className="flex-1 truncate font-mono text-[11px] text-dim">
              {e.tool === "run_python" ? "" : truncate(JSON.stringify(e.args), 80)}
            </span>
            {!result ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
            ) : (
              <span className={cn("text-[11px]", result.ok ? "text-acid" : "text-red-400")}>{truncate(result.summary, 60)}</span>
            )}
          </button>
          {open && (code || result?.detail || result?.sources?.length) ? (
            <div className="space-y-2 border-t border-line px-3 py-2">
              {code && <pre className="max-h-56 overflow-auto rounded bg-codebg/60 p-2 text-[11px] leading-relaxed text-fg">{code}</pre>}
              {result?.detail && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-mut">{result.detail}</pre>}
              {result?.sources?.length ? (
                <div className="flex flex-wrap gap-1">
                  {result.sources.slice(0, 6).map((s) => (
                    <a key={s} href={s} target="_blank" rel="noreferrer" className="max-w-[240px] truncate rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-mut hover:text-fg">
                      {s.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    default:
      return null;
  }
}
