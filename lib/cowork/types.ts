export type TaskStatus =
  | "planning"
  | "awaiting_approval"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type StepKind =
  | "research"
  | "read_docs"
  | "analyze"
  | "write"
  | "artifact"
  | "save_to_workspace";

export type StepStatus =
  | "pending"
  | "waiting_approval"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export type ArtifactFormat = "md" | "csv" | "json";

export interface TaskRow {
  id: string;
  user_id: string;
  goal: string;
  title: string;
  status: TaskStatus;
  error: string | null;
  budget_steps: number;
  token_budget: number;
  tokens_used: number;
  lease_until: string | null;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface StepRow {
  id: string;
  task_id: string;
  user_id: string;
  idx: number;
  title: string;
  instruction: string;
  kind: StepKind;
  tools: string[];
  needs_approval: boolean;
  status: StepStatus;
  output: string | null;
  attempts: number;
}

/** One line in a step's live timeline. */
export type StepEvent =
  | { type: "start"; at: number; attempt: number }
  | { type: "tool_call"; at: number; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; at: number; tool: string; preview: string; sources?: string[] }
  | { type: "warning"; at: number; message: string }
  | { type: "partial"; at: number; text: string }
  | { type: "artifact"; at: number; name: string; format: ArtifactFormat }
  | { type: "done"; at: number }
  | { type: "error"; at: number; message: string };

export interface StepRunRow {
  id: string;
  step_id: string;
  attempt: number;
  status: "running" | "done" | "failed";
  events: StepEvent[];
  error: string | null;
  tokens: number;
  started_at: string;
  finished_at: string | null;
}

export interface ArtifactRow {
  id: string;
  task_id: string;
  step_id: string | null;
  name: string;
  format: ArtifactFormat;
  content: string;
  created_at: string;
}

/** A step as the planner (or the user's edit) describes it, before it is saved. */
export interface PlanStepInput {
  title: string;
  instruction: string;
  kind: StepKind;
}
