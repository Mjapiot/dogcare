import type { Metadata } from "next";
import Link from "next/link";
import { PawPrint, Plus } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getMyCircleDogs, getMyDogs, signDogPhotos } from "@/server/data";
import { CIRCLE_KIND_LABELS } from "@/domain/circle";
import { EmptyState, PillLink } from "@/components/ui/kit";
import { PillTabs } from "@/components/ui/editorial";
import { Rise, Stagger } from "@/components/ui/motion";
import { DogAvatar } from "@/components/domain/request-bits";

export const metadata: Metadata = { title: "Chiens" };

/** Soft color on top of each card (decoration only: the name says everything). */
const TOPS = ["bg-beige", "bg-[var(--tone-covered)]", "bg-[var(--tone-info)]", "bg-[var(--tone-pending)]"];

/** "Chiens": my dogs, and the dogs entrusted to me through a circle. */
export default async function DogsPage({ searchParams }: PageProps<"/dogs">) {
  const { userId } = await requireAppContext();
  const params = await searchParams;
  const trusted = params.vue === "confies";
  const [dogs, circleDogs] = await Promise.all([getMyDogs(userId), getMyCircleDogs()]);
  const mine = dogs.filter((d) => !d.archived_at);
  const photos = await signDogPhotos([...mine, ...circleDogs.map((d) => ({ id: d.dog_id, photo_path: d.photo_path }))]);
  const cards = trusted
    ? circleDogs.map((d) => ({ id: d.dog_id, name: d.name, sub: CIRCLE_KIND_LABELS[d.role] }))
    : mine.map((d) => ({ id: d.id, name: d.name, sub: d.breed || "Passeport, cercle, routines" }));

  return (
    <Stagger className="flex flex-col gap-5 pt-2">
      <Rise>
        <h1 className="text-[40px] font-light leading-[1.02] tracking-[-0.035em] text-ink">
          Les <b className="font-semibold">chiens</b> de ma vie
        </h1>
      </Rise>
      <Rise>
        <PillTabs
          label="Chiens"
          items={[
            { href: "/dogs", label: "Mes chiens", active: !trusted },
            { href: "/dogs?vue=confies", label: "Qu'on me confie", active: trusted },
          ]}
        />
      </Rise>
      <Rise>
        {cards.length === 0 ? (
          <EmptyState
            icon={PawPrint}
            title={trusted ? "Aucun chien ne vous est confié" : "Pas encore de chien"}
            description={trusted ? "Quand un propriétaire vous invitera dans le cercle de son chien, il apparaîtra ici." : "Ajoutez votre chien pour créer son passeport et organiser ses gardes."}
            action={trusted ? undefined : <PillLink href="/dogs/new">Ajouter un chien</PillLink>}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {cards.map((d, i) => (
              <li key={d.id}>
                <Link href={`/dogs/${d.id}`} className="shadow-soft flex flex-col overflow-hidden rounded-[28px] bg-surface active:scale-[0.98]">
                  <span className={`flex h-24 items-center justify-center ${TOPS[i % TOPS.length]}`}>
                    <DogAvatar name={d.name} photoUrl={photos[d.id]} size={64} />
                  </span>
                  <span className="flex flex-col px-4 pt-3 pb-4">
                    <span className="truncate text-[20px] font-semibold tracking-tight text-ink">{d.name}</span>
                    <span className="truncate text-[13px] text-ink-2">{d.sub}</span>
                  </span>
                </Link>
              </li>
            ))}
            {!trusted && (
              <li>
                <Link
                  href="/dogs/new"
                  className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-[28px] border-2 border-dashed border-ink/20 text-[15px] font-medium text-ink-2"
                >
                  <Plus className="size-6" aria-hidden /> Ajouter un chien
                </Link>
              </li>
            )}
          </ul>
        )}
      </Rise>
    </Stagger>
  );
}
