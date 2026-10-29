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
  it("an admin can delete a group that has requests (through delete_group only)", async () => {
    const s = await scenario(1);
    await expect(asUser(db, s.owner, (tx) => tx.query("delete from groups where id = $1", [s.groupId]))).rejects.toThrow(/permission denied/);
    await asUser(db, s.owner, (tx) => tx.query("select public.delete_group($1)", [s.groupId]));
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

async function respond(helper: string, requestId: string, from?: string, to?: string) {
  await asUser(db, helper, (tx) =>
    tx.query(
      "insert into request_responses (request_id, response_status, proposed_starts_at, proposed_ends_at) values ($1, 'yes', $2, $3)",
      [requestId, from ?? null, to ?? null],
    ),
  );
}

async function moveRequestToPast(requestId: string) {
  await db.exec(`
    alter table care_requests disable trigger care_requests_before;
    alter table care_requests disable trigger care_requests_after_update;
    update care_requests set starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' where id = '${requestId}';
    alter table care_requests enable trigger care_requests_before;
    alter table care_requests enable trigger care_requests_after_update;
  `);
}

describe("notification preferences only control push, never the in-app bell", () => {
  it("a helper who disabled confirmations still sees the reconfirmation request", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await confirmHelper(s, emma);
    await asUser(db, emma, (tx) =>
      tx.query("insert into notification_preferences (confirmations_enabled, cancellations_enabled) values (false, false)"),
    );
    await asUser(db, s.owner, (tx) => tx.query("update care_requests set ends_at = $2 where id = $1", [s.requestId, inDays(3, 15)]));
    const n = await rows<{ push_state: string }>(
      db,
      "select push_state from notifications where user_id = $1 and notification_type = 'reconfirmation_needed'",
      [emma],
    );
    expect(n).toEqual([{ push_state: "skipped" }]);
  });

  it("enabled preferences still lead to a push", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    const n = await rows<{ push_state: string }>(
      db,
      "select push_state from notifications where user_id = $1 and notification_type = 'new_request'",
      [emma],
    );
    expect(n).toEqual([{ push_state: "pending" }]);
  });
});

describe("a helper with two slots on the same request", () => {
  it("can cancel one slot and keep the other", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await respond(emma, s.requestId);
    await asUser(db, s.owner, (tx) =>
      tx.query("select public.confirm_assignment($1, $2, $3, $4)", [s.requestId, emma, inDays(3, 8), inDays(3, 10)]),
    );
    await asUser(db, s.owner, (tx) =>
      tx.query("select public.confirm_assignment($1, $2, $3, $4)", [s.requestId, emma, inDays(3, 14), inDays(3, 16)]),
    );
    const [first] = await rows<{ id: string }>(db, "select id from care_assignments where request_id = $1 order by starts_at", [s.requestId]);
    await asUser(db, emma, (tx) => tx.query("select public.cancel_assignment($1)", [first.id]));
    const live = await rows(db, "select id from care_assignments where request_id = $1 and status = 'confirmed'", [s.requestId]);
    expect(live).toHaveLength(1);
    const r = await one<{ response_status: string }>(db, "select response_status from request_responses where request_id = $1", [s.requestId]);
    expect(r.response_status).toBe("yes");

    const remaining = await one<{ id: string }>(db, "select id from care_assignments where request_id = $1 and status = 'confirmed'", [s.requestId]);
    await asUser(db, emma, (tx) => tx.query("select public.cancel_assignment($1)", [remaining.id]));
    const after = await one<{ response_status: string }>(db, "select response_status from request_responses where request_id = $1", [s.requestId]);
    expect(after.response_status).toBe("no");
  });
});

