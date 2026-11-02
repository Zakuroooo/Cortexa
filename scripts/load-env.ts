/** Load .env.local into process.env for scripts (Next.js does this itself for the app). */
import fs from "fs";
import path from "path";

for (const raw of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq > 0 && !process.env[line.slice(0, eq)]) process.env[line.slice(0, eq)] = line.slice(eq + 1);
}
