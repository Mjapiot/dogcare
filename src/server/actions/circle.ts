"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { circleInviteSchema, circleMemberSchema, uuid } from "@/lib/validation";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import { schedulePushDispatch } from "@/server/push";
import type { ActionResult } from "@/lib/types";

/** Role and health/emergency access of a member of the dog's groups or of the circle. */
export async function setCircleMember(
  dogId: string,
  userId: string,
  input: z.input<typeof circleMemberSchema>,
): Promise<ActionResult> {
  const parsed = circleMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!uuid.safeParse(dogId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Paramètres invalides." };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_circle_member", {
    p_dog_id: dogId,
    p_user_id: userId,
    p_role: v.role,
    p_health_access: v.health,
    p_emergency_access: v.emergency,
    p_starts_at: v.role === "guest" ? v.startsAt : null,
    p_ends_at: v.role === "guest" ? v.endsAt : null,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  // shorter guest dates may cancel gardes (with notifications)
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** A group member goes back to "entourage"; someone outside the groups loses access. */
export async function removeCircleMember(dogId: string, userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_circle_member", { p_dog_id: dogId, p_user_id: userId });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Creates a single-use invitation link (valid 7 days); the token is returned once. */
export async function createCircleInvitation(
  dogId: string,
  input: z.input<typeof circleInviteSchema>,
): Promise<ActionResult<{ token: string }>> {
  const parsed = circleInviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!uuid.safeParse(dogId).success) return { ok: false, error: "Chien introuvable." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_circle_invitation", {
    p_dog_id: dogId,
    p_role: v.role,
    p_health_access: v.health,
    p_emergency_access: v.emergency,
    p_starts_at: v.role === "guest" ? v.startsAt : null,
    p_ends_at: v.role === "guest" ? v.endsAt : null,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  // shorter guest dates may cancel gardes (with notifications)
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: { token: data as string } };
}

export async function revokeCircleInvitation(dogId: string, invitationId: string): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success || !uuid.safeParse(invitationId).success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_circle_invitation", { p_invitation_id: invitationId });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/dogs/${dogId}`);
  return { ok: true, data: undefined };
}

export async function acceptCircleInvitation(token: string): Promise<ActionResult<{ dogId: string }>> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, error: "Ce lien d'invitation n'est pas valide." };
  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_circle_invitation", { p_token: token });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: { dogId: data as string } };
}

/** The current user leaves a dog's circle (their gardes on it are cancelled, owners told). */
export async function leaveDogCircle(dogId: string): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success) return { ok: false, error: "Chien introuvable." };
  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_dog_circle", { p_dog_id: dogId });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
