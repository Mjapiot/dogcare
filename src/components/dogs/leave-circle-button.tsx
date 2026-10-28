"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { leaveDogCircle } from "@/server/actions/circle";
import { deName } from "@/lib/format";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";

/** A close person or guest leaves a dog's circle (also stops its requests). */
export function LeaveCircleButton({ dogId, dogName }: { dogId: string; dogName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 self-center rounded-full px-3 text-[14px] font-medium text-ink-3 hover:bg-surface-2 hover:text-ink"
      >
        <LogOut className="size-4" aria-hidden /> Quitter le cercle {deName(dogName)}
      </button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title={`Quitter le cercle ${deName(dogName)} ?`}
        description="Vous ne verrez plus son passeport ni ses demandes. Si une garde vous est confiée, elle sera annulée et ses responsables prévenus."
        confirmLabel="Quitter le cercle"
        destructive
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await leaveDogCircle(dogId);
            if (!r.ok) return void toast.error(r.error);
            setOpen(false);
            toast.success("Vous avez quitté le cercle");
            router.replace("/circle");
          })
        }
      />
    </>
  );
}
