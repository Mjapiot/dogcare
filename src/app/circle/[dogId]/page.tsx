import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, HeartPulse, IdCard, Lock, Phone, Utensils } from "lucide-react";
import { getMyGroups, getProfile, requireUserId } from "@/server/session";
import { getDog, getDogCircle, getDogPassportPrivate, signDogPhotos } from "@/server/data";
import { uuid } from "@/lib/validation";
import { deName } from "@/lib/format";
import { todayLocal } from "@/domain/time";
import { DogAvatar } from "@/components/domain/request-bits";
import { PassportHero } from "@/components/dogs/passport-hero";
import { PassportSection } from "@/components/dogs/passport-section";
import { EmergencyView, HabitsView, HealthView, IdentityView } from "@/components/dogs/passport-view";
import { Rise, Stagger } from "@/components/ui/motion";
import { LeaveCircleButton } from "@/components/dogs/leave-circle-button";

export const metadata: Metadata = { title: "Passeport" };

/** A dog's passport, read-only, for someone in its circle but in none of its groups. */
export default async function CircleDogPage({ params }: PageProps<"/circle/[dogId]">) {
  const { dogId } = await params;
  if (!uuid.safeParse(dogId).success) notFound();
  await requireUserId();
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect("/onboarding");
  // members of a group use the full app
  if ((await getMyGroups()).length) redirect(`/dogs/${dogId}`);
  const data = await getDog(dogId);
  if (!data) notFound();
  const { dog } = data;
  const [photos, priv, circle] = await Promise.all([signDogPhotos([dog]), getDogPassportPrivate(dog.id), getDogCircle(dog.id)]);
  const today = todayLocal();
  const caretakers = circle.filter((m) => m.kind === "owner" || m.kind === "co_owner").map((m) => m.display_name);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-safe pb-safe">
      <Stagger className="flex flex-col gap-4 pt-4 pb-10">
        <Link href="/circle" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2">
          <ArrowLeft className="size-4" aria-hidden /> Chiens confiés
        </Link>
        <Rise>
          <PassportHero
            dog={dog}
            today={today}
            caption={caretakers.length ? `Responsable${caretakers.length > 1 ? "s" : ""} : ${caretakers.join(", ")}` : undefined}
            photo={<DogAvatar name={dog.name} photoUrl={photos[dog.id]} size={104} className="ring-4" />}
          />
        </Rise>
        <Rise>
          <PassportSection id="identity" title="Identité" icon={<IdCard />}>
            <IdentityView dog={dog} />
          </PassportSection>
        </Rise>
        <Rise>
          <PassportSection id="habits" title="Habitudes" icon={<Utensils />}>
            <HabitsView dog={dog} />
          </PassportSection>
        </Rise>
        {priv.access.health && (
          <Rise>
            <PassportSection id="health" title="Santé" icon={<HeartPulse />}>
              <HealthView health={priv.health} />
            </PassportSection>
          </Rise>
        )}
        {priv.access.emergency && (
          <Rise>
            <PassportSection id="emergency" title="Urgences" icon={<Phone />}>
              <EmergencyView emergency={priv.emergency} />
            </PassportSection>
          </Rise>
        )}
        {!(priv.access.health && priv.access.emergency) && (
          <Rise>
            <div className="flex items-start gap-3 rounded-3xl bg-surface-2 px-5 py-4">
              <Lock className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />
              <p className="text-[14px] text-ink-2">
                Certaines rubriques ne sont pas partagées avec vous. Demandez-les aux responsables {deName(dog.name)} si besoin.
              </p>
            </div>
          </Rise>
        )}
        <Rise>
          <div className="flex justify-center">
            <LeaveCircleButton dogId={dog.id} dogName={dog.name} />
          </div>
        </Rise>
      </Stagger>
    </main>
  );
}
