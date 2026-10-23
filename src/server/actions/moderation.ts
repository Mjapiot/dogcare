"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/server/session";
import { schedulePushDispatch } from "@/server/push";
import { toUserMessage } from "@/server/errors";
import { uuid } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";

const reportSchema = z.object({
  groupId: uuid,
  targetType: z.enum(["request", "dog", "member"]),
  targetId: uuid,
  reason: z.string().trim().max(500, "500 caractères maximum."),
});

/** Reports a request, a dog or a member to the group's admins and the Dogcare team. */
export async function reportContent(input: z.input<typeof reportSchema>): Promise<ActionResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { groupId, targetType, targetId, reason } = parsed.data;
  const { error } = await supabase.rpc("report_content", {
    p_group_id: groupId,
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason || null,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  return { ok: true, data: undefined };
}

/** Blocks a member: neither sees the other's requests nor gets notified by the other. */
export async function blockMember(userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Membre invalide." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("block_member", { p_user_id: userId });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function unblockMember(userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Membre invalide." };
  const me = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", me).eq("blocked_id", userId);
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
