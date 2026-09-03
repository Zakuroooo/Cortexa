import { streamChat, completeOnce, type Msg } from "./provider";
import { AGENT_SYSTEM } from "./prompts";
import { executeTool, TOOL_SPECS, type ToolContext } from "./tools";
import type { TraceStep } from "@/types";
import { truncate } from "@/lib/utils";

export type AgentEvent =
  | { type: "turn" }
  | { type: "delta"; value: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "done"; answer: string; trace: TraceStep[] }
  | { type: "error"; message: string };

const MAX_STEPS = 8;
const MAX_PARALLEL_TOOLS = 3;

function safeParse(jsonStr: string): Record<string, unknown> {
  try {
    return jsonStr ? JSON.parse(jsonStr) : {};
  } catch {
    return {};
  }
}

export async function runAgent(opts: {
  history: Msg[];
  ctx: ToolContext;
  emit: (e: AgentEvent) => void;
}): Promise<{ answer: string; trace: TraceStep[] }> {
  const { ctx, emit } = opts;
  const trace: TraceStep[] = [];
  const messages: Msg[] = [{ role: "system", content: AGENT_SYSTEM }, ...opts.history];

  let answer = "";

  for (let step = 1; step <= MAX_STEPS; step++) {
    emit({ type: "turn" });

    let res;
    try {
      res = await streamChat({
        messages,
        tools: TOOL_SPECS,
        temperature: 0.3,
        maxTokens: 3000,
        onToken: (t) => emit({ type: "delta", value: t }),
      });
    } catch (e: any) {
      const message = String(e?.message || e);
      trace.push({ type: "error", detail: message, at: Date.now() });
      emit({ type: "error", message });
      return { answer, trace };
    }

    if (res.content.trim()) {
      trace.push({
        type: "thinking",
        detail: truncate(res.content.trim(), 600),
        at: Date.now(),
      });
    }

    const finishCall = res.toolCalls.find((tc) => tc.name === "finish");
    if (finishCall) {
      const args = safeParse(finishCall.args);
      answer = String(args.answer ?? res.content ?? "").trim();
      break;
    }

    if (!res.toolCalls.length) {
      answer = res.content.trim();
      break;
    }

    messages.push({
      role: "assistant",
      content: res.content || null,
      tool_calls: res.toolCalls,
    });

    for (const tc of res.toolCalls.slice(0, MAX_PARALLEL_TOOLS)) {
      if (tc.name === "finish") continue;
      const args = safeParse(tc.args);
      emit({ type: "tool_call", tool: tc.name, args });
      trace.push({ type: "tool_call", tool: tc.name, args, at: Date.now() });

      const result = await executeTool(tc.name, tc.args, ctx);
      emit({ type: "tool_result", tool: tc.name, result: truncate(result, 700) });
      trace.push({
        type: "tool_result",
        tool: tc.name,
        detail: truncate(result, 1500),
        at: Date.now(),
      });

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.name,
        content: result,
      });
    }
  }

  if (!answer) {
    try {
      messages.push({
        role: "user",
        content:
          "You have reached the step limit. Based on everything gathered so far, write your final best answer now. Do not call any more tools.",
      });
      answer = await completeOnce(messages, 1200);
    } catch {
      answer =
        "The agent ran out of steps before completing this mission. Try a narrower request.";
    }
  }

  emit({ type: "done", answer, trace });
  return { answer, trace };
}
