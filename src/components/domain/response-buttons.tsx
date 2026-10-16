"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Scissors, X } from "lucide-react";
import { respondToRequest } from "@/server/actions/requests";
import { toLocalDate, toLocalTime, zonedInstant } from "@/domain/time";
import { formatPeriod } from "@/lib/format";
import { hapticSuccess } from "@/lib/native";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, PillButton, TextArea, TextInput } from "@/components/ui/kit";

type Props = {
  requestId: string;
  current: "yes" | "no" | null;
  period: { start: number; end: number };
  splittable: boolean;
  proposed?: { start: number; end: number } | null;
  locked?: boolean;
  size?: "sm" | "md";
};

/**
 * Oui / Non answer. "Oui" is an offer of help, never a confirmation. For
 * splittable requests, the helper may offer only part of the period.
 */
export function ResponseButtons({ requestId, current, period, splittable, proposed, locked, size = "md" }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, startTransition] = useTransition();
  const [partOpen, setPartOpen] = useState(false);

  const send = (status: "yes" | "no", part?: { start: number; end: number } | null, note?: string) => {
    const previous = value;
    setValue(status);
    startTransition(async () => {
      const result = await respondToRequest({
        requestId,
        status,
        proposedStart: part ? new Date(part.start).toISOString() : null,
        proposedEnd: part ? new Date(part.end).toISOString() : null,
        note: note ?? "",
      });
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
        return;
      }
      void hapticSuccess();
      toast.success(status === "yes" ? "Merci ! Le propriétaire est prévenu de votre proposition." : "Réponse enregistrée");
      setPartOpen(false);
      router.refresh();
    });
  };

  if (locked) {
    return <p className="text-[14px] font-medium text-ink-2">Cette garde vous est confiée.</p>;
  }

  const multiSlot = period.end - period.start > 4 * 3_600_000;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Pouvez-vous aider ?">
        <PillButton
          size={size}
          aria-pressed={value === "yes"}
          disabled={pending}
          onClick={() => send("yes", null)}
          className={cn(value === "yes" ? "bg-[var(--tone-covered-ink)] text-white" : "bg-surface text-ink ring-1 ring-ink/15 hover:bg-surface-2")}
        >
          <Check className="size-4" aria-hidden /> Oui, je peux
        </PillButton>
        <PillButton
          size={size}
          aria-pressed={value === "no"}
          disabled={pending}
          onClick={() => send("no")}
          className={cn(value === "no" ? "bg-ink text-surface" : "bg-surface text-ink ring-1 ring-ink/15 hover:bg-surface-2")}
        >
          <X className="size-4" aria-hidden /> Non
        </PillButton>
      </div>
      {splittable && multiSlot && (
        <button
          type="button"
          onClick={() => setPartOpen(true)}
          className="inline-flex min-h-9 items-center gap-1.5 self-start text-[14px] font-medium text-ink-2 underline-offset-2 hover:underline"
        >
          <Scissors className="size-4" aria-hidden />
          {proposed && value === "yes" ? `Proposé : ${formatPeriod(proposed.start, proposed.end)}` : "Je peux seulement une partie"}
        </button>
      )}
      <PartialOfferSheet
        open={partOpen}
        onOpenChange={setPartOpen}
        period={period}
        initial={proposed ?? null}
        pending={pending}
        onSubmit={(part, note) => send("yes", part, note)}
      />
    </div>
  );
}

function PartialOfferSheet({
  open,
  onOpenChange,
  period,
  initial,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  period: { start: number; end: number };
  initial: { start: number; end: number } | null;
  pending: boolean;
  onSubmit: (part: { start: number; end: number }, note: string) => void;
}) {
  const base = initial ?? period;
  const [startDate, setStartDate] = useState(toLocalDate(base.start));
  const [startTime, setStartTime] = useState(toLocalTime(base.start));
  const [endDate, setEndDate] = useState(toLocalDate(base.end));
  const [endTime, setEndTime] = useState(toLocalTime(base.end));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    try {
      const start = zonedInstant(startDate, startTime);
      const end = zonedInstant(endDate, endTime);
      if (end <= start) return setError("La fin doit être après le début.");
      if (start < period.start || end > period.end) return setError(`Restez dans la demande : ${formatPeriod(period.start, period.end)}.`);
      setError(null);
      onSubmit({ start, end }, note);
    } catch {
      setError("Date ou heure invalide.");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-0 pb-safe">
        <SheetHeader>
          <SheetTitle className="text-xl font-semibold">Proposer une partie</SheetTitle>
          <SheetDescription>Demande : {formatPeriod(period.start, period.end)}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Du" htmlFor="part-start-date">
              <TextInput id="part-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="à" htmlFor="part-start-time">
              <TextInput id="part-start-time" type="time" step={900} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Au" htmlFor="part-end-date">
              <TextInput id="part-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="à" htmlFor="part-end-time">
              <TextInput id="part-end-time" type="time" step={900} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Message (facultatif)" htmlFor="part-note">
            <TextArea id="part-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Je peux le récupérer à 19h…" />
          </Field>
          {error && (
            <p className="text-[14px] font-medium text-[#9b1c14]" role="alert">
              {error}
            </p>
          )}
          <PillButton size="lg" loading={pending} onClick={submit}>
            Proposer ce créneau
          </PillButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
