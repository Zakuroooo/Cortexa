/**
 * Create a login for the LOCAL Supabase so you can try the Tasks UI.
 *   npx tsx scripts/create-demo-user.ts
 * The password is random and written to .env.local (LOCAL_DEMO_EMAIL / LOCAL_DEMO_PASSWORD).
 */
import fs from "fs";
import crypto from "crypto";
import "./load-env";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error("Local Supabase only");

(async () => {
  if (process.env.LOCAL_DEMO_EMAIL) return console.log("Demo user already in .env.local");
  const email = "demo@cortexa.test";
  const password = `demo-${crypto.randomBytes(6).toString("hex")}A1`;
  const admin = createClient(url, process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Demo" } });
  if (error) throw error;
  fs.appendFileSync(".env.local", `\n# local demo login for the Tasks UI (local Supabase only)\nLOCAL_DEMO_EMAIL=${email}\nLOCAL_DEMO_PASSWORD=${password}\n`);
  console.log(`Created ${email} — password saved in .env.local`);
})();
