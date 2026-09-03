"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, ClipboardPaste, Link2, Trash2, Loader2 } from "lucide-react";
import type { DocumentRow } from "@/types";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Overline,
  Spinner,
  StatusDot,
  Textarea,
} from "@/components/ui";
import { formatBytes, timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Tab = "file" | "text" | "url";

const TABS = [
  { k: "file", label: "Upload file", icon: FileText },
  { k: "text", label: "Paste text", icon: ClipboardPaste },
  { k: "url", label: "From URL", icon: Link2 },
] as const;

export default function DocumentsManager() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setDocs(json.documents ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!docs.some((d) => d.status === "processing")) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [docs, load]);

  async function ingest(body: FormData | object) {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ingestion failed");
      setOkMsg(
        `Indexed "${json.document.title}" — ${json.document.chunk_count} vectors ready.`
      );
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ingestion failed");
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (tab === "file") {
      if (!file) return setError("Choose a PDF/TXT/MD file first");
      const fd = new FormData();
      fd.append("file", file);
      if (title.trim()) fd.append("title", title.trim());
      ingest(fd);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } else if (tab === "text") {
      if (!text.trim()) return setError("Paste some text first");
      ingest({ title: title.trim() || undefined, text });
      setText("");
    } else {
      if (!url.trim()) return setError("Enter a URL");
      ingest({ url: url.trim(), title: title.trim() || undefined });
      setUrl("");
    }
    setTitle("");
  }

  async function remove(id: string) {
    if (!confirm("Delete this document and its indexed vectors?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Delete failed (${res.status})`);
      // Only drop it from the list once the server confirms it's really gone,
      // otherwise the next poll silently brings it back and it looks broken.
      setDocs((d) => d.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that document");
      load();
    }
  }

  async function removeAll() {
    if (
      !confirm(
        `Delete ALL ${docs.length} documents and every indexed vector?\n\n` +
          "Do this after changing embedding provider — vectors from two different " +
          "models can't be compared, so old documents must be re-uploaded.\n\n" +
          "This cannot be undone."
      )
    )
      return;
    setError(null);
    try {
      const res = await fetch("/api/documents", { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Delete failed (${res.status})`);
      setDocs([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear the library");
      load();
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-10 py-12">
      <Overline>Knowledge base</Overline>
      <div className="mt-3 flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <span className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-dim">
            {docs.length} indexed · {docs.reduce((a, d) => a + d.chunk_count, 0)} vectors
          </span>
          {docs.length > 0 && (
            <button
              onClick={removeAll}
              className="rounded-md border border-red-500/25 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-red-400 transition-colors hover:bg-red-500/[0.08] hover:border-red-500/40"
            >
              delete all
            </button>
          )}
        </span>
      </div>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-mut">
        Everything here becomes retrievable knowledge for RAG answers and the
        agent&apos;s tool calls.
      </p>

      <div className="mt-10 border-b border-line">
        <div className="flex gap-8">
          {TABS.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm transition-colors",
                tab === t.k
                  ? "border-fg text-fg"
                  : "border-transparent text-dim hover:text-mut"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-8">
        {tab === "file" && (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
              file
                ? "border-acid/40 bg-acid/[0.04]"
                : "border-line hover:border-line-strong"
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.markdown,.csv,.json,text/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <FileText className="h-6 w-6 text-dim" />
            {file ? (
              <>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="font-mono text-[11px] text-dim">
                  {formatBytes(file.size)} · click to replace
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-mut">
                  Drop or click to choose a file
                </p>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
                  pdf · txt · md · csv · json — max 10 mb
                </p>
              </>
            )}
          </label>
        )}

        {tab === "text" && (
          <Textarea
            rows={7}
            placeholder="Paste any article, transcript, lecture notes…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}

        {tab === "url" && (
          <Input
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}

        <div className="mt-5 flex items-center gap-3">
          <Input
            className="max-w-xs"
            placeholder="Optional title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button onClick={submit} disabled={busy} className="w-32">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Index it
          </Button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-4 py-2.5 text-sm text-red-400">
            {error}
          </p>
        )}
        {okMsg && (
          <p className="mt-4 rounded-lg border border-acid/25 bg-acid/[0.05] px-4 py-2.5 text-sm text-acid">
            {okMsg}
          </p>
        )}
      </div>

      <div className="mt-14">
        <Overline>Indexed library</Overline>
        <div className="mt-4">
          {loading ? (
            <div className="flex justify-center py-12 text-dim">
              <Spinner className="h-5 w-5" />
            </div>
          ) : docs.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title="Nothing indexed yet"
              hint="Add your first document above. Once processed, ask questions about it in Chat."
            />
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {docs.map((d) => (
                <li key={d.id} className="group flex items-center gap-4 py-4">
                  <StatusDot
                    tone={
                      d.status === "ready"
                        ? "green"
                        : d.status === "failed"
                          ? "red"
                          : "amber"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="mt-1 font-mono text-[11px] text-dim">
                      {d.source_type} · {timeAgo(d.created_at)} ·{" "}
                      {d.char_count > 0 && `${formatBytes(d.char_count)} · `}
                      {d.status === "ready"
                        ? `${d.chunk_count} vectors`
                        : d.status === "failed"
                          ? d.error
                          : "processing…"}
                    </p>
                  </div>
                  <Badge
                    tone={
                      d.status === "ready"
                        ? "green"
                        : d.status === "failed"
                          ? "red"
                          : "amber"
                    }
                  >
                    {d.status}
                  </Badge>
                  <button
                    onClick={() => remove(d.id)}
                    className="rounded-md p-2 text-dim opacity-60 transition-all hover:bg-hvr1 hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Delete ${d.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
