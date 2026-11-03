import { describe, expect, it } from "vitest";
import { groupProposals, holePartFor, planAbsence, separatedIntervals, type AbsenceDog, type AbsencePerson, type CircleCandidate } from "@/domain/absence";
import { DEFAULT_PLAN_RULES } from "@/domain/planner";
import { zonedInstant } from "@/domain/time";

// Friday 13 18:00 → Monday 16 09:00, November 2026 (Paris)
const z = (d: number, t: string) => zonedInstant(`2026-11-${d}`, t);
const period = { start: z(13, "18:00"), end: z(16, "09:00") };
const ALL = ["morning", "afternoon", "evening", "night"] as const;
const days = (...dates: string[]) => dates.flatMap((date) => ALL.map((slot) => ({ date, slot, status: "available" as const })));
const allDays = () => days("2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16");
const person = (userId: string, over: Partial<AbsencePerson> = {}): AbsencePerson => ({
  userId,
  name: userId,
  entries: [],
  rules: [],
  gardes: [],
  maxDogs: 2,
  ownsDog: false,
  prefs: {},
  ...over,
});
const dog = (id: string, over: Partial<AbsenceDog> = {}): AbsenceDog => ({ id, name: id, aloneOnly: false, rules: DEFAULT_PLAN_RULES, candidates: [], ...over });
const aston = dog("aston");
const nala = dog("nala");
const pro: CircleCandidate = { userId: "pro", name: "Zoé", role: "pro", startsAt: null, endsAt: null };
const close: CircleCandidate = { userId: "mum", name: "Annie", role: "close", startsAt: null, endsAt: null };
const guest = (startsAt: number, endsAt: number): CircleCandidate => ({ userId: "guest", name: "Bea", role: "guest", startsAt, endsAt });

describe("planAbsence, one dog", () => {
  it("groups the plan per person, with their place, and leaves Sunday evening and night as a hole", () => {
    const a = planAbsence({
      period,
      dogs: [aston],
      people: [
        // the parents: Friday and Saturday (nights included), at home, 2 nights max
        person("parents", { entries: days("2026-11-13", "2026-11-14"), prefs: { aston: { place: "helper", maxNights: 2 } } }),
        // Léa: Sunday daytime only, at the owner's
        person("lea", {
          entries: [
            { date: "2026-11-15", slot: "morning", status: "available" },
            { date: "2026-11-15", slot: "afternoon", status: "available" },
          ],
          prefs: { aston: { place: "owner", maxNights: 0 } },
        }),
      ],
    });
    expect(a.proposals.map((p) => [p.userId, p.parts[0].place, p.parts[0].slices.length])).toEqual([
      ["parents", "helper", 1],
      ["lea", "owner", 1],
    ]);
    expect(a.proposals[0].parts[0].slices[0]).toEqual({ start: period.start, end: z(15, "06:00") });
    expect(a.proposals[1].parts[0].slices[0]).toEqual({ start: z(15, "06:00"), end: z(15, "18:00") });
    const [{ plan }] = a.dogs;
    expect(plan.holes.map((h) => [h.start, h.end])).toEqual([[z(15, "18:00"), period.end]]);
    expect(plan.holes[0].reason).toBe("Personne n'a déclaré de dispo sur ce créneau");
    expect(a.separated).toEqual([]);
  });

  it("offers circle people for the holes, pros first, guests only within their dates", () => {
    const a = planAbsence({ period, dogs: [dog("aston", { candidates: [guest(z(13, "00:00"), z(14, "00:00")), close, pro] })], people: [] });
    // nobody declared anything: one hole, the guest's dates do not cover it
    expect(a.dogs[0].plan.holes).toHaveLength(1);
    expect(a.dogs[0].holeCandidates[String(period.start)].map((c) => c.userId)).toEqual(["pro", "mum"]);
    const b = planAbsence({ period, dogs: [dog("aston", { candidates: [guest(z(13, "00:00"), z(17, "00:00"))] })], people: [] });
    expect(b.dogs[0].holeCandidates[String(period.start)].map((c) => c.userId)).toEqual(["guest"]);
  });

  it("leaving someone out recomputes the plan without them", () => {
    const people = [person("emma", { entries: allDays() })];
    expect(planAbsence({ period, dogs: [aston], people }).proposals).toHaveLength(1);
    const a = planAbsence({ period, dogs: [aston], people, skip: ["emma"] });
    expect(a.proposals).toEqual([]);
    expect(a.skipped).toEqual(["emma"]);
  });
});

