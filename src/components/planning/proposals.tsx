"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleCheck, Clock, Home, Undo2, X, XCircle, type LucideIcon } from "lucide-react";
import { answerProposal, withdrawProposal } from "@/server/actions/proposals";
import { formatPeriod } from "@/lib/format";
import { hapticSuccess } from "@/lib/native";
import { cn } from "@/lib/utils";
import { Card, PillButton, SectionTitle } from "@/components/ui/kit";
import type { CareProposalRow, ProposalStatus } from "@/lib/types";

const STATUS: Record<ProposalStatus, { label: string; icon: LucideIcon; tone: string }> = {
  pending: { label: "En attente", icon: Clock, tone: "bg-[var(--tone-pending)] text-[var(--tone-pending-ink)]" },
  accepted: { label: "Acceptée", icon: CircleCheck, tone: "bg-[var(--tone-covered)] text-[var(--tone-covered-ink)]" },
  declined: { label: "Refusée", icon: XCircle, tone: "bg-[var(--tone-uncovered)] text-[var(--tone-uncovered-ink)]" },
  withdrawn: { label: "Retirée", icon: Undo2, tone: "bg-surface-2 text-ink-3" },
};

function Slices({ proposal }: { proposal: Pick<CareProposalRow, "slices"> }) {
  return (
    <ul className="flex flex-col">
      {proposal.slices.map((s) => (
        <li key={s.starts_at} className="text-[14px] text-ink-2">
          {formatPeriod(s.starts_at, s.ends_at)}
        </li>
      ))}
    </ul>
  );
}

/** Proposals sent on a request, for the dog's caretakers. */
export function ProposalsSection({ proposals, names }: { proposals: CareProposalRow[]; names: Record<string, string> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (proposals.length === 0) return null;

  const withdraw = (id: string) =>
    startTransition(async () => {
      const r = await withdrawProposal(id);
      if (!r.ok) toast.error(r.error);
      else toast.success("Proposition retirée, la personne est prévenue");
      router.refresh();
    });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="proposals-title">
      <SectionTitle>
        <span id="proposals-title">Propositions envoyées</span>
      </SectionTitle>
      <p className="-mt-1 text-[14px] text-ink-3">
        Une proposition acceptée est un « Oui » : elle entre dans la proposition de planning, que vous confirmez ensuite.
      </p>
      <ul className="flex flex-col gap-2">
        {proposals.map((p) => {
          const s = STATUS[p.status];
          const name = names[p.user_id] ?? "Quelqu'un";
          return (
            <li key={p.id}>
              <Card className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">{name}</p>
                    <p className="inline-flex items-center gap-1 text-[13px] text-ink-3">
                      <Home className="size-3.5" aria-hidden /> {p.place === "owner" ? "Chez le propriétaire" : `Chez ${name}`}
                    </p>
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium", s.tone)}>
                    <s.icon className="size-3.5" aria-hidden /> {s.label}
                  </span>
                </div>
                <Slices proposal={p} />
                {p.status === "pending" && (
                  <PillButton variant="ghost" size="sm" className="self-start px-0 underline underline-offset-2" disabled={pending} onClick={() => withdraw(p.id)}>
                    Retirer la proposition
                  </PillButton>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type IncomingProposal = Pick<CareProposalRow, "id" | "slices" | "place"> & { dogName: string; ownerName?: string };

/** A proposal waiting for my answer: accept (a "Oui" on that part) or decline. */
export function ProposalCard({ proposal }: { proposal: IncomingProposal }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const answer = (accept: boolean) =>
    startTransition(async () => {
      const r = await answerProposal(proposal.id, accept);
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
        return;
      }
      if (accept) hapticSuccess();
      toast.success(accept ? "C'est noté : le propriétaire va confirmer" : "Réponse envoyée");
      router.refresh();
    });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <p className="text-[13px] font-medium uppercase tracking-wide text-ink-3">Proposition de garde</p>
        <p className="text-[17px] font-semibold tracking-tight text-ink">Pouvez-vous garder {proposal.dogName} ?</p>
        <p className="inline-flex items-center gap-1 text-[14px] text-ink-2">
          <Home className="size-3.5" aria-hidden /> {proposal.place === "owner" ? "Chez le propriétaire" : "Chez vous"}
        </p>
      </div>
      <Slices proposal={proposal} />
      <div className="grid grid-cols-2 gap-2">
        <PillButton loading={pending} onClick={() => answer(true)}>
          <Check className="size-4" aria-hidden /> Accepter
        </PillButton>
        <PillButton variant="outline" disabled={pending} onClick={() => answer(false)}>
          <X className="size-4" aria-hidden /> Refuser
        </PillButton>
      </div>
      <p className="text-[13px] text-ink-3">Accepter n&apos;engage pas encore : le propriétaire confirme ensuite la garde.</p>
    </Card>
  );
}
