import { Check, Minus, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlotStatus } from "@/domain/availability";

export const STATUS_TEXT: Record<SlotStatus, string> = {
  available: "disponible",
  unavailable: "indisponible",
  unknown: "non renseigné",
};

/** Visual state of one availability cell. Never color-only: icon + pattern. */
export function SlotCellFace({
  status,
  fromRule,
  selected,
}: {
  status: SlotStatus;
  fromRule: boolean;
  selected: boolean;
}) {
  return (
    <span
      className={cn(
        "relative flex h-11 w-full items-center justify-center rounded-xl text-[13px] font-semibold transition-colors",
        status === "available" && "bg-[var(--tone-covered)] text-[var(--tone-covered-ink)]",
        status === "unavailable" && "bg-[#d9d5cd] text-[#3f3c37]",
        status === "unknown" && "border border-dashed border-ink/20 bg-transparent text-ink-3",
        fromRule && status !== "unknown" && "opacity-75",
        selected && "ring-[3px] ring-ink ring-offset-1 ring-offset-surface",
      )}
    >
      {status === "available" && <Check className="size-4" aria-hidden />}
      {status === "unavailable" && <Minus className="size-4" aria-hidden />}
      {fromRule && status !== "unknown" && <Repeat className="absolute top-1 right-1 size-2.5" aria-hidden />}
    </span>
  );
}
