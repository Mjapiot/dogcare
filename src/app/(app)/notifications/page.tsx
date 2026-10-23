import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, CircleAlert, CircleCheck, Clock, Flag, Inbox, Pencil, UserCheck, UserPlus, XCircle, type LucideIcon } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getNotifications } from "@/server/data";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState, PageTitle } from "@/components/ui/kit";
import { MarkAllRead } from "@/components/app/mark-all-read";
import type { NotificationType } from "@/lib/types";

export const metadata: Metadata = { title: "Notifications" };

const ICONS: Record<NotificationType, LucideIcon> = {
  new_request: Inbox,
  new_volunteer: UserCheck,
  assignment_confirmed: CircleCheck,
  assignment_cancelled: XCircle,
  reconfirmation_needed: CircleAlert,
  request_updated: Pencil,
  request_cancelled: XCircle,
  response_reset: Clock,
  member_joined: UserPlus,
  content_reported: Flag,
};

export default async function NotificationsPage() {
  await requireAppContext();
  const notifications = await getNotifications(60);
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="flex flex-col gap-5 pt-2">
      <PageTitle title="Notifications" action={unread > 0 ? <MarkAllRead /> : undefined} />
      {notifications.length === 0 ? (
        <EmptyState icon={BellOff} title="Aucune notification" description="Vous serez prévenu ici des nouvelles demandes, propositions d'aide et confirmations." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {notifications.map((n) => {
            const Icon = ICONS[n.notification_type];
            const inner = (
              <div className={cn("flex gap-3 rounded-2xl p-3.5", n.read_at ? "bg-surface/60" : "bg-surface")}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  <Icon className="size-5 text-ink" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[15px] text-ink", n.read_at ? "font-medium" : "font-semibold")}>
                    {!n.read_at && <span className="mr-1.5 inline-block size-2 rounded-full bg-[#b3261e] align-middle" aria-label="Non lue" />}
                    {n.title}
                  </p>
                  {n.body && <p className="mt-0.5 text-[14px] text-ink-2">{n.body}</p>}
                  <p className="mt-1 text-[12px] text-ink-3">{formatRelative(n.created_at)}</p>
                </div>
              </div>
            );
            return (
              <li key={n.id}>
                {n.request_id ? <Link href={`/requests/${n.request_id}`}>{inner}</Link> : inner}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
