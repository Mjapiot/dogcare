import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, HeartPulse, IdCard, Lock, Phone, Utensils } from "lucide-react";
import { getMyGroups, requireAppContext } from "@/server/session";
import {
  getDog,
  getDogCircle,
  getDogPassportPrivate,
  getDogShareLinks,
  getMyCircleDogs,
  getPendingCircleInvitations,
  signDogPhotos,
} from "@/server/data";
import { uuid } from "@/lib/validation";
import { deName } from "@/lib/format";
import { todayLocal } from "@/domain/time";
import { DogAvatar } from "@/components/domain/request-bits";
import { PhotoUploader } from "@/components/dogs/photo-uploader";
import { DogManage } from "@/components/dogs/dog-manage";
import { ReportButton } from "@/components/domain/report-button";
import { PassportHero } from "@/components/dogs/passport-hero";
import { PassportSection } from "@/components/dogs/passport-section";
import { EmergencyView, HabitsView, HealthView, IdentityView } from "@/components/dogs/passport-view";
import { EmergencyEditor, HabitsEditor, HealthEditor, IdentityEditor } from "@/components/dogs/passport-editors";
import { PassportShare } from "@/components/dogs/passport-share";
import { CircleCard } from "@/components/dogs/circle-card";
import { LeaveCircleButton } from "@/components/dogs/leave-circle-button";
import { Rise, Stagger } from "@/components/ui/motion";

export const metadata: Metadata = { title: "Passeport" };

const PRIVATE_NOTE = "Visible selon les réglages du cercle de confiance.";

export default async function DogPage({ params }: PageProps<"/dogs/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { userId } = await requireAppContext();
  const data = await getDog(id);
  if (!data) notFound();
  const { dog, caretakers, groupIds } = data;
  const isCaretaker = caretakers.some((c) => c.user_id === userId);
  const [photos, myGroups, priv, links, circle, invitations, h, circleDogs] = await Promise.all([
    signDogPhotos([dog]),
    getMyGroups(),
    getDogPassportPrivate(dog.id),
    isCaretaker ? getDogShareLinks(dog.id) : Promise.resolve([]),
    getDogCircle(dog.id),
    isCaretaker ? getPendingCircleInvitations(dog.id) : Promise.resolve([]),
    headers(),
    isCaretaker ? Promise.resolve([]) : getMyCircleDogs(),
  ]);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const visibleGroups = myGroups.filter((g) => groupIds.includes(g.id));
  const today = todayLocal();
  const caretakerNames = circle
    .filter((m) => m.kind === "owner" || m.kind === "co_owner")
    .map((m) => m.display_name)
    .join(", ");
  const editable = isCaretaker && !dog.archived_at;

  return (
    <Stagger className="flex flex-col gap-4 pt-2">
      <Link href="/profile" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2">
        <ArrowLeft className="size-4" aria-hidden /> Profil
      </Link>

      <Rise>
        <PassportHero
          dog={dog}
          today={today}
          caption={
            dog.archived_at
              ? "Archivé — l'historique des gardes est conservé"
              : `Responsable${caretakers.length > 1 ? "s" : ""} : ${caretakerNames}`
          }
          photo={
            editable ? (
              <PhotoUploader dogId={dog.id} name={dog.name} photoUrl={photos[dog.id] ?? null} variant="badge" />
            ) : (
              <DogAvatar name={dog.name} photoUrl={photos[dog.id]} size={104} className="ring-4" />
            )
          }
        />
      </Rise>

      {editable && (
        <Rise>
          <PassportShare dogId={dog.id} dogName={dog.name} origin={origin} links={links} />
        </Rise>
      )}

      <Rise>
        <PassportSection
          id="identity"
          title="Identité"
          icon={<IdCard />}
          editor={
            editable && (
              <IdentityEditor
                dogId={dog.id}
                initial={{
                  name: dog.name,
                  breed: dog.breed ?? "",
                  birthDate: dog.birth_date ?? "",
                  sex: dog.sex ?? "",
                  sterilized: dog.sterilized === null ? "" : dog.sterilized ? "yes" : "no",
                  weight: dog.weight_kg === null ? "" : String(dog.weight_kg).replace(".", ","),
                  identification: dog.identification ?? "",
                  distinctiveMarks: dog.distinctive_marks ?? "",
                }}
              />
            )
          }
        >
          <IdentityView dog={dog} />
        </PassportSection>
      </Rise>

      <Rise>
        <PassportSection
          id="habits"
          title="Habitudes"
          icon={<Utensils />}
          editor={
            editable && (
              <HabitsEditor
                dogId={dog.id}
                initial={{
                  meals: dog.meals ?? "",
                  walks: dog.walks ?? "",
                  sleep: dog.sleep ?? "",
                  behavior: dog.behavior ?? "",
                  careNotes: dog.care_notes ?? "",
                }}
              />
            )
          }
        >
          <HabitsView dog={dog} />
        </PassportSection>
      </Rise>

      {priv.access.health || priv.access.emergency ? (
        <>
          {priv.access.health && (
            <Rise>
              <PassportSection
                id="health"
                title="Santé"
                icon={<HeartPulse />}
                note={PRIVATE_NOTE}
                editor={
                  editable && (
                    <HealthEditor
                      dogId={dog.id}
                      initial={{
                        allergies: priv.health?.allergies ?? "",
                        treatments: priv.health?.treatments ?? "",
                        vetName: priv.health?.vet_name ?? "",
                        vetClinic: priv.health?.vet_clinic ?? "",
                        vetPhone: priv.health?.vet_phone ?? "",
                        vetAddress: priv.health?.vet_address ?? "",
                        notes: priv.health?.notes ?? "",
                      }}
                    />
                  )
                }
              >
                <HealthView health={priv.health} />
              </PassportSection>
            </Rise>
          )}

          {priv.access.emergency && (
            <Rise>
              <PassportSection
                id="emergency"
                title="Urgences"
                icon={<Phone />}
                note={PRIVATE_NOTE}
                editor={
                  editable && (
                    <EmergencyEditor
                      dogId={dog.id}
                      initial={{ contacts: priv.emergency?.contacts ?? [], instructions: priv.emergency?.instructions ?? "" }}
                    />
                  )
                }
              >
                <EmergencyView emergency={priv.emergency} />
              </PassportSection>
            </Rise>
          )}
        </>
      ) : (
        <div className="flex items-start gap-3 rounded-3xl bg-surface-2 px-5 py-4">
          <Lock className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />
          <p className="text-[14px] text-ink-2">
            <span className="font-semibold text-ink">Santé et urgences</span> : vous les verrez pendant vos gardes{" "}
            {deName(dog.name)}, ou si ses responsables vous les ouvrent dans son cercle de confiance.
          </p>
        </div>
      )}

      {editable && (
        <Rise>
          <CircleCard dogId={dog.id} dogName={dog.name} origin={origin} me={userId} members={circle} invitations={invitations} />
        </Rise>
      )}

      {isCaretaker && (
        <div className="mt-4">
          <DogManage
            dogId={dog.id}
            archived={Boolean(dog.archived_at)}
            groups={myGroups.map((g) => ({ id: g.id, name: g.name }))}
            sharedGroupIds={groupIds}
          />
        </div>
      )}
      {!isCaretaker && visibleGroups[0] && (
        <ReportButton groupId={visibleGroups[0].id} targetType="dog" targetId={dog.id} label="Signaler cette fiche" />
      )}
      {circleDogs.some((d) => d.dog_id === dog.id) && <LeaveCircleButton dogId={dog.id} dogName={dog.name} />}
    </Stagger>
  );
}
