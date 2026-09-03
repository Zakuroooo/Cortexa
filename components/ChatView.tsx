"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Bot,
  MessageSquareText,
  Plus,
  ArrowUp,
  Square,
  Trash2,
  Wrench,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Route as RouteIcon,
  BrainCircuit,
} from "lucide-react";
import type { Citation, ChatRow, TraceStep, ChatMode, Route } from "@/types";
import { Button } from "@/components/ui";
import Markdown from "@/components/Markdown";
import { cn, truncate } from "@/lib/utils";

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  trace?: TraceStep[];
}

type StreamEvent =
  | { type: "route"; route: Route; reason: string; source: "llm" | "heuristic"; searchQuery: string }
  | { type: "memory_recall"; count: number; items: Array<{ kind: string; content: string }> }
  | { type: "memory_saved"; items: Array<{ status: string; content: string }> }
  | { type: "end" }
  | { type: "citations"; citations: Citation[] }
  | { type: "retrieval"; mode: string; count: number }
  | { type: "delta"; value: string }
  | { type: "turn" }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "done"; answer: string; trace: TraceStep[] }
  | { type: "error"; message: string };

const ROUTE_LABELS: Record<Route, string> = {
  direct: "answered directly · no retrieval",
  documents: "searched your documents",
  memory: "recalled from memory",
  hybrid: "documents + memory",
  agent: "agent loop · tools",
};

const ROUTE_THINKING: Record<Route, string> = {
  direct: "Thinking",
  documents: "Retrieving from your library",
  memory: "Recalling what I know about you",
  hybrid: "Retrieving documents and memory",
  agent: "Agent is reasoning",
};

const SUGGESTIONS_AUTO = [
  "What do you know about me so far?",
  "Remember that I'm preparing for my semester exams in December.",
  "What's the weather in Kolkata right now?",
  "Summarize the key points across my library.",
];

const SUGGESTIONS_ASK = [
  "What are my documents about in one paragraph?",
  "Summarize the key points across my library.",
  "Which sources mention the main topic?",
];

const SUGGESTIONS_AGENT = [
  "Research my library for the main theme and write a summary note.",
  "Search the web for the latest news on AI agents, then save a briefing note.",
  "Make a 5-question quiz from my documents.",
];

