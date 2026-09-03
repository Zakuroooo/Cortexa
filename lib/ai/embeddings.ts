import crypto from "crypto";
import {
  parseKeyList,
  runWithKeys,
  isRetryableStatus,
  RotatableError,
} from "./keyring";

export const EMBEDDING_DIM = 768;

export type EmbeddingProvider = "gemini" | "jina" | "ollama" | "local";

export function embeddingProvider(): EmbeddingProvider {
  const raw = (process.env.EMBEDDING_PROVIDER || "").toLowerCase().trim();
  if (raw === "jina" || raw === "ollama" || raw === "local" || raw === "gemini")
    return raw;
  // No explicit choice: pick whichever provider actually has a key.
  if (parseKeyList(process.env.JINA_API_KEY).length) return "jina";
  if (embeddingKeyList().length) return "gemini";
  return "local";
}

export function embeddingKeyList(provider: EmbeddingProvider = "gemini"): string[] {
  if (provider === "jina")
    return parseKeyList(process.env.JINA_API_KEY, process.env.EMBEDDING_API_KEY);
  if (provider === "ollama" || provider === "local") return [];
  return parseKeyList(
    process.env.EMBEDDING_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.LLM_PROVIDER === "gemini"
      ? process.env.LLM_API_KEY
      : undefined
  );
}

function signedHash(token: string): { bucket: number; sign: number } {
  const a = crypto.createHash("sha1").update(token).digest();
  const bucket = ((a[0] << 16) | (a[1] << 8) | a[2]) % EMBEDDING_DIM;
  const sign = a[3] & 1 ? -1 : 1;
  return { bucket, sign };
}

export function localEmbed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && w.length < 40)
    .slice(0, 2000);

  const grams: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    grams.push(`${words[i]}_${words[i + 1]}`);
  }

  for (const g of grams) {
    const { bucket, sign } = signedHash(g);
    vec[bucket] += sign;
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => +(v / norm).toFixed(6));
}

