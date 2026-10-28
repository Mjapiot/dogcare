"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Footprints, HandHeart, Home, NotebookPen, Pill, SlidersHorizontal, Utensils, type LucideIcon } from "lucide-react";
import { addCareLog } from "@/server/actions/care-log";
import { CARE_LOG_KINDS, CARE_LOG_LABELS } from "@/domain/care-log";
import { toLocalDate, toLocalTime, zonedInstant } from "@/domain/time";
import { MAX_INPUT_BYTES, resizeImage } from "@/lib/image";
import { hapticSuccess } from "@/lib/native";
import { useBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { CareLogKind } from "@/lib/types";
import { Field, PillButton, TextArea, TextInput } from "@/components/ui/kit";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const CARE_LOG_ICONS: Record<CareLogKind, LucideIcon> = {
  meal: Utensils,
  walk: Footprints,
  medication: Pill,
  drop_off: HandHeart,
  pick_up: Home,
  photo: Camera,
  note: NotebookPen,
};

/** One tap logs "now"; photo, note and "Détails" open a sheet (time, note, photo). */
export function CareLogComposer({
  assignmentId,
  dogName,
  window,
}: {
  assignmentId: string;
  dogName: string;
  /** When the log is open (ms): the entry's time must fall inside. */
  window: { start: number; end: number };
}) {
  const router = useRouter();
  const supabase = useBrowserClient();
  const [pending, startTransition] = useTransition();
  const [sheet, setSheet] = useState<{ kind: CareLogKind; file: File | null } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const quick = (kind: CareLogKind) => {
    if (kind === "photo") return fileInput.current?.click();
    if (kind === "note") return setSheet({ kind, file: null });
    startTransition(async () => {
      const r = await addCareLog({ assignmentId, kind });
      if (!r.ok) return void toast.error(r.error);
      hapticSuccess();
      toast.success(`Ajouté au carnet : ${CARE_LOG_LABELS[kind].toLowerCase()}`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2" role="group" aria-label={`Noter pour ${dogName}`}>
        {CARE_LOG_KINDS.map((kind) => {
          const Icon = CARE_LOG_ICONS[kind];
          return (
            <button
              key={kind}
              type="button"
              disabled={pending}
              onClick={() => quick(kind)}
              className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-surface-2 px-1 text-[13px] font-medium text-ink transition-colors active:bg-line disabled:opacity-60"
            >
              <Icon className="size-5" aria-hidden />
              {CARE_LOG_LABELS[kind]}
            </button>
          );
        })}
        <button
          type="button"
          disabled={pending}
          onClick={() => setSheet({ kind: "meal", file: null })}
          className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-line px-1 text-[13px] font-medium text-ink-2"
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          Détails
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choisir une photo"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (!file.type.startsWith("image/")) return void toast.error("Choisissez une image.");
          if (file.size > MAX_INPUT_BYTES) return void toast.error("Image trop lourde (15 Mo maximum).");
          setSheet({ kind: "photo", file });
        }}
      />
      <EntrySheet
        key={sheet ? `${sheet.kind}-${sheet.file?.name ?? ""}` : "closed"}
        open={sheet !== null}
        initialKind={sheet?.kind ?? "meal"}
        initialFile={sheet?.file ?? null}
        onClose={() => setSheet(null)}
        window={window}
        onSubmit={async ({ kind, occurredAt, note, file }) => {
          let photoPath: string | null = null;
          if (file) {
            if (!supabase) return "Envoi de photo indisponible pour le moment.";
            try {
              const blob = await resizeImage(file, 1600);
              const ext = blob.type === "image/webp" ? "webp" : "jpg";
              photoPath = `${assignmentId}/${crypto.randomUUID()}.${ext}`;
              const { error } = await supabase.storage.from("care-logs").upload(photoPath, blob, { contentType: blob.type, upsert: false });
              if (error) return "La photo n'a pas pu être envoyée. Réessayez.";
            } catch {
              return "Cette image ne peut pas être lue.";
            }
          }
          const r = await addCareLog({ assignmentId, kind, occurredAt, note, photoPath });
          if (!r.ok) return r.error;
          hapticSuccess();
          toast.success(`Ajouté au carnet : ${CARE_LOG_LABELS[kind].toLowerCase()}`);
          setSheet(null);
          router.refresh();
          return null;
        }}
      />
    </div>
  );
}

function EntrySheet({
  open,
  initialKind,
  initialFile,
  onClose,
  window,
  onSubmit,
}: {
  open: boolean;
  initialKind: CareLogKind;
  initialFile: File | null;
  onClose: () => void;
  window: { start: number; end: number };
  onSubmit: (v: { kind: CareLogKind; occurredAt: string; note: string; file: File | null }) => Promise<string | null>;
}) {
  // now, kept inside the garde's window
  const [defaultAt] = useState(() => Math.min(Math.max(Date.now(), window.start), window.end - 60_000));
  const [kind, setKind] = useState(initialKind);
  const [date, setDate] = useState(toLocalDate(defaultAt));
  const [time, setTime] = useState(toLocalTime(defaultAt));
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(initialFile);
  const [preview] = useState(() => (initialFile ? URL.createObjectURL(initialFile) : null));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pickFile = useRef<HTMLInputElement>(null);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      let occurredAt: string;
      try {
        occurredAt = new Date(zonedInstant(date, time)).toISOString();
      } catch {
        return setError("Heure invalide.");
      }
      if (kind === "note" && !note.trim()) return setError("Écrivez un mot.");
      if (kind === "photo" && !file) return setError("Ajoutez une photo.");
      const message = await onSubmit({ kind, occurredAt, note, file });
      if (message) setError(message);
    });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-[28px] border-0 pb-safe">
        <SheetHeader>
          <SheetTitle className="text-xl font-semibold">Ajouter au carnet</SheetTitle>
          <SheetDescription>Les responsables du chien le verront. Prise en charge, récupération et photos les préviennent.</SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-col gap-4 px-4 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm font-medium text-ink-2">Quoi ?</legend>
            {CARE_LOG_KINDS.map((k) => {
              const Icon = CARE_LOG_ICONS[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium",
                    kind === k ? "bg-ink text-surface" : "bg-surface-2 text-ink",
                  )}
                >
                  <Icon className="size-4" aria-hidden /> {CARE_LOG_LABELS[k]}
                </button>
              );
            })}
          </fieldset>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Jour" htmlFor="log-date">
              <TextInput id="log-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Heure" htmlFor="log-time">
              <TextInput id="log-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
            </Field>
          </div>
          <Field label={kind === "note" ? "Votre mot" : "Un mot (facultatif)"} htmlFor="log-note">
            <TextArea id="log-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {kind === "photo" && (
            <div className="flex items-center gap-3">
              {preview && file === initialFile ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL)
                <img src={preview} alt="Aperçu de la photo" className="size-20 rounded-2xl object-cover" />
              ) : null}
              <PillButton type="button" variant="soft" size="sm" onClick={() => pickFile.current?.click()}>
                <Camera className="size-4" aria-hidden /> {file ? "Changer de photo" : "Choisir une photo"}
              </PillButton>
              {file && file !== initialFile && <span className="truncate text-[13px] text-ink-3">{file.name}</span>}
              <input
                ref={pickFile}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Choisir une photo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f && f.type.startsWith("image/") && f.size <= MAX_INPUT_BYTES) setFile(f);
                  else if (f) toast.error("Choisissez une image de 15 Mo au plus.");
                }}
              />
            </div>
          )}
          {error && (
            <p className="rounded-2xl bg-[#f6dcd9] px-4 py-3 text-[14px] font-medium text-[#7a1b14]" role="alert">
              {error}
            </p>
          )}
          <PillButton type="submit" size="lg" loading={pending}>
            Ajouter
          </PillButton>
        </form>
      </SheetContent>
    </Sheet>
  );
}
