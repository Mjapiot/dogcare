"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
