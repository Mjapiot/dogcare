import type { Metadata } from "next";
import { getMyGroups, requireAppContext } from "@/server/session";
import { PageTitle, PillLink } from "@/components/ui/kit";
import { DogForm } from "@/components/dogs/dog-form";

export const metadata: Metadata = { title: "Ajouter un chien" };

export default async function NewDogPage({ searchParams }: PageProps<"/dogs/new">) {
  const { group } = await requireAppContext();
  const params = await searchParams;
  const welcome = params.welcome === "1";
  const groups = await getMyGroups();

  return (
    <div className="flex flex-col gap-6 pt-2">
      <PageTitle
        title={welcome ? "Votre chien" : "Nouveau chien"}
        subtitle={welcome ? "Facultatif : vous pouvez aussi simplement aider les autres." : undefined}
      />
      <DogForm
        initial={{ name: "", breed: "", birthDate: "", careNotes: "", specialNeeds: "" }}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        defaultGroupIds={[group.id]}
        afterCreate={welcome ? "/availability?welcome=1" : undefined}
      />
      {welcome && (
        <PillLink href="/availability?welcome=1" variant="ghost">
          Passer cette étape
        </PillLink>
      )}
    </div>
  );
}
