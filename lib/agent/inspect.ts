/**
 * Open output files with Python and describe what is really inside them.
 * Used by the agent's final verify step and by the eval checks.
 */
import type { PythonSandbox } from "./sandbox";
import { snapshot, type Workspace } from "./workspace";

export const INSPECT_PY = String.raw`
import json, os
def _inspect(p):
    if not os.path.exists(p):
        return {"exists": False}
    ext = p.rsplit(".", 1)[-1].lower() if "." in p else ""
    f = {"exists": True, "bytes": os.path.getsize(p), "type": ext}
    try:
        if ext in ("csv", "tsv"):
            import pandas as pd
            df = pd.read_csv(p, sep="\t" if ext == "tsv" else ",")
            f.update(rows=int(df.shape[0]), cols=int(df.shape[1]), columns=[str(c) for c in df.columns][:20],
                     duplicate_rows=int(df.duplicated().sum()), empty_cells=int(df.isna().sum().sum()),
                     head=df.head(3).astype(str).values.tolist())
        elif ext in ("xlsx", "xlsm"):
            import openpyxl
            wb = openpyxl.load_workbook(p)
            sheets = []
            for ws in wb.worksheets:
                formulas = [c.coordinate + c.value for r in ws.iter_rows() for c in r if isinstance(c.value, str) and c.value.startswith("=")]
                rows = [[("" if v is None else str(v)) for v in r] for r in ws.iter_rows(max_row=4, values_only=True)]
                sheets.append({"name": ws.title, "rows": ws.max_row, "cols": ws.max_column, "formula_count": len(formulas), "formulas": formulas[:6], "first_rows": rows})
            f["sheets"] = sheets
        elif ext == "pptx":
            import pptx
            prs = pptx.Presentation(p)
            slides = []
            for s in prs.slides:
                title = s.shapes.title.text if s.shapes.title is not None and s.shapes.title.has_text_frame else ""
                text = " ".join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame)[:200]
                slides.append({"title": title, "text": text})
            f.update(slide_count=len(slides), slides=slides)
        elif ext == "docx":
            import docx
            d = docx.Document(p)
            paras = [x.text for x in d.paragraphs if x.text.strip()]
            links = [r.target_ref for r in d.part.rels.values() if "hyperlink" in r.reltype]
            body = "\n".join(paras)
            f.update(paragraphs=len(paras), headings=[x.text for x in d.paragraphs if x.style.name.lower().startswith("heading")][:12],
                     hyperlinks=len(links), http_mentions=body.count("http"), tables=len(d.tables), start=body[:400])
        elif ext in ("png", "jpg", "jpeg"):
            import matplotlib.image as mpimg
            img = mpimg.imread(p)
            f.update(width=int(img.shape[1]), height=int(img.shape[0]))
        elif ext == "pdf":
            import pypdf
            f.update(pages=len(pypdf.PdfReader(p).pages))
        else:
            t = open(p, encoding="utf-8", errors="replace").read()
            f.update(chars=len(t), start=t[:500])
    except Exception as e:
        f["error"] = f"{type(e).__name__}: {e}"
    return f
`;

export type FileFacts = Record<string, Record<string, any>>;

export async function inspectFiles(python: PythonSandbox, ws: Workspace, paths: string[]): Promise<FileFacts> {
  const { files } = await snapshot(ws);
  const code = `${INSPECT_PY}\nprint("@@FACTS@@" + json.dumps({p: _inspect(p) for p in ${JSON.stringify(paths)}}))`;
  const r = await python.run(code, files, { timeoutMs: 90_000 });
  const line = r.stdout.split("\n").find((l) => l.startsWith("@@FACTS@@"));
  if (!line) throw new Error(`Could not inspect files: ${r.error ?? "no output"}`);
  return JSON.parse(line.slice("@@FACTS@@".length));
}
