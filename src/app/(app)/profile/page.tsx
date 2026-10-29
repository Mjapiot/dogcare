import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CalendarPlus, ChevronRight, HeartHandshake, LifeBuoy, Plus, ShieldCheck, Users } from "lucide-react";
import { getMyGroups, getUserEmail, requireAppContext } from "@/server/session";
import { getCalendarFeedToken, getGroupMemberCounts, getMyCircleDogs, getMyDogs, getYearGardes, signDogPhotos } from "@/server/data";
import { yearStart, yearStats, yearStatsLabel } from "@/domain/profile";
import { CIRCLE_KIND_LABELS } from "@/domain/circle";
import { initials } from "@/lib/format";
import { requestNow } from "@/server/clock";
import { PillLink, SectionTitle } from "@/components/ui/kit";
import { Rise, Stagger } from "@/components/ui/motion";
import { DogAvatar } from "@/components/domain/request-bits";
import { ProfileHeader } from "@/components/profile/profile-header";
import { AccountActions } from "@/components/profile/account-actions";
import { SettingsRow } from "@/components/profile/settings-row";
import { PushStatus } from "@/components/profile/push-status";
import { InstallRow } from "@/components/profile/install-row";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const { userId, profile } = await requireAppContext();
  const now = requestNow();
  const [email, groups, dogs, circleDogs, feedToken] = await Promise.all([
    getUserEmail(),
    getMyGroups(),
    getMyDogs(userId),
    getMyCircleDogs(),
    getCalendarFeedToken(),
  ]);
  const activeDogs = dogs.filter((d) => !d.archived_at);
  const archivedDogs = dogs.filter((d) => d.archived_at);
  const [photos, counts, gardes] = await Promise.all([
    signDogPhotos([...activeDogs, ...circleDogs.map((d) => ({ id: d.dog_id, photo_path: d.photo_path }))]),
    getGroupMemberCounts(groups.map((g) => g.id)),
    getYearGardes(userId, dogs.map((d) => d.id), yearStart(now)),
  ]);
  const thisYear = yearStatsLabel(yearStats(gardes, userId, dogs.map((d) => d.id), now));

  return (
    <Stagger className="flex flex-col gap-7 pt-2">
      {/* my card */}
      <Rise>
        <section className="shadow-soft flex flex-col gap-3 rounded-[32px] bg-surface p-5 ring-1 ring-white/70">
          <span className="flex size-16 items-center justify-center rounded-full bg-ink text-[22px] font-semibold text-surface" aria-hidden>
            {initials(profile.display_name)}
          </span>
          <ProfileHeader displayName={profile.display_name} email={email ?? null} />
          {thisYear && (
            <p className="flex items-center gap-2 rounded-2xl bg-sage/12 px-3 py-2 text-[14px] font-medium text-ink-2">
              <HeartHandshake className="size-4 shrink-0 text-sage" aria-hidden />
              Cette année : {thisYear}
            </p>
          )}
        </section>
      </Rise>

      {/* my world */}
      <Rise>
        <section className="flex flex-col gap-3" aria-labelledby="my-dogs">
          <SectionTitle>
            <span id="my-dogs">Mes chiens</span>
          </SectionTitle>
          <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {activeDogs.map((d) => (
              <li key={d.id} className="shrink-0">
                <Link href={`/dogs/${d.id}`} className="flex w-20 flex-col items-center gap-1.5">
                  <DogAvatar name={d.name} photoUrl={photos[d.id]} size={72} className="shadow-soft" />
                  <span className="w-full truncate text-center text-[14px] font-semibold text-ink">{d.name}</span>
                </Link>
              </li>
            ))}
            <li className="shrink-0">
              <Link href="/dogs/new" className="flex w-20 flex-col items-center gap-1.5">
                <span className="flex size-[72px] items-center justify-center rounded-full border-2 border-dashed border-ink/20 text-ink-2">
                  <Plus className="size-6" aria-hidden />
                </span>
                <span className="text-[14px] font-medium text-ink-2">Ajouter</span>
              </Link>
            </li>
          </ul>
          {activeDogs.length === 0 && (
            <p className="px-1 text-[14px] text-ink-3">Pas de chien ? Aucun souci : vous pouvez simplement aider les autres membres.</p>
          )}
          {archivedDogs.length > 0 && (
            <details className="rounded-2xl bg-surface/60 px-4 py-1 text-[14px] text-ink-2">
              <summary className="flex min-h-11 cursor-pointer items-center font-medium">Chiens archivés ({archivedDogs.length})</summary>
              <ul className="flex flex-col pb-2">
                {archivedDogs.map((d) => (
                  <li key={d.id}>
                    <Link href={`/dogs/${d.id}`} className="flex min-h-11 items-center underline-offset-2 hover:underline">
                      {d.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </Rise>

      {circleDogs.length > 0 && (
        <Rise>
          <section className="flex flex-col gap-3" aria-labelledby="circle-dogs">
            <SectionTitle action={<PillLink href="/circle" size="sm" variant="soft">Demandes</PillLink>}>
              <span id="circle-dogs">Chiens qui me sont confiés</span>
            </SectionTitle>
            <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {circleDogs.map((d) => (
                <li key={d.dog_id} className="shrink-0">
                  <Link href={`/dogs/${d.dog_id}`} className="flex w-20 flex-col items-center gap-1.5">
                    <DogAvatar name={d.name} photoUrl={photos[d.dog_id]} size={72} className="shadow-soft" />
                    <span className="w-full truncate text-center text-[14px] font-semibold text-ink">{d.name}</span>
                    <span className="text-[12px] text-ink-3">{CIRCLE_KIND_LABELS[d.role]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </Rise>
      )}

      <Rise>
        <section className="flex flex-col gap-3" aria-labelledby="my-groups">
          <SectionTitle
            action={
              <PillLink href="/onboarding/group" size="sm" variant="soft">
                <Plus className="size-4" aria-hidden /> Créer / rejoindre
              </PillLink>
            }
          >
            <span id="my-groups">Mes groupes</span>
          </SectionTitle>
          <ul className="flex flex-col gap-2">
            {groups.map((g) => (
              <li key={g.id}>
                <Link href={`/groups/${g.id}`} className="shadow-soft flex items-center gap-3 rounded-[24px] bg-surface p-3 ring-1 ring-white/70">
                  <span className="flex size-12 items-center justify-center rounded-full bg-beige">
                    <Users className="size-5 text-ink" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold text-ink">{g.name}</span>
                    <span className="block text-[13px] text-ink-3">
                      {counts[g.id] ?? 1} membre{(counts[g.id] ?? 1) > 1 ? "s" : ""} · {g.role === "admin" ? "Administrateur" : "Membre"}
                    </span>
                  </span>
                  <ChevronRight className="size-5 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </Rise>

      {/* settings */}
      <Rise>
        <section className="flex flex-col gap-3" aria-labelledby="settings">
          <SectionTitle>
            <span id="settings">Réglages</span>
          </SectionTitle>
          <ul className="shadow-soft flex flex-col divide-y divide-line rounded-[24px] bg-surface ring-1 ring-white/70">
            <li>
              <SettingsRow href="/profile/notifications" icon={Bell} label="Notifications" status={<PushStatus />} />
            </li>
            <li>
              <SettingsRow href="/profile/calendar" icon={CalendarPlus} label="Abonnement calendrier" status={feedToken ? "Abonné" : "Non"} />
            </li>
            <InstallRow />
            <li>
              <SettingsRow href="/confidentialite" icon={ShieldCheck} label="Confidentialité" />
            </li>
            <li>
              <SettingsRow href="/assistance" icon={LifeBuoy} label="Assistance" />
            </li>
          </ul>
        </section>
      </Rise>

      <Rise>
        <AccountActions />
      </Rise>
    </Stagger>
  );
}
