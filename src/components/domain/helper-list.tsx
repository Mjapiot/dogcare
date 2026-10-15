"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleHelp, Clock, Minus, UserCheck, X } from "lucide-react";
import { cancelAssignment, confirmAssignment } from "@/server/actions/requests";
import { PERIOD_AVAILABILITY_LABELS, type PeriodAvailability } from "@/domain/availability";
import { intersect, overlaps, type Interval } from "@/domain/intervals";
import { toLocalDate, toLocalTime, zonedInstant } from "@/domain/time";
import { formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, Field, PillButton, TextInput } from "@/components/ui/kit";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmationDialog } from "./confirmation-dialog";

type Helper = {
  userId: string;
  name: string;
  response: "yes" | "no" | null;
  proposed: Interval | null;
  note: string | null;
  availability: PeriodAvailability | "hidden";
  assignments: Array<{ id: string; start: number; end: number; status: "confirmed" | "pending_reconfirmation" | "cancelled" }>;
};

function defaultRange(offer: Interval, gaps: Interval[]): Interval {
  for (const gap of gaps) {
    const i = intersect(offer, gap);
    if (i) return i;
  }
  return offer;
}

export function HelperList({
  requestId,
  canConfirm,
  splittable,
  period,
  gaps,
  helpers,
}: {
  requestId: string;
  canConfirm: boolean;
  splittable: boolean;
  period: Interval;
  gaps: Interval[];
  helpers: Helper[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Helper | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  if (helpers.length === 0) {
    return (
      <section className="rounded-[24px] bg-surface p-4 text-[15px] text-ink-2">
        Personne d&apos;autre dans le groupe pour le moment. Invitez vos amis depuis votre profil.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="helpers-title">
      <h2 id="helpers-title" className="px-1 text-[17px] font-semibold text-ink">
        Réponses des membres
      </h2>
      {gaps.length > 0 && gaps.length < 4 && canConfirm && (
        <p className="px-1 text-[14px] text-ink-3">Reste à couvrir : {gaps.map((g) => formatPeriod(g.start, g.end)).join(" ; ")}</p>
      )}
      <ul className="flex flex-col divide-y divide-line rounded-[24px] bg-surface">
        {helpers.map((h) => {
          const live = h.assignments.filter((a) => a.status !== "cancelled");
          const offer = h.proposed ?? period;
          const offerOverlapsGap = gaps.some((g) => overlaps(offer, g));
          return (
            <li key={h.userId} className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-3">
                <Avatar name={h.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{h.name}</p>
                  <p className="flex items-center gap-1.5 text-[13px] text-ink-2">
                    <ResponseIcon h={h} />
                    {live.length > 0
                      ? live.some((a) => a.status === "pending_reconfirmation")
                        ? "Doit reconfirmer"
                        : "Garde confirmée"
                      : h.response === "yes"
                        ? h.proposed
                          ? `Propose ${formatPeriod(h.proposed.start, h.proposed.end)}`
                          : "Propose son aide"
                        : h.response === "no"
                          ? "Ne peut pas"
                          : h.availability === "hidden"
                            ? "Pas encore répondu"
                            : `Pas encore répondu · ${PERIOD_AVAILABILITY_LABELS[h.availability]}`}
                  </p>
                </div>
                {canConfirm && h.response === "yes" && offerOverlapsGap && (
                  <PillButton size="sm" onClick={() => setConfirming(h)} disabled={pending}>
                    Confirmer
                  </PillButton>
                )}
              </div>
              {h.note && <p className="rounded-xl bg-surface-2 px-3 py-2 text-[14px] text-ink-2">« {h.note} »</p>}
              {live.map((a) => (
                <div key={a.id} className={cn("flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[14px]", a.status === "confirmed" ? "bg-[var(--tone-covered)] text-[var(--tone-covered-ink)]" : "bg-[var(--tone-pending)] text-[var(--tone-pending-ink)]")}>
                  <span className="flex items-center gap-1.5 font-medium">
                    {a.status === "confirmed" ? <Check className="size-4" aria-hidden /> : <Clock className="size-4" aria-hidden />}
                    {formatPeriod(a.start, a.end)}
                  </span>
                  {canConfirm && (
                    <button
                      type="button"
                      onClick={() => setRemoving({ id: a.id, name: h.name })}
                      className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[13px] font-medium hover:bg-black/5"
                    >
                      <X className="size-3.5" aria-hidden /> Retirer
                    </button>
                  )}
                </div>
              ))}
            </li>
          );
        })}
      </ul>

      {confirming && (
        <ConfirmSheet
          key={confirming.userId}
          helper={confirming}
          range={defaultRange(confirming.proposed ?? period, gaps)}
          splittable={splittable}
          period={period}
          pending={pending}
          onClose={() => setConfirming(null)}
          onConfirm={(range) =>
            startTransition(async () => {
              const r = await confirmAssignment({
                requestId,
                userId: confirming.userId,
                startsAt: new Date(range.start).toISOString(),
                endsAt: new Date(range.end).toISOString(),
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success(`${confirming.name} est prévenu·e : garde confirmée`);
              setConfirming(null);
              router.refresh();
            })
          }
        />
      )}

      <ConfirmationDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Retirer la garde de ${removing?.name ?? ""} ?`}
        description="La personne sera prévenue et le créneau redeviendra à organiser."
        confirmLabel="Retirer la garde"
        destructive
        withReason
        pending={pending}
        onConfirm={(reason) => {
          const target = removing;
          if (!target) return;
          setRemoving(null);
          startTransition(async () => {
            const r = await cancelAssignment(target.id, reason);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Garde retirée");
            router.refresh();
          });
        }}
      />
    </section>
  );
}

function ResponseIcon({ h }: { h: Helper }) {
  if (h.assignments.some((a) => a.status !== "cancelled")) return <UserCheck className="size-3.5" aria-hidden />;
  if (h.response === "yes") return <Check className="size-3.5" aria-hidden />;
  if (h.response === "no") return <Minus className="size-3.5" aria-hidden />;
  return <CircleHelp className="size-3.5" aria-hidden />;
}

function ConfirmSheet({
  helper,
  range,
  splittable,
  period,
  pending,
  onClose,
  onConfirm,
}: {
  helper: Helper;
  range: Interval;
  splittable: boolean;
  period: Interval;
  pending: boolean;
  onClose: () => void;
  onConfirm: (range: Interval) => void;
}) {
  const [startDate, setStartDate] = useState(toLocalDate(range.start));
  const [startTime, setStartTime] = useState(toLocalTime(range.start));
  const [endDate, setEndDate] = useState(toLocalDate(range.end));
  const [endTime, setEndTime] = useState(toLocalTime(range.end));
  const [error, setError] = useState<string | null>(null);
  const editable = splittable;

  const submit = () => {
    if (!editable) return onConfirm(period);
    try {
      const start = zonedInstant(startDate, startTime);
      const end = zonedInstant(endDate, endTime);
      if (end <= start) return setError("La fin doit être après le début.");
      setError(null);
      onConfirm({ start, end });
    } catch {
      setError("Date ou heure invalide.");
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-0 pb-safe">
        <SheetHeader>
          <SheetTitle className="text-xl font-semibold">Confier la garde à {helper.name}</SheetTitle>
          <SheetDescription>
            {helper.name} sera prévenu·e et la garde apparaîtra dans ses gardes. Vous pourrez la retirer plus tard.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6">
          {editable ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="Du" htmlFor="c-start-date">
                <TextInput id="c-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="à" htmlFor="c-start-time">
                <TextInput id="c-start-time" type="time" step={900} value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-32" />
              </Field>
              <Field label="Au" htmlFor="c-end-date">
                <TextInput id="c-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
              <Field label="à" htmlFor="c-end-time">
                <TextInput id="c-end-time" type="time" step={900} value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-32" />
              </Field>
            </div>
          ) : (
            <p className="text-[15px] font-medium text-ink">{formatPeriod(period.start, period.end)} (garde non partageable)</p>
          )}
          {error && (
            <p className="text-[14px] font-medium text-[#9b1c14]" role="alert">
              {error}
            </p>
          )}
          <PillButton size="lg" loading={pending} onClick={submit}>
            Confirmer {helper.name}
          </PillButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
