"use client";

import { useEffect, useState } from "react";
import { Badge, Card, Overline, Spinner } from "@/components/ui";

interface Status {
  authenticated: boolean;
  email: string | null;
  supabaseConfigured: boolean;
  llm: { provider: string; model: string; configured: boolean; keys: number };
  embeddings: {
    name: string;
    keys: number;
    provider: string;
    quality: "high" | "low";
  };
  webSearch: { provider: string; keys: number };
  liveData: { sources: string[]; configured: boolean };
  memory: { enabled: boolean; writeBack: string };
  router: { enabled: boolean; modes: string[] };
  tools: string[];
  failover: boolean;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) throw new Error("Failed to load status");
        setStatus(await res.json());
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load status");
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-10 py-12">
      <Overline>System</Overline>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-mut">
        Live integration status with automatic key failover counts. All keys
        live server-side in{" "}
        <code className="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-xs">
          .env.local
        </code>{" "}
        — they never reach this browser.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {!status ? (
        <div className="mt-10 flex justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <Card className="flex items-center justify-between">
            <div>
              <p className="font-medium">Supabase</p>
              <p className="text-sm text-slate-500">
                Auth + Postgres + pgvector (database)
              </p>
            </div>
            <Badge tone={status.supabaseConfigured ? "green" : "red"}>
              {status.supabaseConfigured ? "connected" : "not configured"}
            </Badge>
          </Card>

          <Card className="flex items-center justify-between">
            <div>
              <p className="font-medium">LLM provider</p>
              <p className="text-sm text-slate-500">
                {status.llm.provider} · {status.llm.model}
                {status.llm.keys > 1 &&
                  ` · ${status.llm.keys} keys with auto-failover`}
              </p>
            </div>
            <Badge tone={status.llm.configured ? "green" : "amber"}>
              {status.llm.configured
                ? `configured${status.llm.keys > 1 ? ` ×${status.llm.keys}` : ""}`
                : "add LLM_API_KEY"}
            </Badge>
          </Card>

          <Card className="flex items-center justify-between">
            <div>
              <p className="font-medium">Embeddings</p>
              <p className="text-sm text-slate-500">{status.embeddings.name}</p>
            </div>
            <Badge tone={status.embeddings.quality === "high" ? "green" : "amber"}>
              {status.embeddings.quality === "high"
                ? `semantic${status.embeddings.keys > 1 ? ` ×${status.embeddings.keys}` : ""}`
                : "fallback mode"}
            </Badge>
          </Card>

          <Card className="flex items-center justify-between">
            <div>
              <p className="font-medium">Web search (agent tool)</p>
              <p className="text-sm text-slate-500">
                {status.webSearch.provider === "tavily" &&
                status.webSearch.keys > 1
                  ? `tavily · ${status.webSearch.keys} keys rotating`
                  : status.webSearch.provider}
              </p>
            </div>
            <Badge
              tone={status.webSearch.provider === "tavily" ? "green" : "gray"}
            >
              {status.webSearch.provider}
            </Badge>
          </Card>

          <Card className="flex items-center justify-between">
            <div>
              <p className="font-medium">Live data sources</p>
              <p className="text-sm text-slate-500">
                {status.liveData?.sources?.join(" · ") ?? "—"}
              </p>
            </div>
            <Badge tone="green">keyless</Badge>
          </Card>

          <Card className="flex items-center justify-between">
            <div>
              <p className="font-medium">Persistent memory</p>
              <p className="text-sm text-slate-500">
                semantic recall before answering · {status.memory?.writeBack}
              </p>
            </div>
            <Badge tone={status.memory?.enabled ? "green" : "gray"}>
              {status.memory?.enabled ? "active" : "off"}
            </Badge>
          </Card>

          <Card className="flex items-center justify-between">
            <div>
              <p className="font-medium">Agentic router</p>
              <p className="text-sm text-slate-500">
                picks direct · documents · memory · hybrid · agent per question
              </p>
            </div>
            <Badge tone={status.router?.enabled ? "green" : "gray"}>
              {status.router?.enabled ? "active" : "off"}
            </Badge>
          </Card>

          <Card>
            <p className="mb-2 font-medium">
              Agent tools{" "}
              <span className="font-mono text-xs text-slate-500">
                ({status.tools?.length ?? 0})
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(status.tools ?? []).map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-slate-400"
                >
                  {t}
                </span>
              ))}
            </div>
          </Card>

          <Card>
            <p className="mb-2 font-medium">Setup guide</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-400">
              <li>
                Create a free project at{" "}
                <a className="text-indigo-400 underline" href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>
                , open SQL Editor and run the contents of{" "}
                <code className="rounded bg-ink-800 px-1.5 py-0.5 text-xs">supabase/schema.sql</code>.
              </li>
              <li>
                Copy Settings → API values into{" "}
                <code className="rounded bg-ink-800 px-1.5 py-0.5 text-xs">.env.local</code>{" "}
                (see <code className="rounded bg-ink-800 px-1.5 py-0.5 text-xs">.env.example</code>).
              </li>
              <li>
                Get a free LLM key —{" "}
                <a className="text-indigo-400 underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Groq</a>{" "}
                or{" "}
                <a className="text-indigo-400 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Gemini</a>{" "}
                — and set <code className="rounded bg-ink-800 px-1.5 py-0.5 text-xs">LLM_API_KEY</code>. Same Gemini key also upgrades embeddings.
              </li>
              <li>Restart <code className="rounded bg-ink-800 px-1.5 py-0.5 text-xs">npm run dev</code> and refresh this page.</li>
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}
