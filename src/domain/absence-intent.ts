/**
 * The absence assistant: a sentence ("Je pars vendredi 18 h, retour lundi
 * matin, pas plus de 2 nuits chez mes parents") is turned into structured
 * data by a language model; this module checks that data against what the
 * app knows (dogs, people, dates). Nothing is ever invented: an unknown name
 * or a missing date becomes an issue the owner sees. Pure.
 */
import { zonedInstant, type LocalDate } from "./time";

/** What the model returns (already validated in shape). */
export type AbsenceIntent = {
  dog: string | null;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  rules: Array<{ person: string; maxNights: number | null; place: "helper" | "owner" | null }>;
  assumptions: string[];
};

/** A rule for this absence only (never saved as a preference). */
export type AbsenceRule = { userId: string; name: string; maxNights: number | null; place: "helper" | "owner" | null };

export type ResolvedAbsence = {
  dogId: string | null;
  startDate: LocalDate | null;
  startTime: string;
  endDate: LocalDate | null;
  endTime: string;
  rules: AbsenceRule[];
  /** What the assistant supposed (shown, never silent). */
  assumptions: string[];
  /** What it could not understand or check (to fix by hand). */
  issues: string[];
};

export const DEFAULT_START_TIME = "09:00";
export const DEFAULT_END_TIME = "18:00";
const MAX_DAYS = 31;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Case, accents and spaces do not matter when matching names. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Who a name designates: the whole display name, or its first word. */
function matchPeople<T extends { name: string }>(name: string, people: readonly T[]): T[] {
  const n = normalizeName(name);
  if (!n) return [];
  const exact = people.filter((p) => normalizeName(p.name) === n);
  if (exact.length) return exact;
  return people.filter((p) => normalizeName(p.name).split(" ")[0] === n.split(" ")[0] && n.split(" ").length === 1);
}

export function resolveAbsenceIntent(
  intent: AbsenceIntent,
  ctx: { dogs: ReadonlyArray<{ id: string; name: string }>; people: ReadonlyArray<{ userId: string; name: string }>; now: number },
): ResolvedAbsence {
  const issues: string[] = [];
  const assumptions = intent.assumptions.map((a) => a.trim()).filter(Boolean).slice(0, 5);

  // the dog: the only one, or the one named
  let dogId: string | null = null;
  if (ctx.dogs.length === 1) dogId = ctx.dogs[0].id;
  else if (intent.dog) {
    const found = matchPeople(intent.dog, ctx.dogs);
    if (found.length === 1) dogId = found[0].id;
    else issues.push(`Je ne sais pas de quel chien il s'agit (« ${intent.dog} ») : choisissez-le.`);
  } else issues.push("Quel chien ? Choisissez-le.");

  // dates: never guessed here; times default with a visible assumption
  const startDate = intent.startDate && DATE.test(intent.startDate) ? intent.startDate : null;
  const endDate = intent.endDate && DATE.test(intent.endDate) ? intent.endDate : null;
  if (!startDate) issues.push("Je n'ai pas compris la date de départ.");
  if (!endDate) issues.push("Je n'ai pas compris la date de retour.");
  let startTime = intent.startTime && TIME.test(intent.startTime) ? intent.startTime : null;
  let endTime = intent.endTime && TIME.test(intent.endTime) ? intent.endTime : null;
  if (!startTime) {
    startTime = DEFAULT_START_TIME;
    if (startDate) assumptions.push("Heure de départ non précisée : 9 h");
  }
  if (!endTime) {
    endTime = DEFAULT_END_TIME;
    if (endDate) assumptions.push("Heure de retour non précisée : 18 h");
  }
  if (startDate && endDate) {
    const start = zonedInstant(startDate, startTime);
    const end = zonedInstant(endDate, endTime);
    if (end <= start) issues.push("Le retour doit être après le départ.");
    else if (end <= ctx.now) issues.push("Cette période est déjà passée.");
    else if (end - start > MAX_DAYS * 24 * 3_600_000) issues.push("Une absence ne peut pas dépasser 31 jours.");
  }

  // rules: only for people the app knows, one per person
  const rules: AbsenceRule[] = [];
  for (const r of intent.rules.slice(0, 10)) {
    if (r.maxNights === null && r.place === null) continue;
    const found = matchPeople(r.person, ctx.people);
    if (found.length === 0) {
      issues.push(`« ${r.person} » ne fait pas partie du groupe ni du cercle du chien : règle ignorée.`);
      continue;
    }
    if (found.length > 1) {
      issues.push(`« ${r.person} » peut désigner ${found.map((p) => p.name).join(" ou ")} : règle ignorée.`);
      continue;
    }
    const person = found[0];
    const maxNights = r.maxNights === null ? null : Math.min(14, Math.max(0, Math.round(r.maxNights)));
    const existing = rules.find((x) => x.userId === person.userId);
    if (existing) {
      existing.maxNights = maxNights ?? existing.maxNights;
      existing.place = r.place ?? existing.place;
    } else rules.push({ userId: person.userId, name: person.name, maxNights, place: r.place });
  }

  return { dogId, startDate, startTime, endDate, endTime, rules, assumptions, issues };
}

/** "Mes parents : 2 nuits d'affilée max, chez eux" */
export function describeRule(r: Pick<AbsenceRule, "name" | "maxNights" | "place">): string {
  const parts: string[] = [];
  if (r.maxNights === 0) parts.push("jamais la nuit");
  else if (r.maxNights !== null) parts.push(`${r.maxNights} nuit${r.maxNights > 1 ? "s" : ""} d'affilée max`);
  if (r.place === "owner") parts.push("chez moi");
  else if (r.place === "helper") parts.push("chez eux");
  return `${r.name} : ${parts.join(", ")}`;
}

/** Rules in the URL of /plan: "id:2:helper,id:0:" (maxNights empty = dog's rule, place empty = their preference). */
export function encodeRules(rules: ReadonlyArray<Pick<AbsenceRule, "userId" | "maxNights" | "place">>): string {
  return rules.map((r) => `${r.userId}:${r.maxNights ?? ""}:${r.place ?? ""}`).join(",");
}

export function decodeRules(param: string | undefined): Array<Pick<AbsenceRule, "userId" | "maxNights" | "place">> {
  if (!param) return [];
  const out: Array<Pick<AbsenceRule, "userId" | "maxNights" | "place">> = [];
  for (const chunk of param.split(",").slice(0, 20)) {
    const [userId, nights, place] = chunk.split(":");
    if (!/^[0-9a-f-]{36}$/i.test(userId ?? "")) continue;
    const n = nights === "" || nights === undefined ? null : Number(nights);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 14)) continue;
    out.push({ userId, maxNights: n, place: place === "helper" || place === "owner" ? place : null });
  }
  return out;
}
