import { describe, expect, it } from "vitest";
import { guestState, guestWindow, lastGuestDay } from "@/domain/circle";
import { deName } from "@/lib/format";

describe("guest window (Europe/Paris days, half-open)", () => {
  it("runs from the start of the first day to midnight after the last one", () => {
    expect(guestWindow("2026-11-07", "2026-11-16")).toEqual({
      startsAt: "2026-11-06T23:00:00.000Z",
      endsAt: "2026-11-16T23:00:00.000Z",
    });
  });

  it("starts now when no first day is given, and handles the DST change", () => {
    expect(guestWindow("", "2026-10-25")).toEqual({ startsAt: null, endsAt: "2026-10-25T23:00:00.000Z" });
    expect(guestWindow("2026-03-29", "2026-03-29").startsAt).toBe("2026-03-28T23:00:00.000Z");
    expect(guestWindow("2026-03-29", "2026-03-29").endsAt).toBe("2026-03-29T22:00:00.000Z");
  });

  it("gives back the last day included", () => {
    expect(lastGuestDay("2026-11-16T23:00:00.000Z")).toBe("2026-11-16");
    expect(lastGuestDay(guestWindow("", "2026-03-29").endsAt)).toBe("2026-03-29");
  });
});

describe("guest state", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("is upcoming, active or ended", () => {
    expect(guestState({ starts_at: "2026-11-12T00:00:00Z", ends_at: "2026-11-14T00:00:00Z" }, now)).toBe("upcoming");
    expect(guestState({ starts_at: null, ends_at: "2026-11-14T00:00:00Z" }, now)).toBe("active");
    expect(guestState({ starts_at: null, ends_at: "2026-11-10T12:00:00Z" }, now)).toBe("ended");
  });
});

describe("deName", () => {
  it("elides before a vowel or a mute h", () => {
    expect(deName("Aston")).toBe("d'Aston");
    expect(deName("Hector")).toBe("d'Hector");
    expect(deName("Éclair")).toBe("d'Éclair");
    expect(deName("Moka")).toBe("de Moka");
  });
});
