import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Overline, StatusDot, Button } from "@/components/ui";
import {
  ArrowRight,
  FileText,
  MessageSquareText,
  StickyNote,
  BrainCircuit,
} from "lucide-react";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    docsRes,
    notesRes,
    chatsRes,
    docCountRes,
    noteCountRes,
    chatCountRes,
    memCountRes,
    memRes,
  ] = await Promise.all([
      supabase.from("documents").select("id,title,status,created_at").order("created_at", { ascending: false }).limit(6),
      supabase.from("notes").select("id,title,kind,updated_at").order("updated_at", { ascending: false }).limit(6),
      supabase.from("chats").select("id,title,mode,updated_at").order("updated_at", { ascending: false }).limit(6),
      supabase.from("documents").select("id", { count: "exact", head: true }),
      supabase.from("notes").select("id", { count: "exact", head: true }),
    supabase.from("chats").select("id", { count: "exact", head: true }),
    supabase.from("memories").select("id", { count: "exact", head: true }),
    supabase
      .from("memories")
      .select("id,kind,content,pinned,created_at")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const { data: chunkSum } = await supabase
    .from("documents")
    .select("chunk_count");
  const chunksIndexed = (chunkSum ?? []).reduce(
    (a, d: any) => a + (d.chunk_count || 0),
    0
  );

  const stats = [
    { v: String(docCountRes.count ?? 0).padStart(2, "0"), label: "Documents" },
    { v: String(chunksIndexed).padStart(2, "0"), label: "Vectors indexed" },
    { v: String(noteCountRes.count ?? 0).padStart(2, "0"), label: "Notes" },
    { v: String(memCountRes.count ?? 0).padStart(2, "0"), label: "Memories" },
    { v: String(chatCountRes.count ?? 0).padStart(2, "0"), label: "Conversations" },
  ];

  const docs = docsRes.data ?? [];
  const notes = notesRes.data ?? [];
  const chats = chatsRes.data ?? [];
  const memories = memRes.data ?? [];

  return (
    <div className="mx-auto max-w-6xl px-10 py-12">
      <Overline>Overview</Overline>
      <div className="mt-3 flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <Link href="/documents">
          <Button variant="secondary" className="h-9">
            Add knowledge <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>

      <div className="mt-9 grid grid-cols-2 divide-line border-y border-line md:grid-cols-5 md:divide-x">
        {stats.map((s) => (
          <div key={s.label} className="px-1 py-7 first:pl-0 md:px-7 md:first:pl-1">
            <p className="font-mono text-[28px] leading-none tracking-tight text-fg">
              {s.v}
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-dim">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {(docCountRes.count ?? 0) === 0 && (
        <div className="mt-8 flex items-center justify-between gap-6 rounded-xl border border-acid/20 bg-acid/[0.04] px-6 py-5">
          <div>
            <p className="text-sm font-medium">Your second brain is empty</p>
            <p className="mt-1 text-sm text-mut">
              Feed it a PDF, some pasted text or a URL — then ask it anything.
            </p>
          </div>
          <Link href="/documents" className="shrink-0">
            <Button className="h-9">Feed it now</Button>
          </Link>
        </div>
      )}

      <div className="mt-12 grid gap-12 lg:grid-cols-2 xl:grid-cols-4">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <Overline>Documents</Overline>
            <Link href="/documents" className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-fg">
              all →
            </Link>
          </div>
          {docs.length === 0 ? (
            <p className="py-8 text-sm text-dim">Nothing indexed yet.</p>
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.id} className="border-b border-line">
                  <Link href="/documents" className="group flex items-center gap-3 py-3.5">
                    <StatusDot
                      tone={
                        d.status === "ready"
                          ? "green"
                          : d.status === "failed"
                            ? "red"
                            : "amber"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-mut transition-colors group-hover:text-fg">
                      {d.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-dim">
                      {timeAgo(d.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <Overline>Notes</Overline>
            <Link href="/notes" className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-fg">
              all →
            </Link>
          </div>
          {notes.length === 0 ? (
            <p className="py-8 text-sm text-dim">Nothing written yet.</p>
          ) : (
            <ul>
              {notes.map((n) => (
                <li key={n.id} className="border-b border-line">
                  <Link href="/notes" className="group flex items-center gap-3 py-3.5">
                    {n.kind === "quiz" ? (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-sky-400">Q</span>
                    ) : (
                      <StickyNote className="h-3.5 w-3.5 shrink-0 text-dim" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-mut transition-colors group-hover:text-fg">
                      {n.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-dim">
                      {timeAgo(n.updated_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <Overline>Conversations</Overline>
            <Link href="/chat" className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-fg">
              open →
            </Link>
          </div>
          {chats.length === 0 ? (
            <p className="py-8 text-sm text-dim">No conversations yet.</p>
          ) : (
            <ul>
              {chats.map((c) => (
                <li key={c.id} className="border-b border-line">
                  <Link href={`/chat?id=${c.id}`} className="group flex items-center gap-3 py-3.5">
                    <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-dim" />
                    <span className="min-w-0 flex-1 truncate text-sm text-mut transition-colors group-hover:text-fg">
                      {c.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase text-dim">
                      {c.mode === "agent" ? (
                        <span className="text-sky-400/80">agent</span>
                      ) : c.mode === "auto" ? (
                        <span className="text-violet-400/80">auto</span>
                      ) : (
                        "ask"
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <Overline>Memory</Overline>
            <Link href="/memory" className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-fg">
              all →
            </Link>
          </div>
          {memories.length === 0 ? (
            <p className="py-8 text-sm leading-relaxed text-dim">
              Nothing remembered yet — it learns as you chat.
            </p>
          ) : (
            <ul>
              {memories.map((m: any) => (
                <li key={m.id} className="border-b border-line">
                  <Link href="/memory" className="group flex items-start gap-3 py-3.5">
                    <BrainCircuit
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${m.pinned ? "text-acid" : "text-dim"}`}
                    />
                    <span className="min-w-0 flex-1 text-sm leading-relaxed text-mut transition-colors group-hover:text-fg">
                      {m.content}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-16 flex items-center justify-between rounded-xl border border-line bg-panel px-6 py-5">
        <div className="flex items-center gap-4">
          <FileText className="h-4 w-4 text-dim" />
          <p className="text-sm text-mut">
            Tip: the agent writes notes straight into your workspace — check the{" "}
            <Link href="/notes" className="text-fg underline decoration-line underline-offset-4 hover:decoration-acid">
              Notes page
            </Link>{" "}
            after a mission.
          </p>
        </div>
      </div>
    </div>
  );
}