describe("planAbsence, several dogs", () => {
  it("keeps the dogs together with one person when they can", () => {
    const a = planAbsence({ period, dogs: [aston, nala], people: [person("emma", { entries: allDays(), prefs: {} }), person("lea", { entries: days("2026-11-14") })] });
    expect(a.proposals.map((p) => [p.userId, p.parts.map((x) => x.dogId)])).toEqual([["emma", ["aston", "nala"]]]);
    // the dog's rule (3 nights) holds for the pair: both plans are identical
    expect(a.dogs[0].plan.slices).toEqual(a.dogs[1].plan.slices);
    expect(a.separated).toEqual([]);
  });

  it("splits them when nobody can take both, and says when they are apart", () => {
    // Emma keeps one dog at a time; Léa is there Saturday only
    const a = planAbsence({
      period,
      dogs: [aston, nala],
      people: [person("emma", { entries: allDays(), maxDogs: 1 }), person("lea", { entries: days("2026-11-14"), maxDogs: 2 })],
    });
    // together: only Léa on Saturday; the rest dog by dog
    const holders = (i: number) => a.dogs[i].plan.slices.map((s) => s.userId);
    expect(holders(0)).toContain("emma");
    expect(holders(1)).not.toContain("emma");
    expect(a.separated.length).toBeGreaterThan(0);
    // Nala has holes Emma could not fill (she already keeps Aston then)
    expect(a.dogs[1].plan.holes.length).toBeGreaterThan(0);
  });

  it("a dog kept alone is never with another dog of the absence, and never at the home of someone with a dog", () => {
    const rex = dog("rex", { aloneOnly: true });
    const a = planAbsence({
      period,
      dogs: [aston, rex],
      people: [
        person("emma", { entries: allDays(), maxDogs: 3 }),
        person("paul", { entries: allDays(), ownsDog: true }),
        person("annie", { entries: allDays(), ownsDog: true, prefs: { rex: { place: "owner", maxNights: null } } }),
      ],
    });
    const rexPlan = a.dogs.find((d) => d.dogId === "rex")!.plan;
    const astonPlan = a.dogs.find((d) => d.dogId === "aston")!.plan;
    // Paul has a dog: never Rex; Annie too, but at the owner's
    expect(rexPlan.slices.length).toBeGreaterThan(0);
    expect(rexPlan.slices.every((s) => s.userId !== "paul" && (s.userId !== "annie" || s.place === "owner"))).toBe(true);
    // whoever keeps Rex keeps no other dog at the same time
    for (const r of rexPlan.slices) {
      expect(astonPlan.slices.some((s) => s.userId === r.userId && s.start < r.end && r.start < s.end)).toBe(false);
    }
    expect(a.separated).toEqual([]);
  });

  it("uses the strictest rules of the dogs and each person's preference for each", () => {
    const strict = dog("nala", { rules: { maxConsecutiveNights: 1, minSliceMs: 3 * 3_600_000 } });
    const a = planAbsence({
      period,
      dogs: [aston, strict],
      people: [
        person("emma", { entries: allDays(), prefs: { aston: { place: "owner", maxNights: null }, nala: { place: "owner", maxNights: null } } }),
        person("lea", { entries: allDays() }),
      ],
    });
    expect(Math.max(...Object.values(a.dogs[1].plan.nights))).toBe(1);
    expect(a.dogs[0].plan.slices.find((s) => s.userId === "emma")?.place).toBe("owner");
  });

  it("their other gardes count: someone keeping a dog kept alone elsewhere cannot take ours", () => {
    const a = planAbsence({
      period,
      dogs: [aston],
      people: [person("emma", { entries: allDays(), gardes: [{ start: z(14, "10:00"), end: z(14, "20:00"), aloneOnly: true }] })],
    });
    expect(a.dogs[0].plan.holes.map((h) => [h.start, h.end])).toEqual([[z(14, "10:00"), z(14, "20:00")]]);
  });
});

describe("separatedIntervals", () => {
  const plan = (slices: Array<[string, number, number]>, holes: Array<[number, number]> = []) => ({
    plan: {
      slices: slices.map(([userId, start, end]) => ({ userId, name: userId, start, end, reason: "" })),
      holes: holes.map(([start, end]) => ({ start, end, reason: "" })),
      openMs: 0,
      coveredMs: 0,
      handoffs: 0,
      nights: {},
    },
  });
  it("reports when the dogs are with different people or one is without anyone", () => {
    const a = plan([["emma", 0, 10], ["lea", 10, 20]]);
    const b = plan([["emma", 0, 5], ["lea", 5, 15]], [[15, 20]]);
    expect(separatedIntervals([a, b])).toEqual([{ start: 5, end: 10 }, { start: 15, end: 20 }]);
    // both without anyone: a hole, not a separation
    expect(separatedIntervals([plan([], [[0, 10]]), plan([], [[0, 10]])])).toEqual([]);
  });
});

describe("holePartFor", () => {
  it("asks a circle person for the whole hole, or what fits their limit of nights for this absence", () => {
    const zoe = { userId: "zoe", name: "Zoé" };
    expect(holePartFor(period, { ...zoe, maxNights: null }, DEFAULT_PLAN_RULES)).toEqual([period]);
    // Friday 18:00 → Monday 09:00 with 2 nights max: until Sunday morning, then the Sunday day (no third night)
    expect(holePartFor(period, { ...zoe, maxNights: 2 }, DEFAULT_PLAN_RULES)).toEqual([{ start: period.start, end: z(15, "20:00") }]);
  });
});

describe("groupProposals", () => {
  const p = (id: string, dogName: string, absenceId: string | null, start = "2026-11-13T17:00:00Z") => ({
    id,
    request_id: `r-${id}`,
    absenceId,
    dogName,
    place: "helper" as const,
    slices: [{ starts_at: start, ends_at: "2026-11-16T08:00:00Z" }],
    starts_at: start,
  });
  it("one card per absence, the dogs in alphabetical order; a lone proposal stays alone", () => {
    const groups = groupProposals([p("2", "Nala", "abs"), p("1", "Aston", "abs"), p("3", "Rex", null, "2026-11-20T08:00:00Z")]);
    expect(groups.map((g) => [g.requestIds.length, g.parts.map((x) => x.dogName)])).toEqual([
      [2, ["Aston", "Nala"]],
      [1, ["Rex"]],
    ]);
  });
});
