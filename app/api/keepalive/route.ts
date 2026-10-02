import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/keepalive — a daily ping that keeps the Supabase project awake.
 *
 * Supabase's free tier pauses a project after ~7 days without activity, which
 * takes the whole demo offline (the project URL stops resolving at all). A
 * Vercel cron (vercel.json) calls this once a day; one tiny query counts as
 * activity. It reads no user data: with no session, Row-Level Security makes
 * the count 0, but the query still reaches Postgres.
 *
 * If CRON_SECRET is set, only Vercel's cron (which sends it as a Bearer token)
 * may call this; without it the endpoint is public, which is harmless here.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
