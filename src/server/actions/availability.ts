"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { availabilityBatchSchema, ruleSchema } from "@/lib/validation";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import type { ActionResult } from "@/lib/types";

/** Applies "available", "unavailable" or "clear" to many (date, slot) cells at once. */
export async function applyAvailability(input: z.input<typeof availabilityBatchSchema>): Promise<ActionResult> {
  const parsed = availabilityBatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const userId = await requireUserId();
  const supabase = await createClient();
  const { cells, status } = parsed.data;

  if (status === "clear") {
    const byDate = new Map<string, string[]>();
    for (const c of cells) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c.slot]);
    for (const [date, slots] of byDate) {
      const { error } = await supabase
        .from("availability_entries")
        .delete()
        .eq("user_id", userId)
        .eq("date", date)
        .in("slot", slots);
      if (error) return { ok: false, error: toUserMessage(error) };
    }
  } else {
    const { error } = await supabase
      .from("availability_entries")
      .upsert(
        cells.map((c) => ({ user_id: userId, date: c.date, slot: c.slot, status })),
        { onConflict: "user_id,date,slot" },
      );
    if (error) return { ok: false, error: toUserMessage(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Weekly habits. One-off entries keep priority over these rules. */
export async function applyRules(input: z.input<typeof ruleSchema>): Promise<ActionResult> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const userId = await requireUserId();
  const supabase = await createClient();
  const { weekdays, slots, status } = parsed.data;

  if (status === "clear") {
    const { error } = await supabase
      .from("availability_rules")
      .delete()
      .eq("user_id", userId)
      .in("weekday", weekdays)
      .in("slot", slots);
    if (error) return { ok: false, error: toUserMessage(error) };
  } else {
    const rows = weekdays.flatMap((weekday) => slots.map((slot) => ({ user_id: userId, weekday, slot, status })));
    const { error } = await supabase.from("availability_rules").upsert(rows, { onConflict: "user_id,weekday,slot" });
    if (error) return { ok: false, error: toUserMessage(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
