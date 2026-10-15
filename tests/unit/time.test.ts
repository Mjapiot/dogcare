import { describe, expect, it } from "vitest";
import {
  addDays,
  isoWeekday,
  localDatesTouched,
  localDayInterval,
  slotInstancesOverlapping,
  slotInterval,
  startOfWeek,
  toLocalDate,
  toLocalTime,
  zonedInstant,
} from "@/domain/time";

const HOUR = 3_600_000;

describe("calendar arithmetic", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("computes ISO weekdays and week starts", () => {
    expect(isoWeekday("2026-10-15")).toBe(4); // Thursday
    expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12");
  });
});

describe("Europe/Paris conversions", () => {
  it("uses UTC+2 in summer and UTC+1 in winter", () => {
    expect(new Date(zonedInstant("2026-07-01", "12:00")).toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(new Date(zonedInstant("2026-12-01", "12:00")).toISOString()).toBe("2026-12-01T11:00:00.000Z");
  });

  it("maps instants back to local date and time", () => {
    const instant = Date.parse("2026-10-15T22:30:00Z"); // 00:30 on the 16th in Paris
    expect(toLocalDate(instant)).toBe("2026-10-16");
    expect(toLocalTime(instant)).toBe("00:30");
  });

  it("has a 23h day when clocks spring forward (29 March 2026)", () => {
    const day = localDayInterval("2026-03-29");
    expect(day.end - day.start).toBe(23 * HOUR);
  });

  it("has a 25h day when clocks fall back (25 October 2026)", () => {
    const day = localDayInterval("2026-10-25");
    expect(day.end - day.start).toBe(25 * HOUR);
  });
});

describe("slots", () => {
  it("builds standard slots", () => {
    const morning = slotInterval("2026-07-01", "morning");
    expect(new Date(morning.start).toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(morning.end - morning.start).toBe(6 * HOUR);
  });

  it("night spills over to the next day", () => {
    const night = slotInterval("2026-07-01", "night");
    expect(toLocalDate(night.start)).toBe("2026-07-01");
    expect(toLocalDate(night.end)).toBe("2026-07-02");
    expect(night.end - night.start).toBe(8 * HOUR);
  });

  it("night slot is 7h or 9h across DST changes", () => {
    const spring = slotInterval("2026-03-28", "night");
    expect(spring.end - spring.start).toBe(7 * HOUR);
    const autumn = slotInterval("2026-10-24", "night");
    expect(autumn.end - autumn.start).toBe(9 * HOUR);
  });

  it("lists slots overlapping an interval, including the previous night", () => {
    const period = { start: zonedInstant("2026-07-02", "05:00"), end: zonedInstant("2026-07-02", "13:00") };
    const found = slotInstancesOverlapping(period).map((s) => `${s.date}:${s.slot}`);
    expect(found).toEqual(["2026-07-01:night", "2026-07-02:morning", "2026-07-02:afternoon"]);
  });

  it("does not include a slot that only touches the boundary", () => {
    const period = { start: zonedInstant("2026-07-02", "12:00"), end: zonedInstant("2026-07-02", "18:00") };
    const found = slotInstancesOverlapping(period).map((s) => `${s.date}:${s.slot}`);
    expect(found).toEqual(["2026-07-02:afternoon"]);
  });

  it("lists the local days an interval touches (end exclusive)", () => {
    const period = { start: zonedInstant("2026-07-03", "18:00"), end: zonedInstant("2026-07-05", "00:00") };
    expect(localDatesTouched(period)).toEqual(["2026-07-03", "2026-07-04"]);
  });
});
