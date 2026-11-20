"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { feedRowToEvent, type FeedRow } from "@/lib/calendar-feed";
import type { NativeEvent } from "@/lib/calendar-sync";
import { getUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import type { ActionResult } from "@/lib/types";

/** Creates the personal calendar subscription token if it does not exist yet. */
export async function enableCalendarFeed(): Promise<ActionResult<{ token: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_calendar_feed_token", { p_create: true });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/profile");
  return { ok: true, data: { token: data as string } };
}

/** New subscription link (the old one stops working), or disables it. */
export async function resetCalendarFeed(enabled: boolean): Promise<ActionResult<{ token: string | null }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reset_calendar_feed_token", { p_enabled: enabled === true });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/profile");
  return { ok: true, data: { token: (data as string | null) ?? null } };
}

/**
 * My confirmed gardes as events for the iPhone app's own calendar (same rule
 * and wording as the subscription), with the signed-in user (the device keeps
 * one account's events only).
 */
export async function getMyCalendarEvents(): Promise<ActionResult<{ userId: string; events: NativeEvent[] }>> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Vous devez être connecté." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_calendar_events");
  if (error) return { ok: false, error: toUserMessage(error) };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const events = ((data as FeedRow[] | null) ?? []).map((row) => {
    const e = feedRowToEvent(row, origin);
    return { key: row.assignment_id, title: e.summary, start: e.start.getTime(), end: e.end.getTime(), notes: e.description ?? "", url: e.url ?? "" };
  });
  return { ok: true, data: { userId, events } };
}
