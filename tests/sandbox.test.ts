import { describe, it, expect, afterAll } from "vitest";
import { diffFiles } from "@/lib/agent/sandbox";
import { createNodeSandbox } from "@/lib/agent/sandbox-node";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("diffFiles", () => {
  it("finds created, modified and deleted files", () => {
    const before = { "a.csv": enc("1"), "b.txt": enc("x"), "c.md": enc("same") };
    const after = { "a.csv": enc("2"), "c.md": enc("same"), "new/chart.png": enc("png") };
    expect(diffFiles(before, after)).toEqual({ created: ["new/chart.png"], modified: ["a.csv"], deleted: ["b.txt"] });
  });
});

// Real Pyodide in a worker thread — the same core the browser uses.
describe("python sandbox (real Pyodide)", () => {
  const sb = createNodeSandbox();
  afterAll(() => sb.kill());

  it("reads input files, writes outputs, captures stdout", async () => {
    const r = await sb.run(
      `import pandas as pd
df = pd.read_csv("in/data.csv")
df["total"] = df.a + df.b
df.to_csv("out.csv", index=False)
print("rows", len(df))`,
      { "in/data.csv": enc("a,b\n1,2\n3,4\n") }
    );
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("rows 2");
    expect(dec(r.files["out.csv"])).toContain("total");
    expect(r.files["in/data.csv"]).toBeDefined();
  });

  it("makes xlsx with formulas, pptx, docx and a png chart", async () => {
    const r = await sb.run(
      `import openpyxl, pptx, docx, matplotlib.pyplot as plt
wb = openpyxl.Workbook(); ws = wb.active; ws.append(["x"]); ws.append([2]); ws["A3"] = "=SUM(A2:A2)"; wb.save("m.xlsx")
p = pptx.Presentation(); p.slides.add_slide(p.slide_layouts[0]); p.save("d.pptx")
d = docx.Document(); d.add_paragraph("hi"); d.save("b.docx")
plt.bar([1, 2], [3, 4]); plt.savefig("c.png")`,
      {}
    );
    expect(r.error ?? null).toBeNull();
    expect(Object.keys(r.files).sort()).toEqual(["b.docx", "c.png", "d.pptx", "m.xlsx"]);
  });

  it("returns the traceback on error", async () => {
    const r = await sb.run(`open("missing.csv")`, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/FileNotFoundError/);
  });

  it("kills an endless loop at the timeout and recovers", async () => {
    const r = await sb.run(`while True: pass`, {}, { timeoutMs: 15_000 });
    expect(r.timedOut).toBe(true);
    const again = await sb.run(`print(6 * 7)`, {});
    expect(again.stdout).toContain("42");
  });
});
