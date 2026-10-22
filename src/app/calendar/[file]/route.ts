import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";
import { buildIcs } from "@/lib/ics";
import { feedRowToEvent, parseFeedFile, type FeedRow } from "@/lib/calendar-feed";

/**
 * Personal calendar subscription (Apple Calendar polls it without a session).
 * The secret token in the URL is the only key: the database function returns
 * nothing for an unknown token, and an empty calendar is served either way so
 * the response never tells whether a token exists.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/calendar/[file]">) {
  const { file } = await ctx.params;
  const token = parseFeedFile(file);
  const env = getSupabaseEnv();
  if (!token || !env) return new Response("Not found", { status: 404 });

  const supabase = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("calendar_feed_events", { p_token: token });
  if (error) {
    console.error("[dogcare] calendar feed", error.code, error.message);
    // a 5xx keeps the events already in the calendar instead of emptying it
    return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "600" } });
  }

  const origin = request.nextUrl.origin;
  const body = buildIcs({
    name: "Dogcare",
    now: new Date(),
    events: ((data as FeedRow[] | null) ?? []).map((row) => feedRowToEvent(row, origin)),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="dogcare.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
