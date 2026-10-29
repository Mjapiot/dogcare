import type { Metadata } from "next";
import { Repeat } from "lucide-react";
import { getMyGroups, requireAppContext } from "@/server/session";
import { getMyAvailability, getMyInvitedRequests, getUpcomingSnapshot } from "@/server/data";
import { addDays, todayLocal } from "@/domain/time";
import { buildRequestViews } from "@/domain/views";
import { buildInvitedView } from "@/domain/invited";
import { fromGroupView, fromInvitedView } from "@/domain/requests-screen";
import { habitsSummary, needsByDay, weekStarts } from "@/domain/availability-screen";
import { requestNow } from "@/server/clock";
import { PageTitle } from "@/components/ui/kit";
import { Rise, Stagger } from "@/components/ui/motion";
import { ScreenTabs } from "@/components/requests/screen-tabs";
import { WeekEditor } from "@/components/availability/week-editor";
import { RulesEditor } from "@/components/availability/rules-editor";
import { SharingSettings } from "@/components/availability/sharing-settings";

export const metadata: Metadata = { title: "Mes disponibilités" };

type Tab = "days" | "habits" | "sharing";

export default async function AvailabilityPage({ searchParams }: PageProps<"/availability">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const tab: Tab = params.tab === "habits" || params.tab === "sharing" ? params.tab : "days";
  const today = todayLocal();
  const now = requestNow();
  const mondays = weekStarts(today);
  // the week before the first one too, for "Comme la semaine dernière"
  const [{ entries, rules }, groups, snapshot, invited] = await Promise.all([
    getMyAvailability(userId, addDays(mondays[0], -7), addDays(mondays.at(-1)!, 6)),
    getMyGroups(),
    tab === "days" ? getUpcomingSnapshot(group.id, userId) : Promise.resolve(null),
    tab === "days" ? getMyInvitedRequests() : Promise.resolve([]),
  ]);
  const ruleList = rules.map((r) => ({ weekday: r.weekday, slot: r.slot, status: r.status }));
  const needs = snapshot
    ? needsByDay(
        [
          ...buildRequestViews(snapshot, now).map((v) => fromGroupView(v, now)),
          ...invited.map((r) => fromInvitedView(buildInvitedView(r, now))),
        ]
          .filter((i) => i.needsMyAnswer)
          .map((i) => ({ requestId: i.requestId, href: i.href, dogName: i.dogName, period: i.period })),
      )
    : {};

  return (
    <Stagger className="flex flex-col gap-5 pt-2">
      <Rise>
        <PageTitle title="Mes dispos" subtitle="Indiquez à l'avance quand vous pourriez aider. Ce n'est jamais un engagement." />
      </Rise>
      <Rise>
        <ScreenTabs
          active={tab}
          tabs={[
            { key: "days", label: "Prochains jours", href: "/availability", count: 0 },
            { key: "habits", label: "Habitudes", href: "/availability?tab=habits", count: 0 },
            { key: "sharing", label: "Partage", href: "/availability?tab=sharing", count: 0 },
          ]}
        />
      </Rise>

      {tab === "days" && (
        <Rise>
          <WeekEditor
            mondays={mondays}
            today={today}
            entries={entries.map((e) => ({ date: e.date, slot: e.slot, status: e.status }))}
            rules={ruleList}
            needs={needs}
          />
        </Rise>
      )}

      {tab === "habits" && (
        <Rise className="flex flex-col gap-4">
          <div className="glass flex items-start gap-3 rounded-[24px] p-4">
            <Repeat className="mt-0.5 size-5 shrink-0 text-sage" aria-hidden />
            <div>
              <p className="text-[15px] font-semibold text-ink">{habitsSummary(ruleList)}</p>
              <p className="mt-1 text-[13px] text-ink-3">
                Une habitude se répète chaque semaine. Ce que vous saisissez jour par jour reste toujours prioritaire.
              </p>
            </div>
          </div>
          <RulesEditor rules={ruleList} embedded />
        </Rise>
      )}

      {tab === "sharing" && (
        <Rise>
          <SharingSettings groups={groups.map((g) => ({ id: g.id, name: g.name, share: g.share_availability }))} />
        </Rise>
      )}
    </Stagger>
  );
}
