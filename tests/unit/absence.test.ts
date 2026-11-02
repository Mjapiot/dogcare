import { describe, expect, it } from "vitest";
import { planAbsence, type CircleCandidate } from "@/domain/absence";
import type { PlanPerson } from "@/domain/plan-inputs";
import { DEFAULT_PLAN_RULES } from "@/domain/planner";
import { zonedInstant } from "@/domain/time";

// Friday 13 18:00 → Monday 16 09:00, November 2026 (Paris)
const z = (d: number, t: string) => zonedInstant(`2026-11-${d}`, t);
const period = { start: z(13, "18:00"), end: z(16, "09:00") };
const ALL = ["morning", "afternoon", "evening", "night"] as const;
const days = (...dates: string[]) => dates.flatMap((date) => ALL.map((slot) => ({ date, slot, status: "available" as const })));
const person = (userId: string, over: Partial<PlanPerson> = {}): PlanPerson => ({ userId, name: userId, entries: [], rules: [], busy: [], ...over });
const pro: CircleCandidate = { userId: "pro", name: "Zoé", role: "pro", startsAt: null, endsAt: null };
const close: CircleCandidate = { userId: "mum", name: "Annie", role: "close", startsAt: null, endsAt: null };
const guest = (startsAt: number, endsAt: number): CircleCandidate => ({ userId: "guest", name: "Bea", role: "guest", startsAt, endsAt });

describe("planAbsence", () => {
  it("groups the plan per person, with their place, and leaves Sunday evening and night as a hole", () => {
    const a = planAbsence({
      period,
      rules: DEFAULT_PLAN_RULES,
      candidates: [],
      people: [
        // the parents: Friday and Saturday (nights included), at home, 2 nights max
        person("parents", { entries: days("2026-11-13", "2026-11-14"), pref: { place: "helper", maxNights: 2 } }),
        // Léa: Sunday daytime only, at the owner's
        person("lea", {
          entries: [
            { date: "2026-11-15", slot: "morning", status: "available" },
            { date: "2026-11-15", slot: "afternoon", status: "available" },
          ],
          pref: { place: "owner", maxNights: 0 },
        }),
      ],
    });
    expect(a.proposals.map((p) => [p.userId, p.place, p.slices.length])).toEqual([
      ["parents", "helper", 1],
      ["lea", "owner", 1],
    ]);
    expect(a.proposals[0].slices[0]).toEqual({ start: period.start, end: z(15, "06:00") });
    expect(a.proposals[1].slices[0]).toEqual({ start: z(15, "06:00"), end: z(15, "18:00") });
    expect(a.plan.holes.map((h) => [h.start, h.end])).toEqual([
      [z(15, "18:00"), period.end],
    ]);
    expect(a.plan.holes[0].reason).toBe("Personne n'a déclaré de dispo sur ce créneau");
  });

  it("offers circle people for the holes, pros first, guests only within their dates", () => {
    const a = planAbsence({
      period,
      rules: DEFAULT_PLAN_RULES,
      people: [],
      candidates: [guest(z(13, "00:00"), z(14, "00:00")), close, pro],
    });
    // nobody declared anything: one hole, the guest's dates do not cover it
    expect(a.plan.holes).toHaveLength(1);
    expect(a.holeCandidates[String(period.start)].map((c) => c.userId)).toEqual(["pro", "mum"]);
    const b = planAbsence({ period, rules: DEFAULT_PLAN_RULES, people: [], candidates: [guest(z(13, "00:00"), z(17, "00:00"))] });
    expect(b.holeCandidates[String(period.start)].map((c) => c.userId)).toEqual(["guest"]);
  });

  it("leaving someone out recomputes the plan without them", () => {
    const people = [person("emma", { entries: days("2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16") })];
    expect(planAbsence({ period, rules: DEFAULT_PLAN_RULES, people, candidates: [] }).proposals).toHaveLength(1);
    const a = planAbsence({ period, rules: DEFAULT_PLAN_RULES, people, candidates: [], skip: ["emma"] });
    expect(a.proposals).toEqual([]);
    expect(a.skipped).toEqual(["emma"]);
  });
});
