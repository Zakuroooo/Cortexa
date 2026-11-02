/** Shared types for the Cowork agent (browser + server + evals). */

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** JSON string, as the model sent it */
  args: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export interface LlmReply {
  content: string;
  toolCalls: ToolCall[];
  /** total tokens the provider counted for this call */
  tokens: number;
  model: string;
}

export interface Todo {
  id: number;
  text: string;
  status: "todo" | "doing" | "done" | "failed";
}

/** One line in the task timeline. Saved to history as-is. */
export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "thought"; text: string }
  | { type: "todos"; todos: Todo[] }
  | { type: "tool_call"; id: string; tool: string; args: Record<string, unknown> }
  | {
      type: "tool_result";
      id: string;
      tool: string;
      ok: boolean;
      summary: string;
      /** Python: stdout/error; files: changes; web: sources */
      detail?: string;
      code?: string;
      sources?: string[];
      files?: string[];
    }
  | { type: "warning"; text: string }
  | { type: "approval"; id: string; question: string; decision: "approved" | "denied" | "pending" }
  | { type: "ask_user"; id: string; question: string; answer?: string }
  | { type: "verify"; passed: boolean; text: string }
  | { type: "subagent"; index: number; question: string; text: string }
  | { type: "done"; summary: string; outputs: string[] }
  | { type: "error"; text: string };

export type TaskStatus = "running" | "succeeded" | "failed" | "stopped";
