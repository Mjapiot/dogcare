/**
 * Keeping the iPhone's "Dogcare" calendar equal to my confirmed gardes: what
 * to create, modify and delete, from the gardes wanted and the events the app
 * wrote before (kept on the device). Pure.
 */

/** A garde as an event of the iPhone's calendar. */
export type NativeEvent = {
  /** The assignment: one event per assignment. */
  key: string;
  title: string;
  start: number;
  end: number;
  notes: string;
  url: string;
};

/** What the app wrote: the iPhone's event id, and the content it had. */
export type WrittenEvents = Record<string, { eventId: string; signature: string }>;

/** Changes when anything shown changes (dates, title, notes, link). */
export function eventSignature(e: NativeEvent): string {
  return JSON.stringify([e.title, e.start, e.end, e.notes, e.url]);
}

export function planCalendarSync(
  wanted: readonly NativeEvent[],
  written: Readonly<WrittenEvents>,
): {
  create: NativeEvent[];
  modify: Array<NativeEvent & { eventId: string }>;
  remove: Array<{ key: string; eventId: string }>;
} {
  const keys = new Set(wanted.map((e) => e.key));
  return {
    create: wanted.filter((e) => !written[e.key]),
    modify: wanted.filter((e) => written[e.key] && written[e.key].signature !== eventSignature(e)).map((e) => ({ ...e, eventId: written[e.key].eventId })),
    remove: Object.entries(written)
      .filter(([key]) => !keys.has(key))
      .map(([key, w]) => ({ key, eventId: w.eventId })),
  };
}
