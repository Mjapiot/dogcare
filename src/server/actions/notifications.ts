"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import type { ActionResult, NotificationPreferencesRow } from "@/lib/types";

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

const prefsSchema = z.object({
  new_requests_enabled: z.boolean(),
  responses_enabled: z.boolean(),
  confirmations_enabled: z.boolean(),
  cancellations_enabled: z.boolean(),
  reminders_enabled: z.boolean(),
  summary_enabled: z.boolean(),
});

export async function saveNotificationPreferences(prefs: NotificationPreferencesRow): Promise<ActionResult> {
  const parsed = prefsSchema.safeParse(prefs);
  if (!parsed.success) return { ok: false, error: "Préférences invalides." };
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: userId, ...parsed.data }, { onConflict: "user_id" });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/profile");
  return { ok: true, data: undefined };
}
