/**
 * Pure delivery decisions for push notifications (unit-tested).
 *
 * Outcome of one send to one device:
 * - ok: delivered
 * - gone: the device no longer exists (404/410, unknown token) → forget it
 * - error: transient failure (5xx, 429, network) → retry later
 * - unconfigured: the server cannot use this channel (missing keys) →
 *   not the device's fault: never counted against it
 */
export type DeviceOutcome = "ok" | "gone" | "error" | "unconfigured";

export type NotificationDecision = "complete" | "retry";

/** A notification is done when one device got it, or when retrying cannot help. */
export function decideNotification(outcomes: readonly DeviceOutcome[]): NotificationDecision {
  if (outcomes.some((o) => o === "ok")) return "complete";
  if (outcomes.some((o) => o === "error" || o === "unconfigured")) return "retry";
  return "complete"; // no device, or only devices that are gone
}

export const MAX_DEVICE_FAILURES = 5;

/** What to do with a device after an outcome. */
export function decideDevice(
  outcome: DeviceOutcome,
  previousFailures: number,
): { action: "success" | "forget" | "count-failure" | "none"; failures: number } {
  switch (outcome) {
    case "ok":
      return { action: "success", failures: 0 };
    case "gone":
      return { action: "forget", failures: previousFailures };
    case "unconfigured":
      return { action: "none", failures: previousFailures };
    case "error": {
      const failures = previousFailures + 1;
      return { action: failures >= MAX_DEVICE_FAILURES ? "forget" : "count-failure", failures };
    }
  }
}
