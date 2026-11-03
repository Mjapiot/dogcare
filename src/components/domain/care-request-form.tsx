"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, HeartHandshake } from "lucide-react";
import { updateCareRequest } from "@/server/actions/requests";
import { toLocalDate, zonedInstant, type LocalDate } from "@/domain/time";
import { CIRCLE_KIND_LABELS, circleCovers, lastGuestDay } from "@/domain/circle";
import type { InviteeCandidateRow } from "@/lib/types";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, PillButton, TextArea, TextInput } from "@/components/ui/kit";
import { Switch } from "@/components/ui/switch";

export type RequestFormValues = {
  dogId: string;
  startDate: LocalDate;
  startTime: string;
  endDate: LocalDate;
  endTime: string;
  description: string;
};

const DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" });
const dayLabel = (date: LocalDate) => DAY.format(new Date(`${date}T00:00:00Z`));

/**
 * Editing a request: dates, details and the circle people asked. New needs go
 * through "Besoin d'une garde" (/plan).
 */
export function RequestEditForm({
  initial,
  requestId,
  hasAssignments = false,
  candidates = [],
  initialInvitees = [],
}: {
  initial: RequestFormValues;
  requestId: string;
  hasAssignments?: boolean;
  /** Close people and guests of the dogs, outside the group ("Demander aussi à"). */
  candidates?: InviteeCandidateRow[];
  /** People already asked (editing). */
  initialInvitees?: string[];
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof RequestFormValues>(k: K, value: RequestFormValues[K]) => setV((prev) => ({ ...prev, [k]: value }));

  const duration = useMemo(() => {
    try {
      return zonedInstant(v.endDate, v.endTime) - zonedInstant(v.startDate, v.startTime);
    } catch {
      return NaN;
    }
  }, [v.startDate, v.startTime, v.endDate, v.endTime]);

  // circle people: on by default when their dates fit (new request), or as saved (editing)
  const [inviteChoice, setInviteChoice] = useState<Record<string, boolean>>({});
  const period = Number.isFinite(duration) && duration > 0 ? { start: zonedInstant(v.startDate, v.startTime), end: zonedInstant(v.endDate, v.endTime) } : null;
  const circle = candidates
    .filter((c) => c.dog_id === v.dogId)
    .map((c) => {
      const fits = period ? circleCovers(c, period) : false;
      const allowed = fits || initialInvitees.includes(c.user_id);
      const on = allowed && (inviteChoice[c.user_id] ?? initialInvitees.includes(c.user_id));
      return { ...c, allowed, on };
    });
  // people asked earlier but no longer listed (e.g. dates ended) are kept as they are
  const unlisted = initialInvitees.filter((id) => !circle.some((c) => c.user_id === id));
  const inviteeIds = [...circle.filter((c) => c.on).map((c) => c.user_id), ...unlisted];

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const { startDate, startTime, endDate, endTime, description } = v;
      const result = await updateCareRequest(requestId, { startDate, startTime, endDate, endTime, description, inviteeIds });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.inviteError) toast.error(`Demande modifiée, mais : ${result.data.inviteError}`);
      else toast.success("Demande modifiée");
      router.replace(`/requests/${requestId}`);
      router.refresh();
    });
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-3">
        <Field label="Début" htmlFor="start-date">
          <TextInput
            id="start-date"
            type="date"
            required
            value={v.startDate}
            onChange={(e) => {
              const startDate = e.target.value;
              setV((prev) => ({ ...prev, startDate, endDate: prev.endDate < startDate ? startDate : prev.endDate }));
            }}
          />
        </Field>
        <Field label="Heure" htmlFor="start-time">
          <TextInput id="start-time" type="time" step={900} required value={v.startTime} onChange={(e) => set("startTime", e.target.value)} className="w-32" />
        </Field>
        <Field label="Fin" htmlFor="end-date">
          <TextInput id="end-date" type="date" required min={v.startDate} value={v.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
        <Field label="Heure" htmlFor="end-time">
          <TextInput id="end-time" type="time" step={900} required value={v.endTime} onChange={(e) => set("endTime", e.target.value)} className="w-32" />
        </Field>
        <p className={cn("col-span-2 text-[14px]", Number.isFinite(duration) && duration > 0 ? "text-ink-3" : "font-medium text-[#9b1c14]")}>
          {Number.isFinite(duration) && duration > 0 ? `Durée : ${formatDuration(duration)}` : "La fin doit être après le début."}
        </p>
      </div>

      {circle.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium text-ink-2">
            <HeartHandshake className="size-4" aria-hidden /> Demander aussi à
          </legend>
          <p className="text-[13px] text-ink-3">
            Des personnes du cercle de votre chien, hors du groupe. Elles voient cette demande et peuvent répondre, sans voir
            le groupe ni les réponses des autres.
          </p>
          <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface">
            {circle.map((c) => {
              const id = `invitee-${c.user_id}`;
              const until = c.ends_at ? dayLabel(lastGuestDay(c.ends_at)) : null;
              const from = c.starts_at ? dayLabel(toLocalDate(c.starts_at)) : null;
              return (
                <li key={c.user_id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                  <label htmlFor={id} className={cn("flex flex-col", !c.allowed && "opacity-60")}>
                    <span className="text-[15px] font-medium text-ink">{c.display_name}</span>
                    <span className="text-[13px] text-ink-3">
                      {CIRCLE_KIND_LABELS[c.role]}
                      {until && (from ? ` · du ${from} au ${until}` : ` · jusqu'au ${until}`)}
                      {!c.allowed && " · ses dates ne couvrent pas cette période"}
                    </span>
                  </label>
                  <Switch
                    id={id}
                    checked={c.on}
                    disabled={!c.allowed}
                    onCheckedChange={(checked) => setInviteChoice((prev) => ({ ...prev, [c.user_id]: checked }))}
                  />
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <Field label="Précisions (facultatif)" htmlFor="description" hint="Habitudes, clés, horaires de repas…">
        <TextArea id="description" maxLength={1000} value={v.description} onChange={(e) => set("description", e.target.value)} />
      </Field>

      {hasAssignments && (
        <p className="flex items-start gap-2 rounded-2xl bg-[var(--tone-pending)] px-4 py-3 text-[14px] text-[var(--tone-pending-ink)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Des gardes sont déjà confirmées. Si leurs horaires changent, les gardiens seront prévenus et devront reconfirmer.
          Les autres réponses seront remises à zéro si la période change.
        </p>
      )}

      {error && (
        <p className="rounded-2xl bg-[#f6dcd9] px-4 py-3 text-[14px] font-medium text-[#7a1b14]" role="alert">
          {error}
        </p>
      )}

      <PillButton type="submit" size="lg" loading={pending} disabled={!(duration > 0)}>
        Enregistrer les modifications
      </PillButton>
    </form>
  );
}
