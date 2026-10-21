"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, UserPlus, X } from "lucide-react";
import { addCaretaker, removeCaretaker, setDogArchived, setDogGroups } from "@/server/actions/dogs";
import { Avatar, PillButton, Select, SectionTitle } from "@/components/ui/kit";
import { Switch } from "@/components/ui/switch";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";

export function DogManage({
  dogId,
  archived,
  me,
  groups,
  sharedGroupIds,
  caretakers,
  candidates,
}: {
  dogId: string;
  archived: boolean;
  me: string;
  groups: Array<{ id: string; name: string }>;
  sharedGroupIds: string[];
  caretakers: Array<{ userId: string; role: "owner" | "caretaker"; name: string }>;
  candidates: Array<{ userId: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [candidate, setCandidate] = useState("");
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

      <section className="flex flex-col gap-3">
        <SectionTitle>Responsables</SectionTitle>
        <p className="-mt-1 text-[14px] text-ink-3">Ils peuvent publier des demandes et confirmer les gardes pour ce chien.</p>
        <ul className="flex flex-col gap-1.5">
          {caretakers.map((c) => (
            <li key={c.userId} className="flex items-center gap-3 rounded-2xl bg-surface p-3">
              <Avatar name={c.name} />
              <span className="flex-1 text-[15px] font-medium text-ink">
                {c.name} {c.userId === me && <span className="text-ink-3">(vous)</span>}
              </span>
              {caretakers.length > 1 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeCaretaker(dogId, c.userId), "Responsable retiré")}
                  className="flex size-11 items-center justify-center rounded-full hover:bg-surface-2"
                  aria-label={`Retirer ${c.name} des responsables`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
        {candidates.length > 0 && (
          <div className="flex gap-2">
            <Select aria-label="Ajouter un responsable" value={candidate} onChange={(e) => setCandidate(e.target.value)} className="flex-1">
              <option value="">Ajouter un responsable…</option>
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
            </Select>
            <PillButton
              disabled={!candidate || pending}
              onClick={() => run(() => addCaretaker(dogId, candidate), "Responsable ajouté")}
              aria-label="Ajouter"
            >
              <UserPlus className="size-4" aria-hidden />
            </PillButton>
          </div>
        )}
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
