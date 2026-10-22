import { REQUEST_TYPE_LABELS, type RequestType } from "@/domain/status";
import type { IcsEvent } from "@/lib/ics";

/** One row of public.calendar_feed_events. */
export type FeedRow = {
  assignment_id: string;
  request_id: string;
  role: "sitter" | "owner";
  request_type: RequestType;
  assignment_status: "confirmed" | "pending_reconfirmation";
  starts_at: string;
  ends_at: string;
  dog_name: string;
  other_name: string;
  description: string | null;
  updated_at: string;
};

/**
 * Turns a confirmed assignment into a calendar event.
 * - sitter: "Garde · Pistache (Camille)"
 * - owner:  "Pistache · Garde assurée par Emma"
 * An assignment waiting for reconfirmation is shown as tentative.
 */
export function feedRowToEvent(row: FeedRow, origin: string): IcsEvent {
  const type = REQUEST_TYPE_LABELS[row.request_type];
  const pending = row.assignment_status === "pending_reconfirmation";
  const base =
    row.role === "sitter"
      ? `${type} · ${row.dog_name}${row.other_name ? ` (${row.other_name})` : ""}`
      : `${row.dog_name} · ${type} assurée par ${row.other_name}`;
  const summary = pending ? `À reconfirmer · ${base}` : base;

  const url = `${origin}/requests/${row.request_id}`;
  const lead =
    row.role === "sitter"
      ? `Vous vous occupez de ${row.dog_name}${row.other_name ? ` pour ${row.other_name}` : ""}.`
      : `${row.other_name} s'occupe de ${row.dog_name}.`;
  const description = [
    lead,
    pending ? "Les horaires ont changé : la garde doit être reconfirmée dans Dogcare." : null,
    row.description?.trim() || null,
    `Détails dans Dogcare : ${url}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    uid: `${row.assignment_id}@dogcare`,
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
    summary,
    description,
    url,
    status: pending ? "TENTATIVE" : "CONFIRMED",
    lastModified: new Date(row.updated_at),
  };
}

/** Subscription URL for Apple Calendar (webcal:// opens the subscribe sheet). */
export function calendarFeedUrls(origin: string, token: string): { https: string; webcal: string } {
  const https = `${origin}/calendar/${token}.ics`;
  return { https, webcal: https.replace(/^https?:/, "webcal:") };
}

/** Token from the "{token}.ics" route segment, or null. */
export function parseFeedFile(file: string): string | null {
  const match = /^([A-Za-z0-9_-]{43})\.ics$/.exec(file);
  return match ? match[1] : null;
}
