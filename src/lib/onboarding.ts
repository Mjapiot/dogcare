/** Onboarding paths: creating a group adds the (optional) dog step. */
export const ONBOARDING_STEPS = {
  create: ["Prénom", "Groupe", "Chien", "Habitudes"],
  join: ["Prénom", "Groupe", "Habitudes"],
} as const;

/** Entering a group: dogs kept without one are offered to it first (skipped when there are none). */
export function shareDogsStep(groupId: string, next: string): string {
  return `/onboarding/share-dogs?group=${groupId}&next=${encodeURIComponent(next)}`;
}

/** Without a group: someone keeping a dog (passport first) or in a dog's circle lives in "Mes chiens". */
export function homeWithoutGroup(ownDogs: number, circleDogs: number): "/circle" | "/onboarding/group" {
  return ownDogs > 0 || circleDogs > 0 ? "/circle" : "/onboarding/group";
}

/** Dogs to offer to a group I enter: mine, not archived, not already in it. */
export function dogsToShare<T extends { id: string; archived_at: string | null }>(myDogs: readonly T[], inGroup: ReadonlySet<string>): T[] {
  return myDogs.filter((d) => !d.archived_at && !inGroup.has(d.id));
}

/** After sharing: someone who already has a dog skips the "add your dog" step. */
export function afterSharingDogs(next: string): string {
  return next.startsWith("/dogs/new") ? "/onboarding/habits?dog=1" : next;
}
