import { describe, expect, it } from "vitest";
import { buildRequestViews, bucketByDay, dashboardCounts, needsMyAnswer, type GroupSnapshot } from "@/domain/views";
import { addDays, zonedInstant } from "@/domain/time";
import type { CareAssignmentRow, CareRequestRow, RequestResponseRow } from "@/lib/types";

const DAY = "2030-03-04"; // a Monday, far in the future
const NOW = zonedInstant("2030-03-01", "12:00");
const iso = (d: string, t: string) => new Date(zonedInstant(d, t)).toISOString();

function request(id: string, over: Partial<CareRequestRow> = {}): CareRequestRow {
  return {
    id,
    group_id: "g",
    dog_id: "oscar",
    created_by: "julie",
    request_type: "care",
    necessity: "required",
    starts_at: iso(DAY, "09:00"),
    ends_at: iso(DAY, "18:00"),
    description: null,
    splittable: true,
    lifecycle_status: "active",
    cancelled_at: null,
    cancellation_reason: null,
    revision: 1,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function response(requestId: string, userId: string, status: "yes" | "no"): RequestResponseRow {
  return { id: `${requestId}-${userId}`, request_id: requestId, user_id: userId, response_status: status, proposed_starts_at: null, proposed_ends_at: null, note: null, responded_at: "" };
}

function assignment(requestId: string, userId: string, from: string, to: string, status: CareAssignmentRow["status"] = "confirmed"): CareAssignmentRow {
  return {
    id: `${requestId}-${userId}-a`,
    request_id: requestId,
    assigned_user_id: userId,
    starts_at: from,
    ends_at: to,
    status,
    confirmed_by: "julie",
    confirmed_at: "",
    cancelled_at: null,
    cancellation_reason: null,
    previous_starts_at: null,
    previous_ends_at: null,
  };
}

function snapshot(over: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    me: "emma",
    members: ["julie", "emma", "chloe"].map((u) => ({
      group_id: "g",
      user_id: u,
      role: "member" as const,
      share_availability: u !== "chloe",
      joined_at: "",
      display_name: u,
    })),
    dogs: [{ id: "oscar", name: "Oscar", breed: null, birth_date: null, photo_path: null, care_notes: null, sex: null, sterilized: null, weight_kg: null, identification: null, distinctive_marks: null, meals: null, walks: null, sleep: null, behavior: null, created_by: "julie", archived_at: null }],
    caretakers: [{ dog_id: "oscar", user_id: "julie", role: "owner" }],
    requests: [request("r1")],
    responses: [],
    assignments: [],
    availabilityEntries: [],
    availabilityRules: [],
    ...over,
  };
}

describe("buildRequestViews", () => {
  it("excludes the dog's caretakers from eligible helpers", () => {
    const [v] = buildRequestViews(snapshot(), NOW);
    expect(v.helpers.map((h) => h.userId).sort()).toEqual(["chloe", "emma"]);
    expect(v.iAmEligible).toBe(true);
    expect(v.iAmCaretaker).toBe(false);
  });

  it("uses declared availability only for members who share it", () => {
    const [v] = buildRequestViews(
      snapshot({
        availabilityEntries: [
          { user_id: "emma", date: DAY, slot: "morning", status: "available" },
          { user_id: "emma", date: DAY, slot: "afternoon", status: "available" },
          { user_id: "chloe", date: DAY, slot: "morning", status: "available" },
        ],
      }),
      NOW,
    );
    expect(v.helpers.find((h) => h.userId === "emma")?.availability).toBe("available");
    expect(v.helpers.find((h) => h.userId === "chloe")?.availability).toBe("hidden");
    expect(v.status.status).toBe("potential_helpers");
  });

  it("ignores cancelled assignments for coverage", () => {
    const [v] = buildRequestViews(
      snapshot({
        responses: [response("r1", "emma", "no"), response("r1", "chloe", "no")],
        assignments: [assignment("r1", "emma", iso(DAY, "09:00"), iso(DAY, "18:00"), "cancelled")],
      }),
      NOW,
    );
    expect(v.coverage.state).toBe("none");
    expect(v.status.status).toBe("uncovered");
    expect(v.assignments).toEqual([]);
  });

  it("does not count an assignment awaiting reconfirmation as coverage", () => {
    const [v] = buildRequestViews(
      snapshot({ assignments: [assignment("r1", "emma", iso(DAY, "09:00"), iso(DAY, "18:00"), "pending_reconfirmation")] }),
      NOW,
    );
    expect(v.coverage.state).toBe("none");
    expect(v.myAssignments).toHaveLength(1);
  });

  it("full coverage → confirmed", () => {
    const [v] = buildRequestViews(snapshot({ assignments: [assignment("r1", "emma", iso(DAY, "09:00"), iso(DAY, "18:00"))] }), NOW);
    expect(v.status.status).toBe("confirmed");
    expect(v.assignments[0].name).toBe("emma");
  });
});

describe("bucketByDay and dashboard", () => {
  it("places a multi-day request on every day it touches and skips cancelled ones", () => {
    const snap = snapshot({
      requests: [
        request("multi", { starts_at: iso(DAY, "18:00"), ends_at: iso(addDays(DAY, 2), "10:00") }),
        request("gone", { lifecycle_status: "cancelled" }),
      ],
    });
    const buckets = bucketByDay(buildRequestViews(snap, NOW), DAY, addDays(DAY, 3));
    expect(buckets.map((b) => b.items.map((i) => i.request.id))).toEqual([["multi"], ["multi"], ["multi"], []]);
    expect(buckets[3].tone).toBe("none");
    expect(buckets[0].tone).toBe("pending");
  });

  it("counts dashboard figures", () => {
    const snap = snapshot({
      requests: [
        request("a"),
        request("b", { starts_at: iso(addDays(DAY, 1), "09:00"), ends_at: iso(addDays(DAY, 1), "18:00") }),
        request("c", { request_type: "alone_info", necessity: "info" }),
      ],
      responses: [response("b", "emma", "no"), response("b", "chloe", "no")],
    });
    const counts = dashboardCounts(buildRequestViews(snap, NOW), NOW);
    expect(counts).toMatchObject({ upcoming: 2, uncovered: 1, toOrganize: 2, toAnswer: 1, confirmed: 0 });
  });
});

describe("needsMyAnswer (badge, dashboard and list share it)", () => {
  it("counts only open requests I can answer and have not answered", () => {
    const snap = snapshot({
      requests: [
        request("open"),
        request("covered", { starts_at: iso(addDays(DAY, 1), "09:00"), ends_at: iso(addDays(DAY, 1), "18:00") }),
        request("answered", { starts_at: iso(addDays(DAY, 2), "09:00"), ends_at: iso(addDays(DAY, 2), "18:00") }),
        request("info", { request_type: "alone_info", necessity: "info" }),
        request("gone", { lifecycle_status: "cancelled" }),
      ],
      responses: [response("answered", "emma", "no")],
      assignments: [assignment("covered", "chloe", iso(addDays(DAY, 1), "09:00"), iso(addDays(DAY, 1), "18:00"))],
    });
    const ids = buildRequestViews(snap, NOW).filter(needsMyAnswer).map((v) => v.request.id);
    expect(ids).toEqual(["open"]);
  });

  it("ignores requests that are over", () => {
    const [v] = buildRequestViews(snapshot(), zonedInstant(addDays(DAY, 1), "12:00"));
    expect(needsMyAnswer(v)).toBe(false);
  });
});
