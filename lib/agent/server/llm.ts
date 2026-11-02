/**
 * Server side of the LLM proxy. The browser never sees an API key: it sends
 * messages + tools to /api/agent/llm, which calls this.
 *
 * Free providers only, tried in order:
 *   1. Gemini (if GEMINI_API_KEY is set) — OpenAI-compatible endpoint
 *   2. Groq gpt-oss-120b, then gpt-oss-20b (each has its own daily quota)
 * Every provider speaks the same OpenAI chat format, so one function covers all.
 * On a 429 we wait for the "try again in Xs" hint (short waits only), then move
 * on to the next model rather than failing the user's task.
 */
import { parseKeyList } from "@/lib/ai/keyring";
import { retryAfterMs } from "../backoff";
import type { ChatMessage, LlmReply, ToolSpec } from "../types";

interface Model {
  label: string;
  baseUrl: string;
  model: string;
  keys: string[];
}

export function modelChain(): Model[] {
  const chain: Model[] = [];
  const gemini = parseKeyList(process.env.GEMINI_API_KEY);
  if (gemini.length)
    chain.push({
      label: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      keys: gemini,
    });
  const groq = parseKeyList(
    process.env.GROQ_API_KEY,
    (process.env.LLM_PROVIDER || "groq") === "groq" ? process.env.LLM_API_KEY : undefined
  );
  if (groq.length) {
    for (const model of [process.env.AGENT_GROQ_MODEL || "openai/gpt-oss-120b", "openai/gpt-oss-20b"])
      chain.push({ label: "groq", baseUrl: "https://api.groq.com/openai/v1", model, keys: groq });
  }
  return chain;
}

/** Most time one proxy call may spend waiting on rate limits (stays under 60 s). */
const MAX_WAIT_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toWire(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant")
      return {
        role: "assistant",
        content: m.content ?? "",
        ...(m.tool_calls?.length
          ? { tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args || "{}" } })) }
          : {}),
      };
    if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
    return m;
  });
}

async function callOnce(m: Model, key: string, messages: ChatMessage[], tools: ToolSpec[] | undefined, maxTokens: number) {
  const res = await fetch(`${m.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: m.model,
      messages: toWire(messages),
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(tools?.length
        ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" }
        : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${m.label} ${m.model} (${res.status}): ${text.slice(0, 400)}`), { status: res.status });
  const json = JSON.parse(text);
  const msg = json.choices?.[0]?.message ?? {};
  return {
    content: String(msg.content ?? ""),
    toolCalls: (msg.tool_calls ?? []).map((t: any, i: number) => ({
      id: String(t.id || `call_${Date.now()}_${i}`),
      name: String(t.function?.name ?? ""),
      args: String(t.function?.arguments ?? "{}"),
    })),
    tokens: Number(json.usage?.total_tokens ?? 0),
    model: `${m.label}:${m.model}`,
  } satisfies LlmReply;
}

export async function chatCompletion(opts: {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  /** small jobs (research helpers, the verify judge) try the smaller model first, saving the big model's quota */
  light?: boolean;
}): Promise<LlmReply> {
  let chain = modelChain();
  if (opts.light) chain = [...chain.filter((m) => m.model.includes("20b")), ...chain.filter((m) => !m.model.includes("20b"))];
  if (!chain.length) throw new Error("No free model key configured (GEMINI_API_KEY or a Groq key in LLM_API_KEY)");
  const maxTokens = Math.min(opts.maxTokens ?? 4000, 8000);
  let waited = 0;
  const errors: string[] = [];

  for (const m of chain) {
    for (const key of m.keys) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await callOnce(m, key, opts.messages, opts.tools, maxTokens);
        } catch (e: any) {
          const msg = String(e?.message || e);
          const wait = retryAfterMs(msg);
          // short rate-limit wait → same key again; long one → next key/model
          if (wait !== null && wait <= 8000 && waited + wait <= MAX_WAIT_MS) {
            waited += wait + 250;
            await sleep(wait + 250);
            continue;
          }
          errors.push(msg.slice(0, 200));
          // a bad request (e.g. tool_use_failed) won't get better on another key
          if (e?.status === 400 && !/tool_use_failed|Failed to call a function/i.test(msg)) throw e;
          break;
        }
      }
    }
  }
  throw new Error(`All free models are busy or out of quota. Try again in a minute. (${errors.slice(-2).join(" | ")})`);
}
