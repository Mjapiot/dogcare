import type { Metadata } from "next";
import { getMyGroups, requireAppContext } from "@/server/session";
import { getMyAvailability } from "@/server/data";
import { addDays, dateRange, todayLocal } from "@/domain/time";
import { AVAILABILITY_HORIZON_DAYS } from "@/domain/config";
import { PageTitle } from "@/components/ui/kit";
import { AvailabilityEditor } from "@/components/availability/availability-editor";
import { RulesEditor } from "@/components/availability/rules-editor";
import { SharingSettings } from "@/components/availability/sharing-settings";

export const metadata: Metadata = { title: "Mes disponibilités" };

export default async function AvailabilityPage({ searchParams }: PageProps<"/availability">) {
  const { userId } = await requireAppContext();
  const params = await searchParams;
  const weeks = params.weeks === "4" ? 4 : 2;
  const today = todayLocal();
  const to = addDays(today, Math.min(weeks * 7, AVAILABILITY_HORIZON_DAYS) - 1);
  const [{ entries, rules }, groups] = await Promise.all([getMyAvailability(userId, today, to), getMyGroups()]);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <PageTitle title="Mes dispos" subtitle="Indiquez à l'avance quand vous pourriez aider. Ce n'est jamais un engagement." />
      {params.welcome === "1" && (
        <p className="rounded-2xl bg-[var(--tone-covered)] px-4 py-3 text-[15px] font-medium text-[var(--tone-covered-ink)]">
          Bienvenue ! Commencez par indiquer vos disponibilités des deux prochaines semaines.
        </p>
      )}
      <AvailabilityEditor
        key={weeks}
        dates={dateRange(today, to)}
        weeks={weeks}
        entries={entries.map((e) => ({ date: e.date, slot: e.slot, status: e.status }))}
        rules={rules.map((r) => ({ weekday: r.weekday, slot: r.slot, status: r.status }))}
      />
      <RulesEditor rules={rules.map((r) => ({ weekday: r.weekday, slot: r.slot, status: r.status }))} />
      <SharingSettings groups={groups.map((g) => ({ id: g.id, name: g.name, share: g.share_availability }))} />
    </div>
  );
}
