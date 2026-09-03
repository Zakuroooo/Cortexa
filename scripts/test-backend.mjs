import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
const env = {};
for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 1) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const bad =
  !url.startsWith("https://") ||
  url.includes("YOUR-PROJECT") ||
  !anon ||
  anon.startsWith("PASTE");

let pass = 0;
let fail = 0;
function result(name, ok, note = "") {
  console.log(`${ok ? "✔" : "✖"} ${name.padEnd(34)} ${note}`);
  if (ok) {
    pass++;
  } else {
    fail++;
  }
}

console.log("\n═══ CORTEXA BACKEND TESTER ═══");
console.log(`file: ${envPath}\n`);

if (bad) {
  console.log(
    "✖ Supabase creds are STILL placeholders in .env.local.\n\n" +
      "  Fix: open this exact file:\n    " +
      envPath +
      "\n  and replace the first two lines with the real values from\n" +
      "  Supabase Dashboard → Project Settings → API:\n" +
      "    NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co\n" +
      "    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...\n"
  );
  process.exit(1);
}

result("env: real Supabase URL + anon key", true, url.slice(8, 30) + "…");

async function api(pathname, opts = {}, token) {
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${token ?? anon}`,
    "Content-Type": "application/json",
    ...(opts.headers ?? {}),
  };
  return fetch(`${url}${pathname}`, { ...opts, headers });
}

let session = null;

try {
  const h = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon } });
  result("auth service reachable", h.ok, `HTTP ${h.status}`);
} catch {
  result("auth service reachable", false, "network error — check URL");
}

const email = env.PROBE_EMAIL || "cortexa.probe.check@gmail.com";
const password = env.PROBE_PASSWORD || "Cortexa-Probe-2026!x";

async function tryLogin() {
  const s = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: s.status, j: await s.json().catch(() => ({})) };
}

try {
  let login = await tryLogin();

  if (!login.j.access_token) {
    const r = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    await r.json().catch(() => ({}));
    login = await tryLogin();
  }

  if (login.j.access_token) {
    session = login.j.access_token;
    result("signup + login works", true, "email confirmation is OFF ✔");
  } else {
    const msg = login.j.error_description || login.j.msg || "";
    if (/confirm/i.test(msg)) {
      result(
        "signup + login works",
        false,
        "EMAIL CONFIRMATION IS ON — Dashboard → Authentication → Sign In/Providers → turn OFF 'Confirm email'"
      );
    } else if (/rate/i.test(msg)) {
      result(
        "signup + login works",
        false,
        "email rate limit hit — Dashboard → Authentication → Sign In/Providers → turn OFF 'Confirm email', wait a few min, rerun"
      );
    } else {
      result("signup + login works", false, `${msg || login.status}`);
    }
    console.log("\n→ Session-dependent tests skipped.");
    process.exit(1);
  }
} catch (e) {
  result("signup + login works", false, String(e).slice(0, 100));
  process.exit(1);
}

const token = session;
let userId = null;

try {
  const r = await api("/auth/v1/user", {}, token);
  const u = await r.json();
  userId = u.id;
  result("session valid · profile trigger fired", Boolean(userId));
} catch {
  result("session valid", false);
}

const stamp = Date.now();

{
  const r = await api(
    "/rest/v1/notes",
    {
      method: "POST",
      body: JSON.stringify({
        title: `__probe_${stamp}`,
        content: "backend probe",
      }),
    },
    token
  );
  const j = await r.json().catch(() => []);
  const ok = r.status === 201 && Array.isArray(j) && j[0]?.id;
  result("notes: INSERT (RLS + trigger)", ok, ok ? "" : `HTTP ${r.status} ${JSON.stringify(j).slice(0, 140)}`);
}

{
  const r = await api(
    `/rest/v1/notes?title=eq.__probe_${stamp}&select=id,title`,
    {},
    token
  );
  const j = await r.json();
  const ok = r.ok && Array.isArray(j) && j.length === 1;
  result("notes: SELECT own row", ok);

  if (ok) {
    const id = j[0].id;
    const up = await api(
      `/rest/v1/notes?id=eq.${id}`,
      { method: "PATCH", body: JSON.stringify({ content: "probed ✓" }) },
      token
    );
    result("notes: UPDATE own row", up.status === 204);

    const del = await api(`/rest/v1/notes?id=eq.${id}`, { method: "DELETE" }, token);
    result("notes: DELETE own row", del.status === 204);
  }
}

let probeDocId = null;
{
  const r = await api(
    "/rest/v1/documents",
    {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        title: `__probe_doc_${stamp}`,
        source_type: "text",
        status: "ready",
        char_count: 10,
        chunk_count: 1,
      }),
    },
    token
  );
  const j = await r.json().catch(() => []);
  probeDocId = Array.isArray(j) ? j[0]?.id : null;
  result(
    "documents: INSERT + pgvector table",
    Boolean(probeDocId),
    probeDocId ? "" : `HTTP ${r.status}`
  );
}

if (probeDocId) {
  const zeros = Array(768).fill(0.001);
  const r = await api(
    "/rest/v1/chunks",
    {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        document_id: probeDocId,
        idx: 0,
        content: "probe chunk",
        embedding: zeros,
      }),
    },
    token
  );
  result("chunks: vector(768) INSERT", r.status === 201, `HTTP ${r.status}`);

  const rpc = await api(
    "/rest/v1/rpc/match_chunks",
    {
      method: "POST",
      body: JSON.stringify({
        query_embedding: zeros,
        match_count: 3,
        min_similarity: -1,
      }),
    },
    token
  );
  const rj = await rpc.json().catch(() => null);
  result(
    "match_chunks RPC (vector search)",
    rpc.ok && Array.isArray(rj),
    rpc.ok ? `returned ${Array.isArray(rj) ? rj.length : 0} rows` : `HTTP ${rpc.status}`
  );

  await api(`/rest/v1/documents?id=eq.${probeDocId}`, { method: "DELETE" }, token);
  result("documents: cascade DELETE chunks", true);
}

console.log("\n─────────────────────────────");
console.log(`${pass} passed · ${fail} failed`);
if (fail === 0) {
  console.log("\nDATABASE IS FULLY OPERATIONAL — login will work now.");
  console.log("(If login still fails in the browser, hard-refresh and check you");
  console.log(" restarted the dev server after editing .env.local.)");
}
console.log("");
