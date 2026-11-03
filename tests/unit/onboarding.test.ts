import { describe, expect, it } from "vitest";
import { afterSharingDogs, dogsToShare, homeWithoutGroup, shareDogsStep } from "@/lib/onboarding";

describe("without a group", () => {
  it("someone with a dog or in a dog's circle lives in « Mes chiens », others create or join a group", () => {
    expect(homeWithoutGroup(1, 0)).toBe("/circle");
    expect(homeWithoutGroup(0, 2)).toBe("/circle");
    expect(homeWithoutGroup(0, 0)).toBe("/onboarding/group");
  });
});

describe("sharing dogs when entering a group", () => {
  const dogs = [
    { id: "aston", archived_at: null },
    { id: "nala", archived_at: null },
    { id: "rex", archived_at: "2026-10-01T00:00:00Z" },
  ];

  it("offers my dogs, not archived, not already in the group", () => {
    expect(dogsToShare(dogs, new Set(["nala"])).map((d) => d.id)).toEqual(["aston"]);
    expect(dogsToShare(dogs, new Set(["aston", "nala"]))).toEqual([]);
  });

  it("skips « add your dog » after sharing; the step keeps where to go next", () => {
    expect(afterSharingDogs("/dogs/new?welcome=1")).toBe("/onboarding/habits?dog=1");
    expect(afterSharingDogs("/onboarding/habits")).toBe("/onboarding/habits");
    expect(shareDogsStep("g1", "/dogs/new?welcome=1")).toBe("/onboarding/share-dogs?group=g1&next=%2Fdogs%2Fnew%3Fwelcome%3D1");
  });
});
