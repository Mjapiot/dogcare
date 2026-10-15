import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getMyGroups, requireAppContext } from "@/server/session";
import { getDog, getGroupMembers, signDogPhotos } from "@/server/data";
import { uuid } from "@/lib/validation";
import { Card, PageTitle } from "@/components/ui/kit";
import { DogAvatar } from "@/components/domain/request-bits";
import { DogForm } from "@/components/dogs/dog-form";
import { PhotoUploader } from "@/components/dogs/photo-uploader";
import { DogManage } from "@/components/dogs/dog-manage";

export const metadata: Metadata = { title: "Chien" };

export default async function DogPage({ params }: PageProps<"/dogs/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { userId } = await requireAppContext();
  const data = await getDog(id);
  if (!data) notFound();
  const { dog, caretakers, groupIds } = data;
  const isCaretaker = caretakers.some((c) => c.user_id === userId);
  const [photos, myGroups] = await Promise.all([signDogPhotos([dog]), getMyGroups()]);
  const visibleGroups = myGroups.filter((g) => groupIds.includes(g.id));
  const membersByGroup = await Promise.all(visibleGroups.map((g) => getGroupMembers(g.id)));
  const people = new Map<string, string>();
  for (const list of membersByGroup) for (const m of list) people.set(m.user_id, m.display_name || "Membre");

  return (
    <div className="flex flex-col gap-6 pt-2">
      <Link href="/profile" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2">
        <ArrowLeft className="size-4" aria-hidden /> Profil
      </Link>
      <PageTitle title={dog.name} subtitle={dog.archived_at ? "Archivé — l'historique des gardes est conservé" : (dog.breed ?? undefined)} />

      {isCaretaker ? (
        <>
          <PhotoUploader dogId={dog.id} name={dog.name} photoUrl={photos[dog.id] ?? null} />
          <DogForm
            dogId={dog.id}
            initial={{
              name: dog.name,
              breed: dog.breed ?? "",
              birthDate: dog.birth_date ?? "",
              careNotes: dog.care_notes ?? "",
              specialNeeds: dog.special_needs ?? "",
            }}
          />
          <DogManage
            dogId={dog.id}
            archived={Boolean(dog.archived_at)}
            me={userId}
            groups={myGroups.map((g) => ({ id: g.id, name: g.name }))}
            sharedGroupIds={groupIds}
            caretakers={caretakers.map((c) => ({ userId: c.user_id, role: c.role, name: people.get(c.user_id) ?? "Membre" }))}
            candidates={[...people.entries()]
              .filter(([uid]) => !caretakers.some((c) => c.user_id === uid))
              .map(([uid, name]) => ({ userId: uid, name }))}
          />
        </>
      ) : (
        <Card className="flex flex-col gap-3">
          <DogAvatar name={dog.name} photoUrl={photos[dog.id]} size={72} />
          <p className="text-[15px] text-ink-2">
            Responsable{caretakers.length > 1 ? "s" : ""} : {caretakers.map((c) => people.get(c.user_id) ?? "Membre").join(", ")}
          </p>
          {dog.care_notes && <p className="whitespace-pre-line text-[15px] text-ink">{dog.care_notes}</p>}
          {dog.special_needs && <p className="whitespace-pre-line text-[15px] text-ink">{dog.special_needs}</p>}
        </Card>
      )}
    </div>
  );
}
