import type { Metadata } from "next";
import { PawPrint } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getGroupDogs, signDogPhotos } from "@/server/data";
import { todayLocal } from "@/domain/time";
import { EmptyState, PageTitle, PillLink } from "@/components/ui/kit";
import { CareRequestForm } from "@/components/domain/care-request-form";

export const metadata: Metadata = { title: "Ajouter un besoin" };

export default async function NewRequestPage({ searchParams }: PageProps<"/requests/new">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const { dogs, caretakers } = await getGroupDogs(group.id);
  const myDogs = dogs.filter((d) => !d.archived_at && caretakers.some((c) => c.dog_id === d.id && c.user_id === userId));
  const photos = await signDogPhotos(myDogs);
  const today = todayLocal();
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date >= today ? params.date : today;

  return (
    <div className="flex flex-col gap-6 pt-2">
      <PageTitle title="Nouveau besoin" subtitle={`Publié dans « ${group.name} »`} />
      {myDogs.length === 0 ? (
        <EmptyState
          icon={PawPrint}
          title="Aucun chien dans ce groupe"
          description="Ajoutez votre chien (ou partagez-le avec ce groupe) pour pouvoir demander de l'aide."
          action={<PillLink href="/dogs/new">Ajouter un chien</PillLink>}
        />
      ) : (
        <CareRequestForm
          groupId={group.id}
          dogs={myDogs.map((d) => ({ id: d.id, name: d.name, photoUrl: photos[d.id] ?? null }))}
          initial={{
            dogId: myDogs.length === 1 ? myDogs[0].id : "",
            requestType: "care",
            necessity: "required",
            startDate: date,
            startTime: "09:00",
            endDate: date,
            endTime: "18:00",
            description: "",
            splittable: true,
          }}
        />
      )}
    </div>
  );
}
