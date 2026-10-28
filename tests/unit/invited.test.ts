import { describe, expect, it } from "vitest";
import { buildInvitedView } from "@/domain/invited";
import { circleCovers } from "@/domain/circle";
import { buildRequestViews, type GroupSnapshot } from "@/domain/views";
import type { InvitedRequestRow } from "@/lib/types";

const H = 3_600_000;
const T0 = Date.parse("2026-11-10T08:00:00Z");
const iso = (t: number) => new Date(t).toISOString();

function invited(over: Partial<InvitedRequestRow> = {}): InvitedRequestRow {
  return {
    id: "r1",
    group_id: "g1",
    dog_id: "d1",
    dog_name: "Aston",
    dog_photo_path: null,
    owner_names: ["Julie"],
    request_type: "care",
    necessity: "required",
    starts_at: iso(T0),
    ends_at: iso(T0 + 12 * H),
    description: null,
    splittable: true,
    lifecycle_status: "active",
    cancellation_reason: null,
    my_response: null,
    my_assignments: [],
    confirmed_slots: [],
    ...over,
  };
}

describe("circleCovers (same rule as the database)", () => {
  const period = { start: T0, end: T0 + 12 * H };
  it("a close person always, a guest only when their dates cover the whole period", () => {
    expect(circleCovers({ role: "close", starts_at: null, ends_at: null }, period)).toBe(true);
    expect(circleCovers({ role: "guest", starts_at: null, ends_at: iso(T0 + 12 * H) }, period)).toBe(true);
    expect(circleCovers({ role: "guest", starts_at: null, ends_at: iso(T0 + 11 * H) }, period)).toBe(false);
    expect(circleCovers({ role: "guest", starts_at: iso(T0 + H), ends_at: iso(T0 + 48 * H) }, period)).toBe(false);
    expect(circleCovers({ role: "guest", starts_at: iso(T0), ends_at: iso(T0 + 48 * H) }, period)).toBe(true);
  });
});

describe("what an invitee sees", () => {
  const before = T0 - 24 * H;
  it("waits for their answer while the request needs someone", () => {
    const v = buildInvitedView(invited(), before);
    expect(v.needsMyAnswer).toBe(true);
    expect(v.label).toBe("Attend votre réponse");
    expect(v.tone).toBe("pending");
  });

  it("is 'already covered' once confirmed slots fill the period, with no names", () => {
    const v = buildInvitedView(invited({ confirmed_slots: [{ starts_at: iso(T0), ends_at: iso(T0 + 12 * H) }] }), before);
    expect(v.coverage.state).toBe("full");
    expect(v.needsMyAnswer).toBe(false);
    expect(v.label).toBe("Déjà couverte");
  });

  it("shows partial coverage, their answer, their garde and cancellation", () => {
    const partial = buildInvitedView(invited({ confirmed_slots: [{ starts_at: iso(T0), ends_at: iso(T0 + 6 * H) }] }), before);
    expect(partial.coverage.state).toBe("partial");
    expect(partial.needsMyAnswer).toBe(true);
    const yes = buildInvitedView(
      invited({ my_response: { response_status: "yes", proposed_starts_at: null, proposed_ends_at: null, note: null } }),
      before,
    );
    expect(yes.needsMyAnswer).toBe(false);
    expect(yes.label).toBe("Vous avez proposé votre aide");
    const mine = buildInvitedView(
      invited({
        my_assignments: [
          { id: "a1", starts_at: iso(T0), ends_at: iso(T0 + 12 * H), status: "pending_reconfirmation", previous_starts_at: null, previous_ends_at: null },
        ],
      }),
      before,
    );
    expect(mine.label).toBe("À reconfirmer");
    expect(mine.tone).toBe("covered");
    expect(buildInvitedView(invited({ lifecycle_status: "cancelled" }), before).label).toBe("Annulée");
    expect(buildInvitedView(invited(), T0 + 13 * H).needsMyAnswer).toBe(false);
  });
});

describe("invitees count as eligible for the group", () => {
  const snapshot = (responses: Array<{ user_id: string; response_status: "yes" | "no" }>): GroupSnapshot => ({
    me: "owner",
    members: [
      { group_id: "g1", user_id: "owner", role: "admin", share_availability: true, joined_at: iso(T0), display_name: "Julie" },
      { group_id: "g1", user_id: "emma", role: "member", share_availability: true, joined_at: iso(T0), display_name: "Emma" },
    ],
    dogs: [],
    caretakers: [{ dog_id: "d1", user_id: "owner", role: "owner" }],
    requests: [
      {
        id: "r1",
        group_id: "g1",
        dog_id: "d1",
        created_by: "owner",
        request_type: "care",
        necessity: "required",
        starts_at: iso(T0),
        ends_at: iso(T0 + 12 * H),
        description: null,
        splittable: true,
        lifecycle_status: "active",
        cancelled_at: null,
        cancellation_reason: null,
        revision: 1,
        created_at: iso(T0),
        updated_at: iso(T0),
      },
    ],
    responses: responses.map((r, i) => ({
      id: `x${i}`,
      request_id: "r1",
      user_id: r.user_id,
      response_status: r.response_status,
      proposed_starts_at: null,
      proposed_ends_at: null,
      note: null,
      responded_at: iso(T0),
    })),
    assignments: [],
    availabilityEntries: [],
    availabilityRules: [],
    invitees: [{ request_id: "r1", user_id: "lea", display_name: "Léa", role: "guest" }],
  });

  it("'Sans solution' waits for the invitee too", () => {
    const [waiting] = buildRequestViews(snapshot([{ user_id: "emma", response_status: "no" }]), T0 - 24 * H);
    expect(waiting.status.status).not.toBe("uncovered");
    expect(waiting.status.counts.pending).toBe(1);
    const [none] = buildRequestViews(
      snapshot([
        { user_id: "emma", response_status: "no" },
        { user_id: "lea", response_status: "no" },
      ]),
      T0 - 24 * H,
    );
    expect(none.status.status).toBe("uncovered");
  });

  it("lists the invitee by name with their circle role", () => {
    const [v] = buildRequestViews(snapshot([{ user_id: "lea", response_status: "yes" }]), T0 - 24 * H);
    const lea = v.helpers.find((h) => h.userId === "lea");
    expect(lea).toMatchObject({ name: "Léa", circleRole: "guest", response: "yes" });
    expect(v.helpers.find((h) => h.userId === "emma")?.circleRole).toBeNull();
    expect(v.status.status).toBe("volunteer_found");
  });
});
