"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, X } from "lucide-react";
import { answerReconfirmation, cancelAssignment } from "@/server/actions/requests";
import { formatPeriod } from "@/lib/format";
import type { CareAssignmentRow } from "@/lib/types";
import { PillButton } from "@/components/ui/kit";
import { ConfirmationDialog } from "./confirmation-dialog";

type MyAssignment = Pick<CareAssignmentRow, "id" | "starts_at" | "ends_at" | "status" | "previous_starts_at" | "previous_ends_at">;

/** Actions of a helper on the assignments entrusted to them. */
export function AssignmentActions({ assignments }: { assignments: MyAssignment[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelId, setCancelId] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Erreur");
      toast.success(success);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      {assignments.map((a) => (
        <div key={a.id} className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3">
          {a.status === "pending_reconfirmation" ? (
            <>
              <p className="flex items-start gap-2 text-[14px] font-medium text-[var(--tone-pending-ink)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Les horaires ont changé. Merci de reconfirmer.
              </p>
              {a.previous_starts_at && a.previous_ends_at && (
                <p className="text-[14px] text-ink-3 line-through">Avant : {formatPeriod(a.previous_starts_at, a.previous_ends_at)}</p>
              )}
              <p className="text-[15px] font-semibold text-ink">Désormais : {formatPeriod(a.starts_at, a.ends_at)}</p>
              <div className="grid grid-cols-2 gap-2">
                <PillButton size="sm" disabled={pending} onClick={() => run(() => answerReconfirmation(a.id, true), "Garde reconfirmée")}>
                  <Check className="size-4" aria-hidden /> Je confirme
                </PillButton>
                <PillButton size="sm" variant="outline" disabled={pending} onClick={() => run(() => answerReconfirmation(a.id, false), "Le propriétaire est prévenu")}>
                  <X className="size-4" aria-hidden /> Je ne peux plus
                </PillButton>
              </div>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--tone-covered-ink)]">
                <Check className="size-4" aria-hidden /> Garde confirmée : {formatPeriod(a.starts_at, a.ends_at)}
              </p>
              <PillButton size="sm" variant="danger" disabled={pending} onClick={() => setCancelId(a.id)} className="self-start">
                Je ne peux plus assurer cette garde
              </PillButton>
            </>
          )}
        </div>
      ))}
      <ConfirmationDialog
        open={cancelId !== null}
        onOpenChange={(o) => !o && setCancelId(null)}
        title="Annuler cette garde ?"
        description="Le propriétaire sera prévenu immédiatement et le créneau redeviendra à organiser."
        confirmLabel="Oui, annuler la garde"
        destructive
        withReason
        reasonLabel="Un mot pour le propriétaire (facultatif)"
        pending={pending}
        onConfirm={(reason) => {
          const id = cancelId;
          if (!id) return;
          run(() => cancelAssignment(id, reason), "Garde annulée, le propriétaire est prévenu");
          setCancelId(null);
        }}
      />
    </div>
  );
}
