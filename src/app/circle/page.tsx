import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, HeartHandshake, Users } from "lucide-react";
import { getMyGroups, getProfile, getUserEmail, requireUserId } from "@/server/session";
import { getMyCircleDogs, signDogPhotos } from "@/server/data";
import { CIRCLE_KIND_LABELS, guestState, lastGuestDay } from "@/domain/circle";
import { toLocalDate } from "@/domain/time";
import { Card, EmptyState, PillLink } from "@/components/ui/kit";
import { DogAvatar } from "@/components/domain/request-bits";
import { AccountActions } from "@/components/profile/account-actions";
import { Rise, Stagger } from "@/components/ui/motion";

export const metadata: Metadata = { title: "Chiens confiés" };

const DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" });
const dayLabel = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));

/**
 * Home of a person invited to one or more dogs' circles without being in a
 * group: the dogs they can see, and their account.
 */
export default async function CirclePage() {
  await requireUserId();
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect("/onboarding?next=/circle");
  const [dogs, groups, email] = await Promise.all([getMyCircleDogs(), getMyGroups(), getUserEmail()]);
  const photos = await signDogPhotos(dogs.map((d) => ({ id: d.dog_id, photo_path: d.photo_path })));
  const now = new Date();

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-safe pb-safe">
      <Stagger className="flex flex-col gap-6 pt-8 pb-10">
        <Rise>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.14em] text-sage uppercase">
            <HeartHandshake className="size-3.5" aria-hidden /> Bonjour {profile.display_name}
          </p>
          <h1 className="mt-2 text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">Chiens confiés</h1>
          {email && <p className="mt-1 text-[14px] text-ink-3">{email}</p>}
        </Rise>

        <Rise>
          {dogs.length === 0 ? (
            <EmptyState
              icon={HeartHandshake}
              title="Aucun chien pour l'instant"
              description="Quand le responsable d'un chien vous invitera dans son cercle, son passeport apparaîtra ici."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {dogs.map((d) => {
                const state = d.role === "guest" ? guestState(d, now) : "active";
                return (
                  <li key={d.dog_id}>
                    <Link
                      href={groups.length ? `/dogs/${d.dog_id}` : `/circle/${d.dog_id}`}
                      className="shadow-soft flex items-center gap-3 rounded-3xl bg-surface p-3 ring-1 ring-white/70"
                    >
                      <DogAvatar name={d.name} photoUrl={photos[d.dog_id]} size={56} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-semibold text-ink">{d.name}</span>
                        <span className="block text-[13px] text-ink-3">
                          {CIRCLE_KIND_LABELS[d.role]}
                          {d.ends_at &&
                            (state === "upcoming" && d.starts_at
                              ? ` · à partir du ${dayLabel(toLocalDate(d.starts_at))}`
                              : ` · jusqu'au ${dayLabel(lastGuestDay(d.ends_at))}`)}
                        </span>
                      </span>
                      <ChevronRight className="size-5 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Rise>

        {groups.length === 0 && (
          <Rise>
            <Card className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <Users className="size-4" aria-hidden /> Entre amis, c&apos;est encore mieux
              </p>
              <p className="text-[14px] text-ink-2">
                Avec un groupe Dogcare, vous organisez les gardes de vos chiens avec vos amis : disponibilités, demandes et
                jours sans solution, au même endroit.
              </p>
              <PillLink href="/onboarding/group" variant="soft">
                Créer ou rejoindre un groupe
              </PillLink>
            </Card>
          </Rise>
        )}

        <Rise>
          <AccountActions />
        </Rise>
      </Stagger>
    </main>
  );
}
