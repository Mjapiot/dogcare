import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CalendarPlus, ChevronRight, HeartHandshake, LifeBuoy, Plus, ShieldCheck, Users } from "lucide-react";
import { getMyGroups, getUserEmail, requireAppContext } from "@/server/session";
import { getCalendarFeedToken, getGroupMemberCounts, getMyDogs, getYearGardes } from "@/server/data";
import { yearStart, yearStats, yearStatsLabel } from "@/domain/profile";
import { initials } from "@/lib/format";
import { requestNow } from "@/server/clock";
import { PillLink, SectionTitle } from "@/components/ui/kit";
import { BigNumber } from "@/components/ui/editorial";
import { Rise, Stagger } from "@/components/ui/motion";
import { ProfileHeader } from "@/components/profile/profile-header";
import { AccountActions } from "@/components/profile/account-actions";
import { SettingsRow } from "@/components/profile/settings-row";
import { PushStatus } from "@/components/profile/push-status";
import { InstallRow } from "@/components/profile/install-row";
import { CareCapacity } from "@/components/profile/care-capacity";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const { userId, profile } = await requireAppContext();
  const now = requestNow();
  const [email, groups, dogs, feedToken] = await Promise.all([getUserEmail(), getMyGroups(), getMyDogs(userId), getCalendarFeedToken()]);
  // dogs live in the "Chiens" tab; here, what I gave this year, my groups and settings
  const [counts, gardes] = await Promise.all([
    getGroupMemberCounts(groups.map((g) => g.id)),
    getYearGardes(userId, dogs.map((d) => d.id), yearStart(now)),
  ]);
  const stats = yearStats(gardes, userId, dogs.map((d) => d.id), now);
  const thisYear = yearStatsLabel(stats);

  return (
    <Stagger className="flex flex-col gap-7 pt-2">
      {/* my card */}
      <Rise>
        <section className="shadow-soft flex flex-col gap-3 rounded-[32px] bg-surface p-5 ring-1 ring-white/70">
          <span className="flex size-16 items-center justify-center rounded-full bg-ink text-[22px] font-semibold text-surface" aria-hidden>
            {initials(profile.display_name)}
          </span>
          <ProfileHeader displayName={profile.display_name} email={email ?? null} />
        </section>
      </Rise>

      <Rise>
        <section aria-label="Cette année" className="rounded-[30px] bg-beige p-5 text-ink">
          <p className="text-[15px] font-medium">Cette année</p>
          <BigNumber className="mt-2" value={stats.given} unit={stats.given > 1 ? " gardes assurées" : " garde assurée"} />
          <p className="mt-2 flex items-center gap-2 text-[14px] text-ink-2">
            <HeartHandshake className="size-4 shrink-0 text-sage" aria-hidden />
            {thisYear ? `Cette année : ${thisYear}` : "Vos gardes terminées de l'année apparaîtront ici."}
          </p>
        </section>
      </Rise>

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
            <li>
              <CareCapacity initial={profile.max_dogs_at_once} />
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
