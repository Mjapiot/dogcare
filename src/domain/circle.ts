import { localDayInterval, toLocalDate, type LocalDate } from "./time";

/** Roles of a dog's circle of trust (owner and co-owner are its caretakers). */
export type CircleKind = "owner" | "co_owner" | "close" | "entourage" | "guest" | "pro";
/** People invited directly to a dog (outside its groups). */
export type DirectRole = "close" | "guest" | "pro";
export type SectionAccess = "always" | "during_care" | "never";

export const CIRCLE_KIND_LABELS: Record<CircleKind, string> = {
  owner: "Propriétaire",
  co_owner: "Copropriétaire",
  close: "Proche",
  entourage: "Entourage",
  guest: "Invité",
  pro: "Professionnel",
};

export const CIRCLE_KIND_HINTS: Record<CircleKind, string> = {
  owner: "Tous les droits.",
  co_owner: "Modifie le passeport, publie et confirme les gardes, gère le cercle.",
  close: "Voit toujours la santé et les urgences.",
  entourage: "Voit la santé et les urgences pendant ses gardes.",
  guest: "Accès au passeport entre deux dates.",
  pro: "Pet-sitter rémunéré : passeport, santé et urgences pendant ses gardes.",
};

export const ACCESS_LABELS: Record<SectionAccess, string> = {
  always: "Toujours",
  during_care: "Pendant ses gardes",
  never: "Jamais",
};

/** Default health/emergency access of a role, as offered in the editor. */
export const ROLE_DEFAULTS: Record<"close" | "entourage" | "guest" | "pro", SectionAccess> = {
  close: "always",
  entourage: "during_care",
  guest: "always",
  pro: "during_care",
};

/**
 * Guest access from the start of `from` to the end of `to` (Paris days,
 * half-open interval), as ISO instants. `from` empty = starts now.
 */
export function guestWindow(from: LocalDate | "", to: LocalDate): { startsAt: string | null; endsAt: string } {
  return {
    startsAt: from ? new Date(localDayInterval(from).start).toISOString() : null,
    endsAt: new Date(localDayInterval(to).end).toISOString(),
  };
}

/** Last day included in a guest window (its end is midnight of the next day). */
export function lastGuestDay(endsAt: string): LocalDate {
  return toLocalDate(new Date(endsAt).getTime() - 1);
}

export type GuestState = "upcoming" | "active" | "ended";

export function guestState(window: { starts_at: string | null; ends_at: string | null }, now: Date): GuestState {
  const t = now.getTime();
  if (window.ends_at && new Date(window.ends_at).getTime() <= t) return "ended";
  if (window.starts_at && new Date(window.starts_at).getTime() > t) return "upcoming";
  return "active";
}

/**
 * Whether a close person, pro or guest can be asked over a period: a close
 * person or a pro always, a guest only if their dates cover it entirely (same rule as
 * private.circle_covers in the database).
 */
export function circleCovers(
  person: { role: DirectRole; starts_at: string | null; ends_at: string | null },
  period: { start: number; end: number },
): boolean {
  if (person.role !== "guest") return true;
  if (!person.ends_at) return false;
  const startsOk = !person.starts_at || new Date(person.starts_at).getTime() <= period.start;
  return startsOk && new Date(person.ends_at).getTime() >= period.end;
}
