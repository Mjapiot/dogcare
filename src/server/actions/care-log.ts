"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { careLogEditSchema, careLogSchema, uuid } from "@/lib/validation";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import { schedulePushDispatch } from "@/server/push";
import type { ActionResult } from "@/lib/types";

/** Adds an entry to the log of one of my gardes (the photo is uploaded beforehand). */
export async function addCareLog(input: z.input<typeof careLogSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = careLogSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_care_log", {
    p_assignment_id: v.assignmentId,
    p_kind: v.kind,
    p_occurred_at: v.occurredAt ?? null,
    p_note: v.note || null,
    p_photo_path: v.photoPath ?? null,
  });
  if (error) {
    // never leave an unused file behind
    if (v.photoPath) await supabase.storage.from("care-logs").remove([v.photoPath]);
    return { ok: false, error: toUserMessage(error) };
  }
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data as string } };
}

export async function updateCareLog(entryId: string, input: z.input<typeof careLogEditSchema>): Promise<ActionResult> {
  const parsed = careLogEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!uuid.safeParse(entryId).success) return { ok: false, error: "Entrée introuvable." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_care_log", {
    p_entry_id: entryId,
    p_occurred_at: parsed.data.occurredAt,
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function deleteCareLog(entryId: string): Promise<ActionResult> {
  if (!uuid.safeParse(entryId).success) return { ok: false, error: "Entrée introuvable." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_care_log", { p_entry_id: entryId });
  if (error) return { ok: false, error: toUserMessage(error) };
  // a file left behind is purged the next day anyway
  if (typeof data === "string" && data) await supabase.storage.from("care-logs").remove([data]);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
