import { describe, expect, it } from "vitest";
import { buildPushPayload, urlBase64ToUint8Array } from "@/lib/push-payload";

describe("buildPushPayload", () => {
  it("links to the request and groups notifications per request", () => {
    const p = buildPushPayload({ id: "n1", notification_type: "new_volunteer", title: "Emma peut aider", body: "Toute la période", request_id: "r1" });
    expect(p).toEqual({ title: "Emma peut aider", body: "Toute la période", url: "/requests/r1", tag: "request-r1" });
  });

  it("falls back to the notification center and truncates long texts", () => {
    const p = buildPushPayload({ id: "n2", notification_type: "member_joined", title: "x".repeat(500), body: null, request_id: null });
    expect(p.url).toBe("/notifications");
    expect(p.title).toHaveLength(120);
    expect(p.body).toBe("");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url VAPID keys", () => {
    expect([...urlBase64ToUint8Array("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});
