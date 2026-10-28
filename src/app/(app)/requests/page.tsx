import type { Metadata } from "next";
import { CheckCheck, ChevronDown, Inbox, PawPrint, Plus } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getMyInvitedRequests, getUpcomingSnapshot, signDogPhotos } from "@/server/data";
import { buildRequestViews } from "@/domain/views";
import { buildInvitedView } from "@/domain/invited";
import { HORIZON_LABELS, fromGroupView, fromInvitedView, groupByHorizon, splitScreenItems } from "@/domain/requests-screen";
import { requestNow } from "@/server/clock";
import { EmptyState, PageTitle, PillLink } from "@/components/ui/kit";
import { Rise, Stagger } from "@/components/ui/motion";
import { ScreenTabs } from "@/components/requests/screen-tabs";
import { AnimatedList } from "@/components/requests/animated-list";
import { RequestCard } from "@/components/requests/request-card";
import { OwnerRequestCard } from "@/components/requests/owner-request-card";

export const metadata: Metadata = { title: "Demandes" };

type TabKey = "todo" | "guards" | "mine";

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const tab: TabKey = params.tab === "guards" || params.tab === "mine" ? params.tab : "todo";
  const now = requestNow();

  // my groups' requests (current group) and those of the circles I am in
  const [snapshot, invited] = await Promise.all([getUpcomingSnapshot(group.id, userId), getMyInvitedRequests()]);
  const views = buildRequestViews(snapshot, now).filter((v) => v.request.lifecycle_status === "active");
  const items = [
    ...views.map((v) => fromGroupView(v, now)),
    ...invited.map((r) => fromInvitedView(buildInvitedView(r, now))),
  ];
  const lists = splitScreenItems(items, now);
  const mine = views.filter((v) => v.iAmCaretaker).sort((a, b) => a.period.start - b.period.start);
  const photos = await signDogPhotos([
    ...snapshot.dogs,
    ...invited.map((r) => ({ id: r.dog_id, photo_path: r.dog_photo_path })),
  ]);

  const card = (item: (typeof items)[number], mode: "answer" | "guard") => ({
    key: item.key,
    node: <RequestCard item={item} photoUrl={photos[item.dogId] ?? null} mode={mode} now={now} />,
  });

  return (
    <Stagger className="flex flex-col gap-5 pt-2">
      <Rise>
        <PageTitle
          title="Demandes"
          subtitle="Un « oui » est une proposition : la garde n'est confiée qu'une fois confirmée."
          action={
            <PillLink href="/requests/new" size="sm" variant="soft">
              <Plus className="size-4" aria-hidden /> Besoin
            </PillLink>
          }
        />
      </Rise>

      <Rise>
        <ScreenTabs
          active={tab}
          tabs={[
            { key: "todo", label: "À répondre", href: "/requests", count: lists.todo.length },
            { key: "guards", label: "Mes gardes", href: "/requests?tab=guards", count: lists.guards.length },
            // counters only where something is expected from me (and it fits a phone)
            { key: "mine", label: "Mes demandes", href: "/requests?tab=mine", count: 0 },
          ]}
        />
      </Rise>

      {tab === "todo" && (
        <Rise className="flex flex-col gap-5">
          {lists.todo.length === 0 ? (
            <EmptyState icon={CheckCheck} title="Vous êtes à jour" description="Aucune demande n'attend votre réponse." />
          ) : (
            groupByHorizon(lists.todo, now).map((g) => (
              <section key={g.horizon} className="flex flex-col gap-2.5" aria-label={HORIZON_LABELS[g.horizon]}>
                <h2 className="px-1 text-[13px] font-semibold tracking-wide text-ink-3 uppercase">{HORIZON_LABELS[g.horizon]}</h2>
                <AnimatedList className="flex flex-col gap-3" items={g.items.map((i) => card(i, "answer"))} />
              </section>
            ))
          )}

          {lists.answered.length > 0 && (
            <details className="group rounded-[24px] bg-surface/60 ring-1 ring-white/70">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                Déjà répondu ({lists.answered.length})
                <ChevronDown className="size-5 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="px-3 pb-3">
                <p className="px-1 pb-3 text-[13px] text-ink-3">Vous pouvez encore changer d&apos;avis tant que personne n&apos;est confirmé.</p>
                <AnimatedList className="flex flex-col gap-3" items={lists.answered.map((i) => card(i, "answer"))} />
              </div>
            </details>
          )}
        </Rise>
      )}

      {tab === "guards" && (
        <Rise>
          {lists.guards.length === 0 ? (
            <EmptyState icon={PawPrint} title="Aucune garde ne vous est confiée" description="Quand un propriétaire confirmera votre aide, elle apparaîtra ici." />
          ) : (
            <AnimatedList className="flex flex-col gap-3" items={lists.guards.map((i) => card(i, "guard"))} />
          )}
        </Rise>
      )}

      {tab === "mine" && (
        <Rise>
          {mine.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Aucune demande en cours pour vos chiens"
              action={
                <PillLink href="/requests/new">
                  <Plus className="size-4" aria-hidden /> Ajouter un besoin
                </PillLink>
              }
            />
          ) : (
            <AnimatedList
              className="flex flex-col gap-3"
              items={mine.map((v) => ({ key: v.request.id, node: <OwnerRequestCard view={v} photoUrl={v.dog ? (photos[v.dog.id] ?? null) : null} /> }))}
            />
          )}
        </Rise>
      )}
    </Stagger>
  );
}
