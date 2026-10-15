import type { RequestStatus, RequestType, StatusTone } from "@/domain/status";
import type { LocalDate } from "@/domain/time";
import type { DayBucket } from "@/domain/views";

/** Serializable, lightweight item passed to client calendar components. */
export type DayItem = {
  id: string;
  dogName: string;
  type: RequestType;
  status: RequestStatus;
  tone: StatusTone;
  label: string;
  start: number;
  end: number;
  helpers: string[];
};

export type CalendarDay = { date: LocalDate; tone: StatusTone; items: DayItem[] };

export function toCalendarDays(buckets: DayBucket[]): CalendarDay[] {
  return buckets.map((b) => ({
    date: b.date,
    tone: b.tone,
    items: b.items.map((v) => ({
      id: v.request.id,
      dogName: v.dog?.name ?? "Chien",
      type: v.request.request_type,
      status: v.status.status,
      tone: v.status.tone,
      label: v.label,
      start: v.period.start,
      end: v.period.end,
      helpers: v.assignments.map((a) => a.name),
    })),
  }));
}

export type StatusFilter = "all" | "organize" | "uncovered" | "confirmed" | "info";
