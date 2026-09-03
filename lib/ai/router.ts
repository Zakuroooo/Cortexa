/**
 * The agentic front door.
 *
 * Plain RAG always retrieves from the same place. Here an LLM inspects the
 * question first and decides *whether* to retrieve, *from where*, and with
 * *what* query — including deciding that no retrieval is needed at all, or
 * that the question needs the full multi-step tool loop.
 */
import { completeOnce, type Msg } from "./provider";
import { truncate } from "@/lib/utils";
import type { Route, RouteDecision } from "@/types";

const ROUTES: Route[] = ["direct", "documents", "memory", "hybrid", "agent"];

const ROUTER_SYSTEM = `You are the router for Cortexa, a personal knowledge assistant.
Pick exactly ONE route for the user's latest message and return ONLY JSON:

{"route": "...", "search_query": "...", "reason": "..."}

Routes:
- "direct"    — answerable with general knowledge or plain reasoning. Greetings,
                small talk, definitions, "rewrite this", math, opinions on text
                already in the conversation. NO retrieval.
- "documents" — needs the user's uploaded library (they say "my notes/docs/PDF/
                library/the paper I uploaded", or ask about specific material
                they'd plausibly have stored).
- "memory"    — about the USER themselves or past sessions: "what do you know
                about me", "what am I working on", "what did I tell you",
                "remember that ...", their goals/preferences/deadlines.
- "hybrid"    — needs BOTH their documents and what you remember about them
                (e.g. "based on my syllabus, what should I revise this week?").
- "agent"     — needs multiple steps or external tools: current/live facts
                (weather, prices, exchange rates, news, anything after your
                training cutoff), fetching a URL, web search, comparing sources,
                or producing a saved artefact (note, summary, quiz).

Rules:
- Prefer "direct" for chit-chat. Do NOT retrieve for "hi" or "thanks".
- Anything time-sensitive, or that names a URL, or asks you to save/create a
  note or quiz, is "agent".
- "search_query" is the retrieval query you'd actually run: resolve pronouns
  from the conversation, strip filler, keep the meaningful terms. For "direct"
  return "".
- "reason" is at most 12 words, shown to the user.
Return the JSON object and nothing else.`;

function heuristicRoute(message: string): RouteDecision {
  const m = message.toLowerCase().trim();

  if (/^(hi|hello|hey|yo|thanks|thank you|ok|okay|cool|nice|bye|good (morning|night))\b/.test(m) || m.length < 4)
    return { route: "direct", searchQuery: "", reason: "greeting — no retrieval needed", source: "heuristic" };

  if (/\bhttps?:\/\//.test(m) || /\b(latest|today|right now|current|currently|live|price|weather|forecast|news|exchange rate|stock|score)\b/.test(m))
    return { route: "agent", searchQuery: message, reason: "needs live external data", source: "heuristic" };

  if (/\b(remember|remind me|what do you know about me|about myself|my goal|i told you|my preference)\b/.test(m))
    return { route: "memory", searchQuery: message, reason: "asks about remembered context", source: "heuristic" };

  if (/\b(quiz|make a note|save a note|create a note|summari[sz]e .*(and|then) save)\b/.test(m))
    return { route: "agent", searchQuery: message, reason: "needs to create an artefact", source: "heuristic" };

  return { route: "documents", searchQuery: message, reason: "default: search the library", source: "heuristic" };
}

function parseDecision(raw: string): RouteDecision | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const route = String(parsed.route ?? "").toLowerCase() as Route;
  if (!ROUTES.includes(route)) return null;
  return {
    route,
    searchQuery: truncate(String(parsed.search_query ?? "").trim(), 300),
    reason: truncate(String(parsed.reason ?? "").trim(), 120) || "routed",
    source: "llm",
  };
}

export async function routeQuery(
  message: string,
  history: Msg[] = []
): Promise<RouteDecision> {
  const recent = history
    .slice(-4)
    .map((m) =>
      m.role === "user" || m.role === "assistant"
        ? `${m.role.toUpperCase()}: ${truncate(String(m.content ?? ""), 300)}`
        : ""
    )
    .filter(Boolean)
    .join("\n");

  const messages: Msg[] = [
    { role: "system", content: ROUTER_SYSTEM },
    {
      role: "user",
      content:
        (recent ? `Recent conversation:\n${recent}\n\n` : "") +
        `Latest user message: ${truncate(message, 1000)}\n\nJSON:`,
    },
  ];

  try {
    const decision = parseDecision(await completeOnce(messages, 160));
    if (decision) {
      // A retrieval route with an empty query is unusable — fall back to the
      // raw message rather than searching for "".
      if (decision.route !== "direct" && !decision.searchQuery)
        decision.searchQuery = message;
      return decision;
    }
  } catch {
    // Router failure must degrade, not break the turn.
  }
  return heuristicRoute(message);
}

export function routeNeedsDocuments(route: Route): boolean {
  return route === "documents" || route === "hybrid";
}

export function routeNeedsMemory(route: Route): boolean {
  return route === "memory" || route === "hybrid" || route === "documents";
}
