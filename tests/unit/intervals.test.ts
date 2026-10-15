import { describe, expect, it } from "vitest";
import {
  contains,
  intersect,
  mergeIntervals,
  overlaps,
  subtractIntervals,
  totalDuration,
} from "@/domain/intervals";

const i = (start: number, end: number) => ({ start, end });

describe("half-open intervals", () => {
  it("treats touching intervals as non-overlapping", () => {
    expect(overlaps(i(0, 10), i(10, 20))).toBe(false);
    expect(overlaps(i(0, 10), i(9, 20))).toBe(true);
  });

  it("intersects and checks containment", () => {
    expect(intersect(i(0, 10), i(5, 20))).toEqual(i(5, 10));
    expect(intersect(i(0, 10), i(10, 20))).toBeNull();
    expect(contains(i(0, 10), i(0, 10))).toBe(true);
    expect(contains(i(0, 10), i(0, 11))).toBe(false);
  });
});

describe("mergeIntervals", () => {
  it("sorts, merges overlapping and adjacent intervals", () => {
    expect(mergeIntervals([i(20, 30), i(0, 10), i(10, 15), i(25, 40)])).toEqual([i(0, 15), i(20, 40)]);
  });

  it("drops invalid intervals", () => {
    expect(mergeIntervals([i(10, 10), i(5, 1), i(0, 2)])).toEqual([i(0, 2)]);
  });

  it("does not mutate input", () => {
    const input = [i(0, 10), i(5, 20)];
    mergeIntervals(input);
    expect(input).toEqual([i(0, 10), i(5, 20)]);
  });
});

describe("subtractIntervals", () => {
  it("returns the whole base when nothing covers it", () => {
    expect(subtractIntervals(i(0, 100), [])).toEqual([i(0, 100)]);
  });

  it("finds gaps at start, middle and end", () => {
    expect(subtractIntervals(i(0, 100), [i(10, 20), i(20, 30), i(50, 60)])).toEqual([
      i(0, 10),
      i(30, 50),
      i(60, 100),
    ]);
  });

  it("returns no gap when fully covered by overlapping pieces", () => {
    expect(subtractIntervals(i(0, 100), [i(-5, 40), i(30, 120)])).toEqual([]);
  });

  it("leaves a 1 ms gap if coverage stops 1 ms short", () => {
    expect(subtractIntervals(i(0, 100), [i(0, 99)])).toEqual([i(99, 100)]);
  });

  it("totals merged durations", () => {
    expect(totalDuration([i(0, 10), i(5, 15), i(20, 25)])).toBe(20);
  });
});
