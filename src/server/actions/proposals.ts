"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { absenceSchema, proposalSchema, uuid } from "@/lib/validation";
import { zonedInstant } from "@/domain/time";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import { schedulePushDispatch } from "@/server/push";
import type { ActionResult } from "@/lib/types";

type Proposal = z.infer<typeof proposalSchema>;

async function rpcSend(requestId: string, proposals: Proposal[]): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_proposals", {
    p_request_id: requestId,
    p_proposals: proposals.map((p) => ({
      user_id: p.userId,
      place: p.place,
      slices: p.slices.map((s) => ({ starts_at: s.start, ends_at: s.end })),
    })),
  });
  return error ? toUserMessage(error) : null;
}

/**
 * "Planifier une absence": publishes a shareable request for the period, then
 * sends each person their part. The request exists even if sending fails.
 */
export async function planAbsence(
  input: z.input<typeof absenceSchema>,
): Promise<ActionResult<{ requestId: string; sendError: string | null }>> {
  const parsed = absenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const start = zonedInstant(v.startDate, v.startTime);
  const end = zonedInstant(v.endDate, v.endTime);
  if (end <= start) return { ok: false, error: "La fin doit être après le début." };
  if (end <= Date.now()) return { ok: false, error: "Cette période est déjà passée." };
  if (end - start > 31 * 24 * 3_600_000) return { ok: false, error: "Une absence ne peut pas dépasser 31 jours." };

  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_requests")
    .insert({
      group_id: v.groupId,
      dog_id: v.dogId,
      request_type: "care",
      necessity: "required",
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      description: v.description || null,
      splittable: true,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501") return { ok: false, error: "Seul un responsable de ce chien peut publier une demande." };
    return { ok: false, error: toUserMessage(error) };
  }
  const requestId = (data as { id: string }).id;
  const sendError = v.proposals.length ? await rpcSend(requestId, v.proposals) : null;
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: { requestId, sendError } };
}

/** Sends (or sends again) proposals on an existing request. */
export async function sendProposals(requestId: string, proposals: z.input<typeof proposalSchema>[]): Promise<ActionResult> {
  if (!uuid.safeParse(requestId).success) return { ok: false, error: "Demande introuvable." };
  const parsed = z.array(proposalSchema).min(1).max(20).safeParse(proposals);
  if (!parsed.success) return { ok: false, error: "Propositions invalides." };
  await requireUserId();
  const error = await rpcSend(requestId, parsed.data);
  if (error) return { ok: false, error };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Accepting is a "Oui" on that part; the owner confirms afterwards. */
export async function answerProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(proposalId).success) return { ok: false, error: "Proposition introuvable." };
  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_proposal", { p_proposal_id: proposalId, p_accept: accept });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function withdrawProposal(proposalId: string): Promise<ActionResult> {
  if (!uuid.safeParse(proposalId).success) return { ok: false, error: "Proposition introuvable." };
  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_proposal", { p_proposal_id: proposalId });
  if (error) return { ok: false, error: toUserMessage(error) };
  schedulePushDispatch();
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
