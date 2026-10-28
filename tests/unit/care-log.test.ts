import { describe, expect, it } from "vitest";
import { careLogWindow, groupCareLogByDay, isCareLogOpen, isOngoing, latestCareNews } from "@/domain/care-log";

const H = 3_600_000;
const garde = { status: "confirmed", starts_at: "2026-11-10T08:00:00.000Z", ends_at: "2026-11-10T20:00:00.000Z" };
const start = Date.parse(garde.starts_at);
const end = Date.parse(garde.ends_at);

describe("care log window (same rule as the database)", () => {
  it("opens 2 hours before the garde and closes 24 hours after it (half-open)", () => {
    expect(careLogWindow(garde)).toEqual({ start: start - 2 * H, end: end + 24 * H });
    expect(isCareLogOpen(garde, start - 2 * H - 1)).toBe(false);
    expect(isCareLogOpen(garde, start - 2 * H)).toBe(true);
    expect(isCareLogOpen(garde, end + 24 * H - 1)).toBe(true);
    expect(isCareLogOpen(garde, end + 24 * H)).toBe(false);
  });

  it("is closed while a garde waits for reconfirmation or is cancelled", () => {
    expect(isCareLogOpen({ ...garde, status: "pending_reconfirmation" }, start)).toBe(false);
    expect(isCareLogOpen({ ...garde, status: "cancelled" }, start)).toBe(false);
  });

  it("knows when a garde is happening now", () => {
    expect(isOngoing(garde, start)).toBe(true);
    expect(isOngoing(garde, end)).toBe(false);
    expect(isOngoing(garde, start - 1)).toBe(false);
  });
});

describe("timeline", () => {
  const entries = [
    { id: "a", occurred_at: "2026-11-10T07:30:00.000Z" },
    { id: "b", occurred_at: "2026-11-10T22:30:00.000Z" }, // 23:30 in Paris: still the 10th
    { id: "c", occurred_at: "2026-11-10T23:10:00.000Z" }, // 00:10 in Paris: the 11th
    { id: "d", occurred_at: "2026-11-10T12:00:00.000Z" },
  ];

  it("groups by Paris day, newest first", () => {
    expect(groupCareLogByDay(entries).map((d) => [d.date, d.entries.map((e) => e.id)])).toEqual([
      ["2026-11-11", ["c"]],
      ["2026-11-10", ["b", "d", "a"]],
    ]);
  });

  it("gives the latest news", () => {
    expect(latestCareNews(entries)?.id).toBe("c");
    expect(latestCareNews([])).toBeNull();
  });
});
