"use client";

import { useState } from "react";
import { ChevronRight, Smartphone } from "lucide-react";
import { InstallHint, useCanInstall } from "@/components/pwa/install-hint";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** "Installer l'application": only in a browser, never in the iPhone app or once installed. */
export function InstallRow() {
  const canInstall = useCanInstall();
  const [open, setOpen] = useState(false);
  if (!canInstall) return null;
  return (
    <li>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sage/15 text-ink">
          <Smartphone className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">Installer l&apos;application</span>
        <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-0 pb-safe">
          <SheetHeader>
            <SheetTitle className="text-xl font-semibold">Installer Dogcare</SheetTitle>
            <SheetDescription>Sur l&apos;écran d&apos;accueil, Dogcare s&apos;ouvre en plein écran et reçoit les notifications.</SheetDescription>
          </SheetHeader>
          <div className="px-3 pb-6">
            <InstallHint always />
          </div>
        </SheetContent>
      </Sheet>
    </li>
  );
}
