import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("✖ .env.local not found in project root");
  process.exit(1);
}

const env = {};
for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 1) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const mask = (k) =>
  k.length > 14 ? `${k.slice(0, 7)}…${k.slice(-4)} (${k.length} chars)` : "***too-short***";
const list = (...vals) => {
  const seen = new Set();
  const out = [];
  for (const v of vals) {
    if (!v) continue;
    for (const k of v.split(/[,\s]+/)) {
      const t = k.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
};

const results = [];
function record(service, key, ok, note) {
  results.push({ service, key, ok, note });
  console.log(`${ok ? "✔" : "✖"}  ${service.padEnd(8)} ${mask(key)}  ${note}`);
}

async function testGroq(key) {
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const b = await r.text().catch(() => "");
    return record("groq", key, false, `HTTP ${r.status} · ${b.slice(0, 90)}`);
  }
  const j = await r.json();
  const ids = (j.data ?? []).map((m) => m.id);
  const wanted = env.LLM_MODEL || "openai/gpt-oss-120b";
  record(
    "groq",
    key,
    true,
    ids.includes(wanted)
      ? `valid · model "${wanted.split("/").pop()}" available`
      : `valid · BUT "${wanted}" missing — pick one of: ${ids.slice(0, 4).join(", ")}`
  );
}

async function testGemini(key) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!r.ok) {
    const b = await r.text().catch(() => "");
    return record("gemini", key, false, `HTTP ${r.status} · ${b.slice(0, 90)}`);
  }
  const j = await r.json();
  const names = (j.models ?? []).map((m) => m.name.replace("models/", ""));
  const embedModel = env.EMBEDDING_MODEL || "gemini-embedding-001";
  let embedNote = "";
  try {
    const e = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${embedModel}:embedContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: "ping" }] },
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    embedNote = e.ok ? `· ${embedModel} works` : `· ${embedModel} FAILED (${e.status})`;
  } catch {
    embedNote = `· ${embedModel} unreachable`;
  }
  record(
    "gemini",
    key,
    true,
    `valid${names.some((n) => n.includes(embedModel)) ? "" : ` · "${embedModel}" not in model list`}${embedNote}`
  );
}

async function testTavily(key) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query: "cortexa test", max_results: 1 }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const b = await r.text().catch(() => "");
    return record("tavily", key, false, `HTTP ${r.status} · ${b.slice(0, 90)}`);
  }
  record("tavily", key, true, "valid · search responded");
}

console.log("\n═══ CORTEXA KEY TESTER ═══\n");

let g = 0;
for (const key of list(env.LLM_API_KEY, env.GROQ_API_KEY)) {
  try {
    await testGroq(key);
  } catch (e) {
    record("groq", key, false, String(e).slice(0, 90));
  }
  g++;
}
if (!g) console.log("–  groq     no keys found under LLM_API_KEY / GROQ_API_KEY");

let d = 0;
for (const key of list(env.GEMINI_API_KEY, env.GOOGLE_API_KEY)) {
  try {
    await testGemini(key);
  } catch (e) {
    record("gemini", key, false, String(e).slice(0, 90));
  }
  d++;
}
if (!d) console.log("–  gemini   no keys found under GEMINI_API_KEY (embeddings use local fallback)");

let t = 0;
for (const key of list(env.TAVILY_API_KEY)) {
  try {
    await testTavily(key);
  } catch (e) {
    record("tavily", key, false, String(e).slice(0, 90));
  }
  t++;
}
if (!t) console.log("–  tavily   no keys found under TAVILY_API_KEY (DuckDuckGo fallback active)");

const supaOk =
  env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("https://") &&
  !env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR-PROJECT") &&
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  !env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("PASTE");

console.log("\n─────────────────────────────");
console.log(`groq: ${list(env.LLM_API_KEY, env.GROQ_API_KEY).length} configured · gemini: ${d} · tavily: ${t}`);
console.log(`supabase creds: ${supaOk ? "present ✔" : "STILL PLACEHOLDERS ✖ — paste Project URL + anon key"}`);
console.log("");
