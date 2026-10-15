import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  Clock,
  Info,
  UserCheck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { RequestStatus, StatusTone } from "@/domain/status";

/** Tailwind classes per tone: background + readable text (>7:1). */
export const TONE_CLASSES: Record<StatusTone, string> = {
  covered: "bg-[var(--tone-covered)] text-[var(--tone-covered-ink)]",
  pending: "bg-[var(--tone-pending)] text-[var(--tone-pending-ink)]",
  uncovered: "bg-[var(--tone-uncovered)] text-[var(--tone-uncovered-ink)]",
  partial: "bg-[var(--tone-partial)] text-[var(--tone-partial-ink)] hatch",
  info: "bg-[var(--tone-info)] text-[var(--tone-info-ink)]",
  muted: "bg-[var(--tone-muted)] text-[var(--tone-muted-ink)]",
  none: "bg-[var(--tone-none)] text-[var(--tone-none-ink)]",
};

export const TONE_ICONS: Record<StatusTone, LucideIcon> = {
  covered: CircleCheck,
  pending: Clock,
  uncovered: CircleAlert,
  partial: CircleDashed,
  info: Info,
  muted: CircleSlash,
  none: CircleSlash,
};

export const STATUS_ICONS: Record<RequestStatus, LucideIcon> = {
  informational: Info,
  awaiting_responses: CircleHelp,
  potential_helpers: Users,
  volunteer_found: UserCheck,
  partially_covered: CircleDashed,
  confirmed: CircleCheck,
  uncovered: CircleAlert,
  cancelled: XCircle,
};
