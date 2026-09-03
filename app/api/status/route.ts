import { NextResponse } from "next/server";
import { resolveLLM, llmConfigured, resolveKeys } from "@/lib/ai/provider";
import { embeddingProviderName } from "@/lib/ai/embeddings";
import { tavilyKeyCount, TOOL_SPECS } from "@/lib/ai/tools";
import { getUser } from "@/lib/supabase/server";

export async function GET() {
  const user = await getUser();
  const cfg = resolveLLM();
  const emb = embeddingProviderName();
  const tavilyKeys = tavilyKeyCount();

  return NextResponse.json({
    authenticated: Boolean(user),
    email: user?.email ?? null,
    supabaseConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("dummy") &&
        !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR-PROJECT") &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("PASTE")
    ),
    llm: {
      provider: cfg.provider,
      model: cfg.model,
      configured: llmConfigured(),
      keys: cfg.provider === "custom" ? 0 : resolveKeys(cfg.provider).length,
    },
    embeddings: emb,
    webSearch: {
      provider: tavilyKeys ? "tavily" : "duckduckgo-fallback",
      keys: tavilyKeys,
    },
    liveData: {
      // Every live source is keyless on its free tier, so this is always on.
      sources: ["open-meteo (weather + local time)", "frankfurter (fx rates)", "coingecko (crypto)"],
      configured: true,
    },
    memory: {
      enabled: true,
      writeBack: "automatic post-turn extraction",
    },
    router: { enabled: true, modes: ["auto", "ask", "agent"] },
    tools: TOOL_SPECS.map((t) => t.name),
    failover: true,
  });
}
