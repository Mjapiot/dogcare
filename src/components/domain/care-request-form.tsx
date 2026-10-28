"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, HeartHandshake } from "lucide-react";
import { createCareRequest, updateCareRequest } from "@/server/actions/requests";
import {
  NECESSITY_LABELS,
  REQUEST_TYPE_LABELS,
  defaultNecessity,
  type NecessityLevel,
  type RequestType,
} from "@/domain/status";
import { addDays, toLocalDate, zonedInstant, type LocalDate } from "@/domain/time";
import { CIRCLE_KIND_LABELS, circleCovers, lastGuestDay } from "@/domain/circle";
import type { InviteeCandidateRow } from "@/lib/types";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, PillButton, Segmented, TextArea, TextInput } from "@/components/ui/kit";
import { Switch } from "@/components/ui/switch";
import { DogAvatar, REQUEST_TYPE_ICONS } from "./request-bits";

export type RequestFormValues = {
  dogId: string;
  requestType: RequestType;
  necessity: NecessityLevel;
  startDate: LocalDate;
  startTime: string;
  endDate: LocalDate;
  endTime: string;
  description: string;
  splittable: boolean;
};

const TYPE_HINTS: Record<RequestType, string> = {
  alone_info: "Pour information, sans demande d'intervention",
  visit: "Une promenade ou un passage serait apprécié",
  care: "Journée, soirée, nuit ou plusieurs jours",
  partial_care: "Un créneau précis à couvrir",
};

const TYPE_DEFAULT_TIMES: Record<RequestType, [string, string, number]> = {
  alone_info: ["09:00", "18:00", 0],
  visit: ["12:00", "13:00", 0],
  care: ["09:00", "18:00", 0],
  partial_care: ["18:00", "22:00", 0],
};

const DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" });
const dayLabel = (date: LocalDate) => DAY.format(new Date(`${date}T00:00:00Z`));

export function CareRequestForm({
  groupId,
  dogs,
  initial,
  requestId,
  hasAssignments = false,
  candidates = [],
  initialInvitees = [],
}: {
  groupId: string;
  dogs: Array<{ id: string; name: string; photoUrl?: string | null }>;
  initial: RequestFormValues;
  requestId?: string;
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
  const editing = Boolean(requestId);

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
      const on = allowed && (inviteChoice[c.user_id] ?? (editing ? initialInvitees.includes(c.user_id) : fits));
      return { ...c, allowed, on };
    });
  // people asked earlier but no longer listed (e.g. dates ended) are kept as they are
  const unlisted = initialInvitees.filter((id) => !circle.some((c) => c.user_id === id));
  const inviteeIds = v.requestType === "alone_info" ? [] : [...circle.filter((c) => c.on).map((c) => c.user_id), ...unlisted];

  const changeType = (type: RequestType) => {
    setV((prev) => {
      const next = { ...prev, requestType: type, necessity: defaultNecessity(type) };
      if (!editing) {
        const [s, e, extra] = TYPE_DEFAULT_TIMES[type];
        next.startTime = s;
        next.endTime = e;
        next.endDate = addDays(prev.startDate, extra);
      }
      return next;
    });
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const payload = { groupId, ...v, inviteeIds };
      const result = editing ? await updateCareRequest(requestId!, payload) : await createCareRequest(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const inviteError = editing ? null : (result.data as { inviteError: string | null }).inviteError;
      if (inviteError) toast.error(`Demande publiée, mais : ${inviteError}`);
      else toast.success(editing ? "Demande modifiée" : "Demande publiée, les membres sont prévenus");
      const id = editing ? requestId! : (result.data as { requestId: string }).requestId;
      router.replace(`/requests/${id}`);
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
      {!editing && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-2">Chien concerné</legend>
          <div className="flex flex-wrap gap-2">
            {dogs.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={v.dogId === d.id}
                onClick={() => set("dogId", d.id)}
                className={cn(
                  "flex min-h-12 items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-[15px] font-medium transition-colors",
                  v.dogId === d.id ? "bg-ink text-surface" : "bg-surface text-ink",
                )}
              >
                <DogAvatar name={d.name} photoUrl={d.photoUrl} size={36} />
                {d.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-2">Type de besoin</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(REQUEST_TYPE_LABELS) as RequestType[]).map((type) => {
            const Icon = REQUEST_TYPE_ICONS[type];
            const active = v.requestType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => changeType(type)}
                className={cn(
                  "flex min-h-24 flex-col items-start gap-1.5 rounded-[22px] p-3.5 text-left transition-colors",
                  active ? "bg-ink text-surface" : "bg-surface text-ink",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="text-[15px] font-semibold">{REQUEST_TYPE_LABELS[type]}</span>
                <span className={cn("text-[12px] leading-snug", active ? "text-surface/75" : "text-ink-3")}>{TYPE_HINTS[type]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

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

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-2" id="necessity-label">
          Niveau de nécessité
        </span>
        {v.requestType === "alone_info" ? (
          <p className="rounded-2xl bg-[var(--tone-info)] px-4 py-3 text-[14px] text-[var(--tone-info-ink)]">
            Information seulement : personne n&apos;est sollicité et le jour n&apos;apparaîtra jamais « sans solution ».
          </p>
        ) : (
          <Segmented
            label="Niveau de nécessité"
            value={v.necessity === "info" ? "nice_to_have" : v.necessity}
            onChange={(n) => set("necessity", n)}
            options={[
              { value: "nice_to_have", label: NECESSITY_LABELS.nice_to_have },
              { value: "required", label: NECESSITY_LABELS.required },
            ]}
          />
        )}
      </div>

      {(v.requestType === "care" || v.requestType === "partial_care") && (
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3">
          <label htmlFor="splittable" className="flex flex-col">
            <span className="text-[15px] font-medium text-ink">Partager entre plusieurs personnes</span>
            <span className="text-[13px] text-ink-3">Chacun peut proposer une partie de la période</span>
          </label>
          <Switch id="splittable" checked={v.splittable} onCheckedChange={(c) => set("splittable", c)} />
        </div>
      )}

      {v.requestType !== "alone_info" && circle.length > 0 && (
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

      {editing && hasAssignments && (
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

      <PillButton type="submit" size="lg" loading={pending} disabled={!v.dogId || !(duration > 0)}>
        {editing ? "Enregistrer les modifications" : "Publier la demande"}
      </PillButton>
    </form>
  );
}
