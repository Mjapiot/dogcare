import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ChevronRight, Plus, Users } from "lucide-react";
import { getMyGroups, getUserEmail, requireAppContext } from "@/server/session";
import { getCalendarFeedToken, getMyDogs, getNotificationPreferences, signDogPhotos } from "@/server/data";
import { Card, PillLink, SectionTitle } from "@/components/ui/kit";
import { DogAvatar } from "@/components/domain/request-bits";
import { InstallHint } from "@/components/pwa/install-hint";
import { ProfileHeader } from "@/components/profile/profile-header";
import { NotificationPrefs } from "@/components/profile/notification-prefs";
import { AccountActions } from "@/components/profile/account-actions";
import { PushSettings } from "@/components/profile/push-settings";
import { CalendarFeed } from "@/components/profile/calendar-feed";
import { getVapidPublicKey } from "@/server/push";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const { userId, profile } = await requireAppContext();
  const [email, groups, dogs, prefs, feedToken, h] = await Promise.all([
    getUserEmail(),
    getMyGroups(),
    getMyDogs(userId),
    getNotificationPreferences(),
    getCalendarFeedToken(),
    headers(),
  ]);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const photos = await signDogPhotos(dogs);
  const activeDogs = dogs.filter((d) => !d.archived_at);
  const archivedDogs = dogs.filter((d) => d.archived_at);

  return (
    <div className="flex flex-col gap-7 pt-2">
      <ProfileHeader displayName={profile.display_name} email={email ?? null} />

      <section className="flex flex-col gap-3">
        <SectionTitle action={<PillLink href="/dogs/new" size="sm" variant="soft"><Plus className="size-4" aria-hidden /> Ajouter</PillLink>}>
          Mes chiens
        </SectionTitle>
        {activeDogs.length === 0 ? (
          <Card className="text-[15px] text-ink-2">
            Pas de chien ? Aucun souci : vous pouvez simplement aider les autres membres.
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeDogs.map((d) => (
              <li key={d.id}>
                <Link href={`/dogs/${d.id}`} className="flex items-center gap-3 rounded-2xl bg-surface p-3">
                  <DogAvatar name={d.name} photoUrl={photos[d.id]} size={48} />
                  <span className="flex-1">
                    <span className="block text-[16px] font-semibold text-ink">{d.name}</span>
                    {d.breed && <span className="block text-[13px] text-ink-3">{d.breed}</span>}
                  </span>
                  <ChevronRight className="size-5 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {archivedDogs.length > 0 && (
          <details className="rounded-2xl bg-surface/60 px-4 py-2 text-[14px] text-ink-2">
            <summary className="flex min-h-11 cursor-pointer items-center py-1.5 font-medium">Chiens archivés ({archivedDogs.length})</summary>
            <ul className="flex flex-col gap-1 pb-2">
              {archivedDogs.map((d) => (
                <li key={d.id}>
                  <Link href={`/dogs/${d.id}`} className="flex min-h-11 items-center py-1.5 underline-offset-2 hover:underline">
                    {d.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle action={<PillLink href="/onboarding/group" size="sm" variant="soft"><Plus className="size-4" aria-hidden /> Créer / rejoindre</PillLink>}>
          Mes groupes
        </SectionTitle>
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="flex items-center gap-3 rounded-2xl bg-surface p-3">
                <span className="flex size-12 items-center justify-center rounded-full bg-beige">
                  <Users className="size-5 text-ink" aria-hidden />
                </span>
                <span className="flex-1">
                  <span className="block text-[16px] font-semibold text-ink">{g.name}</span>
                  <span className="block text-[13px] text-ink-3">{g.role === "admin" ? "Administrateur" : "Membre"}</span>
                </span>
                <ChevronRight className="size-5 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Mes gardes dans mon calendrier</SectionTitle>
        <CalendarFeed origin={origin} initialToken={feedToken} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Notifications</SectionTitle>
        <PushSettings vapidPublicKey={getVapidPublicKey()} preferences={<NotificationPrefs initial={prefs} />} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Installer l&apos;application</SectionTitle>
        <InstallHint always />
      </section>

      <AccountActions />

      <nav aria-label="Informations" className="flex justify-center gap-4 pb-2 text-[13px] text-ink-3">
        <Link href="/confidentialite" className="inline-flex min-h-11 items-center underline-offset-2 hover:underline">
          Confidentialité
        </Link>
        <Link href="/assistance" className="inline-flex min-h-11 items-center underline-offset-2 hover:underline">
          Assistance
        </Link>
      </nav>
    </div>
  );
}
