import { describe, it, expect } from "vitest";
import {
  sanitizePlan,
  toolsForKind,
  needsApproval,
  riskOf,
  validateGoal,
  nextAction,
  LIMITS,
} from "@/lib/cowork/policy";
import type { StepRow, TaskRow } from "@/lib/cowork/types";

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: "t1",
  user_id: "u1",
  goal: "g",
  title: "t",
  status: "running",
  error: null,
  budget_steps: 8,
  token_budget: 60000,
  tokens_used: 0,
  lease_until: null,
  cancel_requested: false,
  created_at: "",
  updated_at: "",
  finished_at: null,
  ...over,
});

const step = (idx: number, over: Partial<StepRow> = {}): StepRow => ({
  id: `s${idx}`,
  task_id: "t1",
  user_id: "u1",
  idx,
  title: `step ${idx}`,
  instruction: "",
  kind: "analyze",
  tools: [],
  needs_approval: false,
  status: "pending",
  output: null,
  attempts: 0,
  ...over,
});

describe("sanitizePlan", () => {
  it("keeps valid steps and drops unknown kinds", () => {
    const plan = sanitizePlan({
      steps: [
        { title: "Search", instruction: "find it", kind: "research" },
        { title: "Hack", instruction: "x", kind: "send_email" },
        { title: "", instruction: "no title", kind: "write" },
      ],
    });
    expect(plan).toEqual([{ title: "Search", instruction: "find it", kind: "research" }]);
  });

  it("caps the plan at maxSteps", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `s${i}`, kind: "write" }));
    expect(sanitizePlan(many)?.length).toBe(LIMITS.maxSteps);
  });

  it("returns null when nothing is usable", () => {
    expect(sanitizePlan("nope")).toBeNull();
    expect(sanitizePlan({ steps: [{ kind: "bogus" }] })).toBeNull();
  });

  it("falls back to the title when the instruction is empty", () => {
    expect(sanitizePlan([{ title: "Write brief", kind: "write" }])?.[0].instruction).toBe("Write brief");
  });
});

describe("tool allowlist and approvals", () => {
  it("research gets web tools but no write tools", () => {
    const tools = toolsForKind("research");
    expect(tools).toContain("web_search");
    expect(tools).not.toContain("create_note");
    expect(needsApproval(tools)).toBe(false);
  });

  it("save_to_workspace always needs approval", () => {
    expect(needsApproval(toolsForKind("save_to_workspace"))).toBe(true);
  });

  it("artifact writing is task-local and needs no approval", () => {
    expect(needsApproval(toolsForKind("artifact"))).toBe(false);
  });

  it("unknown tools are treated as external (fail closed)", () => {
    expect(riskOf("send_email")).toBe("external");
    expect(needsApproval(["send_email"])).toBe(true);
  });
});

describe("validateGoal", () => {
  it("rejects empty and too-long goals", () => {
    expect(validateGoal("  ").ok).toBe(false);
    expect(validateGoal("x".repeat(LIMITS.maxGoalChars + 1)).ok).toBe(false);
    expect(validateGoal(" brief on HNSW ")).toEqual({ ok: true, goal: "brief on HNSW" });
  });
});

describe("nextAction (state machine)", () => {
  it("runs the first pending step", () => {
    const r = nextAction(task(), [step(1), step(0, { status: "done" })]);
    expect(r).toMatchObject({ action: "run", step: { idx: 1 } });
  });

  it("stops for approval on a gated step", () => {
    const r = nextAction(task(), [step(0, { status: "done" }), step(1, { needs_approval: true })]);
    expect(r.action).toBe("wait_approval");
  });

  it("finishes when every step is done or skipped", () => {
    expect(nextAction(task(), [step(0, { status: "done" }), step(1, { status: "skipped" })]).action).toBe("finish");
  });

  it("cancel wins over everything", () => {
    expect(nextAction(task({ cancel_requested: true }), [step(0)]).action).toBe("cancel");
  });

  it("fails when the token budget is used up", () => {
    expect(nextAction(task({ tokens_used: 60000 }), [step(0)]).action).toBe("fail");
  });

  it("retries a failed step until the attempt limit, then fails the task", () => {
    expect(nextAction(task(), [step(0, { status: "failed", attempts: 1 })]).action).toBe("run");
    expect(nextAction(task(), [step(0, { status: "failed", attempts: LIMITS.maxAttemptsPerStep })]).action).toBe("fail");
  });

  it("re-runs a step left 'running' by a request that died", () => {
    expect(nextAction(task(), [step(0, { status: "running", attempts: 1 })]).action).toBe("run");
  });

  it("does nothing unless the task is running", () => {
    expect(nextAction(task({ status: "awaiting_approval" }), [step(0)]).action).toBe("idle");
  });
});
