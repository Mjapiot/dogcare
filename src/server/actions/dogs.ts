"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  dogEmergencySchema,
  dogHabitsSchema,
  dogHealthSchema,
  dogIdentitySchema,
  dogSchema,
  shareLinkSchema,
  uuid,
} from "@/lib/validation";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import type { ActionResult } from "@/lib/types";

const PHOTO_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$/i;

export async function createDog(
  input: z.input<typeof dogSchema> & { groupIds: string[] },
): Promise<ActionResult<{ dogId: string }>> {
  const parsed = dogSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const groups = z.array(uuid).max(20).safeParse(input.groupIds);
  if (!groups.success) return { ok: false, error: "Groupes invalides." };
  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_dog", {
    p_name: parsed.data.name,
    p_group_ids: groups.data,
    p_breed: parsed.data.breed || null,
    p_birth_date: parsed.data.birthDate || null,
    p_care_notes: parsed.data.careNotes || null,
    p_special_needs: null,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: { dogId: data as string } };
}

const noFutureBirthDate = (birthDate: string) =>
  birthDate && birthDate > new Date().toISOString().slice(0, 10) ? "La date de naissance ne peut pas être dans le futur." : null;

/** Updates columns of `dogs` (identity or habits); RLS lets only caretakers do it. */
async function updateDogColumns(dogId: string, values: Record<string, string | number | boolean | null>): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success) return { ok: false, error: "Chien introuvable." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("dogs").update(values).eq("id", dogId).select("id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Seul un responsable du chien peut le modifier." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function updateDogIdentity(dogId: string, input: z.input<typeof dogIdentitySchema>): Promise<ActionResult> {
  const parsed = dogIdentitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const futureError = noFutureBirthDate(v.birthDate);
  if (futureError) return { ok: false, error: futureError };
  return updateDogColumns(dogId, {
    name: v.name,
    breed: v.breed || null,
    birth_date: v.birthDate || null,
    sex: v.sex || null,
    sterilized: v.sterilized === "" ? null : v.sterilized === "yes",
    weight_kg: v.weight ? Number(v.weight.replace(",", ".")) : null,
    identification: v.identification || null,
    distinctive_marks: v.distinctiveMarks || null,
  });
}

export async function updateDogHabits(dogId: string, input: z.input<typeof dogHabitsSchema>): Promise<ActionResult> {
  const parsed = dogHabitsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  return updateDogColumns(dogId, {
    meals: v.meals || null,
    walks: v.walks || null,
    sleep: v.sleep || null,
    behavior: v.behavior || null,
    care_notes: v.careNotes || null,
  });
}

export async function saveDogHealth(dogId: string, input: z.input<typeof dogHealthSchema>): Promise<ActionResult> {
  const parsed = dogHealthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!uuid.safeParse(dogId).success) return { ok: false, error: "Chien introuvable." };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_dog_health", {
    p_dog_id: dogId,
    p_allergies: v.allergies,
    p_treatments: v.treatments,
    p_vet_name: v.vetName,
    p_vet_clinic: v.vetClinic,
    p_vet_phone: v.vetPhone,
    p_vet_address: v.vetAddress,
    p_notes: v.notes,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/dogs/${dogId}`);
  return { ok: true, data: undefined };
}

export async function saveDogEmergency(dogId: string, input: z.input<typeof dogEmergencySchema>): Promise<ActionResult> {
  const parsed = dogEmergencySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!uuid.safeParse(dogId).success) return { ok: false, error: "Chien introuvable." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_dog_emergency", {
    p_dog_id: dogId,
    // relation is omitted when empty, as the database expects
    p_contacts: parsed.data.contacts.map((c) => (c.relation ? c : { name: c.name, phone: c.phone })),
    p_instructions: parsed.data.instructions,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/dogs/${dogId}`);
  return { ok: true, data: undefined };
}

/** Creates a temporary passport link; the token is returned once and never stored in clear. */
export async function createPassportLink(
  dogId: string,
  input: z.input<typeof shareLinkSchema>,
): Promise<ActionResult<{ token: string }>> {
  const parsed = shareLinkSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(dogId).success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_dog_share_link", {
    p_dog_id: dogId,
    p_expires_in_hours: parsed.data.hours,
    p_include_health: parsed.data.health,
    p_include_emergency: parsed.data.emergency,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/dogs/${dogId}`);
  return { ok: true, data: { token: data as string } };
}

export async function revokePassportLink(dogId: string, linkId: string): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success || !uuid.safeParse(linkId).success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_dog_share_link", { p_link_id: linkId });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/dogs/${dogId}`);
  return { ok: true, data: undefined };
}

export async function setDogPhoto(dogId: string, path: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success) return { ok: false, error: "Chien introuvable." };
  if (path !== null && (!PHOTO_PATH.test(path) || !path.startsWith(`${dogId}/`))) {
    return { ok: false, error: "Photo invalide." };
  }
  const supabase = await createClient();
  const { data: before } = await supabase.from("dogs").select("photo_path").eq("id", dogId).maybeSingle();
  const { data, error } = await supabase.from("dogs").update({ photo_path: path }).eq("id", dogId).select("id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Seul un responsable du chien peut changer sa photo." };
  const previous = (before as { photo_path: string | null } | null)?.photo_path;
  if (previous && previous !== path) await supabase.storage.from("dog-photos").remove([previous]);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function setDogArchived(dogId: string, archived: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success) return { ok: false, error: "Chien introuvable." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dogs")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", dogId)
    .select("id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Seul un responsable du chien peut l'archiver." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function setDogGroups(dogId: string, groupIds: string[], previous: string[]): Promise<ActionResult> {
  const parsed = z.object({ dogId: uuid, groupIds: z.array(uuid).max(20), previous: z.array(uuid) }).safeParse({ dogId, groupIds, previous });
  if (!parsed.success) return { ok: false, error: "Groupes invalides." };
  const supabase = await createClient();
  const toAdd = groupIds.filter((g) => !previous.includes(g));
  const toRemove = previous.filter((g) => !groupIds.includes(g));
  if (toAdd.length) {
    const { error } = await supabase.from("group_dogs").insert(toAdd.map((group_id) => ({ group_id, dog_id: dogId })));
    if (error) return { ok: false, error: toUserMessage(error) };
  }
  for (const groupId of toRemove) {
    const { error } = await supabase.from("group_dogs").delete().eq("group_id", groupId).eq("dog_id", dogId);
    if (error) {
      return {
        ok: false,
        error:
          error.code === "23503"
            ? "Ce chien a des demandes dans ce groupe : archivez-le plutôt que de le retirer."
            : toUserMessage(error),
      };
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function addCaretaker(dogId: string, userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_dog_caretaker", { p_dog_id: dogId, p_user_id: userId });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath(`/dogs/${dogId}`);
  return { ok: true, data: undefined };
}

export async function removeCaretaker(dogId: string, userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(dogId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Paramètres invalides." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("dog_caretakers").delete().eq("dog_id", dogId).eq("user_id", userId).select("user_id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Action non autorisée." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
