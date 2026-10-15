"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { careRequestSchema, responseSchema, uuid } from "@/lib/validation";
import { zonedInstant } from "@/domain/time";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
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

export async function createCareRequest(
  input: z.input<typeof careRequestSchema>,
): Promise<ActionResult<{ requestId: string }>> {
  const parsed = careRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const { start, end } = toPeriod(v);
  const periodError = validatePeriod(start, end);
  if (periodError) return { ok: false, error: periodError };

  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_requests")
    .insert({
      group_id: v.groupId,
      dog_id: v.dogId,
      request_type: v.requestType,
      necessity: v.necessity,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      description: v.description || null,
      splittable: v.splittable,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501") return { ok: false, error: "Seul un responsable de ce chien peut publier une demande." };
    if (error.code === "23503") return { ok: false, error: "Ce chien n'est pas visible dans ce groupe." };
    return { ok: false, error: toUserMessage(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { requestId: (data as { id: string }).id } };
}

export async function updateCareRequest(
  requestId: string,
  input: z.input<typeof careRequestSchema>,
): Promise<ActionResult> {
  const parsed = careRequestSchema.safeParse(input);
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
      request_type: v.requestType,
      necessity: v.necessity,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      description: v.description || null,
      splittable: v.splittable,
    })
    .eq("id", requestId)
    .select("id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Seul un responsable du chien peut modifier cette demande." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
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
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function answerReconfirmation(assignmentId: string, accept: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(assignmentId).success) return { ok: false, error: "Garde introuvable." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_reconfirmation", { p_assignment_id: assignmentId, p_accept: accept });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
