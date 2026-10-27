"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, ChevronDown, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { switchGroup } from "@/server/actions/groups";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RoundIconLink } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

export function AppHeader({
  groups,
  currentGroupId,
  unread,
}: {
  groups: Array<{ id: string; name: string }>;
  currentGroupId: string;
  unread: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = groups.find((g) => g.id === currentGroupId);

  return (
    <header className="sticky top-0 z-30 bg-canvas/55 px-4 pt-safe backdrop-blur-xl backdrop-saturate-150">
      <div className="flex h-16 items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="glass flex min-h-11 min-w-0 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-ink"
          aria-label={`Groupe actuel : ${current?.name ?? ""}. Changer de groupe`}
        >
          <span className="truncate">{current?.name ?? "Groupe"}</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        </button>
        <div className="flex items-center gap-2">
          <RoundIconLink href="/notifications" icon={Bell} label="Notifications" badge={unread} />
          <RoundIconLink href="/requests/new" icon={Plus} label="Ajouter un besoin" className="bg-ink text-surface hover:bg-ink/90" />
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-0 pb-safe">
          <SheetHeader>
            <SheetTitle className="text-xl font-semibold">Mes groupes</SheetTitle>
            <SheetDescription>Le calendrier et les demandes affichés dépendent du groupe choisi.</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-1 px-4">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      if (g.id !== currentGroupId) {
                        const r = await switchGroup(g.id);
                        if (!r.ok) toast.error(r.error);
                        router.refresh();
                      }
                      setOpen(false);
                    })
                  }
                  className={cn(
                    "flex min-h-13 w-full items-center justify-between rounded-2xl px-4 text-left text-[16px] font-medium",
                    g.id === currentGroupId ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                >
                  {g.name}
                  {g.id === currentGroupId && <Check className="size-5" aria-label="Groupe actuel" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-4">
            <Link
              href="/onboarding/group"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center gap-2 rounded-2xl px-4 text-[15px] font-medium text-ink-2 hover:bg-surface-2"
            >
              <UserPlus className="size-5" aria-hidden /> Créer ou rejoindre un groupe
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
