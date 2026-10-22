/**
 * Personal calendar subscription: only the feed owner's confirmed
 * assignments, reachable with the secret token alone.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

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
  return `00000000-0000-4000-9200-${String(seq).padStart(12, "0")}`;
}

/** Owner and helper in a group; the helper is confirmed on one request. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const helper = await createUser(db, uid(), `Helper${seq}`);
  const outsider = await createUser(db, uid(), `Outsider${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  const invite = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
  await asUser(db, helper, (tx) => tx.query("select public.accept_invitation($1)", [invite]));
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
  await asUser(db, helper, (tx) =>
    tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]),
  );
  await asUser(db, owner, (tx) => tx.query("select public.confirm_assignment($1, $2, null, null)", [requestId, helper]));
  return { owner, helper, outsider, groupId, requestId };
}

const tokenOf = (user: string) =>
  asUser(db, user, (tx) => one<{ t: string }>(tx, "select public.get_calendar_feed_token(true) as t")).then((r) => r.t);

const feed = (token: string) =>
  asAnon(db, (tx) => rows<{ role: string; dog_name: string; other_name: string }>(tx, "select * from public.calendar_feed_events($1)", [token]));

beforeAll(async () => {
  db = await createTestDb();
});

describe("calendar feed", () => {
  it("is created once and stays stable", async () => {
    const s = await scenario();
    const t1 = await tokenOf(s.helper);
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await tokenOf(s.helper)).toBe(t1);
    const none = await asUser(db, s.outsider, (tx) => one<{ t: string | null }>(tx, "select public.get_calendar_feed_token(false) as t"));
    expect(none.t).toBeNull();
  });

  it("lists the sitter's assignment and the owner's covered dog", async () => {
    const s = await scenario();
    expect(await feed(await tokenOf(s.helper))).toMatchObject([{ role: "sitter", dog_name: "Rex", other_name: `Owner${seq - 2}` }]);
    expect(await feed(await tokenOf(s.owner))).toMatchObject([{ role: "owner", dog_name: "Rex", other_name: `Helper${seq - 1}` }]);
  });

  it("never shows other people's assignments", async () => {
    const s = await scenario();
    expect(await feed(await tokenOf(s.outsider))).toEqual([]);
  });

  it("drops cancelled assignments", async () => {
    const s = await scenario();
    const token = await tokenOf(s.helper);
    const { id } = await one<{ id: string }>(db, "select id from care_assignments where request_id = $1", [s.requestId]);
    await asUser(db, s.owner, (tx) => tx.query("select public.cancel_assignment($1, 'test')", [id]));
    expect(await feed(token)).toEqual([]);
  });

  it("an unknown, malformed or renewed token returns nothing", async () => {
    const s = await scenario();
    const old = await tokenOf(s.helper);
    expect(await feed("x".repeat(43))).toEqual([]);
    expect(await feed("' or 1=1 --")).toEqual([]);
    const renewed = await asUser(db, s.helper, (tx) => one<{ t: string }>(tx, "select public.reset_calendar_feed_token(true) as t"));
    expect(renewed.t).not.toBe(old);
    expect(await feed(old)).toEqual([]);
    expect(await feed(renewed.t)).toHaveLength(1);
    await asUser(db, s.helper, (tx) => tx.query("select public.reset_calendar_feed_token(false)"));
    expect(await feed(renewed.t)).toEqual([]);
  });

  it("tokens are never readable directly", async () => {
    const s = await scenario();
    await tokenOf(s.helper);
    await expect(asUser(db, s.helper, (tx) => tx.query("select * from calendar_feeds"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select * from calendar_feeds"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select public.get_calendar_feed_token(true)"))).rejects.toThrow(/permission denied/);
  });
});