describe("response integrity", () => {
  it("an answer cannot be moved to another request", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await respond(emma, s.requestId);
    const other = (
      await asUser(db, s.owner, (tx) =>
        one<{ id: string }>(
          tx,
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
          [s.groupId, s.dogId, inDays(5, 8), inDays(5, 20)],
        ),
      )
    ).id;
    await expect(
      asUser(db, emma, (tx) => tx.query("update request_responses set request_id = $1 where request_id = $2", [other, s.requestId])),
    ).rejects.toThrow(/ne peut pas être déplacée/);
  });

  it("a confirmed helper cannot shrink their offer below their assignment", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await respond(emma, s.requestId, inDays(3, 10), inDays(3, 14));
    await asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2)", [s.requestId, emma]));
    await expect(
      asUser(db, emma, (tx) =>
        tx.query("update request_responses set proposed_starts_at = $2, proposed_ends_at = $3 where request_id = $1", [
          s.requestId,
          inDays(3, 11),
          inDays(3, 12),
        ]),
      ),
    ).rejects.toThrow(/garde confirmée/);
  });

  it("a period change keeps the assignee's offer inside the new period", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await respond(emma, s.requestId, inDays(3, 10), inDays(3, 14));
    await asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2)", [s.requestId, emma]));
    await asUser(db, s.owner, (tx) => tx.query("update care_requests set ends_at = $2 where id = $1", [s.requestId, inDays(3, 12)]));
    const r = await one<{ proposed_ends_at: Date }>(db, "select proposed_ends_at from request_responses where request_id = $1", [s.requestId]);
    expect(new Date(r.proposed_ends_at).toISOString()).toBe(inDays(3, 12));
  });
});

describe("request changes", () => {
  it("an information that becomes a real need is announced to the group", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    const info = (
      await asUser(db, s.owner, (tx) =>
        one<{ id: string }>(
          tx,
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'alone_info', 'info', $3, $4) returning id",
          [s.groupId, s.dogId, inDays(6, 8), inDays(6, 18)],
        ),
      )
    ).id;
    expect(await rows(db, "select id from notifications where user_id = $1 and request_id = $2", [emma, info])).toEqual([]);
    await asUser(db, s.owner, (tx) =>
      tx.query("update care_requests set request_type = 'visit', necessity = 'nice_to_have' where id = $1", [info]),
    );
    const n = await rows(db, "select id from notifications where user_id = $1 and request_id = $2 and notification_type = 'new_request'", [emma, info]);
    expect(n).toHaveLength(1);
  });

  it("a request cannot become non-splittable while it has partial assignments", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await respond(emma, s.requestId, inDays(3, 10), inDays(3, 14));
    await asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2)", [s.requestId, emma]));
    await expect(
      asUser(db, s.owner, (tx) => tx.query("update care_requests set splittable = false where id = $1", [s.requestId])),
    ).rejects.toThrow(/gardes partielles/);
  });

  it("partial offers are reset (and their authors told) when a request becomes non-splittable", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await respond(emma, s.requestId, inDays(3, 10), inDays(3, 14));
    await asUser(db, s.owner, (tx) => tx.query("update care_requests set splittable = false where id = $1", [s.requestId]));
    expect(await rows(db, "select id from request_responses where request_id = $1", [s.requestId])).toEqual([]);
    const n = await rows(db, "select id from notifications where user_id = $1 and request_id = $2 and notification_type = 'response_reset'", [emma, s.requestId]);
    expect(n).toHaveLength(1);
  });

  it("a past request can no longer be confirmed", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    await respond(emma, s.requestId);
    await moveRequestToPast(s.requestId);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2)", [s.requestId, emma])),
    ).rejects.toThrow(/terminée/);
  });
});

