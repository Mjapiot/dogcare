/**
 * Regression tests for issues found in the 2026-10-21 project review.
 * Each scenario builds its own group so tests stay independent.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;

const inDays = (days: number, hour = 9) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9000-${String(seq).padStart(12, "0")}`;
}

/** Owner + helpers in a fresh group, one dog, one future request. */
async function scenario(helperCount = 1) {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const helpers: string[] = [];
  for (let i = 0; i < helperCount; i++) helpers.push(await createUser(db, uid(), `Helper${seq}`));
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  for (const h of helpers) {
    const token = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, h, (tx) => tx.query("select public.accept_invitation($1)", [token]));
  }
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Rex', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  const requestId = (
    await asUser(db, owner, (tx) =>
      one<{ id: string }>(
        tx,
        "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
        [groupId, dogId, inDays(3, 8), inDays(3, 20)],
      ),
    )
  ).id;
  return { owner, helpers, groupId, dogId, requestId };
}

async function confirmHelper(s: { owner: string; requestId: string }, helper: string, from?: string, to?: string) {
  await asUser(db, helper, (tx) =>
    tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [s.requestId]),
  );
  await asUser(db, s.owner, (tx) =>
    tx.query("select public.confirm_assignment($1, $2, $3, $4)", [s.requestId, helper, from ?? null, to ?? null]),
  );
}

beforeAll(async () => {
  db = await createTestDb();
});

describe("C1 — deleting groups and accounts that have requests", () => {
  it("an admin can delete a group that has requests", async () => {
    const s = await scenario(1);
    await asUser(db, s.owner, (tx) => tx.query("delete from groups where id = $1", [s.groupId]));
    expect(await rows(db, "select id from care_requests where group_id = $1", [s.groupId])).toEqual([]);
  });

  it("the last member can leave a group that has requests (the group is deleted)", async () => {
    const s = await scenario(0);
    await asUser(db, s.owner, (tx) =>
      tx.query("delete from group_members where group_id = $1 and user_id = $2", [s.groupId, s.owner]),
    );
    expect(await rows(db, "select id from groups where id = $1", [s.groupId])).toEqual([]);
  });

  it("a member alone in a group with requests can delete their account", async () => {
    const s = await scenario(0);
    await asUser(db, s.owner, (tx) => tx.query("select public.delete_my_account()"));
    expect(await rows(db, "select id from auth.users where id = $1", [s.owner])).toEqual([]);
  });

  it("removing a dog from a group that still has its requests stays refused", async () => {
    const s = await scenario(0);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("delete from group_dogs where group_id = $1 and dog_id = $2", [s.groupId, s.dogId])),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("C2 — a departing helper never leaves a false 'covered' status", () => {
  it("leaving the group cancels future assignments, withdraws answers and alerts the owner", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await confirmHelper(s, emma);
    await asUser(db, emma, (tx) => tx.query("delete from group_members where group_id = $1 and user_id = $2", [s.groupId, emma]));

    const live = await rows(db, "select id from care_assignments where request_id = $1 and status <> 'cancelled'", [s.requestId]);
    expect(live).toEqual([]);
    expect(await rows(db, "select id from request_responses where request_id = $1", [s.requestId])).toEqual([]);
    const n = await rows<{ title: string }>(
      db,
      "select title from notifications where user_id = $1 and notification_type = 'assignment_cancelled'",
      [s.owner],
    );
    expect(n).toHaveLength(1);
  });

  it("being removed by an admin has the same effect", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await confirmHelper(s, emma);
    await asUser(db, s.owner, (tx) => tx.query("delete from group_members where group_id = $1 and user_id = $2", [s.groupId, emma]));
    expect(
      await rows(db, "select id from care_assignments where request_id = $1 and status <> 'cancelled'", [s.requestId]),
    ).toEqual([]);
  });

  it("deleting an account alerts the owner before the assignment disappears", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await confirmHelper(s, emma);
    await asUser(db, emma, (tx) => tx.query("select public.delete_my_account()"));
    const n = await rows(
      db,
      "select id from notifications where user_id = $1 and notification_type = 'assignment_cancelled' and request_id = $2",
      [s.owner, s.requestId],
    );
    expect(n).toHaveLength(1);
  });

  it("an account deleted by an operator also alerts the owner", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await confirmHelper(s, emma);
    await db.query("delete from auth.users where id = $1", [emma]);
    const n = await rows(
      db,
      "select id from notifications where user_id = $1 and notification_type = 'assignment_cancelled' and request_id = $2",
      [s.owner, s.requestId],
    );
    expect(n).toHaveLength(1);
  });

  it("past assignments are kept as history when a helper leaves", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await confirmHelper(s, emma);
    // move the request into the past (as if it had happened)
    const id = s.requestId;
    await db.exec(`
      alter table care_requests disable trigger care_requests_before;
      alter table care_requests disable trigger care_requests_after_update;
      update care_requests set starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' where id = '${id}';
      update care_assignments set starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' where request_id = '${id}';
      alter table care_requests enable trigger care_requests_before;
      alter table care_requests enable trigger care_requests_after_update;
    `);
    await asUser(db, emma, (tx) => tx.query("delete from group_members where group_id = $1 and user_id = $2", [s.groupId, emma]));
    const past = await rows(db, "select status from care_assignments where request_id = $1", [s.requestId]);
    expect(past).toEqual([{ status: "confirmed" }]);
  });
});

describe("push endpoints can only be registered through validated functions", () => {
  it("direct inserts and updates of push subscriptions are refused", async () => {
    const s = await scenario(0);
    await expect(
      asUser(db, s.owner, (tx) =>
        tx.query(
          "insert into push_subscriptions (endpoint, platform, p256dh, auth) values ('http://169.254.169.254/x', 'web', 'k', 'a')",
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await asUser(db, s.owner, (tx) =>
      tx.query("select public.register_push_subscription($1, $2, $3)", [
        "https://fcm.googleapis.com/fcm/send/abc",
        "B".repeat(87),
        "A".repeat(22),
      ]),
    );
    await expect(
      asUser(db, s.owner, (tx) => tx.query("update push_subscriptions set endpoint = 'http://internal/x'")),
    ).rejects.toThrow(/permission denied/);
    // users can still remove their own devices
    await asUser(db, s.owner, (tx) => tx.query("delete from push_subscriptions"));
    expect(await asUser(db, s.owner, (tx) => rows(tx, "select id from push_subscriptions"))).toEqual([]);
  });

  it("the database rejects non-https, non-APNs endpoints even from the server", async () => {
    const s = await scenario(0);
    await expect(
      db.query(
        "insert into push_subscriptions (user_id, endpoint, platform, p256dh, auth) values ($1, 'http://internal/x', 'web', 'k', 'a')",
        [s.owner],
      ),
    ).rejects.toThrow(/push_subscriptions_endpoint_format/);
  });
});
