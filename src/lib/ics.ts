/**
 * Minimal iCalendar (RFC 5545) writer for the calendar subscription feed.
 * Times are written in UTC: calendar apps show them in the device time zone.
 */
export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  url?: string;
  status: "CONFIRMED" | "TENTATIVE";
  lastModified: Date;
};

export type IcsCalendar = {
  name: string;
  events: IcsEvent[];
  now: Date;
};

/** 20261022T081500Z */
export function icsDateTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escapes a TEXT value (backslash, separators, line breaks). */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line at 75 octets, never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // continuation lines start with a space, which counts toward the limit
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(calendar: IcsCalendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dogcare//Gardes//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(calendar.name)}`,
    "X-WR-TIMEZONE:Europe/Paris",
    // hint for calendar apps: refresh every hour
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of calendar.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${icsDateTime(calendar.now)}`,
      `LAST-MODIFIED:${icsDateTime(e.lastModified)}`,
      `DTSTART:${icsDateTime(e.start)}`,
      `DTEND:${icsDateTime(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
      `STATUS:${e.status}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