describe("push retries and retention", () => {
  const asService = <T,>(fn: (tx: import("./harness").Tx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return fn(tx);
    });

  it("a released notification is retried later, and given up after 5 attempts", async () => {
    const s = await scenario(0);
    await db.query("insert into notifications (user_id, notification_type, title) values ($1, 'member_joined', 'retry-me')", [s.owner]);
    const claim = () => asService((tx) => rows<{ id: string; title: string }>(tx, "select * from public.claim_push_batch(500)"));
    const mine = async () => (await claim()).filter((n) => n.title === "retry-me");

    const [first] = await mine();
    await asService((tx) => tx.query("select public.release_push_batch($1::uuid[])", [[first.id]]));
    expect(await mine()).toEqual([]); // not immediately re-claimed in the same run

    for (let i = 0; i < 4; i++) {
      await db.query("update notifications set push_state = 'sending', push_claimed_at = now() where id = $1", [first.id]);
      await asService((tx) => tx.query("select public.release_push_batch($1::uuid[])", [[first.id]]));
    }
    const final = await one<{ push_state: string; push_attempts: number }>(
      db,
      "select push_state, push_attempts from notifications where id = $1",
      [first.id],
    );
    expect(final).toEqual({ push_state: "skipped", push_attempts: 5 });
  });

  it("delivery and purge functions are reserved to the server", async () => {
    const s = await scenario(0);
    await expect(asUser(db, s.owner, (tx) => tx.query("select public.release_push_batch('{}'::uuid[])"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(asUser(db, s.owner, (tx) => tx.query("select public.purge_old_records()"))).rejects.toThrow(/permission denied/);
  });

  it("purges notifications older than 6 months", async () => {
    const s = await scenario(0);
    await db.query(
      "insert into notifications (user_id, notification_type, title, created_at) values ($1, 'member_joined', 'old', now() - interval '200 days')",
      [s.owner],
    );
    await asService((tx) => tx.query("select public.purge_old_records()"));
    expect(await rows(db, "select id from notifications where title = 'old'")).toEqual([]);
  });
});

describe("permanent group join code", () => {
  it("only admins can see or renew the code, and nobody reads the table directly", async () => {
    const s = await scenario(1);
    const [emma] = s.helpers;
    const code = (await asUser(db, s.owner, (tx) => one<{ c: string }>(tx, "select public.get_group_join_code($1) as c", [s.groupId]))).c;
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    // stable until renewed
    const again = (await asUser(db, s.owner, (tx) => one<{ c: string }>(tx, "select public.get_group_join_code($1) as c", [s.groupId]))).c;
    expect(again).toBe(code);
    await expect(
      asUser(db, emma, (tx) => tx.query("select public.get_group_join_code($1)", [s.groupId])),
    ).rejects.toThrow(/administrateur/);
    await expect(asUser(db, emma, (tx) => tx.query("select * from group_join_codes"))).rejects.toThrow(/permission denied/);
  });

  it("anyone signed in joins with the code (case and dash insensitive); admins are notified", async () => {
    const s = await scenario(0);
    const newcomer = await createUser(db, uid(), "Newcomer");
    const code = (await asUser(db, s.owner, (tx) => one<{ c: string }>(tx, "select public.get_group_join_code($1) as c", [s.groupId]))).c;
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;
    const r = await asUser(db, newcomer, (tx) => one<{ status: string; group_id: string }>(tx, "select * from public.join_group_with_code($1)", [typed]));
    expect(r).toMatchObject({ status: "joined", group_id: s.groupId });
    const again = await asUser(db, newcomer, (tx) => one<{ status: string }>(tx, "select * from public.join_group_with_code($1)", [code]));
    expect(again.status).toBe("already_member");
    const n = await rows(db, "select id from notifications where user_id = $1 and notification_type = 'member_joined'", [s.owner]);
    expect(n).toHaveLength(1);
  });

  it("a renewed or disabled code stops working", async () => {
    const s = await scenario(0);
    const newcomer = await createUser(db, uid(), "Late");
    const old = (await asUser(db, s.owner, (tx) => one<{ c: string }>(tx, "select public.get_group_join_code($1) as c", [s.groupId]))).c;
    const renewed = (await asUser(db, s.owner, (tx) => one<{ c: string }>(tx, "select public.reset_group_join_code($1) as c", [s.groupId]))).c;
    expect(renewed).not.toBe(old);
    const r = await asUser(db, newcomer, (tx) => one<{ status: string }>(tx, "select * from public.join_group_with_code($1)", [old]));
    expect(r.status).toBe("invalid");
    await asUser(db, s.owner, (tx) => tx.query("select public.reset_group_join_code($1, false)", [s.groupId]));
    const r2 = await asUser(db, newcomer, (tx) => one<{ status: string }>(tx, "select * from public.join_group_with_code($1)", [renewed]));
    expect(r2.status).toBe("invalid");
  });

  it("guessing is throttled after 10 wrong codes in 15 minutes", async () => {
    const s = await scenario(0);
    const guesser = await createUser(db, uid(), "Guesser");
    const code = (await asUser(db, s.owner, (tx) => one<{ c: string }>(tx, "select public.get_group_join_code($1) as c", [s.groupId]))).c;
    for (let i = 0; i < 10; i++) {
      const r = await asUser(db, guesser, (tx) => one<{ status: string }>(tx, "select * from public.join_group_with_code('ZZZZZZZZ')"));
      expect(r.status).toBe("invalid");
    }
    const blocked = await asUser(db, guesser, (tx) => one<{ status: string }>(tx, "select * from public.join_group_with_code($1)", [code]));
    expect(blocked.status).toBe("throttled");
  });
});
