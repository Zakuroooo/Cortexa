/**
 * Rate-limit backoff. Free-tier Groq allows ~8k tokens per minute per key and
 * a task fires calls back to back. On a 429 we wait as long as the provider
 * says ("try again in 2.5s") and try again, instead of failing the step.
 */

/** Most time one step (or one plan) may spend waiting out rate limits. */
export const MAX_BACKOFF_MS = 15_000;

/** How long the provider asked us to wait, or null if this is not a rate limit. */
export function retryAfterMs(message: string): number | null {
  if (!/\b429\b|rate limit/i.test(message)) return null;
  const m = message.match(/try again in ([\d.]+)\s*(ms|s)\b/i);
  if (!m) return 5000;
  const n = Number(m[1]);
  return Math.ceil(m[2].toLowerCase() === "ms" ? n : n * 1000);
}

/**
 * If the error is a rate limit and there is backoff budget left, sleep and
 * return true (= try again). Otherwise return false (= give up, rethrow).
 */
export async function waitOutRateLimit(message: string, budget: { usedMs: number }): Promise<boolean> {
  const wait = retryAfterMs(message);
  if (wait === null || budget.usedMs + wait > MAX_BACKOFF_MS) return false;
  const ms = wait + 300;
  budget.usedMs += ms;
  await new Promise((r) => setTimeout(r, ms));
  return true;
}
