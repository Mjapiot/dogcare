/** Onboarding paths: creating a group adds the (optional) dog step. */
export const ONBOARDING_STEPS = {
  create: ["Prénom", "Groupe", "Chien", "Habitudes"],
  join: ["Prénom", "Groupe", "Habitudes"],
} as const;

/** Entering a group: dogs kept without one are offered to it first (skipped when there are none). */
export function shareDogsStep(groupId: string, next: string): string {
  return `/onboarding/share-dogs?group=${groupId}&next=${encodeURIComponent(next)}`;
}
