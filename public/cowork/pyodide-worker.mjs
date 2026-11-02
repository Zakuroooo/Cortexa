// Browser Web Worker: runs Python (Pyodide) off the main thread so the page
// never freezes. The page kills this worker on timeout or Stop.
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";
import { createRunner } from "./pyrunner-core.mjs";

const runner = createRunner(loadPyodide);
const status = (text) => self.postMessage({ type: "status", text });

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "warmup") {
      await runner.ensureReady(status);
      self.postMessage({ type: "ready", id: msg.id });
    } else if (msg.type === "run") {
      const res = await runner.run(msg.code, msg.files, status);
      // transfer file buffers instead of copying them
      const transfer = [...new Set(Object.values(res.files).map((b) => b.buffer))];
      self.postMessage({ type: "result", id: msg.id, res }, transfer);
    }
  } catch (err) {
    self.postMessage({ type: "result", id: msg.id, res: { ok: false, error: String(err?.message || err), stdout: "", stderr: "", files: {} } });
  }
};
