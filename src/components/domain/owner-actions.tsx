"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Send, Trash2 } from "lucide-react";
import { cancelCareRequest } from "@/server/actions/requests";
import { formatPeriod } from "@/lib/format";
import { shareLink } from "@/lib/native";
import { PillButton, PillLink } from "@/components/ui/kit";
import { ConfirmationDialog } from "./confirmation-dialog";

export function OwnerActions({
  requestId,
  dogName,
  period,
  showRelaunch,
}: {
  requestId: string;
  dogName: string;
  period: { start: number; end: number };
  showRelaunch: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // "Relancer": shares a real message through the phone's share sheet (or
  // copies it). No hidden notification is sent.
  const relaunch = async () => {
    const url = `${window.location.origin}/requests/${requestId}`;
    const text = `Quelqu'un peut-il aider pour ${dogName} (${formatPeriod(period.start, period.end)}) ? Répondez ici :`;
    const result = await shareLink({ title: "Dogcare", text, url });
    if (result === "copied") toast.success("Message copié, collez-le dans votre conversation de groupe");
  };

  return (
    <section className="flex flex-col gap-2" aria-label="Actions du propriétaire">
      {showRelaunch && (
        <PillButton variant="soft" onClick={relaunch}>
          <Send className="size-4" aria-hidden /> Relancer les membres
        </PillButton>
      )}
      <PillLink href={`/requests/${requestId}/edit`} variant="outline">
        <Pencil className="size-4" aria-hidden /> Modifier la demande
      </PillLink>
      <PillButton variant="danger" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" aria-hidden /> Annuler la demande
      </PillButton>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title="Annuler cette demande ?"
        description="Les gardes confirmées seront annulées et les personnes concernées prévenues. Cette action est définitive."
        confirmLabel="Annuler la demande"
        destructive
        withReason
        pending={pending}
        onConfirm={(reason) =>
          startTransition(async () => {
            const r = await cancelCareRequest(requestId, reason);
            if (!r.ok) return void toast.error(r.error);
            setOpen(false);
            toast.success("Demande annulée");
            router.refresh();
          })
        }
      />
    </section>
  );
}
