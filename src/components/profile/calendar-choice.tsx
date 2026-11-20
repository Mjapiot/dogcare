"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck2, CalendarPlus, RefreshCw } from "lucide-react";
import { disableNativeCalendar, enableNativeCalendar, nativeCalendarEnabled, nativeCalendarSupported, syncNativeCalendar } from "@/lib/native-calendar";
import { Card, PillButton } from "@/components/ui/kit";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";
import { CalendarFeed } from "./calendar-feed";

/**
 * "Mes gardes dans le Calendrier": in the iPhone app, written straight into a
 * "Dogcare" calendar of the iPhone (immediate); on the web, the subscription.
 */
export function CalendarChoice({ origin, initialToken }: { origin: string; initialToken: string | null }) {
  // known in the browser only: the web card is shown until then
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the platform once on mount
    setNative(nativeCalendarSupported());
  }, []);
  if (native === null) return null;
  return native ? <NativeCalendarCard /> : <CalendarFeed key={initialToken ?? "off"} origin={origin} initialToken={initialToken} />;
}

function NativeCalendarCard() {
  const [on, setOn] = useState(() => nativeCalendarEnabled());
  const [count, setCount] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const report = (r: Awaited<ReturnType<typeof enableNativeCalendar>>, success: string) => {
    if (r.ok) {
      setCount(r.count);
      toast.success(success);
    } else if (r.reason === "denied") setDenied(true);
    else if (r.reason === "error") toast.error("Le Calendrier n'a pas pu être mis à jour. Réessayez.");
  };

  const enable = () =>
    startTransition(async () => {
      const r = await enableNativeCalendar();
      setOn(nativeCalendarEnabled());
      report(r, "Vos gardes sont dans le Calendrier");
    });

  const syncNow = () => startTransition(async () => report(await syncNativeCalendar(), "Calendrier à jour"));

  const disable = () =>
    startTransition(async () => {
      await disableNativeCalendar();
      setOn(false);
      setCount(null);
      setConfirm(false);
      toast.success("Calendrier « Dogcare » retiré de cet iPhone");
    });

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-[14px] text-ink-2">
        Vos gardes confirmées (celles que vous assurez et celles qui couvrent vos chiens) s&apos;ajoutent tout de suite à un
        calendrier « Dogcare » de l&apos;iPhone, et suivent chaque changement, annulations comprises.
      </p>
      {on ? (
        <>
          <p className="flex items-center gap-2 rounded-2xl bg-[var(--tone-covered)] px-3 py-2 text-[14px] font-medium text-[var(--tone-covered-ink)]">
            <CalendarCheck2 className="size-4 shrink-0" aria-hidden />
            Activé sur cet iPhone{count !== null ? ` · ${count} garde${count > 1 ? "s" : ""}` : ""}
          </p>
          <PillButton size="sm" variant="soft" loading={pending} onClick={syncNow}>
            <RefreshCw className="size-4" aria-hidden /> Mettre à jour maintenant
          </PillButton>
          <PillButton size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>
            Retirer de cet iPhone
          </PillButton>
        </>
      ) : (
        <PillButton loading={pending} onClick={enable}>
          <CalendarPlus className="size-4" aria-hidden /> Ajouter mes gardes au Calendrier
        </PillButton>
      )}
      {denied && (
        <p className="rounded-2xl bg-[var(--tone-pending)] px-3 py-2 text-[14px] text-[var(--tone-pending-ink)]" role="alert">
          L&apos;accès au Calendrier est refusé. Autorisez-le dans Réglages → Dogcare → Calendriers (« Accès complet »), puis
          réessayez.
        </p>
      )}
      <ConfirmationDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Retirer le calendrier « Dogcare » ?"
        description="Les gardes ajoutées par Dogcare disparaissent du Calendrier de cet iPhone. Rien ne change dans Dogcare."
        confirmLabel="Retirer"
        pending={pending}
        onConfirm={disable}
      />
    </Card>
  );
}
