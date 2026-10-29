import type { NotificationType } from "@/lib/types";

export type PushNotificationInput = {
  id: string;
  notification_type: NotificationType;
  title: string;
  body: string | null;
  request_id: string | null;
  /** Null when the person is outside the request's group (a circle invitee). */
  group_id?: string | null;
};

export type PushPayload = { title: string; body: string; url: string; tag: string };

/** A request opened from a notification: the group's page for members, the circle's page otherwise. */
export function requestHref(requestId: string, groupId: string | null): string {
  return groupId === null ? `/circle/requests/${requestId}` : `/requests/${requestId}`;
}

/** Content of the system notification shown on the device. */
export function buildPushPayload(n: PushNotificationInput): PushPayload {
  return {
    title: n.title.slice(0, 120),
    body: (n.body ?? "").slice(0, 240),
    // group_id unknown (older batch): the group's page, which redirects if needed
    url: n.request_id ? requestHref(n.request_id, n.group_id === undefined ? "" : n.group_id) : "/notifications",
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

const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Android
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari / iOS home-screen apps
  /^[a-z0-9-]+\.notify\.windows\.com$/, // legacy Edge / Windows
];

/** Only well-known push services may receive server-side requests. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.port && PUSH_SERVICE_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}
