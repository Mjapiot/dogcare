import { parseLocalDate, type LocalDate } from "./time";

/** Identity and habits: visible to everyone who sees the dog. */
export type PassportDog = {
  name: string;
  breed: string | null;
  birth_date: string | null;
  photo_path: string | null;
  sex: "female" | "male" | null;
  sterilized: boolean | null;
  weight_kg: number | string | null;
  identification: string | null;
  distinctive_marks: string | null;
  meals: string | null;
  walks: string | null;
  sleep: string | null;
  behavior: string | null;
  care_notes: string | null;
};

/** Health: caretakers, live sitters, or a link that includes it. */
export type PassportHealth = {
  allergies: string | null;
  treatments: string | null;
  vet_name: string | null;
  vet_clinic: string | null;
  vet_phone: string | null;
  vet_address: string | null;
  notes: string | null;
};

export type EmergencyContact = { name: string; relation?: string; phone: string };

/** Emergency: same visibility as health. */
export type PassportEmergency = { contacts: EmergencyContact[]; instructions: string | null };

export const MAX_EMERGENCY_CONTACTS = 5;

/** Durations offered when sharing the passport, in hours. */
export const SHARE_DURATIONS = [
  { hours: 24, label: "24 heures" },
  { hours: 24 * 7, label: "7 jours" },
  { hours: 24 * 30, label: "30 jours" },
] as const;

/** "3 ans", "1 an", "8 mois", "moins d'un mois"; null without a valid past birth date. */
export function dogAge(birthDate: LocalDate | null, today: LocalDate): string | null {
  if (!birthDate) return null;
  const b = parseLocalDate(birthDate);
  const t = parseLocalDate(today);
  let months = (t.year - b.year) * 12 + (t.month - b.month);
  if (t.day < b.day) months -= 1;
  if (months < 0) return null;
  if (months < 1) return "moins d'un mois";
  if (months < 12) return `${months} mois`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 an" : `${years} ans`;
}

/** "12,5 kg" (French decimal comma). */
export function formatWeight(weight: number | string | null): string | null {
  if (weight === null || weight === "") return null;
  const n = typeof weight === "number" ? weight : Number(weight);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kg`;
}

/** "Mâle, stérilisé" / "Femelle" / null. */
export function formatSex(sex: PassportDog["sex"], sterilized: boolean | null): string | null {
  const base = sex === "male" ? "Mâle" : sex === "female" ? "Femelle" : null;
  const ster =
    sterilized === null ? null : sterilized ? (sex === "female" ? "stérilisée" : "stérilisé") : sex === "female" ? "non stérilisée" : "non stérilisé";
  if (base && ster) return `${base}, ${ster}`;
  if (base) return base;
  return ster ? ster.charAt(0).toUpperCase() + ster.slice(1) : null;
}

/** "tel:" target for a phone number typed freely ("06 12 34 56 78", "+33 (0)6…"). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/\(0\)/g, "").replace(/[^0-9+]/g, "")}`;
}

export function hasHabits(dog: PassportDog): boolean {
  return Boolean(dog.meals || dog.walks || dog.sleep || dog.behavior || dog.care_notes);
}

export function hasHealth(health: PassportHealth | null): boolean {
  return Boolean(
    health &&
      (health.allergies || health.treatments || health.vet_name || health.vet_clinic || health.vet_phone || health.vet_address || health.notes),
  );
}

export function hasEmergency(emergency: PassportEmergency | null): boolean {
  return Boolean(emergency && (emergency.contacts.length > 0 || emergency.instructions));
}

export type ShareLinkState = "active" | "expired" | "revoked";

export function shareLinkState(link: { expires_at: string; revoked_at: string | null }, now: Date): ShareLinkState {
  if (link.revoked_at) return "revoked";
  return new Date(link.expires_at).getTime() > now.getTime() ? "active" : "expired";
}
