import { describe, expect, it } from "vitest";
import { decideDevice, decideNotification } from "@/lib/push-delivery";

describe("decideNotification", () => {
  it("is complete as soon as one device received it", () => {
    expect(decideNotification(["error", "ok"])).toBe("complete");
  });

  it("retries after a transient error or a server configuration problem", () => {
    expect(decideNotification(["error"])).toBe("retry");
    expect(decideNotification(["gone", "unconfigured"])).toBe("retry");
  });

  it("is complete when the user has no device or only dead devices", () => {
    expect(decideNotification([])).toBe("complete");
    expect(decideNotification(["gone", "gone"])).toBe("complete");
  });
});

describe("decideDevice", () => {
  it("resets failures on success and forgets dead devices", () => {
    expect(decideDevice("ok", 3)).toEqual({ action: "success", failures: 0 });
    expect(decideDevice("gone", 0).action).toBe("forget");
  });

  it("never blames a device for a server configuration problem", () => {
    expect(decideDevice("unconfigured", 4)).toEqual({ action: "none", failures: 4 });
  });

  it("forgets a device only after 5 consecutive transient failures", () => {
    expect(decideDevice("error", 3)).toEqual({ action: "count-failure", failures: 4 });
    expect(decideDevice("error", 4)).toEqual({ action: "forget", failures: 5 });
  });
});
