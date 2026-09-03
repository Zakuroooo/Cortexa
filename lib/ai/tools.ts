import type { ToolSpec } from "./provider";
import { embedQuery } from "./embeddings";
import { parseKeyList } from "./keyring";
import { recallMemories, saveMemory, markMemoriesUsed } from "./memory";
import {
  getWeather,
  getExchangeRate,
  getCryptoPrice,
  getCurrentTime,
} from "./live";
import { truncate } from "@/lib/utils";

export interface ToolContext {
  userId: string;
  supabase: any;
  chatId?: string;
}

export interface AgentTool {
  spec: ToolSpec;
  run(args: Record<string, any>, ctx: ToolContext): Promise<string>;
}

async function htmlToText(html: string): Promise<string> {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CortexaBot/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text")) {
    throw new Error(`Unsupported content-type: ${contentType.split(";")[0]}`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : url;
  return { title, text: truncate(await htmlToText(html), 8000) };
}

async function tavilySearch(
  key: string,
  query: string,
  maxResults: number
): Promise<string> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: maxResults,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Tavily failed (${res.status})`);
  const json: any = await res.json();
  const items = (json.results ?? []).map(
    (r: any, i: number) =>
      `[${i + 1}] ${r.title}\nURL: ${r.url}\n${truncate(r.content ?? "", 500)}`
  );
  return items.length
    ? items.join("\n\n")
    : "No results found.";
}

async function duckSearch(query: string, maxResults: number): Promise<string> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; CortexaBot/1.0)",
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);
  const html = await res.text();
  const results: string[] = [];
  const re =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < maxResults) {
    let href = m[1];
    const uddg = href.match(/uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    const strip = (s: string) =>
      s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    results.push(
      `[${results.length + 1}] ${strip(m[2])}\nURL: ${href}\n${truncate(strip(m[3]), 400)}`
    );
  }
  if (!results.length) throw new Error("DuckDuckGo parse produced no results");
  return results.join("\n\n");
}

export async function webSearch(query: string, maxResults = 5): Promise<string> {
  const keys = parseKeyList(process.env.TAVILY_API_KEY);
  if (keys.length) {
    for (const key of keys) {
      try {
        return await tavilySearch(key, query, maxResults);
      } catch {}
    }
  }
  return duckSearch(query, maxResults);
}

export function tavilyKeyCount(): number {
  return parseKeyList(process.env.TAVILY_API_KEY).length;
}

export const TOOLS: AgentTool[] = [
  {
    spec: {
      name: "search_knowledge_base",
      description:
        "Semantic search over the user's own uploaded documents and knowledge base. Always use this first when the mission relates to the user's material.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
          match_count: {
            type: "integer",
            description: "How many passages to return (default 5)",
          },
        },
        required: ["query"],
      },
    },
    run: async (args, ctx) => {
      const query = String(args.query ?? "");
      if (!query.trim()) return JSON.stringify({ error: "query is required" });
      const embedding = await embedQuery(query);
      const { data, error } = await ctx.supabase.rpc("match_chunks", {
        query_embedding: embedding,
        match_count: Math.min(Number(args.match_count) || 5, 10),
      });
      if (error)
        return JSON.stringify({ error: `Search failed: ${error.message}` });
      if (!data?.length)
        return JSON.stringify({
          result:
            "No relevant passages found. The library may be empty or unrelated to this query.",
        });
      return JSON.stringify({
        results: data.map((d: any, i: number) => ({
          ref: i + 1,
          document_title: d.document_title,
          similarity: Number(d.similarity.toFixed(3)),
          excerpt: truncate(d.content, 600),
        })),
      });
    },
  },
  {
    spec: {
      name: "fetch_url",
      description:
        "Extract readable text content from a public web page URL. Use for articles, docs or blog posts the user provided or that web_search surfaced.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL starting with http(s)" },
        },
        required: ["url"],
      },
    },
    run: async (args) => {
      const url = String(args.url ?? "");
      if (!/^https?:\/\//i.test(url))
        return JSON.stringify({ error: "url must start with http(s)://" });
      try {
        const { title, text } = await fetchUrlText(url);
        return JSON.stringify({ title, text });
      } catch (e: any) {
        return JSON.stringify({ error: `Could not fetch URL: ${String(e.message || e)}` });
      }
    },
  },
  {
    spec: {
      name: "web_search",
      description:
        "Search the public internet and get top results with titles, URLs and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Web search query" },
          max_results: { type: "integer", description: "default 5" },
        },
        required: ["query"],
      },
    },
    run: async (args) => {
      const query = String(args.query ?? "");
      if (!query.trim()) return JSON.stringify({ error: "query is required" });
      try {
        const out = await webSearch(query, Math.min(Number(args.max_results) || 5, 8));
        return JSON.stringify({ query, results: out });
      } catch (e: any) {
        return JSON.stringify({
          error: `Web search unavailable: ${String(e.message || e)}`,
        });
      }
    },
  },
  {
    spec: {
      name: "list_notes",
      description: "List the user's existing notes (id, title, kind, updated time).",
      parameters: { type: "object", properties: {} },
    },
    run: async (_args, ctx) => {
      const { data, error } = await ctx.supabase
        .from("notes")
        .select("id, title, kind, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        notes: data ?? [],
        hint: data?.length
          ? "Use read_note with an id to see full content."
          : "The user has no notes yet.",
      });
    },
  },
  {
    spec: {
      name: "read_note",
      description: "Read the full content of one of the user's notes by id.",
      parameters: {
        type: "object",
        properties: {
          note_id: { type: "string", description: "Note id from list_notes" },
        },
        required: ["note_id"],
      },
    },
    run: async (args, ctx) => {
      const { data, error } = await ctx.supabase
        .from("notes")
        .select("title, kind, content")
        .eq("id", args.note_id)
        .maybeSingle();
      if (error) return JSON.stringify({ error: error.message });
      if (!data) return JSON.stringify({ error: "Note not found." });
      return JSON.stringify(data);
    },
  },
  {
    spec: {
      name: "create_note",
      description:
        "Create a durable markdown note in the user's workspace. Use for summaries, briefs, study guides and structured findings.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: {
            type: "string",
            description: "Full note body in markdown",
          },
          kind: {
            type: "string",
            enum: ["note", "quiz"],
            description: "Leave as 'note' unless explicitly a quiz",
          },
        },
        required: ["title", "content"],
      },
    },
    run: async (args, ctx) => {
      const title = String(args.title ?? "").trim() || "Untitled note";
      const content = String(args.content ?? "").trim();
      const kind = args.kind === "quiz" ? "quiz" : "note";
      if (!content)
        return JSON.stringify({ error: "content is required" });
      const { data, error } = await ctx.supabase
        .from("notes")
        .insert({
          user_id: ctx.userId,
          title,
          content,
          kind,
          created_by: "ai",
        })
        .select("id")
        .single();
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        created: true,
        note_id: data.id,
        title,
        message: `Note "${title}" saved to the user's Notes.`,
      });
    },
  },
  {
    spec: {
      name: "create_quiz",
      description:
        "Generate and save a practice quiz with multiple-choice questions based on studied material.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 15,
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 2,
                  maxItems: 6,
                },
                answer_index: {
                  type: "integer",
                  description: "Zero-based index of correct option",
                },
                explanation: { type: "string" },
              },
              required: ["question", "options", "answer_index"],
            },
          },
        },
        required: ["title", "questions"],
      },
    },
    run: async (args, ctx) => {
      const questions = Array.isArray(args.questions) ? args.questions : [];
      const valid = questions.filter(
        (q: any) =>
          q &&
          typeof q.question === "string" &&
          Array.isArray(q.options) &&
          q.options.length >= 2 &&
          Number.isInteger(q.answer_index) &&
          q.answer_index >= 0 &&
          q.answer_index < q.options.length
      );
      if (!valid.length)
        return JSON.stringify({ error: "No valid questions provided" });
      const title =
        String(args.title ?? "").trim() || "Practice quiz";
      const { data, error } = await ctx.supabase
        .from("notes")
        .insert({
          user_id: ctx.userId,
          title,
          content: JSON.stringify({ questions: valid }),
          kind: "quiz",
          created_by: "ai",
        })
        .select("id")
        .single();
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        created: true,
        quiz_id: data.id,
        title,
        saved_questions: valid.length,
      });
    },
  },
  {
    spec: {
      name: "recall_memory",
      description:
        "Search everything you have remembered about this user across ALL past sessions — their goals, preferences, deadlines, background. Use this whenever the mission depends on who the user is or what they told you before. This is separate from their uploaded documents.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What you want to remember, e.g. 'exam timeline' or 'preferred answer style'",
          },
        },
        required: ["query"],
      },
    },
    run: async (args, ctx) => {
      const query = String(args.query ?? "").trim();
      if (!query) return JSON.stringify({ error: "query is required" });
      const memories = await recallMemories(ctx.supabase, query, 6);
      if (!memories.length)
        return JSON.stringify({
          memories: [],
          hint: "Nothing remembered about this yet. Use save_memory if the user tells you something durable.",
        });
      await markMemoriesUsed(ctx.supabase, memories);
      return JSON.stringify({
        memories: memories.map((m) => ({
          kind: m.kind,
          content: m.content,
          pinned: m.pinned,
          similarity: Number(m.similarity.toFixed(3)),
        })),
      });
    },
  },
  {
    spec: {
      name: "save_memory",
      description:
        "Remember one durable fact about the user for future sessions — a stable fact, a preference, a goal, a deadline. Do NOT use this for answer content (use create_note) or for one-off trivia. Near-duplicates are merged automatically.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "A standalone third-person sentence, e.g. 'The user is preparing for GATE 2027 in CS.'",
          },
          kind: {
            type: "string",
            enum: ["fact", "preference", "goal", "event", "skill"],
          },
        },
        required: ["content"],
      },
    },
    run: async (args, ctx) => {
      const result = await saveMemory(ctx.supabase, ctx.userId, {
        content: String(args.content ?? ""),
        kind: args.kind,
        source: "agent",
        confidence: 0.85,
        sourceChatId: ctx.chatId ?? null,
      });
      return JSON.stringify(result);
    },
  },
  {
    spec: {
      name: "get_weather",
      description:
        "Live current weather and a 3-day forecast for any place on earth. Real-time — use it instead of guessing, since your training data has no idea what today's weather is.",
      parameters: {
        type: "object",
        properties: {
          place: { type: "string", description: "City or place name, e.g. 'Kolkata'" },
        },
        required: ["place"],
      },
    },
    run: async (args) => {
      try {
        return JSON.stringify(await getWeather(String(args.place ?? "")));
      } catch (e: any) {
        return JSON.stringify({ error: String(e?.message || e) });
      }
    },
  },
  {
    spec: {
      name: "get_exchange_rate",
      description:
        "Live foreign-exchange rates between currencies (ECB reference rates, updated every business day).",
      parameters: {
        type: "object",
        properties: {
          base: { type: "string", description: "ISO code to convert FROM, e.g. 'USD'" },
          targets: {
            type: "array",
            items: { type: "string" },
            description: "ISO codes to convert TO, e.g. ['INR','EUR']",
          },
          amount: { type: "number", description: "Amount to convert (default 1)" },
        },
        required: ["base", "targets"],
      },
    },
    run: async (args) => {
      try {
        const targets = Array.isArray(args.targets)
          ? args.targets.map(String)
          : String(args.targets ?? "").split(",");
        return JSON.stringify(
          await getExchangeRate(
            String(args.base ?? "USD"),
            targets,
            Number(args.amount) || 1
          )
        );
      } catch (e: any) {
        return JSON.stringify({ error: String(e?.message || e) });
      }
    },
  },
  {
    spec: {
      name: "get_crypto_price",
      description:
        "Live cryptocurrency prices with 24h change and market cap. Prices move by the minute, so always call this rather than answering from memory.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description:
              "CoinGecko ids (NOT tickers): 'bitcoin', 'ethereum', 'solana', 'dogecoin'",
          },
          currency: { type: "string", description: "Quote currency, default 'usd'" },
        },
        required: ["ids"],
      },
    },
    run: async (args) => {
      try {
        const ids = Array.isArray(args.ids)
          ? args.ids.map(String)
          : String(args.ids ?? "").split(",");
        return JSON.stringify(
          await getCryptoPrice(ids, String(args.currency ?? "usd"))
        );
      } catch (e: any) {
        return JSON.stringify({ error: String(e?.message || e) });
      }
    },
  },
  {
    spec: {
      name: "get_current_time",
      description:
        "The real current local date and time in a given place. Call this before any reasoning about 'today', 'tomorrow' or how long until a deadline.",
      parameters: {
        type: "object",
        properties: {
          place: { type: "string", description: "City or place name" },
        },
        required: ["place"],
      },
    },
    run: async (args) => {
      try {
        return JSON.stringify(await getCurrentTime(String(args.place ?? "")));
      } catch (e: any) {
        return JSON.stringify({ error: String(e?.message || e) });
      }
    },
  },
  {
    spec: {
      name: "finish",
      description:
        "Call this INSTEAD of writing plain text as the final step, providing the complete final answer for the user.",
      parameters: {
        type: "object",
        properties: {
          answer: {
            type: "string",
            description: "The complete final answer in markdown",
          },
        },
        required: ["answer"],
      },
    },
    run: async (args) => JSON.stringify({ final_answer: String(args.answer ?? "") }),
  },
];

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => t.spec);

export function findTool(name: string): AgentTool | undefined {
  return TOOLS.find((t) => t.spec.name === name);
}

export async function executeTool(
  name: string,
  argsJson: string,
  ctx: ToolContext
): Promise<string> {
  const tool = findTool(name);
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
  let args: Record<string, any> = {};
  try {
    if (argsJson.trim()) args = JSON.parse(argsJson);
  } catch {
    return JSON.stringify({ error: "Invalid JSON arguments" });
  }
  try {
    return await tool.run(args, ctx);
  } catch (e: any) {
    return JSON.stringify({ error: String(e?.message || e) });
  }
}
