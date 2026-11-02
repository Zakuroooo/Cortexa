// Python sandbox core — shared by the browser Web Worker (pyodide-worker.mjs)
// and the Node worker thread used by tests/evals (lib/agent/sandbox-node.ts).
//
// One run = copy the folder's files into /work, run the code there, capture
// stdout/stderr, then hand back every file in /work. The caller (main thread)
// compares before/after and decides what may be written to the real folder.

export const PYODIDE_VERSION = "314.0.7";

// Built into the Pyodide distribution.
const BUILTIN = ["micropip", "numpy", "pandas", "matplotlib", "lxml"];
// Pure-Python wheels from PyPI, installed with micropip.
const FROM_PYPI = ["openpyxl", "python-pptx", "python-docx", "pypdf"];

const MAX_OUTPUT = 20000;
const WORK = "/work";

/**
 * Network lock. Python in Pyodide can reach the browser's fetch/XHR through
 * the "js" module, so a poisoned file could make the code send data out.
 * The network is open ONLY while Pyodide loads packages, and closed while
 * user code runs. (Same for the Node worker used by evals.)
 */
function makeNetLock() {
  const g = globalThis;
  // bind: the browser's fetch must be called with the worker as `this`
  const real = { fetch: g.fetch.bind(g), XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket, importScripts: g.importScripts?.bind(g) };
  let open = true;
  const blocked = () => {
    throw new Error("Network access is disabled inside the Python sandbox");
  };
  g.fetch = (...a) => (open ? real.fetch(...a) : Promise.reject(new Error("Network access is disabled inside the Python sandbox")));
  if (real.XMLHttpRequest) g.XMLHttpRequest = function () { if (!open) blocked(); return new real.XMLHttpRequest(); };
  if (real.WebSocket) g.WebSocket = function (...a) { if (!open) blocked(); return new real.WebSocket(...a); };
  if (real.importScripts) g.importScripts = (...a) => (open ? real.importScripts(...a) : blocked());
  return { allow: () => (open = true), deny: () => (open = false) };
}

export function createRunner(loadPyodide, options = {}) {
  let py = null;
  let ready = null;
  const net = makeNetLock();

  function ensureReady(onStatus) {
    if (!ready) {
      ready = (async () => {
        onStatus?.("Starting Python (first time downloads ~30 MB, then cached)…");
        py = await loadPyodide(options);
        onStatus?.("Loading pandas, matplotlib, openpyxl, python-pptx, python-docx…");
        await py.loadPackage(BUILTIN, { messageCallback: () => {} });
        const micropip = py.pyimport("micropip");
        await micropip.install(FROM_PYPI);
        // headless charts; no network from Python
        await py.runPythonAsync(`
import os, matplotlib
os.environ["MPLBACKEND"] = "Agg"
matplotlib.use("Agg")
`);
        // Extra layer: user code can't `import js` (the bridge to the worker's
        // globals). The real network barrier is the worker's CSP (next.config.ts).
        await py.runPythonAsync(`
import sys
class _BlockJs:
    def find_spec(self, name, path=None, target=None):
        if name == "js" or name.startswith("js."):
            raise ImportError("The js module is disabled in the Cowork sandbox")
        return None
sys.modules.pop("js", None)
sys.meta_path.insert(0, _BlockJs())
`);
        net.deny();
        onStatus?.("Python ready");
      })();
    }
    return ready;
  }

  function rmTree(path) {
    const FS = py.FS;
    for (const name of FS.readdir(path)) {
      if (name === "." || name === "..") continue;
      const p = `${path}/${name}`;
      if (FS.isDir(FS.stat(p).mode)) {
        rmTree(p);
        FS.rmdir(p);
      } else FS.unlink(p);
    }
  }

  function listTree(path, prefix, out) {
    const FS = py.FS;
    for (const name of FS.readdir(path)) {
      if (name === "." || name === ".." || name === "__pycache__") continue;
      const p = `${path}/${name}`;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (FS.isDir(FS.stat(p).mode)) listTree(p, rel, out);
      else out[rel] = FS.readFile(p);
    }
    return out;
  }

  /** files: { "relative/path.csv": Uint8Array } */
  async function run(code, files, onStatus) {
    await ensureReady(onStatus);
    const FS = py.FS;
    FS.mkdirTree(WORK);
    rmTree(WORK);
    for (const [rel, bytes] of Object.entries(files)) {
      const full = `${WORK}/${rel}`;
      FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
      FS.writeFile(full, bytes);
    }
    py.runPython(`import os; os.chdir("${WORK}")`);

    let stdout = "";
    let stderr = "";
    py.setStdout({ batched: (s) => (stdout.length < MAX_OUTPUT ? (stdout += s + "\n") : null) });
    py.setStderr({ batched: (s) => (stderr.length < MAX_OUTPUT ? (stderr += s + "\n") : null) });

    let error = null;
    let result = null;
    try {
      // Fetch any other package from Pyodide's own list that the code imports
      // (e.g. scipy). Network is open only for this, then closed again.
      net.allow();
      try {
        await py.loadPackagesFromImports(code, { messageCallback: () => {} });
      } finally {
        net.deny();
      }
      const value = await py.runPythonAsync(code);
      if (value !== undefined && value !== null) result = String(value).slice(0, 4000);
      value?.destroy?.();
    } catch (e) {
      // keep the useful end of the traceback
      error = String(e?.message || e).split("\n").slice(-25).join("\n").slice(-4000);
    }
    // close figures so memory doesn't grow across runs
    try {
      py.runPython(`import matplotlib.pyplot as _plt; _plt.close("all")`);
    } catch {}

    return {
      ok: !error,
      stdout: stdout.slice(0, MAX_OUTPUT),
      stderr: stderr.slice(0, MAX_OUTPUT),
      result,
      error,
      files: listTree(WORK, "", {}),
      heapBytes: py._module?.HEAP8?.length ?? 0,
    };
  }

  return { ensureReady, run };
}
