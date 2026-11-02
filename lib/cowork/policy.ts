/**
 * The rules of task mode, in one place, as pure functions.
 *
 * The LLM only proposes a plan (titles, instructions, kinds). Everything that
 * decides what the agent is ALLOWED to do — which tools a step gets, whether it
 * must wait for the user, how big the plan may be — is decided here, by code.
 */
import type { PlanStepInput, StepKind, StepRow, TaskRow } from "./types";

export const LIMITS = {
  maxSteps: 8,
  maxToolCallsPerStep: 4,
  maxAttemptsPerStep: 3,
  maxGoalChars: 2000,
  maxInstructionChars: 800,
  defaultTokenBudget: 60000,
} as const;

export const STEP_KINDS: StepKind[] = [
  "research",
  "read_docs",
  "analyze",
  "write",
  "artifact",
  "save_to_workspace",
];

/** How dangerous a tool is. Anything above task_write needs a human yes. */
export type RiskClass = "read" | "task_write" | "workspace_write" | "external";

export const TOOL_RISK: Record<string, RiskClass> = {
  web_search: "read",
  fetch_url: "read",
  get_current_time: "read",
  get_exchange_rate: "read",
  get_crypto_price: "read",
  get_weather: "read",
  list_documents: "read",
  read_document: "read",
  search_knowledge_base: "read",
  list_notes: "read",
  read_note: "read",
  recall_memory: "read",
  write_artifact: "task_write",
  create_note: "workspace_write",
  save_memory: "workspace_write",
};

/** The allowlist: a step only ever sees the tools for its kind. */
const KIND_TOOLS: Record<StepKind, string[]> = {
  research: [
    "web_search",
    "fetch_url",
    "get_current_time",
    "get_exchange_rate",
    "get_crypto_price",
    "get_weather",
  ],
  read_docs: [
    "list_documents",
    "read_document",
    "search_knowledge_base",
    "list_notes",
    "read_note",
    "recall_memory",
  ],
  analyze: [],
  write: [],
  artifact: ["write_artifact"],
  save_to_workspace: ["create_note"],
};

export function toolsForKind(kind: StepKind): string[] {
  return [...KIND_TOOLS[kind]];
}

/** Unknown tools count as external — fail closed, not open. */
export function riskOf(tool: string): RiskClass {
  return TOOL_RISK[tool] ?? "external";
}

export function needsApproval(tools: string[]): boolean {
  return tools.some((t) => {
    const r = riskOf(t);
    return r === "workspace_write" || r === "external";
  });
}

function isKind(v: unknown): v is StepKind {
  return typeof v === "string" && (STEP_KINDS as string[]).includes(v);
}

function clean(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Turn whatever the planner (or the plan editor) sent into a safe plan:
 * known kinds only, non-empty titles, at most maxSteps steps.
 * Returns null when nothing usable is left.
 */
export function sanitizePlan(raw: unknown): PlanStepInput[] | null {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.steps)
      ? (raw as any).steps
      : null;
  if (!list) return null;

  const steps: PlanStepInput[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const title = clean((item as any).title, 120);
    const instruction = clean((item as any).instruction, LIMITS.maxInstructionChars);
    const kind = (item as any).kind;
    if (!title || !isKind(kind)) continue;
    steps.push({ title, instruction: instruction || title, kind });
    if (steps.length === LIMITS.maxSteps) break;
  }
  return steps.length ? steps : null;
}

/** Validate the goal text before we spend any LLM quota on it. */
export function validateGoal(goal: unknown): { ok: true; goal: string } | { ok: false; error: string } {
  const g = String(goal ?? "").trim();
  if (!g) return { ok: false, error: "Goal is required" };
  if (g.length > LIMITS.maxGoalChars)
    return { ok: false, error: `Goal is too long (max ${LIMITS.maxGoalChars} characters)` };
  return { ok: true, goal: g };
}

/** Rough token count — good enough for a budget, no tokenizer needed. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * What should the runner do next? Pure: looks only at the task and its steps.
 * The tick route calls this, then acts on the answer.
 */
export type NextAction =
  | { action: "cancel" }
  | { action: "finish" }
  | { action: "fail"; reason: string }
  | { action: "wait_approval"; step: StepRow }
  | { action: "run"; step: StepRow }
  | { action: "idle"; reason: string };

export function nextAction(task: TaskRow, steps: StepRow[]): NextAction {
  if (task.cancel_requested) return { action: "cancel" };
  if (task.status !== "running")
    return { action: "idle", reason: `task is ${task.status}` };
  if (task.tokens_used >= task.token_budget)
    return { action: "fail", reason: "Token budget used up" };

  const ordered = [...steps].sort((a, b) => a.idx - b.idx);
  const failed = ordered.find(
    (s) => s.status === "failed" && s.attempts >= LIMITS.maxAttemptsPerStep
  );
  if (failed) return { action: "fail", reason: `Step "${failed.title}" failed ${failed.attempts} times` };

  // A "running" step here means an earlier tick died mid-step (its lease ran
  // out). Treat it like a failed attempt and run it again.
  const next = ordered.find(
    (s) => s.status === "pending" || s.status === "running" || s.status === "failed" || s.status === "waiting_approval"
  );
  if (!next) return { action: "finish" };
  if (next.status === "waiting_approval") return { action: "wait_approval", step: next };
  if (next.status === "pending" && next.needs_approval)
    return { action: "wait_approval", step: next };
  return { action: "run", step: next };
}

/** Which statuses are final — the runner never touches these again. */
export function isFinal(status: TaskRow["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
