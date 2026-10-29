import { getMyGroups, requireAppContext } from "@/server/session";
import { getMyInvitedRequests, getUnreadCount, getUpcomingStatusSnapshot } from "@/server/data";
import { buildRequestViews, needsMyAnswer } from "@/domain/views";
import { buildInvitedView } from "@/domain/invited";
import { requestNow } from "@/server/clock";
import { AppHeader } from "@/components/app/app-header";
import { BottomNavigation } from "@/components/app/bottom-navigation";
import { LiveUpdates } from "@/components/app/live-updates";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { userId, group } = await requireAppContext();
  const [groups, unread, upcoming, invited] = await Promise.all([
    getMyGroups(),
    getUnreadCount(),
    getUpcomingStatusSnapshot(group.id, userId),
    getMyInvitedRequests(),
  ]);
  // same rule as the "À répondre" list: my group's requests and those of the circles I am in
  const now = requestNow();
  const toAnswer =
    buildRequestViews(upcoming, now).filter(needsMyAnswer).length +
    invited.filter((r) => buildInvitedView(r, now).needsMyAnswer).length;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <AppHeader
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        currentGroupId={group.id}
        unread={unread}
      />
      <main className="flex-1 px-4 pb-nav">{children}</main>
      <BottomNavigation toAnswer={toAnswer} />
      <LiveUpdates groupId={group.id} userId={userId} />
    </div>
  );
}
