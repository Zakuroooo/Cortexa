/**
 * read_webpage: fetch a public page safely and keep only the article text.
 * safeFetch blocks private/internal addresses (SSRF); Readability (the engine
 * behind Firefox Reader View) strips menus, ads and footers.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { safeFetch } from "./safe-fetch";

const MAX_HTML_BYTES = 2_000_000;
const MAX_TEXT = 12_000;

export async function readWebpage(url: string): Promise<{ url: string; title: string; text: string; links: string[] }> {
  const res = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CortexaCowork/1.0)", Accept: "text/html,text/plain" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Page returned HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const raw = (await res.text()).slice(0, MAX_HTML_BYTES);
  if (!type.includes("html")) return { url, title: url, text: raw.slice(0, MAX_TEXT), links: [] };

  const { document } = parseHTML(raw);
  const links = [...document.querySelectorAll("a[href]")]
    .map((a: any) => {
      try {
        return new URL(a.getAttribute("href"), url).toString();
      } catch {
        return "";
      }
    })
    .filter((u) => /^https?:\/\//.test(u))
    .slice(0, 60);
  const article = new Readability(document as any).parse();
  const text = (article?.textContent || document.body?.textContent || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { url, title: article?.title || document.title || url, text: text.slice(0, MAX_TEXT), links: [...new Set(links)] };
}
