"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { displayNameSchema, groupNameSchema, uuid } from "@/lib/validation";
import { normalizeJoinCode } from "@/lib/join-code";
import { CURRENT_GROUP_COOKIE, requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import { schedulePushDispatch } from "@/server/push";
import type { ActionResult } from "@/lib/types";

const COOKIE_OPTIONS = { path: "/", sameSite: "lax" as const, httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 365 };

export async function updateDisplayName(name: string): Promise<ActionResult> {
  const parsed = displayNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data, onboarded_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function createGroup(name: string): Promise<ActionResult<{ groupId: string }>> {
  const parsed = groupNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_group", { p_name: parsed.data });
  if (error) return { ok: false, error: toUserMessage(error) };
  (await cookies()).set(CURRENT_GROUP_COOKIE, data as string, COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true, data: { groupId: data as string } };
}

export async function switchGroup(groupId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(groupId);
  if (!parsed.success) return { ok: false, error: "Groupe invalide." };
  (await cookies()).set(CURRENT_GROUP_COOKIE, parsed.data, COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function renameGroup(groupId: string, name: string): Promise<ActionResult> {
  const parsed = z.object({ groupId: uuid, name: groupNameSchema }).safeParse({ groupId, name });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("groups").update({ name: parsed.data.name }).eq("id", groupId).select("id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Seul un administrateur peut renommer le groupe." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function createInvitation(
  groupId: string,
  expiresInHours: number,
  maxUses: number,
): Promise<ActionResult<{ token: string }>> {
  const parsed = z
    .object({ groupId: uuid, expiresInHours: z.number().int().min(1).max(720), maxUses: z.number().int().min(1).max(50) })
    .safeParse({ groupId, expiresInHours, maxUses });
  if (!parsed.success) return { ok: false, error: "Paramètres d'invitation invalides." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_group_id: groupId,
    p_expires_in_hours: expiresInHours,
    p_max_uses: maxUses,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/groups/${groupId}`);
  return { ok: true, data: { token: data as string } };
}

export async function revokeInvitation(invitationId: string, groupId: string): Promise<ActionResult> {
  if (!uuid.safeParse(invitationId).success) return { ok: false, error: "Invitation invalide." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: invitationId });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/groups/${groupId}`);
  return { ok: true, data: undefined };
}

export async function acceptInvitation(token: string): Promise<ActionResult<{ groupId: string }>> {
  const parsed = z.string().min(10).max(100).safeParse(token);
  if (!parsed.success) return { ok: false, error: "Ce lien d'invitation n'est pas valide." };
  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: parsed.data });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  (await cookies()).set(CURRENT_GROUP_COOKIE, data as string, COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true, data: { groupId: data as string } };
}

export async function setShareAvailability(groupId: string, share: boolean): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!uuid.safeParse(groupId).success) return { ok: false, error: "Groupe invalide." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("group_members")
    .update({ share_availability: share })
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function setMemberRole(groupId: string, userId: string, role: "admin" | "member"): Promise<ActionResult> {
  if (!uuid.safeParse(groupId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", { p_group_id: groupId, p_user_id: userId, p_role: role });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/groups/${groupId}`);
  return { ok: true, data: undefined };
}

export async function removeMember(groupId: string, userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(groupId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Action non autorisée." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function deleteMyAccount(): Promise<ActionResult> {
  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) return { ok: false, error: toUserMessage(error) };
  await supabase.auth.signOut();
  return { ok: true, data: undefined };
}

/** Admin: renew (the previous code stops working) or disable the group code. */
export async function resetGroupJoinCode(groupId: string, enabled: boolean): Promise<ActionResult<{ code: string | null }>> {
  if (!uuid.safeParse(groupId).success) return { ok: false, error: "Groupe invalide." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reset_group_join_code", { p_group_id: groupId, p_enabled: enabled });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/groups/${groupId}`);
  return { ok: true, data: { code: (data as string | null) ?? null } };
}

/** Admin: create the group code if it does not exist yet. */
export async function createGroupJoinCode(groupId: string): Promise<ActionResult<{ code: string }>> {
  if (!uuid.safeParse(groupId).success) return { ok: false, error: "Groupe invalide." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_group_join_code", { p_group_id: groupId, p_create: true });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/groups/${groupId}`);
  return { ok: true, data: { code: data as string } };
}

/** Anyone signed in: join a group by typing its code. */
export async function joinGroupWithCode(input: string): Promise<ActionResult<{ groupId: string; groupName: string }>> {
  const code = normalizeJoinCode(input);
  if (!code) return { ok: false, error: "Un code de groupe contient 8 caractères, par exemple K7PQ-M2XD." };
  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_group_with_code", { p_code: code });
  if (error) return { ok: false, error: toUserMessage(error) };
  const row = ((data as Array<{ status: string; group_id: string | null; group_name: string | null }> | null) ?? [])[0];
  switch (row?.status) {
    case "joined":
    case "already_member":
      (await cookies()).set(CURRENT_GROUP_COOKIE, row.group_id!, COOKIE_OPTIONS);
      schedulePushDispatch();
      revalidatePath("/", "layout");
      return { ok: true, data: { groupId: row.group_id!, groupName: row.group_name ?? "" } };
    case "throttled":
      return { ok: false, error: "Trop d'essais. Réessayez dans 15 minutes." };
    default:
      return { ok: false, error: "Ce code ne correspond à aucun groupe. Vérifiez-le auprès d'un administrateur." };
  }
}
