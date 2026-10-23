import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getMyGroups, requireAppContext } from "@/server/session";
import { getGroupJoinCode, getGroupMembers, getInvitations, getMyBlockedIds } from "@/server/data";
import { uuid } from "@/lib/validation";
import { PageTitle } from "@/components/ui/kit";
import { GroupManage } from "@/components/groups/group-manage";
import { requestNow } from "@/server/clock";

export const metadata: Metadata = { title: "Groupe" };

export default async function GroupPage({ params }: PageProps<"/groups/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { userId } = await requireAppContext();
  const group = (await getMyGroups()).find((g) => g.id === id);
  if (!group) notFound();
  const isAdmin = group.role === "admin";
  const [members, invitations, joinCode, blockedIds] = await Promise.all([
    getGroupMembers(id),
    isAdmin ? getInvitations(id) : Promise.resolve([]),
    isAdmin ? getGroupJoinCode(id) : Promise.resolve(null),
    getMyBlockedIds(),
  ]);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <Link href="/profile" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2">
        <ArrowLeft className="size-4" aria-hidden /> Profil
      </Link>
      <PageTitle title={group.name} subtitle={`${members.length} membre${members.length > 1 ? "s" : ""}`} />
      <GroupManage
        joinCode={joinCode}
        blockedIds={blockedIds}
        groupId={id}
        groupName={group.name}
        me={userId}
        isAdmin={isAdmin}
        members={members.map((m) => ({ userId: m.user_id, name: m.display_name || "Membre", role: m.role }))}
        invitations={invitations
          .filter((i) => !i.revoked_at && new Date(i.expires_at).getTime() > requestNow() && i.use_count < i.max_uses)
          .map((i) => ({ id: i.id, expiresAt: i.expires_at, uses: i.use_count, maxUses: i.max_uses }))}
      />
    </div>
  );
}
