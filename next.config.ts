import type { NextConfig } from "next";

/**
 * The Python worker may only talk to where Python packages come from.
 * A Content-Security-Policy on a worker script is enforced by the browser
 * for everything inside that worker — so even code that finds a way around
 * our JS network lock can't reach our API (with the user's cookie) or send
 * data to any other site.
 */
const PY_WORKER_CSP = [
  "default-src 'none'",
  // exact paths, not whole hosts: only this Pyodide release and PyPI's package API/files
  // Pyodide's loader needs eval; it can't fetch anything, connect-src still decides that
  "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval' 'unsafe-eval'",
  "connect-src https://cdn.jsdelivr.net/pyodide/v314.0.7/full/ https://pypi.org/simple/ https://pypi.org/pypi/ https://files.pythonhosted.org/packages/",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "pyodide"],
  async headers() {
    return [
      {
        // exact worker file only — NOT the /cowork page itself
        source: "/cowork/pyodide-worker.mjs",
        headers: [{ key: "Content-Security-Policy", value: PY_WORKER_CSP }],
      },
    ];
  },
};

export default nextConfig;
