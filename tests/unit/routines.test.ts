import { describe, expect, it } from "vitest";
import { describeRoutine, routineChecklist, routineOccurrences, type Routine } from "@/domain/routines";
import { zonedInstant } from "@/domain/time";

const meal: Routine = { id: "meal", kind: "meal", label: "Repas", times: ["08:00", "19:00"], weekdays: null, instructions: null };
const pill: Routine = { id: "pill", kind: "medication", label: "Médicament", times: ["20:00"], weekdays: [1, 3, 5], instructions: "½ comprimé" };
// Friday 13 18:00 → Monday 16 09:00, November 2026 (Paris)
const period = { start: zonedInstant("2026-11-13", "18:00"), end: zonedInstant("2026-11-16", "09:00") };

describe("routineOccurrences", () => {
  it("lists each time of each day inside the garde, weekdays respected", () => {
    const o = routineOccurrences([meal, pill], period);
    expect(o.map((x) => `${x.date} ${x.time} ${x.label}`)).toEqual([
      "2026-11-13 19:00 Repas",
      "2026-11-13 20:00 Médicament", // Friday
      "2026-11-14 08:00 Repas",
      "2026-11-14 19:00 Repas",
      "2026-11-15 08:00 Repas",
      "2026-11-15 19:00 Repas",
      "2026-11-16 08:00 Repas", // Monday: 20:00 is after the garde
    ]);
  });

  it("follows Paris time across the change of hour", () => {
    // clocks go back on Sunday 25 October 2026: 08:00 stays 08:00 in Paris
    const o = routineOccurrences([meal], { start: zonedInstant("2026-10-24", "00:00"), end: zonedInstant("2026-10-26", "00:00") });
    expect(o.filter((x) => x.time === "08:00").map((x) => x.at)).toEqual([zonedInstant("2026-10-24", "08:00"), zonedInstant("2026-10-25", "08:00")]);
    expect(o[2].at - o[0].at).toBe(25 * 3_600_000);
  });
});

describe("routineOccurrences across the spring change", () => {
  it("skips a time that does not exist that night (02:30 on 28 March 2027)", () => {
    const night: Routine = { id: "n", kind: "other", label: "Veille", times: ["02:30"], weekdays: null, instructions: null };
    const o = routineOccurrences([night], { start: zonedInstant("2027-03-27", "12:00"), end: zonedInstant("2027-03-29", "12:00") });
    expect(o.map((x) => x.date)).toEqual(["2027-03-29"]);
  });
});

describe("routineChecklist", () => {
  const occ = routineOccurrences([meal, pill], period);
  const at = (d: number, t: string) => zonedInstant(`2026-11-${d}`, t);

  it("shows the day's occurrences: done (when, by whom), due, upcoming", () => {
    const checks = [{ routine_id: "meal", routine_at: new Date(at(14, "08:00")).toISOString(), occurred_at: new Date(at(14, "08:12")).toISOString(), authorName: "Emma", entryId: "e1" }];
    const list = routineChecklist(occ, checks, at(14, "12:00"));
    expect(list.map((i) => [i.time, i.state, i.done?.by ?? null])).toEqual([
      ["08:00", "done", "Emma"],
      ["19:00", "upcoming", null],
    ]);
    // three hours before, it can already be checked off
    expect(routineChecklist(occ, [], at(14, "16:30"))[1].state).toBe("due");
  });

  it("an occurrence left unchecked half a day later is missed", () => {
    expect(routineChecklist(occ, [], at(15, "21:00"), "2026-11-14").map((i) => i.state)).toEqual(["missed", "missed"]);
  });

  it("describes a routine in words", () => {
    expect(describeRoutine(meal)).toBe("Repas 8 h et 19 h");
    expect(describeRoutine({ ...pill, times: ["20:30"] })).toBe("Médicament 20 h 30 (lun., mer., ven.)");
  });
});
