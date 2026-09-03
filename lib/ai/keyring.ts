const COOLDOWN_MS = 60_000;

const failureCounts = new Map<string, number>();
const cooldownUntil = new Map<string, number>();

export function parseKeyList(...values: Array<string | undefined>): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const raw of value.split(/[,\s]+/)) {
      const key = raw.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(key);
    }
  }
  return merged;
}

function health(key: string): number {
  return failureCounts.get(key) ?? 0;
}

export function pickKey(keys: string[]): string | null {
  if (!keys.length) return null;
  const now = Date.now();
  const live = keys.filter((k) => (cooldownUntil.get(k) ?? 0) <= now);
  const pool = live.length ? live : keys;
  return pool.reduce((best, k) => (health(k) < health(best) ? k : best));
}

export function reportFailure(key: string) {
  failureCounts.set(key, health(key) + 1);
  cooldownUntil.set(key, Date.now() + COOLDOWN_MS);
}

export function reportSuccess(key: string) {
  failureCounts.set(key, 0);
  cooldownUntil.delete(key);
}

export function isRetryableStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

export class RotatableError extends Error {
  retriable: boolean;
  status?: number;
  constructor(message: string, opts?: { retriable?: boolean; status?: number }) {
    super(message);
    this.name = "RotatableError";
    this.retriable = opts?.retriable ?? false;
    this.status = opts?.status;
  }
}

export async function runWithKeys<T>(
  keys: string[],
  attempt: (key: string) => Promise<T>
): Promise<T> {
  if (!keys.length) {
    throw new RotatableError("No API keys configured for this service.");
  }
  let lastError: unknown;

  const order: string[] = [];
  const remaining = [...keys];
  while (remaining.length) {
    const best = pickKey(remaining)!;
    order.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }

  for (const key of order) {
    try {
      const result = await attempt(key);
      reportSuccess(key);
      return result;
    } catch (e: unknown) {
      lastError = e;
      const rotatable = e instanceof RotatableError && e.retriable;
      reportFailure(key);
      if (!rotatable) throw e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new RotatableError(String(lastError), { retriable: true });
}
