// Real screenshots of the Cowork page for the README — a real task, real model.
//   node scripts/screenshot-cowork.mjs [baseUrl]
// Logs in with the LOCAL demo user from .env.local (scripts/create-demo-user.ts).
import fs from "fs";
import { chromium } from "playwright-core";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const BASE = process.argv[2] || "http://localhost:3107";
const OUT = "docs/images/cowork";
const GOAL =
  "Read the 3 vendor contracts in contracts/ and build risk_matrix.xlsx: one row per vendor with liability, termination and data-location risk scores (1-5) and a Total column that is an Excel SUM formula. Then make a bar chart of the totals as risk_chart.png.";

// CHROME_PATH: use an already-downloaded Chromium (e.g. from ~/Library/Caches/ms-playwright)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', env.LOCAL_DEMO_EMAIL);
await page.fill('input[type="password"]', env.LOCAL_DEMO_PASSWORD);
await page.keyboard.press("Enter");
await page.waitForURL(/dashboard/);
await page.goto(`${BASE}/cowork`);
fs.mkdirSync(OUT, { recursive: true });
await page.screenshot({ path: `${OUT}/empty.png` });

await page.getByRole("button", { name: "Try sample files" }).click();
await page.getByPlaceholder("What should Cortexa do in this folder?").fill(GOAL);
await page.getByRole("button", { name: "Start" }).click();

// mid-run: to-do list + timeline with Python code
await page.getByText("run_python").first().waitFor({ timeout: 240_000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/running.png` });

// answer any approval/question with yes, until done
const deadline = Date.now() + 8 * 60_000;
while (Date.now() < deadline) {
  if (await page.getByText(/Done — checked and verified|Didn't finish|Stopped/).count()) break;
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.count()) await allow.click();
  const answer = page.getByRole("button", { name: "Answer" });
  if (await answer.count()) await answer.click();
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: `${OUT}/done.png`, fullPage: true });
console.log((await page.locator("main").innerText()).split("Start\n").pop().slice(-600));
await browser.close();
