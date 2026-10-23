"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { blockMember, unblockMember } from "@/server/actions/moderation";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";
import { ReportButton } from "@/components/domain/report-button";

/** Report / block another member (App Store guideline 1.2). */
export function MemberSafetyActions({
  groupId,
  userId,
  name,
  blocked,
}: {
  groupId: string;
  userId: string;
  name: string;
  blocked: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Erreur");
      setConfirm(false);
      toast.success(success);
      router.refresh();
    });

  return (
    <span className="flex flex-wrap gap-1">
      <ReportButton groupId={groupId} targetType="member" targetId={userId} label="Signaler" />
      {blocked ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => unblockMember(userId), "Membre débloqué")}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <Ban className="size-4" aria-hidden /> Débloquer
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <Ban className="size-4" aria-hidden /> Bloquer
        </button>
      )}
      <ConfirmationDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Bloquer ${name} ?`}
        description="Vous ne verrez plus ses demandes de garde et cette personne ne verra plus les vôtres. Aucune notification ne circulera plus entre vous. Les gardes déjà confirmées restent visibles. Vous pourrez débloquer à tout moment."
        confirmLabel="Bloquer"
        cancelLabel="Annuler"
        destructive
        pending={pending}
        onConfirm={() => run(() => blockMember(userId), "Membre bloqué")}
      />
    </span>
  );
}
