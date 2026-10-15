"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dogSchema, uuid } from "@/lib/validation";
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
    p_special_needs: parsed.data.specialNeeds || null,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: { dogId: data as string } };
}

export async function updateDog(dogId: string, input: z.input<typeof dogSchema>): Promise<ActionResult> {
  const parsed = dogSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!uuid.safeParse(dogId).success) return { ok: false, error: "Chien introuvable." };
  if (parsed.data.birthDate && parsed.data.birthDate > new Date().toISOString().slice(0, 10)) {
    return { ok: false, error: "La date de naissance ne peut pas être dans le futur." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dogs")
    .update({
      name: parsed.data.name,
      breed: parsed.data.breed || null,
      birth_date: parsed.data.birthDate || null,
      care_notes: parsed.data.careNotes || null,
      special_needs: parsed.data.specialNeeds || null,
    })
    .eq("id", dogId)
    .select("id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Seul un responsable du chien peut le modifier." };
  revalidatePath("/", "layout");
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