export default function ChatView() {
  const search = useSearchParams();
  const router = useRouter();
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(search.get("id"));
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("auto");
  const [streaming, setStreaming] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveTrace, setLiveTrace] = useState<TraceStep[]>([]);
  const [retrievalNote, setRetrievalNote] = useState("");
  const [routeNote, setRouteNote] = useState<{ route: Route; reason: string } | null>(null);
  const [memoryNote, setMemoryNote] = useState<{ count: number } | null>(null);
  const [savedMemories, setSavedMemories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const MODE_LABELS: Record<string, string> = {
    semantic: "vector match",
    keyword: "keyword match",
    overview: "library overview",
    empty: "no matches",
  };

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamedRef = useRef("");
  const pendingCitationsLocal = useRef<Citation[]>([]);

  // Runs on mount AND on every window focus. A rejected fetch here (dev server
  // restarted, laptop asleep, offline) used to escape as an unhandled error and
  // crash the whole view — a background refresh must never do that.
  const loadChats = useCallback(async () => {
    try {
      const res = await fetch("/api/chats");
      if (!res.ok) return;
      const json = await res.json();
      setChats(json.chats ?? []);
    } catch {
      // Offline or server restarting — keep showing the list we already have.
    }
  }, []);

  useEffect(() => {
    loadChats();
    const onFocus = () => loadChats();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadChats]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/chats/${activeId}`);
        if (!res.ok) return;
        const json = await res.json();
        setMessages(json.messages ?? []);
        if (json.chat?.mode) setMode(json.chat.mode);
      } catch {
        setError("Couldn't load that conversation — check your connection.");
      }
    })();
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, liveText, liveTrace]);

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
    router.replace("/chat");
  }

  async function removeChat(id: string) {
    try {
      const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      if (activeId === id) newChat();
      loadChats();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that chat");
    }
  }

  async function ensureChat(): Promise<string> {
    if (activeId) return activeId;
    let res: Response;
    try {
      res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
    } catch {
      throw new Error(
        "Can't reach the server. Is the dev server still running?"
      );
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not create chat");
    setActiveId(json.chat.id);
    setChats((c) => [json.chat, ...c]);
    return json.chat.id;
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    setError(null);
    setInput("");
    setStreaming(true);
    setLiveText("");
    setLiveTrace([]);
    setRetrievalNote("");
    setRouteNote(null);
    setMemoryNote(null);
    setSavedMemories([]);

    const userMsg: UIMessage = { id: `u_${Date.now()}`, role: "user", content };
    setMessages((m) => [...m, userMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const chatId = await ensureChat();
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: content, mode }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }

      let streamed = "";
      let pendingCitations: Citation[] = [];
      streamedRef.current = "";
      pendingCitationsLocal.current = [];
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let evt: StreamEvent;
            try {
              evt = JSON.parse(line.slice(5));
            } catch {
              continue;
            }
            if (evt.type === "route") {
              setRouteNote({ route: evt.route, reason: evt.reason });
              setLiveTrace((t) => [
                ...t,
                { type: "route", label: evt.route, detail: evt.reason, at: Date.now() },
              ]);
            } else if (evt.type === "memory_recall") {
              setMemoryNote({ count: evt.count });
              setLiveTrace((t) => [
                ...t,
                {
                  type: "memory",
                  label: "recalled",
                  detail: evt.items.map((i) => `(${i.kind}) ${i.content}`).join("\n"),
                  at: Date.now(),
                },
              ]);
            } else if (evt.type === "memory_saved") {
              setSavedMemories(evt.items.map((i) => i.content).filter(Boolean));
            } else if (evt.type === "end") {
              // stream finished cleanly
            } else if (evt.type === "citations") {
              pendingCitations = evt.citations;
              pendingCitationsLocal.current = evt.citations;
            } else if (evt.type === "retrieval") {
              setRetrievalNote(
                `${MODE_LABELS[evt.mode] ?? evt.mode} · ${evt.count} passage${evt.count === 1 ? "" : "s"}`
              );
            } else if (evt.type === "delta") {
              streamed += evt.value;
              streamedRef.current = streamed;
              setLiveText(streamed);
            } else if (evt.type === "turn") {
              streamed = "";
              setLiveText("");
            } else if (evt.type === "tool_call") {
              setLiveTrace((t) => [
                ...t,
                { type: "tool_call", tool: evt.tool, args: evt.args, at: Date.now() },
              ]);
            } else if (evt.type === "tool_result") {
              setLiveTrace((t) => [
                ...t,
                { type: "tool_result", tool: evt.tool, detail: evt.result, at: Date.now() },
              ]);
            } else if (evt.type === "done") {
              setMessages((m) => [
                ...m,
                {
                  id: `a_${Date.now()}`,
                  role: "assistant",
                  content: evt.answer || streamed,
                  citations: pendingCitations,
                  trace: evt.trace,
                },
              ]);
              setLiveText("");
              setLiveTrace([]);
              streamed = "";
            } else if (evt.type === "error") {
              throw new Error(evt.message);
            }
          }
        }
      }
      loadChats();
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") {
        if (streamedRef.current.trim()) {
          setMessages((m) => [
            ...m,
            {
              id: `a_${Date.now()}`,
              role: "assistant",
              content:
                streamedRef.current.trim() +
                "\n\n*(stopped by you — generation aborted)*",
              citations: pendingCitationsLocal.current,
              trace: [],
            },
          ]);
        }
        setLiveText("");
        setLiveTrace([]);
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setLiveText("");
        setLiveTrace([]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function switchMode(next: ChatMode) {
    if (next === mode || streaming) return;
    setMode(next);
    if (activeId && messages.length > 0) {
      setActiveId(null);
      setMessages([]);
      setError(null);
      router.replace("/chat");
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send();
  }

  return (
    <div className="flex h-full">
      <div className="flex w-60 shrink-0 flex-col border-r border-line bg-canvas p-3">
        <Button variant="secondary" onClick={newChat} className="h-9 w-full">
          <Plus className="h-3.5 w-3.5" /> New chat
        </Button>
        <p className="mb-2 mt-6 px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
          Conversations
        </p>
        <div className="flex-1 space-y-px overflow-y-auto">
          {chats.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group relative flex items-center rounded-lg px-2 py-2 text-sm transition-colors",
                c.id === activeId
                  ? "bg-hvr2 text-fg"
                  : "text-mut hover:bg-hvr1 hover:text-fg"
              )}
            >
              {c.id === activeId && (
                <span className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-acid" />
              )}
              <button
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => {
                  setActiveId(c.id);
                  router.replace(`/chat?id=${c.id}`);
                }}
              >
                {c.title}
              </button>
              <span
                className={cn(
                  "shrink-0 font-mono text-[9px] uppercase tracking-[0.1em]",
                  c.mode === "agent"
                    ? "text-sky-400/80"
                    : c.mode === "auto"
                      ? "text-violet-400/80"
                      : "text-dim"
                )}
              >
                {c.mode ?? "auto"}
              </span>
              <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => removeChat(c.id)}
                  className="rounded-md p-1 text-dim hover:text-red-400"
                  aria-label="Delete chat"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </div>
          ))}
          {chats.length === 0 && (
            <p className="px-1 py-3 text-xs leading-relaxed text-dim">
              No conversations yet. Start one below.
            </p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-6 py-2.5">
          <div className="flex gap-0.5 rounded-lg border border-line p-0.5">
            {(
              [
                { k: "auto", label: "Auto", icon: Sparkles },
                { k: "ask", label: "Ask", icon: MessageSquareText },
                { k: "agent", label: "Agent", icon: Bot },
              ] as const
            ).map((m) => (
              <button
                key={m.k}
                disabled={streaming}
                onClick={() => switchMode(m.k)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50",
                  mode === m.k
                    ? "bg-hvr2 text-fg"
                    : "text-dim hover:text-mut"
                )}
              >
                <m.icon className={cn("h-3.5 w-3.5", mode === m.k && "text-acid")} />
                {m.label}
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
            {mode === "agent" ? (
              <>
                agent mode <span className="text-acid">· tools armed</span>
              </>
            ) : mode === "ask" ? (
              "rag mode · grounded + cited"
            ) : (
              <>
                auto mode <span className="text-acid">· router picks the source</span>
              </>
            )}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto max-w-3xl space-y-7">
            {messages.length === 0 && !liveText && !liveTrace.length && (
              <div className="pt-20 text-center">
                <Bot className="mx-auto mb-5 h-9 w-9 text-dim" />
                <h2 className="text-lg font-medium tracking-tight">
                  {mode === "ask"
                    ? "Ask your knowledge base"
                    : mode === "agent"
                      ? "Brief the agent"
                      : "Just ask — routing is automatic"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mut">
                  {mode === "ask"
                    ? "Answers are generated strictly from your indexed documents, with numbered citations attached."
                    : mode === "agent"
                      ? "Describe an outcome. The agent plans steps, calls tools, observes results and can save notes or quizzes."
                      : "A router decides each turn whether to search your documents, recall what it remembers about you, pull live data, or just answer. It remembers what you tell it."}
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-2">
                  {(mode === "ask"
                    ? SUGGESTIONS_ASK
                    : mode === "agent"
                      ? SUGGESTIONS_AGENT
                      : SUGGESTIONS_AUTO
                  ).map(
                    (s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="rounded-full border border-line px-4 py-1.5 text-xs text-mut transition-colors hover:border-line-strong hover:text-fg"
                      >
                        {s}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="animate-fade-up flex justify-end">
                  <p className="max-w-[80%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-bubble px-4 py-2.5 text-sm leading-relaxed">
                    {m.content}
                  </p>
                </div>
              ) : (
                <AssistantMessage key={m.id} msg={m} />
              )
            )}

            {(liveText || liveTrace.length > 0 || streaming) && (
              <div className="animate-fade-up rounded-xl border border-acid/20 bg-panel/60 p-5">
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {routeNote && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/25 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-violet-300"
                      title={routeNote.reason}
                    >
                      <RouteIcon className="h-3 w-3" />
                      {ROUTE_LABELS[routeNote.route] ?? routeNote.route}
                    </span>
                  )}
                  {memoryNote && (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/25 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-sky-300">
                      <BrainCircuit className="h-3 w-3" />
                      {memoryNote.count} memor{memoryNote.count === 1 ? "y" : "ies"} recalled
                    </span>
                  )}
                  {retrievalNote && (
                    <span className="inline-block rounded-md border border-acid/25 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-acid">
                      {retrievalNote}
                    </span>
                  )}
                </div>
                {liveTrace.length > 0 && (
                  <AgentTrace trace={liveTrace} live={streaming} />
                )}
                {liveText ? (
                  <>
                    {streaming && mode === "agent" && (
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-acid">
                        drafting answer…
                      </p>
                    )}
                    <Markdown>{liveText}</Markdown>
                  </>
                ) : (
                  streaming && (
                    <p className="flex items-center gap-2.5 py-0.5 text-sm text-mut">
                      <span className="typing-dots"><i /><i /><i /></span>
                      {routeNote
                        ? ROUTE_THINKING[routeNote.route]
                        : mode === "agent"
                          ? "Agent is reasoning"
                          : "Routing your question"}
                    </p>
                  )
                )}
              </div>
            )}

            {savedMemories.length > 0 && !streaming && (
              <div className="animate-fade-up rounded-lg border border-sky-400/25 bg-sky-400/[0.05] px-4 py-3">
                <p className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300">
                  <BrainCircuit className="h-3 w-3" />
                  remembered for next time
                </p>
                <ul className="space-y-0.5 text-xs leading-relaxed text-mut">
                  {savedMemories.map((m, i) => (
                    <li key={i}>· {m}</li>
                  ))}
                </ul>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-4 py-3 text-sm text-red-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] opacity-60 transition-opacity hover:opacity-100"
                >
                  dismiss
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <form onSubmit={submit} className="border-t border-line p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-panel p-2 transition-colors focus-within:border-line-strong">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                mode === "ask"
                  ? "Ask about your documents…"
                  : mode === "agent"
                    ? "Describe a mission — e.g. research X across my notes and the web, then write a note"
                    : "Ask anything — documents, live data, or what I remember about you…"
              }
              className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-dim"
            />
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-mut transition-colors hover:border-red-500/40 hover:text-red-400"
                aria-label="Stop generating"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fg text-canvas transition-all hover:bg-white disabled:opacity-30 active:scale-95"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mx-auto mt-2.5 max-w-3xl text-center font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
            enter to send · shift+enter newline
          </p>
        </form>
      </div>
    </div>
  );
}

function AssistantMessage({ msg }: { msg: UIMessage }) {
  const [saved, setSaved] = useState(false);

  const [saveError, setSaveError] = useState(false);

  async function saveAsNote() {
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: truncate(msg.content.replace(/[#*`\n]/g, " ").trim(), 60),
          content: msg.content,
        }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }

  return (
    <div className="animate-fade-up">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
        Cortexa
      </p>
      <Markdown>{msg.content}</Markdown>

      {msg.citations && msg.citations.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
            Sources
          </p>
          <div className="space-y-1.5">
            {msg.citations.map((c) => (
              <div key={c.n} className="group/ct relative">
                <div
                  className="flex cursor-help items-baseline gap-2.5 rounded-md border border-transparent px-2 py-1 text-xs text-mut transition-colors hover:border-line hover:bg-hvr1 hover:text-fg"
                >
                  <span className="font-mono text-acid">[{c.n}]</span>
                  <span className="truncate">{c.document_title}</span>
                  {typeof c.similarity === "number" && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-dim">
                      {Math.round(c.similarity * 100)}%
                    </span>
                  )}
                </div>
                <div className="pointer-events-none invisible absolute left-6 top-full z-30 mt-1 max-h-52 w-[26rem] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-raise p-3.5 text-[11px] leading-relaxed text-mut opacity-0 shadow-2xl transition-opacity duration-150 group-hover/ct:visible group-hover/ct:opacity-100">
                  <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-acid">
                    [{c.n}] {c.document_title}
                  </p>
                  {c.snippet}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={saveAsNote}
        disabled={saved}
        className="mt-4 rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mut transition-colors hover:border-acid/40 hover:text-acid disabled:opacity-40"
      >
        {saved ? "saved ✓" : saveError ? "failed — retry" : "save as note"}
      </button>
    </div>
  );
}

function AgentTrace({ trace, live }: { trace: TraceStep[]; live: boolean }) {
  return (
    <div className="mb-4 border-b border-line pb-4">
      <p className="mb-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
        <Wrench className="h-3 w-3" />
        Reasoning trace {live && <span className="animate-blink text-acid">· live</span>}
      </p>
      <div className="space-y-1">
        {trace.map((t, i) => {
          const open = i >= trace.length - 2;
          return (
            <details key={i} open={open} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors hover:bg-hvr1 [&::-webkit-details-marker]:hidden">
                {t.type === "thinking" && (
                  <Brain className="h-3 w-3 shrink-0 text-violet-400/80" />
                )}
                {t.type === "tool_call" && (
                  <Wrench className="h-3 w-3 shrink-0 text-amber-400/90" />
                )}
                {t.type === "tool_result" && (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-acid" />
                )}
                {t.type === "error" && (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />
                )}
                {t.type === "route" && (
                  <RouteIcon className="h-3 w-3 shrink-0 text-violet-400/80" />
                )}
                {t.type === "memory" && (
                  <BrainCircuit className="h-3 w-3 shrink-0 text-sky-400/90" />
                )}
                {t.type === "route" && (
                  <span className="truncate text-violet-300/90">
                    route · {t.label}
                    <span className="ml-2 text-dim group-open:hidden">{t.detail}</span>
                  </span>
                )}
                {t.type === "memory" && (
                  <span className="truncate text-sky-300/90">
                    memory {t.label}
                    <span className="ml-2 text-dim group-open:hidden">
                      {truncate(t.detail ?? "", 70)}
                    </span>
                  </span>
                )}
                {t.type === "tool_call" && (
                  <span className="truncate text-amber-200/90">
                    {t.tool}
                    <span className="ml-2 text-dim group-open:hidden">
                      {truncate(JSON.stringify(t.args), 64)}
                    </span>
                  </span>
                )}
                {t.type === "tool_result" && (
                  <span className="truncate text-mut">
                    result ·{" "}
                    <span className="text-dim group-open:hidden">
                      {truncate(t.detail ?? "", 70)}
                    </span>
                  </span>
                )}
                {t.type === "thinking" && (
                  <span className="truncate text-violet-300/70 group-open:hidden">
                    {truncate(t.detail ?? "", 84)}
                  </span>
                )}
                {t.type === "error" && (
                  <span className="truncate text-red-300">{t.detail}</span>
                )}
              </summary>
              <pre className="ml-7 mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words border-l border-line pl-3 font-mono text-[10.5px] leading-relaxed text-dim">
                {t.type === "tool_call"
                  ? JSON.stringify(t.args, null, 2)
                  : t.detail}
              </pre>
            </details>
          );
        })}
      </div>
    </div>
  );
}
