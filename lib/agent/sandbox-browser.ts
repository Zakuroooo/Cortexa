"use client";

import { makeSandbox, type PythonSandbox } from "./sandbox";

/** Python in a Web Worker (public/cowork/pyodide-worker.mjs). */
export function createBrowserSandbox(): PythonSandbox {
  return makeSandbox((onMessage) => {
    const w = new Worker("/cowork/pyodide-worker.mjs", { type: "module" });
    w.onmessage = (e) => onMessage(e.data);
    w.onerror = (e) => onMessage({ type: "status", text: `Python worker error: ${e.message}` });
    return w;
  });
}
