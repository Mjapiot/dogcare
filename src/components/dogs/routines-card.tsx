"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Footprints, ListChecks, NotebookPen, Pencil, Pill, Plus, Trash2, Utensils, X, type LucideIcon } from "lucide-react";
import { deleteRoutine, saveRoutine, setRoutinesEnabled } from "@/server/actions/dogs";
import { ROUTINE_KIND_LABELS, ROUTINE_KINDS, WEEKDAY_SHORT, describeRoutine, spokenTime, type Routine, type RoutineKind } from "@/domain/routines";
import { cn } from "@/lib/utils";
import { Card, Field, PillButton, TextInput } from "@/components/ui/kit";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";

export const ROUTINE_ICONS: Record<RoutineKind, LucideIcon> = { meal: Utensils, walk: Footprints, medication: Pill, other: NotebookPen };

const DAYS = ["L", "M", "M", "J", "V", "S", "D"];

/** One line per routine (icon, times, days, instructions). */
export function RoutineList({ routines, onEdit }: { routines: Routine[]; onEdit?: (r: Routine) => void }) {
  return (
    <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface-2">
      {routines.map((r) => {
        const Icon = ROUTINE_ICONS[r.kind];
        return (
          <li key={r.id} className="flex items-center gap-3 py-2 pr-1 pl-4">
            <Icon className="size-5 shrink-0 text-ink-2" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-ink">{describeRoutine(r)}</p>
              {r.instructions && <p className="text-[13px] text-ink-3">{r.instructions}</p>}
            </div>
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(r)}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2"
                aria-label={`Modifier : ${r.label}`}
              >
                <Pencil className="size-4" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Routines of a dog (off by default): its caretakers turn them on and list
 * meals, walks, medication… The helper checks them off in the care log.
 */
export function RoutinesCard({ dogId, dogName, enabled, routines }: { dogId: string; dogName: string; enabled: boolean; routines: Routine[] }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  // follow the server's value without remounting (a remount would close a sheet opened meanwhile)
  const [serverOn, setServerOn] = useState(enabled);
  if (enabled !== serverOn) {
    setServerOn(enabled);
    setOn(enabled);
  }
  const [, startTransition] = useTransition();
  // the sheet keeps its routine while it closes
  const [editing, setEditing] = useState<Routine | null>(null);
  const [open, setOpen] = useState(false);
  // a fresh form each time the sheet opens
  const [opening, setOpening] = useState(0);

  const toggle = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      const r = await setRoutinesEnabled(dogId, next);
      if (!r.ok) {
        setOn(!next);
        toast.error(r.error);
        return;
      }
      toast.success(next ? "Routines activées" : "Routines désactivées");
      router.refresh();
    });
  };

  const edit = (r: Routine | null) => {
    setEditing(r);
    setOpening((n) => n + 1);
    setOpen(true);
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-beige text-ink">
          <ListChecks className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Routines</h2>
          <p className="text-[14px] text-ink-3">Repas, promenades, médicaments : la personne qui garde {dogName} les coche dans le carnet.</p>
        </div>
        <Switch checked={on} onCheckedChange={toggle} aria-label="Activer les routines" />
      </div>
      {on && (
        <>
          {routines.length > 0 ? (
            <RoutineList routines={routines} onEdit={edit} />
          ) : (
            <p className="text-[14px] text-ink-3">Aucune routine pour l&apos;instant.</p>
          )}
          {routines.length < 12 && (
            <PillButton variant="soft" onClick={() => edit(null)}>
              <Plus className="size-4" aria-hidden /> Ajouter une routine
            </PillButton>
          )}
        </>
      )}
      <RoutineSheet key={opening} dogId={dogId} routine={editing} open={open} onOpenChange={setOpen} onSaved={() => router.refresh()} />
    </Card>
  );
}

function RoutineSheet({
  dogId,
  routine,
  open,
  onOpenChange,
  onSaved,
}: {
  dogId: string;
  routine: Routine | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<RoutineKind>(routine?.kind ?? "meal");
  const [label, setLabel] = useState(routine?.label ?? ROUTINE_KIND_LABELS.meal);
  const [times, setTimes] = useState<string[]>(routine ? [...routine.times] : ["08:00"]);
  const [days, setDays] = useState<number[]>(routine?.weekdays ? [...routine.weekdays] : []);
  const [instructions, setInstructions] = useState(routine?.instructions ?? "");
  const [newTime, setNewTime] = useState("19:00");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pickKind = (k: RoutineKind) => {
    // the default name follows the kind until the owner writes their own
    if (label === ROUTINE_KIND_LABELS[kind] || !label.trim()) setLabel(k === "other" ? "" : ROUTINE_KIND_LABELS[k]);
    setKind(k);
  };

  const save = () =>
    startTransition(async () => {
      const r = await saveRoutine(dogId, routine?.id ?? null, { kind, label, times, weekdays: days, instructions });
      if (!r.ok) return void toast.error(r.error);
      toast.success(routine ? "Routine modifiée" : "Routine ajoutée");
      onOpenChange(false);
      onSaved();
    });

  const remove = () =>
    startTransition(async () => {
      if (!routine) return;
      const r = await deleteRoutine(dogId, routine.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Routine supprimée");
      setConfirmDelete(false);
      onOpenChange(false);
      onSaved();
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-[28px] border-0 pb-safe">
        <SheetHeader>
          <SheetTitle className="text-xl font-semibold">{routine ? "Modifier la routine" : "Nouvelle routine"}</SheetTitle>
          <SheetDescription>Aux heures de Paris, pendant chaque garde.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <div role="radiogroup" aria-label="Type de routine" className="grid grid-cols-4 gap-2">
            {ROUTINE_KINDS.map((k) => {
              const Icon = ROUTINE_ICONS[k];
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => pickKind(k)}
                  className={cn(
                    "flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl text-[12px] font-medium transition-colors",
                    active ? "bg-ink text-surface" : "bg-surface-2 text-ink-2",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {ROUTINE_KIND_LABELS[k]}
                </button>
              );
            })}
          </div>
          <Field label="Nom" htmlFor="routine-label">
            <TextInput id="routine-label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Brossage" />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-ink-2">Heures</legend>
            <div className="flex flex-wrap gap-2">
              {times.map((t) => (
                <span key={t} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-surface-2 pl-4 text-[15px] font-medium text-ink tabular">
                  {spokenTime(t)}
                  <button
                    type="button"
                    onClick={() => setTimes((prev) => prev.filter((x) => x !== t))}
                    className="flex size-11 items-center justify-center rounded-full text-ink-2"
                    aria-label={`Retirer ${spokenTime(t)}`}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
            {times.length < 6 && (
              <div className="flex items-center gap-2">
                <TextInput type="time" step={900} value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="Nouvelle heure" className="w-36" />
                <PillButton
                  variant="outline"
                  size="sm"
                  disabled={!newTime || times.includes(newTime)}
                  onClick={() => setTimes((prev) => [...prev, newTime].sort())}
                >
                  <Plus className="size-4" aria-hidden /> Ajouter l&apos;heure
                </PillButton>
              </div>
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-ink-2">Jours</legend>
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map((d, i) => {
                const day = i + 1;
                const active = days.length === 0 || days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    aria-label={WEEKDAY_SHORT[i]}
                    onClick={() =>
                      setDays((prev) => {
                        const all = prev.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : prev;
                        const next = all.includes(day) ? all.filter((x) => x !== day) : [...all, day].sort();
                        // at least one day; all seven = every day
                        if (next.length === 0) return prev;
                        return next.length === 7 ? [] : next;
                      })
                    }
                    className={cn(
                      "relative min-h-11 rounded-full text-[15px] font-medium transition-colors",
                      active ? "bg-ink text-surface" : "bg-surface-2 text-ink-2 ring-1 ring-line",
                    )}
                  >
                    {d}
                    {/* never the colour alone: a check marks the days of the routine */}
                    {active && <Check className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full bg-sage p-0.5 text-surface" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <p className="text-[13px] text-ink-3">{days.length === 0 ? "Tous les jours" : `Seulement : ${days.map((d) => WEEKDAY_SHORT[d - 1]).join(", ")}`}</p>
          </fieldset>
          <Field label="Consigne (facultatif)" htmlFor="routine-instructions" hint="Ex. « ½ comprimé dans la pâtée »">
            <TextInput id="routine-instructions" maxLength={140} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </Field>
          <PillButton size="lg" loading={pending} disabled={!label.trim() || times.length === 0} onClick={save}>
            Enregistrer
          </PillButton>
          {routine && (
            <PillButton variant="ghost" disabled={pending} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden /> Supprimer la routine
            </PillButton>
          )}
        </div>
        <ConfirmationDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Supprimer cette routine ?"
          description="Ce qui a déjà été coché reste dans le carnet."
          confirmLabel="Supprimer"
          destructive
          pending={pending}
          onConfirm={remove}
        />
      </SheetContent>
    </Sheet>
  );
}
