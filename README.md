<div align="center">

# 🧠 Cortexa — Your AI Second Brain

**Agentic RAG over live data and memory · 100% free-tier stack**

**[▶ Live demo](https://cortexa-kappa.vercel.app)**

</div>

## Try it without signing up

A read-write demo account is available so you can explore everything immediately:

| | |
|---|---|
| **URL** | https://cortexa-kappa.vercel.app |
| **Email** | `demo@gmail.com` |
| **Password** | `demo@2026` |

Once you're in, this sequence shows what the system actually does — watch the
route badge above each answer:

1. `hi` → routes **direct**, no retrieval wasted on small talk
2. `What's the weather in Kolkata right now?` → routes **agent**, fetches live conditions
3. `Remember that I'm evaluating this project for a role.` → a **"remembered for next time"** card appears
4. Start a **new chat** → `What do you know about me?` → routes **memory**, and it still knows

Step 4 is the point. That is cross-session recall from a separate table, not
conversation history — a new chat has no history to draw on.

> The demo account is shared, so documents and memories you add are visible to
> other visitors. Please don't upload anything private.

## What is it?

Cortexa turns scattered PDFs, articles and notes into a private, queryable knowledge base — then puts an agent in front of it.

Plain RAG retrieves from one fixed, pre-indexed corpus, one shot, every time.
Cortexa changes all three of those:

1. **Agentic** — an LLM **router** inspects every question first and decides *whether* to retrieve, *from where*, and *with what query*. It can answer directly with no retrieval, hit one source, hit two, or escalate to a full multi-step tool loop. Its decision is shown to you on every turn.
2. **Live data** — typed tools for facts that go stale the moment you index them: weather & local time, FX rates, crypto prices, plus web search and URL reading. All keyless — live data works with zero configuration.
3. **Memory** — a persistent, per-user store of what the assistant has learned about *you*, separate from your documents. It is **read** before answering and **written** after, automatically: durable facts get extracted from each turn and recalled weeks later. Browse, pin, edit and forget them on the Memory page.
4. **Grounded answers** — document-backed replies still carry numbered citations `[1][2]` you can hover-verify.
5. **Full stack** — auth, ingestion pipeline, vector database, streaming UI, dashboard, notes, quizzes.
6. **MCP server** — the same knowledge base, memory and live tools exposed over the Model Context Protocol, so Claude Desktop can use your second brain too.

### The three modes

| Mode | What it does |
|---|---|
| **Auto** (default) | The router decides per question: `direct` · `documents` · `memory` · `hybrid` · `agent`. |
| **Ask** | Force pure RAG over your library, with citations. |
| **Agent** | Force the full plan → tool → observe loop with all 14 tools. |

## Tech stack (all free)

| Layer | Tech |
|---|---|
| Frontend + Backend | Next.js 15 (App Router) · React 19 · TypeScript |
| Styling | Tailwind CSS v4 |
| Database + Vectors + Auth | Supabase (Postgres + **pgvector** HNSW + Row Level Security) |
| LLMs | Unified client → Groq (default) / Gemini / OpenAI / any OpenAI-compatible (Ollama) |
| Live data | open-meteo · frankfurter · coingecko · Tavily/DuckDuckGo (all free, first three keyless) |
| Interop | Model Context Protocol server (`mcp/server.mjs`) |
| Embeddings | Jina `jina-embeddings-v3` / Ollama `nomic-embed-text` / Gemini — all 768d, with a zero-key local fallback |
| PDF parsing | unpdf |

> Why Supabase over Mongo? RAG needs vector search — Postgres gives DB + pgvector + auth + RLS in one free tier. Mongo would need a separate paid vector service.

## Quickstart (5 minutes)

```bash
npm install
cp .env.example .env.local   # then fill in the values below
```

1. Create a free project at [supabase.com](https://supabase.com)
2. Open **SQL Editor**, paste & run [`supabase/schema.sql`](supabase/schema.sql)
3. Copy **Settings → API → URL + anon key** into `.env.local`
4. Add a free LLM key: [console.groq.com/keys](https://console.groq.com/keys) (fastest) or [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
5. Add a free embedding key: [jina.ai/embeddings](https://jina.ai/embeddings) → `JINA_API_KEY` + `EMBEDDING_PROVIDER=jina`

> **Embeddings matter more than you'd think.** They decide what your documents
> and memories can be *found* by. Without a key the app falls back to hashed
> vectors, which match keywords far better than meaning — retrieval and memory
> recall both get noticeably worse. Jina's free tier needs no credit card and
> returns native 768-dim vectors, so no schema change is needed. `ollama pull
> nomic-embed-text` with `EMBEDDING_PROVIDER=ollama` is the free-forever offline
> option.

```bash
npm run dev
```

Open http://localhost:3000 → sign up → upload something → ask away.

> **Upgrading an existing install?** Re-run `supabase/schema.sql`. It is idempotent
> and contains a migration block that adds the `memories` table, its search
> functions, and the `auto` chat mode to a database created before those existed.

### Environment variables

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | ✅ | From Supabase → Settings → API |
| `LLM_PROVIDER` | – | `groq` (default) \| `gemini` \| `openai` \| `custom` |
| `LLM_API_KEY` | recommended | Free at Groq/Gemini. **Comma-separate multiple keys for automatic failover** — app rotates keys on rate limits |
| `LLM_MODEL`, `LLM_BASE_URL` | – | Optional overrides (`custom` = e.g. local Ollama) |
| `EMBEDDING_PROVIDER` | – | `jina` (recommended) · `ollama` · `gemini` · `local`. Unset = auto-detect from whichever key is present |
| `JINA_API_KEY` | recommended | Free 10M tokens, no card: [jina.ai/embeddings](https://jina.ai/embeddings). Comma-separate for failover |
| `TAVILY_API_KEY` | – | Agent web search; comma-separate multiple keys; DuckDuckGo fallback works without it |
| `SUPABASE_SERVICE_ROLE_KEY` | – | **MCP server only.** Keep secret — it bypasses RLS |
| `CORTEXA_USER_ID` | – | **MCP server only.** Whose brain the MCP server exposes |

Live data needs no keys at all.

**Key failover:** any of the above accept comma-separated lists (`key1,key2,key3`). Each key has health tracking with a 60s cooldown — on 429/quota errors the next healthy key is used instantly, so the app never dead-ends while one key survives. Aliases like `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` are merged in automatically.

## Scripts

```bash
npm run dev            # develop
npm run build          # production build (type-checked, currently green ✓)
npm run lint           # eslint (currently green ✓)
npm run test:keys      # verify every configured API key
npm run test:backend   # verify Supabase schema + RLS
npm run test:agentic   # verify router, memory, live data end-to-end
npm run mcp            # start the MCP server on stdio
```

## Architecture

```
                        ┌──────────── question ────────────┐
                        ▼                                  │
                  ROUTER (LLM)  ── decides route + query ───┤
                        │                                  │
     ┌──────────┬───────┴────────┬──────────┐              │
     ▼          ▼                ▼          ▼              │
  direct    documents         memory      agent loop       │
 (no        pgvector       pgvector      plan → tool →      │
  retrieval) over chunks   over memories  observe (≤8)      │
     │          │                │          │  ├─ knowledge base
     └──────────┴────────┬───────┴──────────┘  ├─ memory (r/w)
                         ▼                     ├─ live data (weather/fx/crypto/time)
                    streamed answer            ├─ web search · fetch url
                         │                     └─ create note · quiz
                         ▼
              MEMORY WRITE-BACK ── extract durable facts ───┘
                  (dedupe → embed → store)
```

Every stage is streamed to the browser as a trace event, so you can watch the
route decision, the memories recalled, each tool call, and what got remembered.

```
Browser ── SSE/FormData ──► Next.js Route Handlers
                              │ ├─ /api/documents   parse → chunk → embed → store
                              │ ├─ /api/chat/stream route → recall → answer → remember
                              │ ├─ /api/memories    list · add · pin · edit · forget
                              │ └─ /api/notes /chats /status
                              ▼
                    Supabase Postgres+pgvector (RLS: own-data-only)
                              ▲                    ▲
        Groq / Gemini / OpenAI-compatible     mcp/server.mjs (stdio)
```

Agent loop: `plan → tool call → observe → …(≤8 steps)… → final answer`, every step streamed as trace events.

### Using it from Claude Desktop (MCP)

Add `SUPABASE_SERVICE_ROLE_KEY` and `CORTEXA_USER_ID` to `.env.local`, then in
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cortexa": {
      "command": "node",
      "args": ["/absolute/path/to/cortexa/mcp/server.mjs"]
    }
  }
}
```

Exposes 8 tools: `search_knowledge_base`, `recall_memory`, `save_memory`,
`list_notes`, `create_note`, `get_weather`, `get_exchange_rate`,
`get_crypto_price`.

## Try it in 60 seconds

Once you're signed in and have uploaded something, in **Auto** mode:

| Ask this | Route taken | What it proves |
|---|---|---|
| `hi` | `direct` | It doesn't waste a retrieval on small talk |
| `What's the weather in Kolkata right now?` | `agent` | Live data your training set can't know |
| `Remember that I'm preparing for my semester exams in December.` | any | Watch for the **"remembered for next time"** card |
| *(new chat)* `What do you know about me?` | `memory` | **Cross-session recall** — the thing chat history can't do |
| `Summarize the key points of my uploaded paper` | `documents` | Grounded answer with `[1][2]` citations |

The fourth row is the one that matters. Ask it in a **brand-new conversation** — if it
still knows about December, that's persistent memory, not a long context window.

## Deploy to Vercel

The app is a standard Next.js project, so deployment is mostly environment variables.

**1. Push this repo to GitHub.**

**2. Import it at [vercel.com/new](https://vercel.com/new).** Framework preset is
detected automatically; no build settings to change.

**3. Add environment variables** in Vercel → Project → Settings → Environment
Variables. Set them for *Production*, *Preview* and *Development*:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page — the **anon** key, not service_role |
| `LLM_PROVIDER` | `groq` |
| `LLM_MODEL` | `openai/gpt-oss-120b` |
| `LLM_API_KEY` | your Groq key(s), comma-separated |
| `EMBEDDING_PROVIDER` | `jina` |
| `JINA_API_KEY` | your Jina key |
| `TAVILY_API_KEY` | optional — DuckDuckGo fallback works without it |

Do **not** add `SUPABASE_SERVICE_ROLE_KEY`. The web app never uses it; it exists only
for the local MCP server, and it bypasses RLS.

**4. Point Supabase at the deployed URL.** Supabase → Authentication → URL
Configuration:
- **Site URL** → `https://your-app.vercel.app`
- **Redirect URLs** → add `https://your-app.vercel.app/**`

Skip this and signup confirmation emails will redirect to `localhost`.

**5. Deploy**, then open `/settings` on the live site and confirm Embeddings shows a
green **semantic** badge.

### Function duration

Both long-running routes are set to `maxDuration = 60`, the Hobby-plan ceiling. On Pro
(or with Fluid compute) you can raise `app/api/chat/stream/route.ts` to `300` for
longer agent missions and `app/api/documents/route.ts` for very large PDFs. The ≤8-step
agent limit keeps most turns well under 60s.

### Known deployment caveats

- **Ingestion is inline.** A very large PDF can exceed the 60s function limit. A background job queue is on the roadmap.
- **No rate limiting.** Fine for a personal deployment; add it before sharing the URL widely, since every request costs you LLM tokens.
- **The MCP server is local-only** (stdio transport). It is not part of the Vercel deployment.

## Rate limits

The public deployment is throttled, since every turn spends real LLM quota:

| Action | Per visitor | Per account |
|---|---|---|
| Chat messages | 30 / hour | 300 / hour |
| Document uploads | 10 / hour | 60 / hour |

Limits are keyed on **account + IP**, with a wider account-wide ceiling behind
them. One shared demo login otherwise means the first visitor exhausts the
allowance for everyone, while keying on IP alone leaves total spend unbounded —
so both apply, and whichever trips first wins.

Counters live in Postgres, not in memory: serverless instances don't share
state, so an in-memory limiter would reset on every cold start. The check and
the record happen in one statement so two concurrent requests can't both see
themselves as under the limit.

Exceeding a limit returns `429` with `Retry-After` and a readable message; the
chat UI restores your unsent message rather than losing it.

Set `RATE_LIMIT_DISABLED=true` to turn limits off locally. They are inactive in
development by default.

## Troubleshooting

**Retrieval returns nonsense / finds nothing relevant**
Check Settings → Embeddings. If it says `quality: low` you're on the hashed fallback,
which matches keywords rather than meaning (it scores a paraphrase at 0.000). Add a
Jina key.

**You changed `EMBEDDING_PROVIDER`**
Vectors from two different models aren't comparable — old documents will return
garbage, silently. Go to **Documents → delete all** and re-upload. There is no
in-place re-index yet.

**Every route suddenly returns a 500 / `Cannot find module './XXX.js'`**
You ran `npm run build` while `npm run dev` was running. The production build
overwrites `.next` and the live dev server loses its chunks.

```bash
rm -rf .next
```

then restart the dev server. Use `npx tsc --noEmit` and `npm run lint` to check code
while dev is running; only run a production build with the dev server stopped.

**Deleting a document appears to do nothing**
Fixed in v2, but the cause is worth knowing: under RLS a `DELETE` that matches no
policy row deletes 0 rows *and reports no error*. The UI now surfaces the real reason
in a red banner instead of optimistically removing the row.

**`auto` mode chats fail to create**
Your database predates the router. Re-run `supabase/schema.sql` — the migration block
at the end re-applies the changed `chats_mode_check` constraint.

**Upgrading an existing database**
`supabase/schema.sql` is idempotent. Re-running it is always safe and is the fix for
most schema-related errors.

