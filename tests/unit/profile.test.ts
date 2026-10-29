import { describe, expect, it } from "vitest";
import { yearStart, yearStats, yearStatsLabel } from "@/domain/profile";
import { zonedInstant } from "@/domain/time";

const NOW = zonedInstant("2026-11-10", "12:00");

describe("this year", () => {
  it("starts on 1 January in Paris", () => {
    expect(new Date(yearStart(NOW)).toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("counts gardes I gave and gardes my dogs received, ended this year only", () => {
    const g = (assigned: string, dog: string, ends: string, request = `r-${assigned}-${ends}`) => ({
      request_id: request,
      assigned_user_id: assigned,
      dog_id: dog,
      ends_at: new Date(zonedInstant(ends, "18:00")).toISOString(),
    });
    const gardes = [
      g("me", "friend-dog", "2026-03-02"),
      g("me", "friend-dog", "2026-10-30"),
      g("emma", "my-dog", "2026-06-01"),
      g("me", "friend-dog", "2025-12-31"), // last year
      g("me", "friend-dog", "2026-11-20"), // not over yet
      g("me", "my-dog", "2026-05-05"), // my own dog: neither given nor received
      g("me", "friend-dog", "2026-03-03", "r-me-2026-03-02"), // second slice of the same garde
    ];
    expect(yearStats(gardes, "me", ["my-dog"], NOW)).toEqual({ given: 2, received: 1 });
  });

  it("says it simply, or nothing", () => {
    expect(yearStatsLabel({ given: 2, received: 1 })).toBe("2 gardes assurées · 1 reçue pour vos chiens");
    expect(yearStatsLabel({ given: 1, received: 0 })).toBe("1 garde assurée");
    expect(yearStatsLabel({ given: 0, received: 0 })).toBeNull();
  });
});
