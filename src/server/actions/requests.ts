"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { planSliceSchema, requestEditSchema, responseSchema, uuid } from "@/lib/validation";
import { zonedInstant } from "@/domain/time";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import { schedulePushDispatch } from "@/server/push";
import type { ActionResult } from "@/lib/types";

function toPeriod(v: { startDate: string; startTime: string; endDate: string; endTime: string }) {
  const start = zonedInstant(v.startDate, v.startTime);
  const end = zonedInstant(v.endDate, v.endTime);
  return { start, end };
}

function validatePeriod(start: number, end: number): string | null {
  if (end <= start) return "La fin doit être après le début.";
  if (end <= Date.now()) return "Cette période est déjà passée.";
  if (end - start > 31 * 24 * 3_600_000) return "Une demande ne peut pas dépasser 31 jours.";
  return null;
}

/** Sets the circle people asked on a request; returns an error message or null. */
async function saveInvitees(requestId: string, inviteeIds: string[] | undefined): Promise<string | null> {
  if (inviteeIds === undefined) return null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_request_invitees", { p_request_id: requestId, p_user_ids: inviteeIds });
  return error ? toUserMessage(error) : null;
}

/** New needs are created by "Besoin d'une garde" (plan_absence_multi); here only dates, details, circle people. */
export async function updateCareRequest(
  requestId: string,
  input: z.input<typeof requestEditSchema>,
): Promise<ActionResult<{ inviteError: string | null }>> {
  const parsed = requestEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!uuid.safeParse(requestId).success) return { ok: false, error: "Demande introuvable." };
  const v = parsed.data;
  const { start, end } = toPeriod(v);
  const periodError = validatePeriod(start, end);
  if (periodError) return { ok: false, error: periodError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_requests")
    .update({
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      description: v.description || null,
    })
    .eq("id", requestId)
    .select("id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Seul un responsable du chien peut modifier cette demande." };
  const inviteError = await saveInvitees(requestId, v.inviteeIds);
  schedulePushDispatch();
  revalidatePath("/", "layout");
  // the request is saved even if asking circle people failed
  return { ok: true, data: { inviteError } };
}

export async function cancelCareRequest(requestId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(requestId).success) return { ok: false, error: "Demande introuvable." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_requests")
    .update({ lifecycle_status: "cancelled", cancellation_reason: reason.trim().slice(0, 500) || null })
    .eq("id", requestId)
    .select("id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Seul un responsable du chien peut annuler cette demande." };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function respondToRequest(input: z.input<typeof responseSchema>): Promise<ActionResult> {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  if ((v.proposedStart && !v.proposedEnd) || (!v.proposedStart && v.proposedEnd)) {
    return { ok: false, error: "Indiquez le début et la fin du créneau proposé." };
  }
  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("request_responses").upsert(
    {
      // user_id is filled by the database (auth.uid()) — never trusted from the client
      request_id: v.requestId,
      response_status: v.status,
      proposed_starts_at: v.status === "yes" ? (v.proposedStart ?? null) : null,
      proposed_ends_at: v.status === "yes" ? (v.proposedEnd ?? null) : null,
      note: v.note || null,
    },
    { onConflict: "request_id,user_id" },
  );
  if (error) {
    if (error.code === "42501") return { ok: false, error: "Vous ne pouvez plus répondre à cette demande." };
    return { ok: false, error: toUserMessage(error) };
  }
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function confirmAssignment(input: {
  requestId: string;
  userId: string;
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<ActionResult> {
  const parsed = z
    .object({
      requestId: uuid,
      userId: uuid,
      startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
      endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_assignment", {
    p_request_id: parsed.data.requestId,
    p_user_id: parsed.data.userId,
    p_starts_at: parsed.data.startsAt ?? null,
    p_ends_at: parsed.data.endsAt ?? null,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function cancelAssignment(assignmentId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(assignmentId).success) return { ok: false, error: "Garde introuvable." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_assignment", {
    p_assignment_id: assignmentId,
    p_reason: reason.trim().slice(0, 500) || null,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function answerReconfirmation(assignmentId: string, accept: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(assignmentId).success) return { ok: false, error: "Garde introuvable." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_reconfirmation", { p_assignment_id: assignmentId, p_accept: accept });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Confirms a validated plan: every slice at once, or none (the database checks each one). */
export async function confirmPlan(requestId: string, slices: z.input<typeof planSliceSchema>[]): Promise<ActionResult<{ count: number }>> {
  if (!uuid.safeParse(requestId).success) return { ok: false, error: "Demande introuvable." };
  const parsed = z.array(planSliceSchema).min(1).max(50).safeParse(slices);
  if (!parsed.success) return { ok: false, error: "Planning invalide." };
  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_plan", {
    p_request_id: requestId,
    p_slices: parsed.data.map((s) => ({ user_id: s.userId, starts_at: s.start, ends_at: s.end, place: s.place ?? "helper" })),
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: { count: Number(data ?? 0) } };
}
