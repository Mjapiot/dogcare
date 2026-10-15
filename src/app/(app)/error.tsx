"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { PillButton } from "@/components/ui/kit";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dogcare] screen error", error.digest ?? error.message);
  }, [error]);
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-surface px-6 py-12 text-center" role="alert">
      <TriangleAlert className="size-8 text-ink-2" aria-hidden />
      <div>
        <p className="text-[19px] font-semibold text-ink">Impossible d&apos;afficher cet écran</p>
        <p className="mt-1 text-[15px] text-ink-3">
          Vérifiez votre connexion puis réessayez. Aucune donnée n&apos;a été modifiée.
        </p>
      </div>
      <PillButton onClick={reset}>
        <RefreshCw className="size-4" aria-hidden /> Réessayer
      </PillButton>
    </div>
  );
}
