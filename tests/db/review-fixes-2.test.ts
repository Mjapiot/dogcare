/**
 * Review fixes (2026-10-29): blocks never silence a commitment, groups are
 * deleted with notice, push knows the group, photos stay in their dog's
 * folder, old health column closed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9a00-${String(seq).padStart(12, "0")}`;
}

/** Owner and helper in a group with a dog, a request tomorrow the helper said yes to. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const helper = await createUser(db, uid(), `Helper${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
  await asUser(db, helper, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  const requestId = (
    await asUser(db, owner, (tx) =>
      one<{ id: string }>(
        tx,
        "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
        [groupId, dogId, inHours(24), inHours(30)],
      ),
    )
  ).id;
  await asUser(db, helper, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
  return { owner, helper, groupId, dogId, requestId };
}

const types = (user: string) =>
  rows<{ notification_type: string; title: string }>(db, "select notification_type, title from notifications where user_id = $1 order by created_at", [user]);
const block = (by: string, other: string) => asUser(db, by, (tx) => tx.query("select public.block_member($1)", [other]));

beforeAll(async () => {
  db = await createTestDb();
});

describe("blocks never silence a commitment", () => {
  it("confirming someone you are blocked with is refused", async () => {
    const s = await scenario();
    await block(s.helper, s.owner);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2)", [s.requestId, s.helper])),
    ).rejects.toThrow(/ne pouvez pas confier/);
  });

  it("a garde confirmed before a block: its cancellation still reaches the helper", async () => {
    const s = await scenario();
    const a = (await asUser(db, s.owner, (tx) => one<{ id: string }>(tx, "select public.confirm_assignment($1, $2) as id", [s.requestId, s.helper]))).id;
    await block(s.helper, s.owner);
    await asUser(db, s.owner, (tx) => tx.query("select public.cancel_assignment($1, null)", [a]));
    expect((await types(s.helper)).map((n) => n.notification_type)).toContain("assignment_cancelled");
  });

  it("social messages stay silenced between blocked members", async () => {
    const s = await scenario();
    await block(s.helper, s.owner);
    const before = (await types(s.helper)).length;
    await asUser(db, s.owner, (tx) =>
      tx.query(
        "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4)",
        [s.groupId, s.dogId, inHours(48), inHours(50)],
      ),
    );
    expect(await types(s.helper)).toHaveLength(before);
  });
});

describe("deleting a group", () => {
  it("cancels the gardes ahead and tells the helper, then deletes", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2)", [s.requestId, s.helper]));
    const n = await asUser(db, s.owner, (tx) => one<{ n: number }>(tx, "select public.delete_group($1) as n", [s.groupId]));
    expect(n.n).toBe(1);
    expect(await rows(db, "select id from groups where id = $1", [s.groupId])).toEqual([]);
    expect((await types(s.helper)).at(-1)).toEqual({ notification_type: "assignment_cancelled", title: "Votre garde d'Aston est annulée" });
    // the owner deleted the group: nobody is notified of their own action
    expect((await types(s.owner)).filter((n) => n.notification_type === "assignment_cancelled")).toEqual([]);
  });

  it("only an admin can, and never with a direct delete", async () => {
    const s = await scenario();
    await expect(asUser(db, s.helper, (tx) => tx.query("select public.delete_group($1)", [s.groupId]))).rejects.toThrow(/administrateur/);
    await expect(asUser(db, s.owner, (tx) => tx.query("delete from groups where id = $1", [s.groupId]))).rejects.toThrow(/permission denied/);
  });
});

describe("push delivery", () => {
  it("knows the group of each notification (null for someone outside it)", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2)", [s.requestId, s.helper]));
    const batch = await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return rows<{ user_id: string; group_id: string | null; notification_type: string }>(tx, "select user_id, group_id, notification_type from public.claim_push_batch(500)");
    });
    const confirmed = batch.find((b) => b.user_id === s.helper && b.notification_type === "assignment_confirmed");
    expect(confirmed?.group_id).toBe(s.groupId);
    await expect(asUser(db, s.owner, (tx) => tx.query("select * from public.claim_push_batch(1)"))).rejects.toThrow(/permission denied/);
  });
});

describe("dog photos and old health column", () => {
  it("a photo must be in its dog's folder", async () => {
    const s = await scenario();
    const other = (
      await asUser(db, s.owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Moka', array[$1]::uuid[]) as id", [s.groupId]))
    ).id;
    await asUser(db, s.owner, (tx) => tx.query("update dogs set photo_path = $2 where id = $1", [s.dogId, `${s.dogId}/a.webp`]));
    await expect(
      asUser(db, s.owner, (tx) => tx.query("update dogs set photo_path = $2 where id = $1", [s.dogId, `${other}/b.webp`])),
    ).rejects.toThrow(/dogs_photo_in_own_folder/);
  });

  it("special_needs can no longer be written", async () => {
    const s = await scenario();
    await expect(asUser(db, s.owner, (tx) => tx.query("update dogs set special_needs = 'x' where id = $1", [s.dogId]))).rejects.toThrow(
      /permission denied/,
    );
  });
});
