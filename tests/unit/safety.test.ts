import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { isAllowedPushEndpoint } from "@/lib/push-payload";

describe("safeRedirectPath", () => {
  it("keeps in-app paths with query and hash", () => {
    expect(safeRedirectPath("/invite/abc?x=1#top")).toBe("/invite/abc?x=1#top");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "evil.com",
    "javascript:alert(1)",
    "/\tevil",
    "",
  ])("rejects %j", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });

  it("keeps percent-encoded paths on the same origin", () => {
    expect(safeRedirectPath("/%0a//evil")).toBe("/%0a//evil");
  });

  it("rejects non-strings and uses the fallback", () => {
    expect(safeRedirectPath(undefined, "/onboarding")).toBe("/onboarding");
    expect(safeRedirectPath(["/a"])).toBe("/");
  });
});

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://web.push.apple.com/QK7a",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ])("accepts %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://169.254.169.254/latest/meta-data",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evil.com/?fcm.googleapis.com",
    "https://fcm.googleapis.com:8443/x",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});

import { formatJoinCode, normalizeJoinCode } from "@/lib/join-code";

describe("join codes", () => {
  it("normalizes what people type", () => {
    expect(normalizeJoinCode(" k7pq-m2xd ")).toBe("K7PQM2XD");
    expect(normalizeJoinCode("K7PQ M2XD")).toBe("K7PQM2XD");
  });

  it("rejects impossible codes (wrong length, look-alike characters)", () => {
    expect(normalizeJoinCode("K7PQM2X")).toBeNull();
    expect(normalizeJoinCode("K7PQM2X0")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeJoinCode("https://dogcare/invite/abc")).toBeNull();
  });

  it("formats for display", () => {
    expect(formatJoinCode("K7PQM2XD")).toBe("K7PQ-M2XD");
  });
});
