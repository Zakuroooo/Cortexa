/**
 * The workspace = the folder the agent works in.
 *
 *  - FolderWorkspace: a REAL folder on the user's disk, through the browser's
 *    File System Access API (Chrome/Edge). The browser asks the user first.
 *  - MemoryWorkspace: a virtual folder in memory (other browsers, tests, evals).
 *    The user uploads files into it and downloads the result as a zip.
 */
import { zipSync } from "fflate";
import type { FileMap } from "./sandbox";

export interface FileInfo {
  path: string;
  size: number;
}

export interface Workspace {
  name: string;
  kind: "folder" | "virtual";
  list(): Promise<FileInfo[]>;
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export const LIMITS = {
  maxFiles: 400,
  /** files bigger than this are not copied into Python */
  maxFileBytes: 25 * 1024 * 1024,
  /** total bytes copied into Python per run */
  maxSnapshotBytes: 80 * 1024 * 1024,
};

/**
 * Clean a path the model gave us. Relative paths only, no "..", no hidden
 * folders — the agent can never climb out of the folder the user picked.
 */
export function normalizePath(raw: string): string {
  const parts = String(raw ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== ".");
  if (!parts.length) throw new Error("Empty path");
  for (const p of parts) {
    if (p === "..") throw new Error(`Path may not contain "..": ${raw}`);
    if (p.startsWith(".")) throw new Error(`Hidden files and folders are off limits: ${raw}`);
    if (/[<>:"|?*\u0000-\u001f]/.test(p)) throw new Error(`Invalid character in path: ${raw}`);
  }
  return parts.join("/");
}

/** Copy the folder for a Python run, skipping huge files. */
export async function snapshot(ws: Workspace): Promise<{ files: FileMap; skipped: string[] }> {
  const files: FileMap = {};
  const skipped: string[] = [];
  let total = 0;
  for (const f of await ws.list()) {
    if (f.size > LIMITS.maxFileBytes || total + f.size > LIMITS.maxSnapshotBytes) {
      skipped.push(f.path);
      continue;
    }
    const data = await ws.read(f.path);
    if (!data) continue;
    files[f.path] = data;
    total += data.length;
  }
  return { files, skipped };
}

export async function toZip(ws: Workspace): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of await ws.list()) {
    const data = await ws.read(f.path);
    if (data) entries[f.path] = data;
  }
  return zipSync(entries);
}

// ------------------------------------------------------------- in memory

export class MemoryWorkspace implements Workspace {
  kind = "virtual" as const;
  files = new Map<string, Uint8Array>();
  constructor(public name = "Virtual folder", initial: FileMap = {}) {
    for (const [p, d] of Object.entries(initial)) this.files.set(normalizePath(p), d);
  }
  async list() {
    return [...this.files.entries()]
      .map(([path, d]) => ({ path, size: d.length }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, LIMITS.maxFiles);
  }
  async read(path: string) {
    return this.files.get(normalizePath(path)) ?? null;
  }
  async write(path: string, data: Uint8Array) {
    this.files.set(normalizePath(path), data);
  }
  async exists(path: string) {
    return this.files.has(normalizePath(path));
  }
  async remove(path: string) {
    const p = normalizePath(path);
    // removing a "folder" removes everything under it
    for (const k of [...this.files.keys()]) if (k === p || k.startsWith(p + "/")) this.files.delete(k);
  }
  async rename(from: string, to: string) {
    const a = normalizePath(from);
    const b = normalizePath(to);
    const data = this.files.get(a);
    if (!data) throw new Error(`No such file: ${from}`);
    this.files.set(b, data);
    this.files.delete(a);
  }
}

// ------------------------------------------------------- real folder (FSA)

/* Minimal typings for the File System Access API (not in every TS lib yet). */
type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
};

export function folderAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Ask the user to pick a folder, with write permission. */
export async function pickFolder(): Promise<FolderWorkspace> {
  const handle = (await (window as any).showDirectoryPicker({ mode: "readwrite" })) as DirHandle;
  return new FolderWorkspace(handle);
}

export class FolderWorkspace implements Workspace {
  kind = "folder" as const;
  name: string;
  constructor(private root: DirHandle) {
    this.name = root.name;
  }

  /** The browser may drop write permission; ask again before writing. */
  async ensureWrite() {
    if (!this.root.queryPermission) return;
    if ((await this.root.queryPermission({ mode: "readwrite" })) === "granted") return;
    if ((await this.root.requestPermission?.({ mode: "readwrite" })) !== "granted")
      throw new Error("Write permission to the folder was not granted");
  }

  private async dir(parts: string[], create: boolean): Promise<DirHandle> {
    let d = this.root;
    for (const p of parts) d = (await d.getDirectoryHandle(p, { create })) as DirHandle;
    return d;
  }

  private split(path: string) {
    const parts = normalizePath(path).split("/");
    return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
  }

  async list() {
    const out: FileInfo[] = [];
    const walk = async (d: DirHandle, prefix: string) => {
      for await (const h of d.values()) {
        if (out.length >= LIMITS.maxFiles || h.name.startsWith(".") || h.name === "node_modules") continue;
        const path = prefix ? `${prefix}/${h.name}` : h.name;
        if (h.kind === "directory") await walk(h as DirHandle, path);
        else out.push({ path, size: (await (h as FileSystemFileHandle).getFile()).size });
      }
    };
    await walk(this.root, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string) {
    try {
      const { dirs, name } = this.split(path);
      const fh = await (await this.dir(dirs, false)).getFileHandle(name);
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    } catch {
      return null;
    }
  }

  async exists(path: string) {
    return (await this.read(path)) !== null;
  }

  async write(path: string, data: Uint8Array) {
    await this.ensureWrite();
    const { dirs, name } = this.split(path);
    const fh = await (await this.dir(dirs, true)).getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data as unknown as BufferSource);
    await w.close();
  }

  async remove(path: string) {
    await this.ensureWrite();
    const { dirs, name } = this.split(path);
    await (await this.dir(dirs, false)).removeEntry(name, { recursive: true });
  }

  async rename(from: string, to: string) {
    // portable rename = copy + delete (FileSystemHandle.move isn't everywhere)
    const data = await this.read(from);
    if (!data) throw new Error(`No such file: ${from}`);
    await this.write(to, data);
    await this.remove(from);
  }
}
