"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore } from "lucide-react";
import { setDogArchived, setDogGroups } from "@/server/actions/dogs";
import { PillButton, SectionTitle } from "@/components/ui/kit";
import { Switch } from "@/components/ui/switch";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";

export function DogManage({
  dogId,
  archived,
  groups,
  sharedGroupIds,
}: {
  dogId: string;
  archived: boolean;
  groups: Array<{ id: string; name: string }>;
  sharedGroupIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Erreur");
      toast.success(success);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <SectionTitle>Visible dans les groupes</SectionTitle>
        <ul className="flex flex-col divide-y divide-line rounded-[24px] bg-surface">
          {groups.map((g) => {
            const on = sharedGroupIds.includes(g.id);
            return (
              <li key={g.id} className="flex min-h-13 items-center justify-between gap-3 px-4">
                <label htmlFor={`dog-group-${g.id}`} className="text-[15px] font-medium text-ink">
                  {g.name}
                </label>
                <Switch
                  id={`dog-group-${g.id}`}
                  checked={on}
                  disabled={pending}
                  onCheckedChange={(c) =>
                    run(
                      () => setDogGroups(dogId, c ? [...sharedGroupIds, g.id] : sharedGroupIds.filter((x) => x !== g.id), sharedGroupIds),
                      c ? "Chien partagé avec le groupe" : "Chien retiré du groupe",
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </section>

      {archived ? (
        <PillButton variant="outline" disabled={pending} onClick={() => run(() => setDogArchived(dogId, false), "Chien réactivé")}>
          <ArchiveRestore className="size-4" aria-hidden /> Réactiver ce chien
        </PillButton>
      ) : (
        <PillButton variant="danger" onClick={() => setArchiveOpen(true)}>
          <Archive className="size-4" aria-hidden /> Archiver ce chien
        </PillButton>
      )}
      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archiver ce chien ?"
        description="Il ne pourra plus faire l'objet de nouvelles demandes. L'historique des gardes est conservé et vous pourrez le réactiver."
        confirmLabel="Archiver"
        destructive
        pending={pending}
        onConfirm={() => {
          setArchiveOpen(false);
          run(() => setDogArchived(dogId, true), "Chien archivé");
        }}
      />
    </div>
  );
}
