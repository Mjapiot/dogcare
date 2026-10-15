"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { signOut } from "@/server/actions/auth";
import { deleteMyAccount } from "@/server/actions/groups";
import { PillButton } from "@/components/ui/kit";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";
import { forgetThisDevice } from "./push-settings";

export function AccountActions() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <section className="flex flex-col gap-2 pb-4">
      <form
        action={async () => {
          // this device must stop receiving the account's notifications
          await forgetThisDevice();
          await signOut();
        }}
      >
        <PillButton type="submit" variant="outline" className="w-full">
          <LogOut className="size-4" aria-hidden /> Se déconnecter
        </PillButton>
      </form>
      <PillButton variant="ghost" className="text-[#9b1c14]" onClick={() => setOpen(true)}>
        Supprimer mon compte
      </PillButton>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title="Supprimer votre compte ?"
        description="Vos disponibilités, réponses et notifications seront supprimées. Les chiens dont vous êtes le seul responsable seront archivés. Cette action est définitive."
        confirmLabel="Supprimer définitivement"
        destructive
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            await forgetThisDevice();
            const r = await deleteMyAccount();
            if (!r.ok) return void toast.error(r.error);
            router.replace("/login");
          })
        }
      />
    </section>
  );
}
