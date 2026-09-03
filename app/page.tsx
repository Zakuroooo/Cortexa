import Link from "next/link";
import { ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import { Button, Overline } from "@/components/ui";
import ThemeToggle from "@/components/ThemeToggle";
import Reveal from "@/components/Reveal";

const FEATURES = [
  {
    n: "01",
    title: "Grounded answers",
    desc: "Every response is generated strictly from your indexed material — retrieved by 768-dimensional vector similarity, never from thin air.",
  },
  {
    n: "02",
    title: "Verifiable citations",
    desc: "Answers arrive with numbered references. Hover [1] to inspect the exact passage and match score behind every claim.",
  },
  {
    n: "03",
    title: "Autonomous agent",
    desc: "Give a mission. The agent plans a sequence of tool calls — library search, web search, page reading — observes each result and adapts, up to eight steps deep.",
  },
  {
    n: "04",
    title: "Ingest anything",
    desc: "Text-layer PDFs, raw pasted text, or any public URL. Extraction, chunking and embedding run automatically the moment you upload.",
  },
  {
    n: "05",
    title: "Notes & quizzes",
    desc: "The agent writes structured markdown notes into your workspace and generates graded multiple-choice quizzes from what it learns.",
  },
  {
    n: "06",
    title: "Private by architecture",
    desc: "Postgres row-level security scopes every query to your user id. Keys stay server-side. Your corpus never leaves your stack.",
  },
];

const STATS = [
  { v: "08", label: "Agent tools" },
  { v: "≤8", label: "Step reasoning loop" },
  { v: "768d", label: "Vector embeddings" },
  { v: "$0", label: "Required spend" },
];

const STACK = [
  "Next.js 15",
  "React 19",
  "TypeScript",
  "Supabase Postgres",
  "pgvector · HNSW",
  "Groq LPU",
  "Gemini",
  "Tavily",
];

const STEPS = [
  {
    n: "01",
    title: "Feed it",
    desc: "Drop in PDFs, paste text, add URLs or write notes. Everything is chunked, embedded and indexed into your private vector store within seconds.",
  },
  {
    n: "02",
    title: "Ask it",
    desc: "Query your entire library in plain language. Answers stream token by token, grounded in retrieved passages with citations attached.",
  },
  {
    n: "03",
    title: "Delegate it",
    desc: "Switch to Agent mode with a mission. Watch its plan unfold live — tool calls, results, revisions — until the work lands in your notes.",
  },
];

const FAQS = [
  {
    q: "Is it actually free?",
    a: "Yes — Cortexa runs entirely on free tiers: Supabase for database/auth/vectors, Groq or Gemini for inference, Tavily or DuckDuckGo for web search. You bring your own keys; there is no subscription and no card anywhere.",
  },
  {
    q: "How is this different from just using ChatGPT?",
    a: "Two ways. First, grounding: answers come only from your documents with citations you can verify. Second, action: the agent doesn't just talk — it plans multi-step research across your library and the live web, then writes durable notes and quizzes into your workspace.",
  },
  {
    q: "What happens when an API key hits its rate limit?",
    a: "Nothing breaks. Paste several keys comma-separated and Cortexa rotates them automatically — each key has health tracking with a cooldown, so the next healthy key takes over instantly. If every embedding key fails, a local fallback keeps retrieval alive.",
  },
  {
    q: "Who can see my data?",
    a: "Only you. Every table is protected by Postgres row-level security bound to your user id — enforced at the database layer, not the app layer. API keys live server-side in environment variables and never reach the browser.",
  },
];

function LogoMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <rect x="1" y="1" width="18" height="18" rx="4" fill="#3ecf8e" fillOpacity="0.12" stroke="#3ecf8e" strokeOpacity="0.5" />
      <path d="M6 13V7l4 3.5L14 7v6" stroke="#3ecf8e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <div className="grain" aria-hidden />

      <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[15px] font-semibold tracking-tight">Cortexa</span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#product" className="text-sm text-mut transition-colors hover:text-fg">Product</a>
            <a href="#method" className="text-sm text-mut transition-colors hover:text-fg">Method</a>
            <a href="#agent" className="text-sm text-mut transition-colors hover:text-fg">Agent</a>
            <a href="#faq" className="text-sm text-mut transition-colors hover:text-fg">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle className="mr-1" />
            <Link href="/login"><Button variant="ghost" className="h-9">Sign in</Button></Link>
            <Link href="/signup"><Button className="h-9">Get started</Button></Link>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="bg-guides relative overflow-hidden pt-40 pb-28">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="animate-drift-a absolute -top-32 left-[8%] h-[420px] w-[520px] rounded-full bg-acid/[0.07] blur-[130px]" />
          <div className="animate-drift-b absolute right-[4%] top-24 h-[380px] w-[460px] rounded-full bg-violet-500/[0.06] blur-[140px]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div
              className="animate-fade-up mb-7 inline-flex items-center gap-2.5 rounded-full border border-line bg-panel/60 py-1.5 pl-3 pr-4 font-mono text-[11px] uppercase tracking-[0.22em] text-mut backdrop-blur"
            >
              <span className="animate-blink inline-block h-1.5 w-1.5 rounded-full bg-acid" />
              RAG pipeline × autonomous agents
            </div>
            <h1
              className="animate-fade-up max-w-xl text-balance text-[clamp(2.9rem,5.6vw,4.8rem)] font-semibold leading-[1.02] tracking-[-0.035em]"
              style={{ animationDelay: "90ms" }}
            >
              Your knowledge,{" "}
              <span className="font-serif italic tracking-[-0.01em] text-acid">finally</span>{" "}
              thinking.
            </h1>
            <p
              className="animate-fade-up mt-8 max-w-lg text-pretty text-base leading-relaxed text-mut"
              style={{ animationDelay: "180ms" }}
            >
              Cortexa turns scattered PDFs, articles and notes into a private
              knowledge base you can converse with — then dispatches an
              autonomous agent that researches across your library and the live
              web on your behalf.
            </p>
            <div
              className="animate-fade-up mt-10 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "270ms" }}
            >
              <Link href="/signup">
                <Button className="h-11 px-6">
                  Start building <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Button>
              </Link>
              <a href="#method">
                <Button variant="secondary" className="h-11 px-6">See the method</Button>
              </a>
            </div>
            <p
              className="animate-fade-up mt-9 font-mono text-[11px] uppercase tracking-[0.16em] text-dim"
              style={{ animationDelay: "360ms" }}
            >
              Free tier forever · no card · self-hostable
            </p>
          </div>

          <div className="animate-fade-up hidden delay-300 lg:block" style={{ animationDelay: "300ms" }}>
            <div className="rounded-xl border border-line bg-panel/80 shadow-[0_50px_100px_-30px_rgba(0,0,0,0.85)] backdrop-blur">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-fg/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-fg/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-acid/60" />
                <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">cortexa — ask mode</span>
              </div>
              <div className="space-y-5 p-5 text-sm">
                <div className="flex justify-end">
                  <p className="max-w-[75%] rounded-xl rounded-br-sm bg-bubble px-3.5 py-2.5 leading-relaxed">
                    What did the Q3 memo say about pricing?
                  </p>
                </div>
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-dim">Cortexa</p>
                  <p className="leading-relaxed text-mut">
                    The memo positions usage-based tiers for Q3, keeping
                    enterprise contracts fixed-rate
                    <sup className="ml-0.5 rounded border border-line px-1 font-mono text-[9px] text-acid">1</sup>, and flags a bundling test for September
                    <sup className="ml-0.5 rounded border border-line px-1 font-mono text-[9px] text-acid">2</sup>.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-md border border-line px-2 py-1 font-mono text-[10px] text-mut">1 · Q3-pricing-memo.pdf · 94%</span>
                    <span className="rounded-md border border-line px-2 py-1 font-mono text-[10px] text-mut">2 · board-notes.md · 88%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-line bg-black/70 p-4 font-mono text-[11px] leading-loose shadow-[0_50px_100px_-30px_rgba(0,0,0,0.85)] backdrop-blur">
              <p className="mb-2 font-sans text-[10px] uppercase tracking-[0.2em] text-dim">agent trace — live</p>
              <p className="text-dim"><span className="text-acid">→</span> plan: search library → read source → write note</p>
              <p className="text-amber-300/80">⚡ search_knowledge_base<span className="animate-caret text-acid">(&quot;pricing strategy&quot;)</span></p>
              <p className="text-mut">✓ 6 passages · top match 94%</p>
              <p className="text-amber-300/80">⚡ create_note(&quot;Q3 Pricing Brief&quot;)</p>
              <p className="text-acid">✓ saved to Notes</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="border-y border-line">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-line md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="px-6 py-9 text-center md:text-left">
              <p className="font-mono text-3xl tracking-tight text-fg">{s.v}</p>
              <p className="mt-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-dim">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── STACK STRIP ── */}
      <section className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-6">
          <Overline>Runs entirely on</Overline>
          {STACK.map((t) => (
            <span key={t} className="font-mono text-xs text-dim transition-colors hover:text-mut">{t}</span>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="product" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-28">
        <Reveal>
          <Overline>( 01 ) — The product</Overline>
          <h2 className="mt-5 max-w-2xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-[3.4rem]">
            Everything a second brain{" "}
            <span className="font-serif italic text-acid">owes</span> you.
          </h2>
        </Reveal>
        <div className="mt-16 border-t border-line">
          {FEATURES.map((f, i) => (
            <Reveal key={f.n} delay={i * 40}>
              <div className="group grid gap-2 border-b border-line py-8 transition-colors md:grid-cols-[72px_280px_1fr] md:items-baseline md:gap-8">
                <span className="font-mono text-xs text-dim transition-colors group-hover:text-acid">{f.n}</span>
                <h3 className="text-lg font-medium tracking-tight transition-transform duration-200 group-hover:translate-x-1.5">{f.title}</h3>
                <p className="max-w-2xl text-sm leading-relaxed text-mut">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── METHOD ── */}
      <section id="method" className="border-t border-line">
        <div className="mx-auto max-w-6xl scroll-mt-20 px-6 py-28">
          <Reveal>
            <Overline>( 02 ) — The method</Overline>
            <h2 className="mt-5 max-w-xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-[3.4rem]">
              Three moves.{" "}
              <span className="font-serif italic text-acid">That&apos;s</span>{" "}
              the whole practice.
            </h2>
          </Reveal>
          <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <div className="border-t border-line pt-8">
                  <p className="font-mono text-xs text-acid">{s.n}</p>
                  <h3 className="mt-5 text-xl font-medium tracking-tight">{s.title}</h3>
                  <p className="mt-3.5 text-sm leading-relaxed text-mut">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── AGENT ── */}
      <section id="agent" className="border-t border-line bg-guides">
        <div className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-14 px-6 py-28 lg:grid-cols-2">
          <Reveal>
            <Overline>( 03 ) — The agent</Overline>
            <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-[3.4rem]">
              It doesn&apos;t chat.{" "}
              <span className="font-serif italic text-acid">It works.</span>
            </h2>
            <p className="mt-7 max-w-md text-[15px] leading-relaxed text-mut">
              Ordinary assistants answer once and hope for the best. The
              Cortexa agent runs an observe–decide–act loop: every tool result
              reshapes the next step, and the full trace stays inspectable — no
              black boxes, no silent guesses.
            </p>
            <ul className="mt-9 space-y-3.5">
              {[
                "Semantic search scoped to your private library",
                "Live web retrieval with per-key failover",
                "Structured notes & quizzes written back automatically",
              ].map((li) => (
                <li key={li} className="flex items-start gap-3 text-sm text-mut">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-acid" />
                  {li}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120}>
            <div className="rounded-xl border border-line bg-black/70 p-7 font-mono text-[12.5px] leading-[1.95] shadow-[0_50px_110px_-45px_rgba(0,0,0,0.95)]">
              <p className="text-dim">$ cortexa agent --mission</p>
              <p className="text-mut">&quot;Compare my lecture notes with the latest docs online&quot;</p>
              <p className="mt-5 text-dim"><span className="text-acid">step 1</span> · plan formed — 4 calls budgeted</p>
              <p><span className="text-amber-300/90">tool</span> search_knowledge_base<span className="text-dim">(lecture-notes)</span></p>
              <p className="text-mut">↳ 6 passages · mean sim 0.87</p>
              <p><span className="text-amber-300/90">tool</span> fetch_url<span className="text-dim">(docs.example.com/v2)</span></p>
              <p className="text-mut">↳ 8,214 chars extracted</p>
              <p><span className="text-amber-300/90">tool</span> create_note<span className="text-dim">(title: &quot;V1 vs V2 gaps&quot;)</span></p>
              <p className="text-acid">✓ note saved · trace persisted · done in 6 steps</p>
              <p className="mt-5 text-dim">
                status: <span className="text-acid">complete</span>
                <span className="animate-caret ml-1 inline-block h-3.5 w-[7px] translate-y-[3px] bg-acid/70" />
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="border-t border-line">
        <div className="mx-auto max-w-3xl scroll-mt-20 px-6 py-28">
          <Reveal>
            <Overline>( 04 ) — Questions</Overline>
            <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-[3rem]">
              Fair questions.
            </h2>
          </Reveal>
          <div className="mt-14 border-t border-line">
            {FAQS.map((f, i) => (
              <Reveal key={f.q} delay={i * 50}>
                <details className="group border-b border-line">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 [&::-webkit-details-marker]:hidden">
                    <span className="text-[17px] font-medium tracking-tight transition-colors group-hover:text-acid">
                      {f.q}
                    </span>
                    <Plus className="h-4 w-4 shrink-0 text-dim transition-transform duration-300 group-open:rotate-45 group-open:text-acid" />
                  </summary>
                  <p className="-mt-1 max-w-2xl pb-7 text-sm leading-relaxed text-mut">{f.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative overflow-hidden border-t border-line">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="animate-drift-a absolute left-1/2 top-1/2 h-[360px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-acid/[0.05] blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-3xl px-6 py-36 text-center">
          <Reveal>
            <h2 className="text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.035em] md:text-6xl">
              Stop re-reading.
              <br />
              <span className="font-serif italic text-acid">Start asking.</span>
            </h2>
            <p className="mx-auto mt-7 max-w-md text-[15px] leading-relaxed text-mut">
              Set up in five minutes on free tiers. Your keys, your database,
              your second brain.
            </p>
            <div className="mt-11 flex justify-center gap-3">
              <Link href="/signup">
                <Button className="h-11 px-7">Create free account <ArrowRight className="h-4 w-4" /></Button>
              </Link>
              <Link href="/login">
                <Button variant="secondary" className="h-11 px-7">Sign in</Button>
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative overflow-hidden border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <LogoMark />
                <span className="text-[15px] font-semibold tracking-tight">Cortexa</span>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-dim">
                A private AI second brain. Grounded retrieval, autonomous
                research, zero subscription.
              </p>
            </div>
            {[
              { h: "Product", links: ["Features", "Method", "Agent"] },
              { h: "Get started", links: ["Sign up", "Sign in"] },
              { h: "Stack", links: ["Next.js 15", "Supabase pgvector", "Groq / Gemini"] },
            ].map((col) => (
              <div key={col.h}>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">{col.h}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l}>
                      <span className="group inline-flex cursor-default items-center gap-1 text-sm text-mut transition-colors hover:text-fg">
                        {l}
                        <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-14 flex items-center justify-between border-t border-line pt-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">© {new Date().getFullYear()} Cortexa</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">built autonomously by ox-alpha</p>
          </div>
        </div>
        <p aria-hidden className="pointer-events-none -mb-[4vw] select-none text-center text-[19vw] font-bold leading-none tracking-[-0.05em] text-fg/[0.04]">
          CORTEXA
        </p>
      </footer>
    </div>
  );
}
