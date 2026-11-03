"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Circle, CircleAlert, Clock } from "lucide-react";
import { checkRoutine, deleteCareLog } from "@/server/actions/care-log";
import { formatTime } from "@/lib/format";
import { hapticSuccess } from "@/lib/native";
import { spokenTime, type RoutineItem } from "@/domain/routines";
import { cn } from "@/lib/utils";
import { ROUTINE_ICONS } from "@/components/dogs/routines-card";

/**
 * Today's routines of a garde. The helper checks an occurrence off in one tap
 * (an entry of the care log) or unchecks it; the owner sees what was done.
 */
export function RoutineChecklist({
  items,
  assignmentId,
  canCheck,
  title,
}: {
  items: RoutineItem[];
  assignmentId: string;
  canCheck: boolean;
  title: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = (item: RoutineItem) =>
    startTransition(async () => {
      const r = item.done
        ? await deleteCareLog(item.done.entryId)
        : await checkRoutine({ assignmentId, routineId: item.routineId, routineAt: new Date(item.at).toISOString() });
      if (!r.ok) return void toast.error(r.error);
      if (!item.done) hapticSuccess();
      router.refresh();
    });

  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="px-1 text-[13px] font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
      <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface-2">
        {items.map((item) => {
          const Icon = ROUTINE_ICONS[item.kind];
          const status = item.done
            ? `Fait à ${formatTime(item.done.at)}${canCheck ? "" : ` par ${item.done.by}`}`
            : item.state === "upcoming"
              ? "À venir"
              : item.state === "missed"
                ? "Non coché"
                : canCheck
                  ? "À faire"
                  : "Pas encore coché";
          const StatusIcon = item.done ? Check : item.state === "upcoming" ? Clock : item.state === "missed" ? CircleAlert : Circle;
          const content = (
            <>
              <Icon className="size-5 shrink-0 text-ink-2" aria-hidden />
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-[15px] font-medium text-ink">
                  {spokenTime(item.time)} · {item.label}
                </span>
                {item.instructions && <span className="block text-[13px] text-ink-3">{item.instructions}</span>}
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium",
                  item.done
                    ? "bg-[var(--tone-covered)] text-[var(--tone-covered-ink)]"
                    : item.state === "missed"
                      ? "bg-[var(--tone-pending)] text-[var(--tone-pending-ink)]"
                      : "bg-surface text-ink-2",
                )}
              >
                <StatusIcon className="size-3.5" aria-hidden /> {status}
              </span>
            </>
          );
          const checkable = canCheck && (item.done || item.state === "due" || item.state === "missed");
          return (
            <li key={`${item.routineId}-${item.at}`}>
              {checkable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(item)}
                  aria-pressed={Boolean(item.done)}
                  aria-label={`${item.label} de ${spokenTime(item.time)} : ${item.done ? "décocher" : "cocher"}`}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 disabled:opacity-60"
                >
                  {content}
                </button>
              ) : (
                <div className="flex min-h-14 items-center gap-3 px-4 py-2">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
