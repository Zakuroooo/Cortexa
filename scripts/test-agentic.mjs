/**
 * Verifies the agentic layer added on top of plain RAG:
 *   1. the memories table + RPCs exist in Supabase
 *   2. every live-data source responds with fresh values
 *   3. the router returns a valid route for representative questions
 *   4. the memory extractor pulls durable facts out of a turn
 *
 * Run: npm run test:agentic
 */
import fs from "fs";
import path from "path";

const env = {};
for (const raw of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

let pass = 0;
let fail = 0;
let warn = 0;
const result = (name, ok, note = "") => {
  console.log(`${ok === "warn" ? "!" : ok ? "✔" : "✖"} ${name.padEnd(38)} ${note}`);
  if (ok === "warn") warn++;
  else if (ok) pass++;
  else fail++;
};

// ------------------------------------------------------------- 1. schema ---
console.log("\n── Supabase schema ─────────────────────────────");

const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!url.startsWith("https://") || !anon) {
  result("supabase configured", false, "fill NEXT_PUBLIC_SUPABASE_* in .env.local");
} else {
  const head = { apikey: anon, Authorization: `Bearer ${anon}` };

  const table = await fetch(`${url}/rest/v1/memories?select=id&limit=1`, { headers: head });
  result(
    "memories table exists",
    table.status !== 404,
    table.status === 404
      ? "run supabase/schema.sql again in the SQL editor"
      : `HTTP ${table.status} (401/empty is fine — RLS is on)`
  );

  // PostgREST resolves functions by argument signature, so these must be
  // called with real arguments — an empty body 404s even when the function
  // exists.
  const zeroVector = `[${new Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
  const rpcs = [
    ["match_chunks", { query_embedding: zeroVector, match_count: 1 }],
    ["match_memories", { query_embedding: zeroVector, match_count: 1, min_similarity: 0.3 }],
    ["touch_memories", { memory_ids: [] }],
  ];
  for (const [fn, body] of rpcs) {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...head, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    result(
      `rpc ${fn}`,
      res.ok,
      res.ok ? `HTTP ${res.status}` : `missing or broken — re-run schema.sql (HTTP ${res.status})`
    );
  }
}

// ---------------------------------------------------------- 2. live data ---
console.log("\n── Live data sources (keyless) ─────────────────");

const live = [
  [
    "open-meteo · weather",
    async () => {
      const g = await (await fetch("https://geocoding-api.open-meteo.com/v1/search?name=Kolkata&count=1")).json();
      const w = await (
        await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${g.results[0].latitude}&longitude=${g.results[0].longitude}&current=temperature_2m&timezone=auto`
        )
      ).json();
      return `${w.current.temperature_2m}°C in Kolkata now`;
    },
  ],
  [
    "frankfurter · fx rates",
    async () => {
      const j = await (await fetch("https://api.frankfurter.app/latest?from=USD&to=INR")).json();
      return `1 USD = ₹${j.rates.INR} (${j.date})`;
    },
  ],
  [
    "coingecko · crypto",
    async () => {
      const j = await (
        await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")
      ).json();
      return `BTC $${j.bitcoin.usd.toLocaleString()}`;
    },
  ],
];

for (const [name, fn] of live) {
  try {
    result(name, true, await fn());
  } catch (e) {
    result(name, "warn", `unreachable: ${String(e.message || e).slice(0, 60)}`);
  }
}

// ------------------------------------------------------------- 3. the LLM ---
console.log("\n── Router + memory extraction ──────────────────");

const keys = (env.LLM_API_KEY || env.GROQ_API_KEY || "").split(",").map((k) => k.trim()).filter(Boolean);
const model = env.LLM_MODEL || "openai/gpt-oss-120b";

async function chat(system, user, maxTokens = 300) {
  let lastErr = "no keys configured";
  for (const key of keys) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        max_completion_tokens: maxTokens,
      }),
    });
    if (res.ok) return (await res.json()).choices[0].message.content;
    lastErr = `HTTP ${res.status}`;
  }
  throw new Error(lastErr);
}

const ROUTER_SYSTEM = fs
  .readFileSync(path.join(process.cwd(), "lib/ai/router.ts"), "utf8")
  .split("const ROUTER_SYSTEM = `")[1]
  .split("`;")[0];

const CASES = [
  ["hey there", ["direct"]],
  ["what's the bitcoin price right now?", ["agent"]],
  ["what do you know about me?", ["memory"]],
  ["summarize the key points of my uploaded paper", ["documents", "hybrid"]],
];

if (!keys.length) {
  result("router", "warn", "no LLM key in .env.local — skipped");
} else {
  for (const [q, expected] of CASES) {
    try {
      const raw = await chat(ROUTER_SYSTEM, `Latest user message: ${q}\n\nJSON:`, 160);
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      result(
        `route "${q.slice(0, 26)}…"`,
        expected.includes(json.route),
        `→ ${json.route}${expected.includes(json.route) ? "" : ` (expected ${expected.join("/")})`}`
      );
    } catch (e) {
      result(`route "${q.slice(0, 26)}…"`, false, String(e.message || e).slice(0, 60));
    }
  }

  const EXTRACT_SYSTEM = fs
    .readFileSync(path.join(process.cwd(), "lib/ai/memory.ts"), "utf8")
    .split("const EXTRACT_SYSTEM = `")[1]
    .split("`;")[0];

  try {
    const raw = await chat(
      EXTRACT_SYSTEM,
      "Conversation turn:\n\nUSER: I'm a 3rd-year CS student at Jadavpur and I'm preparing for GATE 2027. Keep answers short.\n\nASSISTANT: Got it — short answers from here on.\n\nJSON array:",
      400
    );
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    result(
      "memory extraction",
      Array.isArray(arr) && arr.length >= 1 && arr.every((m) => m.content),
      arr.map((m) => `${m.kind}: ${m.content}`).join(" | ").slice(0, 110)
    );

    const noise = await chat(EXTRACT_SYSTEM, "Conversation turn:\n\nUSER: thanks!\n\nASSISTANT: You're welcome.\n\nJSON array:", 200);
    const empty = JSON.parse(noise.slice(noise.indexOf("["), noise.lastIndexOf("]") + 1));
    result("extraction ignores small talk", empty.length === 0, `returned ${empty.length} items`);
  } catch (e) {
    result("memory extraction", false, String(e.message || e).slice(0, 60));
  }
}

console.log(`\n${pass} passed · ${fail} failed · ${warn} warnings\n`);
process.exit(fail ? 1 : 0);
