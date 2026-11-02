/**
 * The Python sandbox, seen from the agent.
 *
 * Python never touches the real folder. Each run gets a COPY of the files in
 * /work; afterwards we compare before/after (diffFiles) and the agent decides:
 * new files are saved, changes to existing files need the user's approval.
 */
export type FileMap = Record<string, Uint8Array>;

export interface PyResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  result?: string | null;
  error?: string | null;
  files: FileMap;
  timedOut?: boolean;
  heapBytes?: number;
}

export interface PythonSandbox {
  /** Start Python early (downloads packages the first time). */
  warmup(onStatus?: (s: string) => void): Promise<void>;
  run(code: string, files: FileMap, opts?: { timeoutMs?: number; onStatus?: (s: string) => void }): Promise<PyResult>;
  /** Kill a running script now (Stop button). The next run starts a fresh worker. */
  kill(): void;
}

export const DEFAULT_PY_TIMEOUT_MS = 60_000;
/** Above this WebAssembly heap size the worker is recycled after the run. */
export const MAX_HEAP_BYTES = 1_500_000_000;

export interface FileChanges {
  created: string[];
  modified: string[];
  deleted: string[];
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** What did the Python run change? Pure function — unit tested. */
export function diffFiles(before: FileMap, after: FileMap): FileChanges {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [path, bytes] of Object.entries(after)) {
    if (!(path in before)) created.push(path);
    else if (!sameBytes(before[path], bytes)) modified.push(path);
  }
  for (const path of Object.keys(before)) if (!(path in after)) deleted.push(path);
  return { created: created.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

/**
 * Shared worker plumbing for both the browser Worker and the Node worker
 * thread: request ids, timeouts and kill-and-restart.
 */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): unknown;
}

type Pending = { resolve: (r: PyResult) => void; timer?: ReturnType<typeof setTimeout> };

export function makeSandbox(spawn: (onMessage: (msg: any) => void) => WorkerLike): PythonSandbox {
  let worker: WorkerLike | null = null;
  let seq = 0;
  const pending = new Map<number, Pending>();
  const readyWaiters = new Map<number, () => void>();
  let statusCb: ((s: string) => void) | undefined;

  function onMessage(msg: any) {
    if (msg.type === "status") statusCb?.(msg.text);
    else if (msg.type === "ready") readyWaiters.get(msg.id)?.();
    else if (msg.type === "result") {
      const p = pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      p.resolve(msg.res as PyResult);
    }
  }

  function get(): WorkerLike {
    if (!worker) worker = spawn(onMessage);
    return worker;
  }

  function kill() {
    worker?.terminate();
    worker = null;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, stdout: "", stderr: "", error: "Stopped: the Python run was killed.", files: {}, timedOut: false });
      pending.delete(id);
    }
  }

  return {
    warmup(onStatus) {
      statusCb = onStatus ?? statusCb;
      const id = ++seq;
      return new Promise<void>((resolve) => {
        readyWaiters.set(id, () => {
          readyWaiters.delete(id);
          resolve();
        });
        get().postMessage({ type: "warmup", id });
      });
    },

    run(code, files, opts = {}) {
      statusCb = opts.onStatus ?? statusCb;
      const id = ++seq;
      const timeoutMs = opts.timeoutMs ?? DEFAULT_PY_TIMEOUT_MS;
      return new Promise<PyResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          // an endless loop can't be interrupted from inside — kill the worker
          worker?.terminate();
          worker = null;
          resolve({
            ok: false,
            stdout: "",
            stderr: "",
            error: `Timed out after ${Math.round(timeoutMs / 1000)} s — the Python worker was killed. Make the code faster or split the work.`,
            files: {},
            timedOut: true,
          });
        }, timeoutMs);
        pending.set(id, {
          timer,
          resolve: (r) => {
            if ((r.heapBytes ?? 0) > MAX_HEAP_BYTES) kill(); // recycle a bloated worker
            resolve(r);
          },
        });
        get().postMessage({ type: "run", id, code, files });
      });
    },

    kill,
  };
}
