import { WifiOff } from "lucide-react";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center pt-safe pb-safe">
      <div className="flex size-14 items-center justify-center rounded-full bg-surface">
        <WifiOff className="size-7 text-ink-2" aria-hidden />
      </div>
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Vous êtes hors ligne</h1>
      <p className="text-[15px] text-ink-2">
        Dogcare a besoin d&apos;une connexion pour afficher des informations de garde à jour. Aucune action n&apos;est
        enregistrée hors ligne.
      </p>
      {/* full reload on purpose: the client router is unavailable offline */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="mt-2 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[15px] font-medium text-surface">
        Réessayer
      </a>
    </main>
  );
}
