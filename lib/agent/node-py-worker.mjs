// Node worker thread with the same Python core as the browser worker.
// Used by tests and the eval harness so they run the exact sandbox code.
import { parentPort } from "node:worker_threads";
import { createRequire } from "node:module";
import path from "node:path";
import { loadPyodide } from "pyodide";
import { createRunner } from "../../public/cowork/pyrunner-core.mjs";

// Pyodide writes its own load messages to stdout; in a worker thread that stream is not a TTY.
// indexURL is explicit: under tsx's loader Pyodide can't work out where its own files are.
const indexURL = path.dirname(createRequire(import.meta.url).resolve("pyodide/package.json")) + "/";
const runner = createRunner(loadPyodide, { indexURL, stdout: () => {}, stderr: () => {} });

parentPort.on("message", async (msg) => {
  try {
    if (msg.type === "warmup") {
      await runner.ensureReady();
      parentPort.postMessage({ type: "ready", id: msg.id });
    } else if (msg.type === "run") {
      const res = await runner.run(msg.code, msg.files);
      parentPort.postMessage({ type: "result", id: msg.id, res });
    }
  } catch (err) {
    parentPort.postMessage({ type: "result", id: msg.id, res: { ok: false, error: String(err?.message || err), stdout: "", stderr: "", files: {} } });
  }
});
