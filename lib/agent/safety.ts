/**
 * Prompt-injection basics for task mode.
 *
 * Web pages and uploaded documents are written by other people. Their text is
 * DATA for the agent to read, never instructions to follow. We do two cheap
 * things here; the real protection is the per-step tool allowlist and the
 * approval gates in policy.ts (a poisoned page can't call a tool it isn't given).
 */

const PATTERNS: RegExp[] = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any )?(the )?(previous|prior|above|system) (instructions|prompts?)/i,
  /you are now (a|an|in) /i,
  /new (system )?instructions?:/i,
  /\bsystem prompt\b/i,
  /(call|use|run) the [a-z_]+ tool/i,
  /\b(save_memory|create_note|send_email|write_artifact)\b/i,
  /reveal (your|the) (system|hidden) (prompt|instructions)/i,
];

/** Returns the first suspicious phrase found, or null. */
export function looksLikeInjection(text: string): string | null {
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Wrap tool output so the model can tell data from instructions.
 * Any closing tag inside the data is defused so the text can't "escape".
 */
export function wrapUntrusted(source: string, text: string): string {
  const safe = text.replace(/<\/?untrusted_data/gi, "&lt;untrusted_data");
  return `<untrusted_data source="${source.replace(/"/g, "'")}">\n${safe}\n</untrusted_data>`;
}

/** Pull every http(s) URL out of a tool result, for the "sources" list in the UI. */
export function extractUrls(text: string, max = 8): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>)\]\\]+/g) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;]+$/, "")))].slice(0, max);
}
