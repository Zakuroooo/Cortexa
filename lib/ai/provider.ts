import {
  parseKeyList,
  runWithKeys,
  isRetryableStatus,
  RotatableError,
} from "./keyring";

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; args: string };

export type Msg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export interface StreamOpts {
  messages: Msg[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  onToken?: (t: string) => void;
}

export interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
}

type ProviderName = "groq" | "gemini" | "openai" | "custom";

const DEFAULT_MODELS: Record<ProviderName, string> = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-flash-latest",
  openai: "gpt-4o-mini",
  custom: "default",
};

const BASE_URLS: Record<ProviderName, string> = {
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
  custom: "",
};

export function resolveLLM(): {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  const provider = (
    process.env.LLM_PROVIDER || "groq"
  ).toLowerCase() as ProviderName;
  const safeProvider: ProviderName = BASE_URLS[provider] === "" && !process.env.LLM_BASE_URL ? "groq" : provider;
  const apiKey = process.env.LLM_API_KEY || "";
  const baseUrl =
    safeProvider === "custom"
      ? (process.env.LLM_BASE_URL || "").replace(/\/$/, "")
      : BASE_URLS[safeProvider];
  const model = process.env.LLM_MODEL || DEFAULT_MODELS[safeProvider];
  return { provider: safeProvider, apiKey, baseUrl, model };
}

export function resolveKeys(
  provider: ProviderName = resolveLLM().provider
): string[] {
  const alias =
    provider === "groq"
      ? process.env.GROQ_API_KEY
      : provider === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return parseKeyList(process.env.LLM_API_KEY, alias);
}

export function llmConfigured(): boolean {
  const { provider } = resolveLLM();
  if (provider === "custom") return Boolean(process.env.LLM_BASE_URL);
  return resolveKeys(provider).length > 0;
}

async function readErrorResponse(res: Response) {
  let body = "";
  try {
    body = await res.text();
  } catch {}
  return `LLM request failed (${res.status}): ${body.slice(0, 400)}`;
}

function fail(message: string, status?: number): RotatableError {
  return new RotatableError(message, {
    retriable: status === undefined ? true : isRetryableStatus(status),
    status,
  });
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) yield buf.trim();
}

function toWireOpenAI(messages: Msg[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant",
        content: m.content ?? null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
          type: "function",
          function: { name: tc.name, arguments: tc.args },
        })),
      };
    }
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: m.content,
      };
    }
    return m;
  });
}

async function streamOpenAICompatible(
  opts: StreamOpts,
  cfg: ReturnType<typeof resolveLLM>,
  apiKey: string
): Promise<StreamResult> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: toWireOpenAI(opts.messages),
    stream: true,
    temperature: opts.temperature ?? 0.4,
  };
  if (cfg.provider !== "groq") {
    body.max_tokens = opts.maxTokens ?? 2048;
  } else {
    body.max_completion_tokens = opts.maxTokens ?? 2048;
  }
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e: unknown) {
    throw fail(`Network error contacting ${cfg.provider}: ${String(e)}`);
  }
  if (!res.ok || !res.body) throw fail(await readErrorResponse(res), res.status);

  let content = "";
  const calls = new Map<number, ToolCall>();

  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      opts.onToken?.(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === "number" ? tc.index : 0;
        const cur =
          calls.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(idx, cur);
      }
    }
  }

  return {
    content,
    toolCalls: [...calls.values()].filter((c) => c.name),
  };
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

function toGemini(messages: Msg[]): {
  system?: string;
  contents: Array<{ role: string; parts: GeminiPart[] }>;
} {
  let system: string | undefined;
  const contents: Array<{ role: string; parts: GeminiPart[] }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      system = system ? `${system}\n\n${m.content}` : m.content;
    } else if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.tool_calls ?? []) {
        let args: Record<string, unknown> = {};
        try {
          args = tc.args ? JSON.parse(tc.args) : {};
        } catch {}
        parts.push({ functionCall: { name: tc.name, args } });
      }
      if (parts.length) contents.push({ role: "model", parts });
    } else if (m.role === "tool") {
      let parsed: unknown = m.content;
      try {
        parsed = JSON.parse(m.content);
      } catch {}
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : { result: String(parsed) };
      contents.push({
        role: "user",
        parts: [
          { functionResponse: { name: m.name, response } },
        ],
      });
    }
  }
  return { system, contents };
}

async function streamGemini(
  opts: StreamOpts,
  cfg: ReturnType<typeof resolveLLM>,
  apiKey: string
): Promise<StreamResult> {
  const { system, contents } = toGemini(opts.messages);
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? 4096,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (opts.tools?.length) {
    body.tools = [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }

  const url = `${cfg.baseUrl}/models/${cfg.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e: unknown) {
    throw fail(`Network error contacting Gemini: ${String(e)}`);
  }
  if (!res.ok || !res.body) throw fail(await readErrorResponse(res), res.status);

  let content = "";
  let fcIndex = 0;
  const toolCalls: ToolCall[] = [];

  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const parts = json.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p.text === "string" && p.text) {
        content += p.text;
        opts.onToken?.(p.text);
      } else if (p.functionCall) {
        toolCalls.push({
          id: `gem_fc_${fcIndex++}`,
          name: p.functionCall.name,
          args: JSON.stringify(p.functionCall.args ?? {}),
        });
      }
    }
  }

  return { content, toolCalls };
}

export async function streamChat(opts: StreamOpts): Promise<StreamResult> {
  const cfg = resolveLLM();
  const keys = resolveKeys(cfg.provider);
  if (!keys.length && cfg.provider !== "custom") {
    throw new Error(
      "No LLM configured. Set LLM_API_KEY in .env.local (free Groq key: console.groq.com/keys). " +
        "Tip: comma-separate multiple keys for automatic failover."
    );
  }
  return runWithKeys(keys.length ? keys : ["__nokey__"], (apiKey) =>
    cfg.provider === "gemini"
      ? streamGemini(opts, cfg, apiKey)
      : streamOpenAICompatible(opts, cfg, apiKey)
  );
}

export async function completeOnce(
  messages: Msg[],
  maxTokens = 600
): Promise<string> {
  const res = await streamChat({ messages, maxTokens, temperature: 0.2 });
  return res.content.trim();
}
