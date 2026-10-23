/**
 * Reporting content and blocking members (App Store guideline 1.2).
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
  return `00000000-0000-4000-9300-${String(seq).padStart(12, "0")}`;
}

/** Owner (admin) + two helpers in a group, a dog and a future request. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const emma = await createUser(db, uid(), `Emma${seq}`);
  const chloe = await createUser(db, uid(), `Chloe${seq}`);
  const outsider = await createUser(db, uid(), `Out${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  for (const u of [emma, chloe]) {
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, u, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  }
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Rex', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  const newRequest = (days: number) =>
    asUser(db, owner, (tx) =>
      one<{ id: string }>(
        tx,
        "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
        [groupId, dogId, inDays(days, 8), inDays(days, 20)],
      ),
    ).then((r) => r.id);
  const requestId = await newRequest(3);
  return { owner, emma, chloe, outsider, groupId, dogId, requestId, newRequest };
}

const visibleRequests = (user: string, groupId: string) =>
  asUser(db, user, (tx) => rows<{ id: string }>(tx, "select id from care_requests where group_id = $1", [groupId]));

beforeAll(async () => {
  db = await createTestDb();
});

describe("reporting", () => {
  it("a member reports a request: stored, admins notified without the reporter's name", async () => {
    const s = await scenario();
    await asUser(db, s.emma, (tx) =>
      tx.query("select public.report_content($1, 'request', $2, 'Contenu déplacé')", [s.groupId, s.requestId]),
    );
    const reports = await rows<{ reporter_id: string; target_type: string }>(
      db,
      "select reporter_id, target_type from content_reports where target_id = $1",
      [s.requestId],
    );
    expect(reports).toEqual([{ reporter_id: s.emma, target_type: "request" }]);
    const n = await rows<{ title: string; body: string; actor_id: string | null }>(
      db,
      "select title, body, actor_id from notifications where user_id = $1 and notification_type = 'content_reported'",
      [s.owner],
    );
    expect(n).toEqual([{ title: "Signalement : une demande pour Rex", body: "Contenu déplacé", actor_id: null }]);
  });

  it("members and dogs can be reported too", async () => {
    const s = await scenario();
    await asUser(db, s.chloe, (tx) => tx.query("select public.report_content($1, 'member', $2, null)", [s.groupId, s.emma]));
    await asUser(db, s.chloe, (tx) => tx.query("select public.report_content($1, 'dog', $2, null)", [s.groupId, s.dogId]));
    expect(await rows(db, "select id from content_reports where group_id = $1", [s.groupId])).toHaveLength(2);
  });

  it("outsiders, unknown targets and self-reports are refused", async () => {
    const s = await scenario();
    await expect(
      asUser(db, s.outsider, (tx) => tx.query("select public.report_content($1, 'request', $2, null)", [s.groupId, s.requestId])),
    ).rejects.toThrow(/ne faites pas partie/);
    await expect(
      asUser(db, s.emma, (tx) => tx.query("select public.report_content($1, 'request', $2, null)", [s.groupId, s.dogId])),
    ).rejects.toThrow(/introuvable/);
    await expect(
      asUser(db, s.emma, (tx) => tx.query("select public.report_content($1, 'member', $2, null)", [s.groupId, s.emma])),
    ).rejects.toThrow(/introuvable/);
  });

  it("reports are never readable by clients", async () => {
    const s = await scenario();
    await expect(asUser(db, s.owner, (tx) => tx.query("select * from content_reports"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select * from content_reports"))).rejects.toThrow(/permission denied/);
  });
});

describe("blocking", () => {
  it("hides requests in both directions and forbids answering", async () => {
    const s = await scenario();
    await asUser(db, s.emma, (tx) => tx.query("select public.block_member($1)", [s.owner]));
    expect(await visibleRequests(s.emma, s.groupId)).toEqual([]);
    await expect(
      asUser(db, s.emma, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [s.requestId])),
    ).rejects.toThrow();
    // unrelated members are not affected
    expect(await visibleRequests(s.chloe, s.groupId)).toHaveLength(1);
  });

  it("the blocked member no longer sees the blocker's requests nor gets notified", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) => tx.query("select public.block_member($1)", [s.emma]));
    const later = await s.newRequest(5);
    expect((await visibleRequests(s.emma, s.groupId)).map((r) => r.id)).not.toContain(later);
    const n = await rows(db, "select id from notifications where user_id = $1 and request_id = $2", [s.emma, later]);
    expect(n).toEqual([]);
    expect(await rows(db, "select id from notifications where user_id = $1 and request_id = $2", [s.chloe, later])).toHaveLength(1);
  });

  it("a confirmed assignment stays visible to its sitter after a block", async () => {
    const s = await scenario();
    await asUser(db, s.emma, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [s.requestId]));
    await asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2, null, null)", [s.requestId, s.emma]));
    await asUser(db, s.owner, (tx) => tx.query("select public.block_member($1)", [s.emma]));
    expect((await visibleRequests(s.emma, s.groupId)).map((r) => r.id)).toContain(s.requestId);
  });

  it("only one's own blocks are visible, and unblocking restores access", async () => {
    const s = await scenario();
    await asUser(db, s.emma, (tx) => tx.query("select public.block_member($1)", [s.owner]));
    expect(await asUser(db, s.owner, (tx) => rows(tx, "select * from user_blocks"))).toEqual([]);
    expect(await asUser(db, s.emma, (tx) => rows(tx, "select blocked_id from user_blocks"))).toEqual([{ blocked_id: s.owner }]);
    await asUser(db, s.emma, (tx) => tx.query("delete from user_blocks where blocked_id = $1", [s.owner]));
    expect(await visibleRequests(s.emma, s.groupId)).toHaveLength(1);
  });

  it("blocks cannot be forged nor target strangers or oneself", async () => {
    const s = await scenario();
    await expect(
      asUser(db, s.emma, (tx) => tx.query("insert into user_blocks (blocker_id, blocked_id) values ($1, $2)", [s.owner, s.chloe])),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, s.emma, (tx) => tx.query("select public.block_member($1)", [s.outsider]))).rejects.toThrow(/aucun de vos groupes/);
    await expect(asUser(db, s.emma, (tx) => tx.query("select public.block_member($1)", [s.emma]))).rejects.toThrow(/vous-même/);
  });
});
