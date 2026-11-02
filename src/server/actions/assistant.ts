"use server";

import { z } from "zod";
import { uuid } from "@/lib/validation";
import { resolveAbsenceIntent, type ResolvedAbsence } from "@/domain/absence-intent";
import { todayLocal } from "@/domain/time";
import { requireUserId } from "@/server/session";
import { getGroupDogs, getGroupMembers, getInviteeCandidates } from "@/server/data";
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
  const [{ dogs, caretakers }, members, candidates] = await Promise.all([
    getGroupDogs(groupId),
    getGroupMembers(groupId),
    getInviteeCandidates(groupId),
  ]);
  const myDogs = dogs.filter((d) => !d.archived_at && caretakers.some((c) => c.dog_id === d.id && c.user_id === userId));
  if (myDogs.length === 0) return { ok: false, error: "Aucun de vos chiens n'est dans ce groupe." };
  const myDogIds = new Set(myDogs.map((d) => d.id));
  const careIds = new Set(caretakers.filter((c) => myDogIds.has(c.dog_id)).map((c) => c.user_id));
  const people = [
    ...members.filter((m) => !careIds.has(m.user_id)).map((m) => ({ userId: m.user_id, name: m.display_name })),
    ...candidates.filter((c) => myDogIds.has(c.dog_id)).map((c) => ({ userId: c.user_id, name: c.display_name })),
  ].filter((p, i, all) => p.name.trim() && all.findIndex((q) => q.userId === p.userId) === i);

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
