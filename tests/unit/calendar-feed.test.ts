import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, icsDateTime, icsText } from "@/lib/ics";
import { calendarFeedUrls, feedRowToEvent, parseFeedFile, type FeedRow } from "@/lib/calendar-feed";

const TOKEN = "a".repeat(40) + "_-Z";

const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  assignment_id: "11111111-1111-4111-8111-111111111111",
  request_id: "22222222-2222-4222-8222-222222222222",
  role: "sitter",
  request_type: "care",
  assignment_status: "confirmed",
  starts_at: "2026-10-30T07:00:00.000Z",
  ends_at: "2026-10-30T17:00:00.000Z",
  dog_name: "Pistache",
  other_name: "Camille",
  description: null,
  updated_at: "2026-10-22T08:00:00.000Z",
  ...over,
});

describe("iCalendar writer", () => {
  it("writes UTC date-times", () => {
    expect(icsDateTime(new Date("2026-10-30T07:05:09.123Z"))).toBe("20261030T070509Z");
  });

  it("escapes text values", () => {
    expect(icsText("a;b,c\\d\nnext")).toBe("a\\;b\\,c\\\\d\\nnext");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const line = `DESCRIPTION:${"é".repeat(80)}`;
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n ").join("")).toBe(line);
  });

  it("builds a calendar with CRLF line endings", () => {
    const ics = buildIcs({ name: "Dogcare", now: new Date("2026-10-22T00:00:00Z"), events: [feedRowToEvent(row(), "https://x.test")] });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261030T070000Z\r\n");
    expect(ics).toContain("UID:11111111-1111-4111-8111-111111111111@dogcare\r\n");
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("an empty feed is still a valid calendar", () => {
    const ics = buildIcs({ name: "Dogcare", now: new Date(), events: [] });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("feed events", () => {
  it("sitter: names the dog and its owner", () => {
    const e = feedRowToEvent(row(), "https://x.test");
    expect(e.summary).toBe("Garde · Pistache (Camille)");
    expect(e.status).toBe("CONFIRMED");
    expect(e.url).toBe("https://x.test/requests/22222222-2222-4222-8222-222222222222");
  });

  it("owner: names who takes care of the dog", () => {
    const e = feedRowToEvent(row({ role: "owner", other_name: "Emma", request_type: "visit" }), "https://x.test");
    expect(e.summary).toBe("Pistache · Visite ou promenade assurée par Emma");
  });

  it("an assignment awaiting reconfirmation is tentative and says so", () => {
    const e = feedRowToEvent(row({ assignment_status: "pending_reconfirmation" }), "https://x.test");
    expect(e.status).toBe("TENTATIVE");
    expect(e.summary.startsWith("À reconfirmer · ")).toBe(true);
  });
});

describe("feed URLs", () => {
  it("webcal and https URLs share the same path", () => {
    expect(calendarFeedUrls("https://x.test", TOKEN)).toEqual({
      https: `https://x.test/calendar/${TOKEN}.ics`,
      webcal: `webcal://x.test/calendar/${TOKEN}.ics`,
    });
  });

  it("only accepts a well-formed token file name", () => {
    expect(parseFeedFile(`${TOKEN}.ics`)).toBe(TOKEN);
    expect(parseFeedFile(TOKEN)).toBeNull();
    expect(parseFeedFile(`${TOKEN}x.ics`)).toBeNull();
    expect(parseFeedFile("../etc.ics")).toBeNull();
  });
});
