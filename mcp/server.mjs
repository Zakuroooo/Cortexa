#!/usr/bin/env node
/**
 * Cortexa MCP server — exposes this app's knowledge base, persistent memory
 * and live-data tools over the Model Context Protocol, so Claude Desktop (or
 * any MCP client) can use the same second brain the web app uses.
 *
 * Run:  node mcp/server.mjs      (stdio transport)
 *
 * Env (see .env.example):
 *   NEXT_PUBLIC_SUPABASE_URL     required
 *   SUPABASE_SERVICE_ROLE_KEY    required — bypasses RLS, so we scope every
 *                                query to CORTEXA_USER_ID by hand
 *   CORTEXA_USER_ID              required — whose brain to expose
 *   GEMINI_API_KEY / EMBEDDING_API_KEY   optional, improves search quality
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------- config ---

const here = dirname(fileURLToPath(import.meta.url));

/** Minimal .env.local reader so the server works without extra deps. */
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(join(here, "..", file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}
loadEnv();

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USER_ID = process.env.CORTEXA_USER_ID || "";
const HAS_DB = Boolean(SUPABASE_URL && SERVICE_KEY && USER_ID);

const EMBEDDING_DIM = 768;

function embeddingKeys() {
  return [
    process.env.EMBEDDING_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ]
    .filter(Boolean)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

// --------------------------------------------------------------- helpers ---

/** Byte-identical to lib/ai/embeddings.ts so vectors stay compatible. */
function localEmbed(text) {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && w.length < 40)
    .slice(0, 2000);

  const grams = [...words];
  for (let i = 0; i < words.length - 1; i++) grams.push(`${words[i]}_${words[i + 1]}`);

  for (const g of grams) {
    const a = createHash("sha1").update(g).digest();
    const bucket = ((a[0] << 16) | (a[1] << 8) | a[2]) % EMBEDDING_DIM;
    vec[bucket] += a[3] & 1 ? -1 : 1;
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => +(v / norm).toFixed(6));
}

async function embed(text, taskType = "RETRIEVAL_QUERY") {
  const model = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
  for (const key of embeddingKeys()) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [
              {
                model: `models/${model}`,
                content: { parts: [{ text: text.slice(0, 8000) }] },
                taskType,
                outputDimensionality: EMBEDDING_DIM,
              },
            ],
          }),
        }
      );
      if (!res.ok) continue;
      const json = await res.json();
      const v = json.embeddings?.[0]?.values;
      if (Array.isArray(v) && v.length === EMBEDDING_DIM) return v;
    } catch {}
  }
  return localEmbed(text);
}

