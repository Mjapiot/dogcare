/**
 * Passport without a group ("Mes chiens"): an owner who has no group keeps a
 * full passport, shares it by link, invites their pet-sitter in the circle,
 * then shares the dog with a group created later.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9d00-${String(seq).padStart(12, "0")}`;
}

async function soloOwner() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const dogId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', '{}'::uuid[]) as id"))).id;
  return { owner, dogId };
}

beforeAll(async () => {
  db = await createTestDb();
});

describe("a dog without a group", () => {
  it("has a full passport its owner reads and edits; nobody else sees it", async () => {
    const { owner, dogId } = await soloOwner();
    const stranger = await createUser(db, uid(), `Stranger${seq}`);
    await asUser(db, owner, async (tx) => {
      await tx.query("select public.save_dog_health($1, 'Poulet', null, 'Dr Martin', null, '01 23 45 67 89', null, null)", [dogId]);
      await tx.query("select public.save_dog_emergency($1, $2::jsonb, 'Appeler le véto')", [dogId, JSON.stringify([{ name: "Maman", relation: "Mère", phone: "06 12 34 56 78" }])]);
      await tx.query("update dogs set breed = 'Beagle' where id = $1", [dogId]);
    });
    expect(await asUser(db, owner, (tx) => rows(tx, "select name, breed from dogs where id = $1", [dogId]))).toEqual([{ name: "Aston", breed: "Beagle" }]);
    expect(await asUser(db, owner, (tx) => rows(tx, "select allergies from dog_health where dog_id = $1", [dogId]))).toEqual([{ allergies: "Poulet" }]);
    expect(await asUser(db, stranger, (tx) => rows(tx, "select id from dogs where id = $1", [dogId]))).toEqual([]);
    expect(await asUser(db, stranger, (tx) => rows(tx, "select dog_id from dog_health where dog_id = $1", [dogId]))).toEqual([]);
  });

  it("is shared by a temporary link, read without an account", async () => {
    const { owner, dogId } = await soloOwner();
    await asUser(db, owner, (tx) => tx.query("select public.save_dog_health($1, 'Poulet', null, null, null, null, null, null)", [dogId]));
    const token = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_dog_share_link($1, 24, true, false) as t", [dogId]))).t;
    const shared = (await asAnon(db, (tx) => one<{ p: { dog: { name: string }; health: { allergies: string } | null } | null }>(tx, "select public.shared_passport($1) as p", [token]))).p;
    expect(shared?.dog.name).toBe("Aston");
    expect(shared?.health?.allergies).toBe("Poulet");
  });

  it("gets a pet-sitter in its circle, who sees the passport but no group", async () => {
    const { owner, dogId } = await soloOwner();
    const sitter = await createUser(db, uid(), `Sitter${seq}`);
    const token = (
      await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_circle_invitation($1, 'pro', 'during_care', 'always') as t", [dogId]))
    ).t;
    await asUser(db, sitter, (tx) => tx.query("select public.accept_circle_invitation($1)", [token]));
    expect(await asUser(db, sitter, (tx) => rows(tx, "select name from dogs where id = $1", [dogId]))).toEqual([{ name: "Aston" }]);
    const [mine] = await asUser(db, sitter, (tx) => rows<{ role: string }>(tx, "select role from public.my_circle_dogs()"));
    expect(mine.role).toBe("pro");
    const list = await asUser(db, owner, (tx) => rows<{ kind: string }>(tx, "select kind from public.dog_circle_list($1) order by kind", [dogId]));
    expect(list.map((m) => m.kind).sort()).toEqual(["owner", "pro"]);
  });

  it("is shared with a group created later; the group then sees it", async () => {
    const { owner, dogId } = await soloOwner();
    const friend = await createUser(db, uid(), `Friend${seq}`);
    const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('Les amis') as id"))).id;
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, friend, (tx) => tx.query("select public.accept_invitation($1)", [t]));
    expect(await asUser(db, friend, (tx) => rows(tx, "select id from dogs where id = $1", [dogId]))).toEqual([]);
    await asUser(db, owner, (tx) => tx.query("insert into group_dogs (group_id, dog_id) values ($1, $2)", [groupId, dogId]));
    expect(await asUser(db, friend, (tx) => rows(tx, "select name from dogs where id = $1", [dogId]))).toEqual([{ name: "Aston" }]);
    // the owner can now ask for help in the group
    await asUser(db, owner, (tx) =>
      tx.query("insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', now() + interval '1 day', now() + interval '2 days')", [
        groupId,
        dogId,
      ]),
    );
  });
});
