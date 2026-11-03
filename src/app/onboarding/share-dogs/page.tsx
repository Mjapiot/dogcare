import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyGroups, requireUserId } from "@/server/session";
import { getMyDogs, signDogPhotos } from "@/server/data";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { uuid } from "@/lib/validation";
import { ShareDogsForm } from "./share-dogs-form";
import { afterSharingDogs, dogsToShare } from "@/lib/onboarding";

export const metadata: Metadata = { title: "Partager vos chiens" };

/**
 * Entering a group (created, joined by code or link) with dogs already kept
 * without a group (passport first): share them with this group? Checked by
 * default, changeable later on the dog's page. Skipped when there is nothing to share.
 */
export default async function ShareDogsPage({ searchParams }: PageProps<"/onboarding/share-dogs">) {
  const userId = await requireUserId();
  const params = await searchParams;
  const next = (typeof params.next === "string" ? safeRedirectPath(params.next) : null) ?? "/";
  const groupId = typeof params.group === "string" && uuid.safeParse(params.group).success ? params.group : null;
  const group = groupId ? (await getMyGroups()).find((g) => g.id === groupId) : undefined;
  if (!group) redirect(next);

  const supabase = await createClient();
  const [dogs, { data: links }] = await Promise.all([
    getMyDogs(userId),
    supabase.from("group_dogs").select("dog_id").eq("group_id", group.id),
  ]);
  const inGroup = new Set((links ?? []).map((l) => l.dog_id as string));
  const toShare = dogsToShare(dogs, inGroup);
  if (toShare.length === 0) redirect(next);
  const photos = await signDogPhotos(toShare);
  // they already have a dog: no "add your dog" step after this one
  const after = afterSharingDogs(next);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-safe pb-safe">
      <div className="flex flex-1 flex-col justify-center gap-8 py-10">
        <div>
          <h1 className="text-[40px] font-semibold leading-[1] tracking-[-0.04em] text-ink">{`Vos chiens dans «\u00a0${group.name}\u00a0»`}</h1>
          <p className="mt-3 text-[17px] text-ink-2">
            Partagez-les pour demander de l&apos;aide au groupe. Leur santé et leurs urgences restent réglées par leur cercle de confiance.
          </p>
        </div>
        <ShareDogsForm
          groupId={group.id}
          dogs={toShare.map((d) => ({ id: d.id, name: d.name, photoUrl: photos[d.id] ?? null }))}
          next={after}
        />
      </div>
    </main>
  );
}
