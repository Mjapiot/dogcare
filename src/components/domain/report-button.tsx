"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Flag } from "lucide-react";
import { reportContent } from "@/server/actions/moderation";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";

/** "Signaler" link: sends a report (with an optional reason) after confirmation. */
export function ReportButton({
  groupId,
  targetType,
  targetId,
  label,
}: {
  groupId: string;
  targetType: "request" | "dog" | "member";
  targetId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 self-center rounded-full px-3 text-[14px] font-medium text-ink-3 hover:bg-surface-2 hover:text-ink"
      >
        <Flag className="size-4" aria-hidden /> {label}
      </button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        description="Le signalement est transmis aux administrateurs du groupe et à l'équipe Dogcare, sans votre nom. Pour ne plus voir les demandes d'un membre, vous pouvez aussi le bloquer depuis la page du groupe."
        withReason
        reasonLabel="Que se passe-t-il ? (facultatif)"
        confirmLabel="Envoyer le signalement"
        cancelLabel="Annuler"
        pending={pending}
        onConfirm={(reason) =>
          startTransition(async () => {
            const r = await reportContent({ groupId, targetType, targetId, reason });
            if (!r.ok) return void toast.error(r.error);
            setOpen(false);
            toast.success("Signalement envoyé. Merci.");
          })
        }
      />
    </>
  );
}
