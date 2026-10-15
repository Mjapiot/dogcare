import type { NotificationType } from "@/lib/types";

export type PushNotificationInput = {
  id: string;
  notification_type: NotificationType;
  title: string;
  body: string | null;
  request_id: string | null;
};

export type PushPayload = { title: string; body: string; url: string; tag: string };

/** Content of the system notification shown on the device. */
export function buildPushPayload(n: PushNotificationInput): PushPayload {
  return {
    title: n.title.slice(0, 120),
    body: (n.body ?? "").slice(0, 240),
    url: n.request_id ? `/requests/${n.request_id}` : "/notifications",
    // one visible notification per request: a newer one replaces the older
    tag: n.request_id ? `request-${n.request_id}` : `notification-${n.id}`,
  };
}

/** Converts a base64url VAPID public key for PushManager.subscribe. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
