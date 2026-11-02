import path from "path";
import { Worker } from "worker_threads";
import { makeSandbox, type PythonSandbox } from "./sandbox";

/** Python in a Node worker thread — same core as the browser. For tests and evals. */
export function createNodeSandbox(): PythonSandbox {
  return makeSandbox((onMessage) => {
    const w = new Worker(path.join(process.cwd(), "lib/agent/node-py-worker.mjs"));
    w.on("message", onMessage);
    return w;
  });
}
