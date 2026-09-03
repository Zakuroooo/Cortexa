import { createClient } from "@/lib/supabase/server";
import { streamChat, type Msg } from "@/lib/ai/provider";
import {
  RAG_SYSTEM,
  DIRECT_SYSTEM,
  MEMORY_SYSTEM,
  ragUserPrompt,
  directPrompt,
  memoryPrompt,
} from "@/lib/ai/prompts";
import { retrieveContext } from "@/lib/ai/rag";
import { runAgent } from "@/lib/ai/agent";
import { routeQuery, routeNeedsDocuments, routeNeedsMemory } from "@/lib/ai/router";
import {
  recallMemories,
  formatMemoryBlock,
  markMemoriesUsed,
  extractAndSaveMemories,
} from "@/lib/ai/memory";
import type {
  Citation,
  TraceStep,
  ChatMode,
  RecalledMemory,
  RouteDecision,
} from "@/types";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
// Vercel's Hobby plan caps function duration at 60s. Raise this (up to 300)
// on Pro, or when Fluid compute is enabled. Long agent missions that exceed the
// cap are cut off mid-stream — the ≤8-step limit keeps most turns well under it.
export const maxDuration = 60;

function parseMode(v: unknown): ChatMode {
  return v === "agent" || v === "ask" ? v : "auto";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const chatId: string = body.chatId;
  const message: string = String(body.message ?? "").trim();
  const mode: ChatMode = parseMode(body.mode);

  if (!chatId || !message)
    return Response.json(
      { error: "chatId and message are required" },
      { status: 400 }
    );

  const { data: chat } = await supabase
    .from("chats")
    .select("*")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat)
    return Response.json({ error: "Chat not found" }, { status: 404 });

  await supabase.from("messages").insert({
    chat_id: chatId,
    user_id: user.id,
    role: "user",
    content: message,
  });

  const { data: priorRows } = await supabase
    .from("messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const priorMsgs: Msg[] = (priorRows ?? [])
    .slice(-16)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  if ((chat.title === "New chat" || !chat.title) && message) {
    await supabase
      .from("chats")
      .update({ title: truncate(message, 48) })
      .eq("id", chatId);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {}
        }
      }, 15000);

      let answer = "";
      let citations: Citation[] = [];
      const trace: TraceStep[] = [];
      let recalled: RecalledMemory[] = [];

      try {
        // ---- 1. ROUTE -----------------------------------------------------
        // In "auto" the LLM decides what this question actually needs. The
        // explicit ask/agent modes stay available as a manual override.
        let decision: RouteDecision;
        if (mode === "auto") {
          decision = await routeQuery(message, priorMsgs.slice(0, -1));
        } else if (mode === "agent") {
          decision = {
            route: "agent",
            searchQuery: message,
            reason: "agent mode selected",
            source: "heuristic",
          };
        } else {
          decision = {
            route: "documents",
            searchQuery: message,
            reason: "ask mode selected",
            source: "heuristic",
          };
        }

        send({ type: "route", ...decision });
        trace.push({
          type: "route",
          label: decision.route,
          detail: decision.reason,
          at: Date.now(),
        });

        // ---- 2. RECALL MEMORY --------------------------------------------
        // Non-agent routes get memory injected up front; the agent pulls it
        // itself via recall_memory when it decides it needs it.
        if (decision.route !== "agent" && routeNeedsMemory(decision.route)) {
          recalled = await recallMemories(
            supabase,
            decision.searchQuery || message,
            6
          );
          if (recalled.length) {
            send({
              type: "memory_recall",
              count: recalled.length,
              items: recalled.map((m) => ({ kind: m.kind, content: m.content })),
            });
            trace.push({
              type: "memory",
              label: "recalled",
              detail: `${recalled.length} memor${recalled.length === 1 ? "y" : "ies"} used`,
              at: Date.now(),
            });
            await markMemoriesUsed(supabase, recalled);
          }
        }
        const memoryBlock = formatMemoryBlock(recalled);

        // ---- 3. ANSWER ----------------------------------------------------
        if (decision.route === "agent") {
          const result = await runAgent({
            history: priorMsgs,
            ctx: { userId: user.id, supabase, chatId },
            emit: (e) => send(e),
          });
          answer = result.answer;
          trace.push(...result.trace);
        } else {
          let system = DIRECT_SYSTEM;
          let userContent = directPrompt(memoryBlock, message);
          let emptyLibrary = false;

          if (routeNeedsDocuments(decision.route)) {
            const retrieved = await retrieveContext(
              supabase,
              decision.searchQuery || message
            );
            citations = retrieved.citations;
            emptyLibrary = retrieved.mode === "empty";
            send({ type: "citations", citations });
            send({
              type: "retrieval",
              mode: retrieved.mode,
              count: citations.length,
            });
            system = RAG_SYSTEM;
            userContent = ragUserPrompt(
              message,
              retrieved.contextBlock || null,
              retrieved.mode,
              memoryBlock
            );
          } else if (decision.route === "memory") {
            system = MEMORY_SYSTEM;
            userContent = memoryPrompt(memoryBlock, message);
          }

          let streamed = "";
          const res = await streamChat({
            messages: [
              { role: "system", content: system },
              ...priorMsgs.slice(0, -1),
              { role: "user", content: userContent },
            ],
            temperature: 0.3,
            maxTokens: 2600,
            onToken: (t) => {
              streamed += t;
              send({ type: "delta", value: t });
            },
          });
          answer = (streamed || res.content).trim();
          if (emptyLibrary && answer) {
            answer = `**Your library doesn't have anything on this yet.**\n\n${answer}`;
          }
          send({ type: "done", answer, trace });
        }
      } catch (e: any) {
        send({ type: "error", message: String(e?.message || e) });
      }

      // ---- 4. WRITE BACK TO MEMORY ----------------------------------------
      // The loop-back arrow: what did this turn teach us about the user?
      // Best-effort — a failure here never affects the answer they just got.
      if (answer) {
        try {
          const saved = await extractAndSaveMemories({
            supabase,
            userId: user.id,
            chatId,
            userMessage: message,
            assistantMessage: answer,
            existing: recalled,
          });
          const kept = saved.filter(
            (s) => s.status === "created" || s.status === "merged"
          );
          if (kept.length) {
            const items = kept.map((s) => ({
              status: s.status,
              content: "content" in s ? s.content : "",
            }));
            send({ type: "memory_saved", items });
            trace.push({
              type: "memory",
              label: "saved",
              detail: items.map((i) => `${i.status}: ${i.content}`).join(" · "),
              at: Date.now(),
            });
          }
        } catch {}
      }

      try {
        if (answer) {
          await supabase.from("messages").insert({
            chat_id: chatId,
            user_id: user.id,
            role: "assistant",
            content: answer,
            citations,
            trace,
          });
        }
      } catch {}

      send({ type: "end" });
      clearInterval(heartbeat);
      closed = true;
      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
