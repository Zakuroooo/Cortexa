/**
 * Tools that exist only in task mode, plus the lookup that builds a step's
 * allowlisted tool set from the chat agent's tools + these.
 */
import type { ToolSpec } from "@/lib/ai/provider";
import { findTool, type ToolContext } from "@/lib/ai/tools";
import { normaliseCsv } from "./csv";
import type { ArtifactFormat } from "./types";
import { truncate } from "@/lib/utils";

export interface TaskToolContext extends ToolContext {
  taskId: string;
  stepId: string;
  /** called when write_artifact saves a file, so the runner can log it */
  onArtifact?: (name: string, format: ArtifactFormat) => void;
}

interface TaskTool {
  spec: ToolSpec;
  run(args: Record<string, any>, ctx: TaskToolContext): Promise<string>;
}

const MAX_DOC_CHARS = 12000;
const FORMATS: ArtifactFormat[] = ["md", "csv", "json"];

export const TASK_TOOLS: TaskTool[] = [
  {
    spec: {
      name: "list_documents",
      description: "List the user's uploaded documents (id, title, type). Use before read_document.",
      parameters: { type: "object", properties: {} },
    },
    run: async (_args, ctx) => {
      const { data, error } = await ctx.supabase
        .from("documents")
        .select("id, title, source_type, char_count")
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({ documents: data ?? [] });
    },
  },
  {
    spec: {
      name: "read_document",
      description: `Read the full text of one uploaded document by id (first ${MAX_DOC_CHARS} characters). Use to compare or summarise whole documents.`,
      parameters: {
        type: "object",
        properties: { document_id: { type: "string", description: "id from list_documents" } },
        required: ["document_id"],
      },
    },
    run: async (args, ctx) => {
      const id = String(args.document_id ?? "");
      const { data: doc } = await ctx.supabase
        .from("documents")
        .select("id, title")
        .eq("id", id)
        .maybeSingle();
      if (!doc) return JSON.stringify({ error: "Document not found" });
      // Chunks overlap a little; joining them in order is close enough to the original.
      const { data: chunks, error } = await ctx.supabase
        .from("chunks")
        .select("idx, content")
        .eq("document_id", id)
        .order("idx", { ascending: true })
        .limit(40);
      if (error) return JSON.stringify({ error: error.message });
      const text = (chunks ?? []).map((c: any) => c.content).join("\n");
      return JSON.stringify({ title: doc.title, text: truncate(text, MAX_DOC_CHARS) });
    },
  },
  {
    spec: {
      name: "write_artifact",
      description:
        "Save a deliverable file for this task. format 'md' for reports/briefs (markdown), 'csv' for tables (first row = header), 'json' for structured data. Put the COMPLETE content in 'content'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "file name without extension, e.g. 'risk-table'" },
          format: { type: "string", enum: FORMATS },
          content: { type: "string", description: "the full file content" },
        },
        required: ["name", "format", "content"],
      },
    },
    run: async (args, ctx) => {
      const format = String(args.format ?? "md") as ArtifactFormat;
      if (!FORMATS.includes(format)) return JSON.stringify({ error: "format must be md, csv or json" });
      const name =
        String(args.name ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || "output";
      let content = String(args.content ?? "").trim();
      if (!content) return JSON.stringify({ error: "content is empty" });
      if (format === "csv") content = normaliseCsv(content);
      if (format === "json") {
        try {
          content = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          return JSON.stringify({ error: "content is not valid JSON" });
        }
      }
      const { count } = await ctx.supabase
        .from("task_artifacts")
        .select("id", { count: "exact", head: true })
        .eq("task_id", ctx.taskId);
      if ((count ?? 0) >= 10) return JSON.stringify({ error: "This task already has 10 artifacts" });

      const { error } = await ctx.supabase.from("task_artifacts").insert({
        task_id: ctx.taskId,
        step_id: ctx.stepId,
        user_id: ctx.userId,
        name,
        format,
        content: content.slice(0, 900_000),
      });
      if (error) return JSON.stringify({ error: error.message });
      ctx.onArtifact?.(name, format);
      return JSON.stringify({ saved: true, file: `${name}.${format}`, chars: content.length });
    },
  },
];

/** Specs for exactly the allowlisted tools, in a stable order. */
export function specsFor(toolNames: string[]): ToolSpec[] {
  const specs: ToolSpec[] = [];
  for (const name of toolNames) {
    const own = TASK_TOOLS.find((t) => t.spec.name === name);
    const shared = findTool(name);
    if (own) specs.push(own.spec);
    else if (shared) specs.push(shared.spec);
  }
  return specs;
}

/**
 * Run a tool — but only if it is on this step's allowlist. A model that
 * hallucinates (or is tricked into) another tool name gets an error, not access.
 */
export async function runAllowedTool(
  name: string,
  argsJson: string,
  allowed: string[],
  ctx: TaskToolContext
): Promise<string> {
  if (!allowed.includes(name))
    return JSON.stringify({ error: `Tool "${name}" is not allowed in this step.` });
  let args: Record<string, any> = {};
  try {
    if (argsJson.trim()) args = JSON.parse(argsJson);
  } catch {
    return JSON.stringify({ error: "Invalid JSON arguments" });
  }
  try {
    const own = TASK_TOOLS.find((t) => t.spec.name === name);
    if (own) return await own.run(args, ctx);
    const shared = findTool(name);
    if (shared) return await shared.run(args, ctx);
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (e: any) {
    return JSON.stringify({ error: String(e?.message || e) });
  }
}
