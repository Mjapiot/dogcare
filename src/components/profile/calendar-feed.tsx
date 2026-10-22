"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarPlus, Copy, RefreshCw } from "lucide-react";
import { enableCalendarFeed, resetCalendarFeed } from "@/server/actions/calendar";
import { calendarFeedUrls } from "@/lib/calendar-feed";
import { Card, PillButton, pillClasses } from "@/components/ui/kit";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";

/**
 * Personal calendar subscription: confirmed assignments appear in Apple
 * Calendar and follow changes and cancellations automatically.
 */
export function CalendarFeed({ origin, initialToken }: { origin: string; initialToken: string | null }) {
  const [token, setToken] = useState(initialToken);
  const [confirm, setConfirm] = useState<"renew" | "disable" | null>(null);
  const [pending, startTransition] = useTransition();
  const urls = token ? calendarFeedUrls(origin, token) : null;

  const enable = () =>
    startTransition(async () => {
      const r = await enableCalendarFeed();
      if (!r.ok) return void toast.error(r.error);
      setToken(r.data.token);
    });

  const reset = (enabled: boolean) =>
    startTransition(async () => {
      const r = await resetCalendarFeed(enabled);
      if (!r.ok) return void toast.error(r.error);
      setToken(r.data.token);
      toast.success(enabled ? "Nouveau lien créé : abonnez-vous à nouveau" : "Abonnement désactivé");
    });

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-[14px] text-ink-2">
        Vos gardes confirmées (celles que vous assurez et celles qui couvrent vos chiens) apparaissent dans le
        Calendrier de l&apos;iPhone et se mettent à jour toutes seules, annulations comprises.
      </p>
      {urls ? (
        <>
          {/* a real link: iOS opens the "subscribe" sheet for webcal:// */}
          <a href={urls.webcal} className={pillClasses("primary", "md")}>
            <CalendarPlus className="size-4" aria-hidden /> Ajouter au Calendrier
          </a>
          <div className="grid grid-cols-2 gap-2">
            <PillButton
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(urls.https);
                  toast.success("Lien copié");
                } catch {
                  toast.error("Copie impossible.");
                }
              }}
            >
              <Copy className="size-4" aria-hidden /> Copier le lien
            </PillButton>
            <PillButton size="sm" variant="soft" disabled={pending} onClick={() => setConfirm("renew")}>
              <RefreshCw className="size-4" aria-hidden /> Nouveau lien
            </PillButton>
          </div>
          <PillButton size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm("disable")}>
            Désactiver l&apos;abonnement
          </PillButton>
          <p className="text-[13px] text-ink-3">
            Ce lien est personnel : ne le partagez pas. L&apos;iPhone actualise le calendrier régulièrement (réglable
            dans Réglages → Calendrier → Comptes → Nouvelles données).
          </p>
        </>
      ) : (
        <PillButton loading={pending} onClick={enable}>
          <CalendarPlus className="size-4" aria-hidden /> Activer l&apos;abonnement
        </PillButton>
      )}
      <ConfirmationDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "renew" ? "Créer un nouveau lien ?" : "Désactiver l'abonnement ?"}
        description={
          confirm === "renew"
            ? "L'ancien lien cessera de fonctionner. Supprimez l'ancien calendrier « Dogcare » de votre iPhone puis abonnez-vous avec le nouveau."
            : "Le calendrier « Dogcare » ne recevra plus vos gardes. Vous pourrez le supprimer de votre iPhone."
        }
        confirmLabel={confirm === "renew" ? "Nouveau lien" : "Désactiver"}
        destructive={confirm === "disable"}
        pending={pending}
        onConfirm={() => {
          const enabled = confirm === "renew";
          setConfirm(null);
          reset(enabled);
        }}
      />
    </Card>
  );
}
