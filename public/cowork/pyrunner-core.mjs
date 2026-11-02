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

export function createRunner(loadPyodide, options = {}) {
  let py = null;
  let ready = null;

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
      // fetch any other Pyodide package the code imports (e.g. scipy)
      await py.loadPackagesFromImports(code, { messageCallback: () => {} });
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
