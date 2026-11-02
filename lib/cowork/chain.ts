/**
 * Self-chaining: after a tick finishes a step, start the next tick as a NEW
 * request (its own fresh 60 s). We forward the user's cookie so the next tick
 * runs as the same user, under the same RLS.
 *
 * We don't wait for the answer — just long enough for the request to be sent.
 * If the chain ever breaks (token expired, network blip), the open Tasks page
 * kicks a tick itself, so the task is never stuck for long.
 */
export function fireNextTick(request: Request, taskId: string) {
  const origin = new URL(request.url).origin;
  const cookie = request.headers.get("cookie") ?? "";
  return fetch(`${origin}/api/tasks/${taskId}/tick`, {
    method: "POST",
    headers: { cookie, "x-cortexa-chain": "1" },
    signal: AbortSignal.timeout(2000),
  }).catch(() => {
    // timing out here is expected: the next tick keeps running server-side
  });
}
