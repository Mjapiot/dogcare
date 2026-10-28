import { APP_TIME_ZONE } from "@/domain/config";
import { parseLocalDate, toLocalDate, type LocalDate } from "@/domain/time";

const tz = APP_TIME_ZONE;

const fmtTime = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
const fmtDayShort = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
const fmtDayLong = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
const fmtRelative = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

/** Local date as a UTC-noon Date, safe to format with timeZone UTC. */
function localDateAsUtc(date: LocalDate): Date {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function formatTime(instant: number | string): string {
  return fmtTime.format(new Date(instant)).replace(":", "h");
}

export function formatDayShort(instant: number | string): string {
  return fmtDayShort.format(new Date(instant));
}

export function formatDayLong(instant: number | string): string {
  return fmtDayLong.format(new Date(instant));
}

export function formatLocalDate(date: LocalDate, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }).format(localDateAsUtc(date));
}

export function weekdayLabel(date: LocalDate, style: "long" | "short" = "long"): string {
  const label = formatLocalDate(date, { weekday: style });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function monthShort(date: LocalDate): string {
  return formatLocalDate(date, { month: "short" }).replace(".", "").toUpperCase();
}

/** "sam. 7 nov., 18h00 → dim. 8 nov., 18h00" — collapses same-day periods. */
export function formatPeriod(start: number | string, end: number | string): string {
  const sameDay = toLocalDate(start) === toLocalDate(new Date(end).getTime() - 1);
  if (sameDay) return `${formatDayShort(start)} · ${formatTime(start)} – ${formatTime(end)}`;
  return `${formatDayShort(start)}, ${formatTime(start)} → ${formatDayShort(end)}, ${formatTime(end)}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} j ${h} h` : `${days} j`;
}

export function formatRelative(instant: string | number, now = Date.now()): string {
  const diff = new Date(instant).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "à l'instant";
  if (abs < 3_600_000) return fmtRelative.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return fmtRelative.format(Math.round(diff / 3_600_000), "hour");
  return fmtRelative.format(Math.round(diff / 86_400_000), "day");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** "de Moka" / "d'Aston" (elision before a vowel or a mute h). */
export function deName(name: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(name.trim()) ? `d'${name}` : `de ${name}`;
}