async function db(path, init = {}) {
  if (!HAS_DB)
    throw new Error(
      "Database tools need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CORTEXA_USER_ID."
    );
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length && i < b.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * The SQL RPCs are scoped with auth.uid(), which is null for the service key,
 * so we fetch this user's rows and rank in-process instead. Fine at personal
 * knowledge-base scale, and it keeps the RLS story honest.
 */
async function semanticSearch(table, query, limit, extraSelect = "") {
  const vector = await embed(query);
  const rows = await db(
    `${table}?user_id=eq.${USER_ID}&select=${extraSelect}&limit=2000`
  );
  return rows
    .filter((r) => Array.isArray(r.embedding) || typeof r.embedding === "string")
    .map((r) => {
      const e = typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding;
      return { ...r, similarity: cosine(vector, e) };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

const WMO = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "rime fog", 51: "light drizzle", 53: "drizzle",
  55: "dense drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 80: "light showers",
  81: "showers", 82: "violent showers", 95: "thunderstorm",
  96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

async function getJson(url, label) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Cortexa-MCP/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${label} returned ${res.status}`);
  return res.json();
}

// ----------------------------------------------------------------- tools ---

const TOOLS = [
  {
    name: "search_knowledge_base",
    description:
      "Semantic search over the user's Cortexa document library (their uploaded PDFs, notes and articles).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        limit: { type: "integer", description: "Max passages (default 5)" },
      },
      required: ["query"],
    },
    async run({ query, limit }) {
      const rows = await semanticSearch(
        "chunks",
        query,
        Math.min(Number(limit) || 5, 15),
        "id,content,embedding,document_id"
      );
      if (!rows.length) return { results: [], hint: "Library is empty or unrelated." };
      const docIds = [...new Set(rows.map((r) => r.document_id))];
      const docs = await db(
        `documents?id=in.(${docIds.join(",")})&select=id,title`
      );
      const titles = Object.fromEntries(docs.map((d) => [d.id, d.title]));
      return {
        results: rows.map((r, i) => ({
          ref: i + 1,
          document_title: titles[r.document_id] ?? "Untitled",
          similarity: Number(r.similarity.toFixed(3)),
          excerpt: r.content.slice(0, 800),
        })),
      };
    },
  },
  {
    name: "recall_memory",
    description:
      "Search durable facts Cortexa has remembered about this user — goals, preferences, deadlines, background. Separate from their documents.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    async run({ query }) {
      const rows = await semanticSearch(
        "memories",
        query,
        8,
        "id,kind,content,pinned,embedding"
      );
      const pinned = await db(
        `memories?user_id=eq.${USER_ID}&pinned=is.true&select=id,kind,content,pinned&limit=8`
      );
      const seen = new Set();
      const out = [];
      for (const m of [...pinned, ...rows]) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({
          kind: m.kind,
          content: m.content,
          pinned: m.pinned,
          ...(m.similarity != null
            ? { similarity: Number(m.similarity.toFixed(3)) }
            : {}),
        });
      }
      return out.length ? { memories: out } : { memories: [], hint: "Nothing remembered yet." };
    },
  },
  {
    name: "save_memory",
    description:
      "Remember one durable fact about the user for future sessions. Third-person standalone sentence. Not for one-off trivia.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        kind: {
          type: "string",
          enum: ["fact", "preference", "goal", "event", "skill"],
        },
      },
      required: ["content"],
    },
    async run({ content, kind }) {
      const text = String(content ?? "").trim().slice(0, 400);
      if (text.length < 8) return { status: "skipped", reason: "too short" };
      const embedding = await embed(text, "RETRIEVAL_DOCUMENT");
      const [row] = await db("memories", {
        method: "POST",
        body: JSON.stringify({
          user_id: USER_ID,
          content: text,
          kind: kind ?? "fact",
          embedding,
          source: "agent",
          confidence: 0.85,
        }),
      });
      return { status: "created", id: row.id, content: text };
    },
  },
  {
    name: "list_notes",
    description: "List the user's Cortexa notes.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const rows = await db(
        `notes?user_id=eq.${USER_ID}&select=id,title,kind,updated_at&order=updated_at.desc&limit=50`
      );
      return { notes: rows };
    },
  },
  {
    name: "create_note",
    description: "Save a markdown note into the user's Cortexa workspace.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" } },
      required: ["title", "content"],
    },
    async run({ title, content }) {
      const [row] = await db("notes", {
        method: "POST",
        body: JSON.stringify({
          user_id: USER_ID,
          title: String(title).slice(0, 200),
          content: String(content),
          kind: "note",
          created_by: "ai",
        }),
      });
      return { created: true, note_id: row.id };
    },
  },
  {
    name: "get_weather",
    description: "Live current weather and 3-day forecast for any place.",
    inputSchema: {
      type: "object",
      properties: { place: { type: "string" } },
      required: ["place"],
    },
    async run({ place }) {
      const geo = await getJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`,
        "Geocoding"
      );
      const hit = geo?.results?.[0];
      if (!hit) throw new Error(`Could not find "${place}"`);
      const w = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`,
        "Open-Meteo"
      );
      const c = w.current ?? {};
      return {
        place: `${hit.name}${hit.country ? `, ${hit.country}` : ""}`,
        local_time: c.time,
        temperature_c: c.temperature_2m,
        feels_like_c: c.apparent_temperature,
        humidity_pct: c.relative_humidity_2m,
        wind_kmh: c.wind_speed_10m,
        conditions: WMO[c.weather_code] ?? `code ${c.weather_code}`,
        forecast: (w.daily?.time ?? []).map((date, i) => ({
          date,
          min_c: w.daily.temperature_2m_min[i],
          max_c: w.daily.temperature_2m_max[i],
          conditions: WMO[w.daily.weather_code[i]] ?? "unknown",
        })),
        fetched_at: new Date().toISOString(),
      };
    },
  },
  {
    name: "get_exchange_rate",
    description: "Live foreign-exchange rates (ECB reference rates).",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string" },
        targets: { type: "array", items: { type: "string" } },
        amount: { type: "number" },
      },
      required: ["base", "targets"],
    },
    async run({ base, targets, amount }) {
      const to = (Array.isArray(targets) ? targets : [targets])
        .map((t) => String(t).toUpperCase().slice(0, 3))
        .join(",");
      const json = await getJson(
        `https://api.frankfurter.app/latest?amount=${Number(amount) || 1}&from=${String(base).toUpperCase().slice(0, 3)}&to=${to}`,
        "Frankfurter"
      );
      return { ...json, fetched_at: new Date().toISOString() };
    },
  },
  {
    name: "get_crypto_price",
    description:
      "Live crypto prices with 24h change. Use CoinGecko ids ('bitcoin'), not tickers.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        currency: { type: "string" },
      },
      required: ["ids"],
    },
    async run({ ids, currency }) {
      const list = (Array.isArray(ids) ? ids : [ids])
        .map((i) => String(i).toLowerCase().trim())
        .filter(Boolean)
        .slice(0, 8);
      const vs = String(currency || "usd").toLowerCase();
      const json = await getJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(list.join(","))}&vs_currencies=${vs}&include_24hr_change=true`,
        "CoinGecko"
      );
      return { prices: json, currency: vs, fetched_at: new Date().toISOString() };
    },
  },
];

// ---------------------------------------------------------------- server ---

const server = new Server(
  { name: "cortexa", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool)
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
    };
  try {
    const result = await tool.run(request.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${e?.message ?? e}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `cortexa mcp ready · ${TOOLS.length} tools · db ${HAS_DB ? "connected" : "DISABLED (set SUPABASE_SERVICE_ROLE_KEY + CORTEXA_USER_ID)"}`
);
