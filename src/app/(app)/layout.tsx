import { getMyGroups, requireAppContext } from "@/server/session";
import { getToAnswerCount, getUnreadCount } from "@/server/data";
import { AppHeader } from "@/components/app/app-header";
import { BottomNavigation } from "@/components/app/bottom-navigation";
import { LiveUpdates } from "@/components/app/live-updates";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { userId, group } = await requireAppContext();
  const [groups, unread, toAnswer] = await Promise.all([
    getMyGroups(),
    getUnreadCount(),
    getToAnswerCount(group.id, userId),
  ]);

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
