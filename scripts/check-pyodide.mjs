// Verifies every Python package the Cowork sandbox promises actually loads in Pyodide.
//   node scripts/check-pyodide.mjs
import { loadPyodide } from "pyodide";

const t0 = Date.now();
const py = await loadPyodide();
console.log(`pyodide ${py.version} ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
try {
await py.loadPackage(["micropip", "pandas", "matplotlib", "lxml"], { messageCallback: () => {} });
} catch (e) { console.log("LOADPKG ERR", String(e.message).slice(0, 600)); process.exit(1); }
const mp = py.pyimport("micropip");
try { await mp.install(["openpyxl", "python-pptx", "python-docx", "pypdf"]); } catch (e) { console.log("MICROPIP ERR", String(e.message).slice(-800)); process.exit(1); }
const out = await py.runPythonAsync(`
import pandas, openpyxl, matplotlib, pptx, docx, pypdf, io
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.plot([1,2,3]); buf = io.BytesIO(); plt.savefig(buf, format="png")
p = pptx.Presentation(); p.slides.add_slide(p.slide_layouts[0]); b2 = io.BytesIO(); p.save(b2)
d = docx.Document(); d.add_heading("hi"); b3 = io.BytesIO(); d.save(b3)
wb = openpyxl.Workbook(); wb.active["A1"] = 1; wb.active["A2"] = "=A1*2"; b4 = io.BytesIO(); wb.save(b4)
f"pandas {pandas.__version__} | openpyxl {openpyxl.__version__} | matplotlib {matplotlib.__version__} png={len(buf.getvalue())}B | pptx {pptx.__version__} {len(b2.getvalue())}B | docx {len(b3.getvalue())}B | xlsx {len(b4.getvalue())}B | pypdf {pypdf.__version__}"
`);
console.log(out);
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
