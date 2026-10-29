import { TONE_LABELS } from "@/domain/status";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, TONE_ICONS } from "@/components/domain/tone";

const MEANINGS = {
  covered: "toute la période a un gardien confirmé",
  pending: "en attente de réponses ou de confirmation",
  uncovered: "indispensable et tout le monde a répondu non",
  partial: "une partie du besoin reste sans gardien",
  info: "le chien sera seul, pour information",
} as const;

/** What each color means (always with its icon and label). */
export function Legend() {
  return (
    <details className="rounded-2xl bg-surface px-4 py-3 text-[14px]">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink-2">Que signifient les couleurs ?</summary>
      <ul className="mt-3 flex flex-col gap-2">
        {(Object.keys(MEANINGS) as Array<keyof typeof MEANINGS>).map((t) => {
          const Icon = TONE_ICONS[t];
          return (
            <li key={t} className="flex items-center gap-2">
              <span className={cn("flex size-7 items-center justify-center rounded-lg", TONE_CLASSES[t])}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-ink-2">
                <strong className="font-semibold text-ink">{TONE_LABELS[t]}</strong> — {MEANINGS[t]}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
