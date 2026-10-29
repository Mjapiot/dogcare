/**
 * Planning engine, database side: a validated plan is confirmed all at once
 * or not at all, with the same checks as a single confirmation; owner rules
 * per dog.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;

// one fixed clock for the whole file: slices must match the offers to the millisecond
const BASE = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
const inHours = (hours: number) => new Date(BASE + hours * 3_600_000).toISOString();

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9900-${String(seq).padStart(12, "0")}`;
}

/** Owner, two helpers who said yes (Emma: hours 24–36, Léa: whole), a member who did not. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const emma = await createUser(db, uid(), `Emma${seq}`);
  const lea = await createUser(db, uid(), `Lea${seq}`);
  const member = await createUser(db, uid(), `Member${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  for (const u of [emma, lea, member]) {
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, u, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  }
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  const requestId = (
    await asUser(db, owner, (tx) =>
      one<{ id: string }>(
        tx,
        "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
        [groupId, dogId, inHours(24), inHours(72)],
      ),
    )
  ).id;
  await asUser(db, emma, (tx) =>
    tx.query("insert into request_responses (request_id, response_status, proposed_starts_at, proposed_ends_at) values ($1, 'yes', $2, $3)", [
      requestId,
      inHours(24),
      inHours(36),
    ]),
  );
  await asUser(db, lea, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
  return { owner, emma, lea, member, groupId, dogId, requestId };
}

const plan = (by: string, requestId: string, slices: Array<{ user_id: string; starts_at: string; ends_at: string }>) =>
  asUser(db, by, (tx) => one<{ n: number }>(tx, "select public.confirm_plan($1, $2::jsonb) as n", [requestId, JSON.stringify(slices)])).then(
    (r) => r.n,
  );
const live = (requestId: string) =>
  rows<{ assigned_user_id: string }>(
    db,
    "select assigned_user_id from care_assignments where request_id = $1 and status <> 'cancelled' order by starts_at",
    [requestId],
  ).then((r) => r.map((x) => x.assigned_user_id));

beforeAll(async () => {
  db = await createTestDb();
});

describe("confirm_plan", () => {
  it("confirms every slice at once and tells each helper", async () => {
    const s = await scenario();
    const n = await plan(s.owner, s.requestId, [
      { user_id: s.emma, starts_at: inHours(24), ends_at: inHours(36) },
      { user_id: s.lea, starts_at: inHours(36), ends_at: inHours(72) },
    ]);
    expect(n).toBe(2);
    expect(await live(s.requestId)).toEqual([s.emma, s.lea]);
    for (const u of [s.emma, s.lea]) {
      const notes = await rows(db, "select 1 from notifications where user_id = $1 and notification_type = 'assignment_confirmed'", [u]);
      expect(notes).toHaveLength(1);
    }
  });

  it("is all or nothing: one invalid slice cancels the whole plan", async () => {
    const s = await scenario();
    // the member never said yes
    await expect(
      plan(s.owner, s.requestId, [
        { user_id: s.emma, starts_at: inHours(24), ends_at: inHours(36) },
        { user_id: s.member, starts_at: inHours(36), ends_at: inHours(72) },
      ]),
    ).rejects.toThrow(/proposé son aide/);
    expect(await live(s.requestId)).toEqual([]);
    // a slice outside a helper's offer
    await expect(plan(s.owner, s.requestId, [{ user_id: s.emma, starts_at: inHours(24), ends_at: inHours(40) }])).rejects.toThrow(
      /dépasse ce que cette personne a proposé/,
    );
    // overlapping slices
    await expect(
      plan(s.owner, s.requestId, [
        { user_id: s.emma, starts_at: inHours(24), ends_at: inHours(36) },
        { user_id: s.lea, starts_at: inHours(30), ends_at: inHours(72) },
      ]),
    ).rejects.toThrow(/déjà confiée/);
    expect(await live(s.requestId)).toEqual([]);
    expect(await rows(db, "select 1 from notifications where user_id = $1 and notification_type = 'assignment_confirmed'", [s.emma])).toEqual([]);
  });

  it("only a caretaker of the dog confirms a plan; malformed plans are refused", async () => {
    const s = await scenario();
    await expect(plan(s.member, s.requestId, [{ user_id: s.lea, starts_at: inHours(24), ends_at: inHours(72) }])).rejects.toThrow(
      /Seul un responsable/,
    );
    await expect(plan(s.owner, s.requestId, [])).rejects.toThrow(/vide/);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("select public.confirm_plan($1, $2::jsonb)", [s.requestId, JSON.stringify([{ user_id: "x" }])])),
    ).rejects.toThrow(/invalide/);
  });
});

describe("planning rules per dog", () => {
  it("default to 3 nights and 3 hours; caretakers change them, others cannot", async () => {
    const s = await scenario();
    const read = () => one<{ plan_max_nights: number; plan_min_slice_hours: number }>(db, "select plan_max_nights, plan_min_slice_hours from dogs where id = $1", [s.dogId]);
    expect(await read()).toEqual({ plan_max_nights: 3, plan_min_slice_hours: 3 });
    await asUser(db, s.owner, (tx) => tx.query("update dogs set plan_max_nights = 5, plan_min_slice_hours = 2 where id = $1", [s.dogId]));
    expect(await read()).toEqual({ plan_max_nights: 5, plan_min_slice_hours: 2 });
    await asUser(db, s.member, (tx) => tx.query("update dogs set plan_max_nights = 9 where id = $1", [s.dogId]));
    expect((await read()).plan_max_nights).toBe(5);
    await expect(asUser(db, s.owner, (tx) => tx.query("update dogs set plan_max_nights = 30 where id = $1", [s.dogId]))).rejects.toThrow(/check/);
  });
});
