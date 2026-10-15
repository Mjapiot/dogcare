import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheck, Inbox, PawPrint, Plus } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getGroupSnapshot, getUpcomingRequestIds } from "@/server/data";
import { buildRequestViews, type RequestView } from "@/domain/views";
import { needsOrganizing } from "@/domain/status";
import { cn } from "@/lib/utils";
import { formatPeriod } from "@/lib/format";
import { EmptyState, PageTitle, PillLink } from "@/components/ui/kit";
import { RequestRow, RequestStatusBadge } from "@/components/domain/request-bits";
import { ResponseButtons } from "@/components/domain/response-buttons";
import { AssignmentActions } from "@/components/domain/assignment-actions";
import { requestNow } from "@/server/clock";

export const metadata: Metadata = { title: "Demandes" };

const TABS = [
  { key: "todo", label: "À répondre" },
  { key: "yes", label: "Mes oui" },
  { key: "no", label: "Mes non" },
  { key: "guards", label: "Mes gardes" },
  { key: "mine", label: "Mes demandes" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === params.tab) ? (params.tab as TabKey) : "todo";

  const ids = await getUpcomingRequestIds(group.id);
  const snapshot = await getGroupSnapshot(group.id, userId, { requestIds: ids });
  const views = buildRequestViews(snapshot, requestNow())
    .filter((v) => v.request.lifecycle_status === "active")
    .sort((a, b) => a.period.start - b.period.start);

  const lists: Record<TabKey, RequestView[]> = {
    todo: views.filter((v) => v.iAmEligible && !v.myResponse && v.request.necessity !== "info" && needsOrganizing(v.status.status)),
    yes: views.filter((v) => v.myResponse?.response_status === "yes" && v.myAssignments.length === 0),
    no: views.filter((v) => v.myResponse?.response_status === "no"),
    guards: views.filter((v) => v.myAssignments.length > 0),
    mine: views.filter((v) => v.iAmCaretaker),
  };
  const list = lists[tab];

  return (
    <div className="flex flex-col gap-5 pt-2">
      <PageTitle title="Demandes" subtitle="Répondez en un geste. Un « oui » est une proposition, pas un engagement." />

      <nav aria-label="Catégories" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "todo" ? "/requests" : `/requests?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium",
              tab === t.key ? "bg-ink text-surface" : "bg-surface text-ink-2",
            )}
          >
            {t.label}
            {lists[t.key].length > 0 && (
              <span className={cn("rounded-full px-1.5 text-[12px] tabular", tab === t.key ? "bg-white/20" : "bg-surface-2")}>
                {lists[t.key].length}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <EmptyState
          icon={tab === "todo" ? CheckCheck : tab === "guards" ? PawPrint : Inbox}
          title={
            tab === "todo"
              ? "Vous êtes à jour"
              : tab === "guards"
                ? "Aucune garde ne vous est confiée"
                : tab === "mine"
                  ? "Aucune demande en cours pour vos chiens"
                  : "Rien ici pour le moment"
          }
          description={tab === "todo" ? "Aucune demande n'attend votre réponse." : undefined}
          action={
            tab === "mine" ? (
              <PillLink href="/requests/new">
                <Plus className="size-4" aria-hidden /> Ajouter un besoin
              </PillLink>
            ) : undefined
          }
        />
      ) : tab === "mine" ? (
        <ul className="flex flex-col gap-2">
          {list.map((v) => (
            <li key={v.request.id}>
              <RequestRow view={v} href={`/requests/${v.request.id}`} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((v) => (
            <li key={v.request.id} className="flex flex-col gap-3 rounded-[24px] bg-surface p-4">
              <Link href={`/requests/${v.request.id}`} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[19px] font-semibold tracking-tight text-ink">{v.dog?.name}</span>
                  <RequestStatusBadge view={v} />
                </span>
                <span className="text-[14px] text-ink-2">{formatPeriod(v.period.start, v.period.end)}</span>
                <span className="text-[13px] text-ink-3">Pour {v.ownerNames.join(", ") || "un membre"}</span>
                {v.request.description && <span className="line-clamp-2 text-[14px] text-ink-2">« {v.request.description} »</span>}
              </Link>
              {tab === "guards" ? (
                <AssignmentActions view={v} />
              ) : (
                <ResponseButtons
                  requestId={v.request.id}
                  current={v.myResponse?.response_status ?? null}
                  period={v.period}
                  splittable={v.request.splittable}
                  proposed={
                    v.myResponse?.proposed_starts_at && v.myResponse.proposed_ends_at
                      ? { start: Date.parse(v.myResponse.proposed_starts_at), end: Date.parse(v.myResponse.proposed_ends_at) }
                      : null
                  }
                  size="sm"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
