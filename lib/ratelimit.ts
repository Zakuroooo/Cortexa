/**
 * Rate limiting for the public deployment.
 *
 * Every chat turn costs real LLM quota, so an open URL without limits is an
 * open tap on someone's free tier. Counters live in Postgres rather than in
 * memory because serverless instances don't share state — an in-memory limiter
 * would reset on every cold start and let a determined caller straight through.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type LimitAction = "chat" | "ingest";

export interface LimitResult {
  allowed: boolean;
  used: number;
  remaining: number;
  resetSeconds: number;
  limit: number;
}

interface Rule {
  limit: number;
  windowSeconds: number;
}

/**
 * Generous enough that a recruiter can explore the whole app without hitting a
 * wall, tight enough that nobody can drain the quota.
 */
const RULES: Record<LimitAction, Rule> = {
  chat: { limit: 30, windowSeconds: 60 * 60 },
  ingest: { limit: 10, windowSeconds: 60 * 60 },
};

/**
 * A second, wider ceiling per account.
 *
 * The public demo is one shared login, so keying only on the user id would put
 * every visitor in the same bucket — the first person to arrive would lock out
 * everyone else. Keying only on IP would leave total spend unbounded. So both:
 * each visitor gets their own allowance, and the account as a whole is capped.
 */
const GLOBAL_RULES: Record<LimitAction, Rule> = {
  chat: { limit: 300, windowSeconds: 60 * 60 },
  ingest: { limit: 60, windowSeconds: 60 * 60 },
};

/** Disable locally so development isn't throttled. */
function enabled(): boolean {
  if (process.env.RATE_LIMIT_DISABLED === "true") return false;
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

/**
 * Trust only the leftmost entry of x-forwarded-for, which is the client as seen
 * by Vercel's edge. Anything further right is caller-controlled and forgeable.
 */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function runCheck(
  supabase: SupabaseClient,
  subject: string,
  action: LimitAction,
  rule: Rule
): Promise<LimitResult> {
  const pass: LimitResult = {
    allowed: true,
    used: 0,
    remaining: rule.limit,
    resetSeconds: 0,
    limit: rule.limit,
  };

  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_subject: subject,
      p_action: action,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error || !data?.length) {
      // Fail OPEN: a limiter outage must not take the whole app down. The
      // trade-off is deliberate — brief over-permissiveness beats a hard outage
      // for a portfolio deployment.
      return pass;
    }
    const row = data[0];
    return {
      allowed: Boolean(row.allowed),
      used: Number(row.used),
      remaining: Number(row.remaining),
      resetSeconds: Number(row.reset_seconds),
      limit: rule.limit,
    };
  } catch {
    return pass;
  }
}

/**
 * Per-visitor first, then the account-wide ceiling. Whichever trips first wins.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  action: LimitAction,
  request?: Request
): Promise<LimitResult> {
  const rule = RULES[action];
  if (!enabled())
    return { allowed: true, used: 0, remaining: rule.limit, resetSeconds: 0, limit: rule.limit };

  const ip = request ? clientIp(request) : "unknown";
  const perVisitor = await runCheck(
    supabase,
    `${userId}:${ip}`,
    action,
    rule
  );
  if (!perVisitor.allowed) return perVisitor;

  const global = await runCheck(
    supabase,
    `acct:${userId}`,
    action,
    GLOBAL_RULES[action]
  );
  if (!global.allowed) return global;

  return perVisitor;
}

export function limitHeaders(r: LimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(Math.max(0, r.remaining)),
  };
  if (!r.allowed) h["Retry-After"] = String(r.resetSeconds);
  return h;
}

export function friendlyWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
