"use server";

import { z } from "zod";
import { uuid } from "@/lib/validation";
import { assistantContext, resolveAbsenceIntent, type ResolvedAbsence } from "@/domain/absence-intent";
import { todayLocal } from "@/domain/time";
import { requireUserId } from "@/server/session";
import { getGroupDogs, getGroupMembers, getInviteeCandidates, getMyBlockedIds } from "@/server/data";
import { understandWithGemini } from "@/server/ai";
import type { ActionResult } from "@/lib/types";

const textSchema = z.string().trim().min(5, "Décrivez votre absence en une phrase.").max(500, "500 caractères maximum.");
const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long" });

/**
 * "Décrivez votre absence": the sentence goes to Gemini (never stored), its
 * answer is checked against my dogs and the people around them. Nothing is
 * planned nor sent: the owner reviews what was understood.
 */
export async function understandAbsence(groupId: string, text: string): Promise<ActionResult<ResolvedAbsence>> {
  if (!uuid.safeParse(groupId).success) return { ok: false, error: "Groupe introuvable." };
  const parsed = textSchema.safeParse(text);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const userId = await requireUserId();
  const [{ dogs, caretakers }, members, candidates, blocked] = await Promise.all([
    getGroupDogs(groupId),
    getGroupMembers(groupId),
    getInviteeCandidates(groupId),
    getMyBlockedIds(),
  ]);
  const { dogs: myDogs, people } = assistantContext({ me: userId, dogs, caretakers, members, circle: candidates, blocked });
  if (myDogs.length === 0) return { ok: false, error: "Aucun de vos chiens n'est dans ce groupe." };

  const now = Date.now();
  const result = await understandWithGemini(parsed.data, {
    today: todayLocal(now),
    weekday: WEEKDAY.format(now),
    dogs: myDogs.map((d) => d.name),
    people: people.map((p) => p.name),
  });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "unavailable"
          ? "Assistant indisponible pour l'instant : utilisez le formulaire ci-dessous."
          : "Je n'ai pas compris. Reformulez, ou utilisez le formulaire ci-dessous.",
    };
  }
  return { ok: true, data: resolveAbsenceIntent(result.intent, { dogs: myDogs, people, now }) };
}
