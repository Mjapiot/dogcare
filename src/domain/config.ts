/**
 * Product-level configuration. These are defaults, not universal truths:
 * change them here and every calculation (availability, calendar) follows.
 */

/** Time zone used to interpret local dates, slots and recurring rules. */
export const APP_TIME_ZONE = "Europe/Paris";

export const SLOT_KEYS = ["morning", "afternoon", "evening", "night"] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export type SlotDefinition = {
  key: SlotKey;
  label: string;
  /** Local start time "HH:MM". */
  start: string;
  /** Local end time "HH:MM". If end <= start the slot ends the next day. */
  end: string;
};

export const SLOTS: Record<SlotKey, SlotDefinition> = {
  morning: { key: "morning", label: "Matin", start: "06:00", end: "12:00" },
  afternoon: { key: "afternoon", label: "Après-midi", start: "12:00", end: "18:00" },
  evening: { key: "evening", label: "Soir", start: "18:00", end: "22:00" },
  night: { key: "night", label: "Nuit", start: "22:00", end: "06:00" },
};

/** How many days ahead the availability screen shows by default. */
export const AVAILABILITY_HORIZON_DAYS = 28;
