"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageOff, Pencil, Trash2 } from "lucide-react";
import { deleteCareLog, updateCareLog } from "@/server/actions/care-log";
import { CARE_LOG_LABELS, groupCareLogByDay } from "@/domain/care-log";
import { toLocalDate, toLocalTime, zonedInstant } from "@/domain/time";
import { formatLocalDate, formatTime } from "@/lib/format";
import type { CareLogEntryRow } from "@/lib/types";
import { Field, PillButton, TextArea, TextInput } from "@/components/ui/kit";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";
import { ReportButton } from "@/components/domain/report-button";
import { CARE_LOG_ICONS } from "./care-log-composer";

export type TimelineEntry = CareLogEntryRow & { photoUrl: string | null; authorName: string };

/**
 * The care log of a request, newest first, grouped by Paris day. The helper
 * edits or deletes their own entries while the log is open; a caretaker can
 * report someone else's entry.
 */
export function CareLogTimeline({
  entries,
  me,
  editableAssignmentIds,
  reportGroupId,
  showAuthors,
}: {
  entries: TimelineEntry[];
  me: string;
  /** My assignments whose log is open. */
  editableAssignmentIds: string[];
  /** Group used to report an entry (caretakers only), or null. */
  reportGroupId: string | null;
  showAuthors: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<TimelineEntry | null>(null);
  const [deleting, setDeleting] = useState<TimelineEntry | null>(null);

  if (entries.length === 0) {
    return <p className="rounded-[24px] bg-surface p-4 text-[15px] text-ink-3">Rien pour l&apos;instant.</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {groupCareLogByDay(entries).map((day) => (
          <section key={day.date} className="flex flex-col gap-2" aria-label={formatLocalDate(day.date, { weekday: "long", day: "numeric", month: "long" })}>
            <h3 className="px-1 text-[13px] font-semibold tracking-wide text-ink-3 uppercase">
              {formatLocalDate(day.date, { weekday: "long", day: "numeric", month: "long" })}
            </h3>
            <ul className="flex flex-col divide-y divide-line rounded-[24px] bg-surface">
              {day.entries.map((e) => {
                const Icon = CARE_LOG_ICONS[e.kind];
                const mine = e.author_id === me && editableAssignmentIds.includes(e.assignment_id);
                return (
                  <li key={e.id} className="flex gap-3 p-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sage/15 text-ink">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <p className="text-[15px] font-semibold text-ink">
                        <span className="tabular">{formatTime(e.occurred_at)}</span> · {CARE_LOG_LABELS[e.kind]}
                        {showAuthors && <span className="font-normal text-ink-3"> · {e.authorName}</span>}
                      </p>
                      {e.note && <p className="whitespace-pre-line text-[15px] text-ink-2">{e.note}</p>}
                      {e.photoUrl && (
                        <a href={e.photoUrl} target="_blank" rel="noreferrer" className="self-start">
                          <Image
                            src={e.photoUrl}
                            alt={`Photo du ${formatTime(e.occurred_at)}`}
                            width={240}
                            height={240}
                            unoptimized
                            className="size-40 rounded-2xl object-cover"
                          />
                        </a>
                      )}
                      {e.photo_removed_at && (
                        <p className="flex items-center gap-1.5 text-[13px] text-ink-3">
                          <ImageOff className="size-4" aria-hidden /> Photo supprimée 90 jours après la garde
                        </p>
                      )}
                      {(mine || (reportGroupId && e.author_id !== me)) && (
                        <div className="-ml-3 flex flex-wrap items-center">
                          {mine && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditing(e)}
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-ink-2"
                              >
                                <Pencil className="size-4" aria-hidden /> Modifier
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleting(e)}
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-[#7a1b14]"
                              >
                                <Trash2 className="size-4" aria-hidden /> Supprimer
                              </button>
                            </>
                          )}
                          {reportGroupId && e.author_id !== me && (
                            <ReportButton
                              groupId={reportGroupId}
                              targetType="care_log"
                              targetId={e.id}
                              label="Signaler"
                              description="Le signalement est transmis aux administrateurs du groupe et à l'équipe Dogcare, sans votre nom."
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {editing && (
        <EditSheet
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Supprimer cette entrée ?"
        description="Elle disparaît du carnet, photo comprise."
        confirmLabel="Supprimer"
        destructive
        pending={pending}
        onConfirm={() => {
          const id = deleting?.id;
          setDeleting(null);
          if (!id) return;
          startTransition(async () => {
            const r = await deleteCareLog(id);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Entrée supprimée");
            router.refresh();
          });
        }}
      />
    </>
  );
}

function EditSheet({ entry, onClose, onSaved }: { entry: TimelineEntry; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(toLocalDate(entry.occurred_at));
  const [time, setTime] = useState(toLocalTime(entry.occurred_at));
  const [note, setNote] = useState(entry.note ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-0 pb-safe">
        <SheetHeader>
          <SheetTitle className="text-xl font-semibold">Modifier : {CARE_LOG_LABELS[entry.kind]}</SheetTitle>
          <SheetDescription>L&apos;heure doit rester pendant la garde.</SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-col gap-4 px-4 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              let occurredAt: string;
              try {
                occurredAt = new Date(zonedInstant(date, time)).toISOString();
              } catch {
                return void toast.error("Heure invalide.");
              }
              const r = await updateCareLog(entry.id, { occurredAt, note });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Entrée modifiée");
              onSaved();
            });
          }}
        >
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Jour" htmlFor="edit-log-date">
              <TextInput id="edit-log-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Heure" htmlFor="edit-log-time">
              <TextInput id="edit-log-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
            </Field>
          </div>
          <Field label="Un mot" htmlFor="edit-log-note">
            <TextArea id="edit-log-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <PillButton type="submit" size="lg" loading={pending}>
            Enregistrer
          </PillButton>
        </form>
      </SheetContent>
    </Sheet>
  );
}
