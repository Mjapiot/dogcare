"use client";

import { getMyCalendarEvents } from "@/server/actions/calendar";
import { eventSignature, planCalendarSync, type WrittenEvents } from "@/lib/calendar-sync";
import { Capacitor } from "@capacitor/core";
import { isNativeApp } from "@/lib/native";

/**
 * iPhone app only: my confirmed gardes written straight into a "Dogcare"
 * calendar of the iPhone (no subscription delay). The app keeps, on the
 * device, which events it wrote, and makes the calendar equal to my gardes at
 * each sync (opening, return to the app, live update). One account at a time:
 * another account signing in starts from an empty calendar.
 */

const STATE_KEY = "dogcare:native-calendar";
const CALENDAR_TITLE = "Dogcare";
const CALENDAR_COLOR = "#4f6f52";

type State = { calendarId: string; userId: string | null; events: WrittenEvents };

function readState(): State | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as State) : null;
  } catch {
    return null;
  }
}

function writeState(state: State | null) {
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    // storage unavailable
  }
}

async function plugin() {
  const { CapacitorCalendar } = await import("@ebarooni/capacitor-calendar");
  return CapacitorCalendar;
}

/**
 * The app can write into the iPhone's calendar: version 1.1 or later (the
 * 1.0 app, which loads this same site, has no calendar module and keeps the
 * subscription).
 */
export function nativeCalendarSupported(): boolean {
  return isNativeApp() && Capacitor.isPluginAvailable("CapacitorCalendar");
}

/** Turned on in this app, on this iPhone. */
export function nativeCalendarEnabled(): boolean {
  return nativeCalendarSupported() && readState() !== null;
}

/** Our calendar on the iPhone, created again if it was deleted in the Calendar app. */
async function ensureCalendar(state: State | null): Promise<State> {
  const cal = await plugin();
  const { result } = await cal.listCalendars();
  if (state && result.some((c) => c.id === state.calendarId)) return state;
  const { id } = await cal.createCalendar({ title: CALENDAR_TITLE, color: CALENDAR_COLOR });
  // a new calendar holds none of the events written before
  return { calendarId: id, userId: state?.userId ?? null, events: {} };
}

let running: Promise<SyncResult> | null = null;

export type SyncResult = { ok: true; count: number } | { ok: false; reason: "off" | "denied" | "error" };

/** Makes the iPhone's "Dogcare" calendar equal to my confirmed gardes. Safe to call often. */
export function syncNativeCalendar(): Promise<SyncResult> {
  if (!nativeCalendarEnabled()) return Promise.resolve({ ok: false, reason: "off" });
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync(): Promise<SyncResult> {
  try {
    const cal = await plugin();
    const access = await cal.requestFullCalendarAccess().catch(() => ({ result: "denied" }));
    if (access.result !== "granted") return { ok: false, reason: "denied" };
    const r = await getMyCalendarEvents();
    if (!r.ok) return { ok: false, reason: "error" };
    let state = await ensureCalendar(readState());
    // another account on this iPhone: never show the previous one's gardes
    if (state.userId && state.userId !== r.data.userId) {
      await cal.deleteCalendar({ id: state.calendarId }).catch(() => {});
      state = await ensureCalendar(null);
    }
    state = { ...state, userId: r.data.userId };

    const plan = planCalendarSync(r.data.events, state.events);
    const events = { ...state.events };
    for (const e of plan.remove) {
      await cal.deleteEvent({ id: e.eventId }).catch(() => {});
      delete events[e.key];
    }
    for (const e of plan.modify) {
      try {
        await cal.modifyEvent({ id: e.eventId, calendarId: state.calendarId, title: e.title, startDate: e.start, endDate: e.end, description: e.notes, url: e.url });
        events[e.key] = { eventId: e.eventId, signature: eventSignature(e) };
      } catch {
        // deleted by hand in the Calendar app: written again below
        delete events[e.key];
        plan.create.push(e);
      }
    }
    for (const e of plan.create) {
      const { id } = await cal.createEvent({ calendarId: state.calendarId, title: e.title, startDate: e.start, endDate: e.end, description: e.notes, url: e.url });
      if (!id) continue;
      events[e.key] = { eventId: id, signature: eventSignature(e) };
      // saved as it goes: an interrupted sync never writes an event twice
      writeState({ ...state, events });
    }
    writeState({ ...state, events });
    return { ok: true, count: r.data.events.length };
  } catch (error) {
    console.error("[dogcare] native calendar", error instanceof Error ? error.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** Asks for access (once), creates the "Dogcare" calendar and writes my gardes. */
export async function enableNativeCalendar(): Promise<SyncResult> {
  if (!nativeCalendarSupported()) return { ok: false, reason: "off" };
  const cal = await plugin();
  const access = await cal.requestFullCalendarAccess().catch(() => ({ result: "denied" }));
  if (access.result !== "granted") return { ok: false, reason: "denied" };
  writeState(await ensureCalendar(readState()));
  return syncNativeCalendar();
}

/** Removes the "Dogcare" calendar and its events from the iPhone (turning it off, signing out). */
export async function disableNativeCalendar(): Promise<void> {
  const state = readState();
  writeState(null);
  if (!state || !nativeCalendarSupported()) return;
  try {
    const cal = await plugin();
    await cal.deleteCalendar({ id: state.calendarId });
  } catch {
    // already gone, or no access any more
  }
}

