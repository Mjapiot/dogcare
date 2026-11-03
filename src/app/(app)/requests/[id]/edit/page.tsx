import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAppContext } from "@/server/session";
import { getGroupSnapshot, getInviteeCandidates, getRequestGroupId } from "@/server/data";
import { toLocalDate, toLocalTime } from "@/domain/time";
import { uuid } from "@/lib/validation";
import { PageTitle } from "@/components/ui/kit";
import { RequestEditForm } from "@/components/domain/care-request-form";

export const metadata: Metadata = { title: "Modifier la demande" };

export default async function EditRequestPage({ params }: PageProps<"/requests/[id]/edit">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { userId } = await requireAppContext();
  const groupId = await getRequestGroupId(id);
  if (!groupId) notFound();
  const snapshot = await getGroupSnapshot(groupId, userId, { requestIds: [id] });
  const r = snapshot.requests[0];
  if (!r) notFound();
  const isCaretaker = snapshot.caretakers.some((c) => c.dog_id === r.dog_id && c.user_id === userId);
  if (!isCaretaker || r.lifecycle_status === "cancelled") redirect(`/requests/${id}`);
  const dog = snapshot.dogs.find((d) => d.id === r.dog_id);
  const hasAssignments = snapshot.assignments.some((a) => a.status !== "cancelled");
  const candidates = await getInviteeCandidates(groupId);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <PageTitle title="Modifier" subtitle={dog ? `Demande pour ${dog.name}` : undefined} />
      <RequestEditForm
        requestId={id}
        hasAssignments={hasAssignments}
        candidates={candidates}
        initialInvitees={(snapshot.invitees ?? []).map((i) => i.user_id)}
        initial={{
          dogId: r.dog_id,
          startDate: toLocalDate(r.starts_at),
          startTime: toLocalTime(r.starts_at),
          endDate: toLocalDate(r.ends_at),
          endTime: toLocalTime(r.ends_at),
          description: r.description ?? "",
        }}
      />
    </div>
  );
}