async function geminiEmbedBatch(
  key: string,
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
): Promise<number[][]> {
  const model = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
  const requests = texts.map((t) => ({
    model: `models/${model}`,
    content: { parts: [{ text: t.slice(0, 8000) }] },
    taskType,
    outputDimensionality: EMBEDDING_DIM,
  }));

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      }
    );
  } catch (e: unknown) {
    throw new RotatableError(`Gemini embedding network error: ${String(e)}`, {
      retriable: true,
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RotatableError(
      `Gemini embedding failed (${res.status}): ${body.slice(0, 300)}`,
      { retriable: isRetryableStatus(res.status), status: res.status }
    );
  }

  const json: any = await res.json();
  const out: number[][] = [];
  for (const e of json.embeddings ?? []) {
    let v: number[] = e.values ?? [];
    if (v.length !== EMBEDDING_DIM) {
      v = v.length > EMBEDDING_DIM ? v.slice(0, EMBEDDING_DIM) : pad(v);
    }
    out.push(v);
  }
  return out;
}

/**
 * Jina AI — free tier, no card, and jina-embeddings-v3 is Matryoshka, so it
 * returns native 768-dim vectors that drop straight into our schema. Its task
 * types map 1:1 onto Gemini's, which keeps query/passage asymmetry intact.
 */
async function jinaEmbedBatch(
  key: string,
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
): Promise<number[][]> {
  const model = process.env.EMBEDDING_MODEL || "jina-embeddings-v3";
  let res: Response;
  try {
    res = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        task:
          taskType === "RETRIEVAL_QUERY"
            ? "retrieval.query"
            : "retrieval.passage",
        dimensions: EMBEDDING_DIM,
        embedding_type: "float",
        input: texts.map((t) => t.slice(0, 8000)),
      }),
    });
  } catch (e: unknown) {
    throw new RotatableError(`Jina embedding network error: ${String(e)}`, {
      retriable: true,
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RotatableError(
      `Jina embedding failed (${res.status}): ${body.slice(0, 300)}`,
      { retriable: isRetryableStatus(res.status), status: res.status }
    );
  }

  const json: any = await res.json();
  // The API may reorder results, so sort by the index it echoes back.
  return (json.data ?? [])
    .slice()
    .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
    .map((d: any) => {
      const v: number[] = d.embedding ?? [];
      return v.length === EMBEDDING_DIM
        ? v
        : v.length > EMBEDDING_DIM
          ? v.slice(0, EMBEDDING_DIM)
          : pad(v);
    });
}

/**
 * Ollama running locally — free forever, no key, no rate limit, works offline.
 * `ollama pull nomic-embed-text` gives native 768-dim vectors.
 */
async function ollamaEmbedBatch(texts: string[]): Promise<number[][]> {
  const base = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(
    /\/$/,
    ""
  );
  const model = process.env.EMBEDDING_MODEL || "nomic-embed-text";
  let res: Response;
  try {
    res = await fetch(`${base}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts.map((t) => t.slice(0, 8000)) }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e: unknown) {
    throw new RotatableError(
      `Ollama unreachable at ${base} — is it running? (${String(e)})`,
      { retriable: false }
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RotatableError(
      `Ollama embedding failed (${res.status}): ${body.slice(0, 300)}`,
      { retriable: false, status: res.status }
    );
  }
  const json: any = await res.json();
  return (json.embeddings ?? []).map((v: number[]) =>
    v.length === EMBEDDING_DIM
      ? v
      : v.length > EMBEDDING_DIM
        ? v.slice(0, EMBEDDING_DIM)
        : pad(v)
  );
}

function pad(v: number[]): number[] {
  return [...v, ...new Array(EMBEDDING_DIM - v.length).fill(0)];
}

const BATCH = 20;

async function embedBatchAll(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
): Promise<number[][]> {
  const provider = embeddingProvider();
  if (provider === "local") throw new Error("local provider selected");

  const out: number[][] = [];

  if (provider === "ollama") {
    for (let i = 0; i < texts.length; i += BATCH) {
      out.push(...(await ollamaEmbedBatch(texts.slice(i, i + BATCH))));
    }
    return out;
  }

  const keys = embeddingKeyList(provider);
  if (!keys.length)
    throw new Error(`No ${provider} embedding keys configured`);

  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    out.push(
      ...(await runWithKeys(keys, (k) =>
        provider === "jina"
          ? jinaEmbedBatch(k, slice, taskType)
          : geminiEmbedBatch(k, slice, taskType)
      ))
    );
  }
  return out;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (embeddingProvider() !== "local") {
    try {
      return await embedBatchAll(texts, "RETRIEVAL_DOCUMENT");
    } catch {
      return texts.map(localEmbed);
    }
  }
  return texts.map(localEmbed);
}

export async function embedQuery(text: string): Promise<number[]> {
  if (embeddingProvider() !== "local") {
    try {
      const [emb] = await embedBatchAll([text], "RETRIEVAL_QUERY");
      return emb;
    } catch {
      return localEmbed(text);
    }
  }
  return localEmbed(text);
}

const DEFAULT_MODEL: Record<EmbeddingProvider, string> = {
  gemini: "gemini-embedding-001",
  jina: "jina-embeddings-v3",
  ollama: "nomic-embed-text",
  local: "hashed n-grams",
};

export function embeddingProviderName(): {
  name: string;
  keys: number;
  provider: EmbeddingProvider;
  quality: "high" | "low";
} {
  const provider = embeddingProvider();
  const model = process.env.EMBEDDING_MODEL || DEFAULT_MODEL[provider];

  if (provider === "local")
    return {
      name: "local hashed vectors (no key) — keyword-ish, not semantic",
      keys: 0,
      provider,
      quality: "low",
    };

  if (provider === "ollama")
    return {
      name: `ollama ${model} · local, unlimited`,
      keys: 0,
      provider,
      quality: "high",
    };

  const keyCount = embeddingKeyList(provider).length;
  if (!keyCount)
    return {
      name: `local fallback — no ${provider} key found`,
      keys: 0,
      provider: "local",
      quality: "low",
    };

  return {
    name: `${provider} ${model} · auto-failover`,
    keys: keyCount,
    provider,
    quality: "high",
  };
}
