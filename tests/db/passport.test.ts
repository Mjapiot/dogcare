/**
 * Digital passport: health and emergency sections restricted to caretakers
 * and live sitters; temporary share links readable without an account.
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
  return `00000000-0000-4000-9400-${String(seq).padStart(12, "0")}`;
}

const CONTACTS = JSON.stringify([{ name: "Maman", relation: "Mère", phone: "06 12 34 56 78" }]);

/** Owner + sitter + plain member in a group, a dog with health and emergency info. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const sitter = await createUser(db, uid(), `Sitter${seq}`);
  const member = await createUser(db, uid(), `Member${seq}`);
  const outsider = await createUser(db, uid(), `Out${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  for (const u of [sitter, member]) {
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, u, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  }
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  await asUser(db, owner, async (tx) => {
    await tx.query("update dogs set meals = '2 fois par jour', sex = 'male', photo_path = $2 where id = $1", [dogId, `${dogId}/photo.webp`]);
    await tx.query("select public.save_dog_health($1, 'Poulet', null, 'Dr Martin', null, '01 23 45 67 89', null, null)", [dogId]);
    await tx.query("select public.save_dog_emergency($1, $2::jsonb, 'Appeler le véto')", [dogId, CONTACTS]);
  });
  /** A request for the dog, the sitter confirmed on it. */
  const confirmSitter = async (startDays: number, endDays: number) => {
    const requestId = (
      await asUser(db, owner, (tx) =>
        one<{ id: string }>(
          tx,
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
          [groupId, dogId, inDays(startDays, 8), inDays(endDays, 20)],
        ),
      )
    ).id;
    await asUser(db, sitter, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
    await asUser(db, owner, (tx) => tx.query("select public.confirm_assignment($1, $2, null, null)", [requestId, sitter]));
    return requestId;
  };
  return { owner, sitter, member, outsider, groupId, dogId, confirmSitter };
}

const healthOf = (user: string, dogId: string) =>
  asUser(db, user, (tx) => rows<{ allergies: string }>(tx, "select allergies from dog_health where dog_id = $1", [dogId]));
const emergencyOf = (user: string, dogId: string) =>
  asUser(db, user, (tx) => rows(tx, "select contacts from dog_emergency where dog_id = $1", [dogId]));
const canViewPrivate = (user: string, dogId: string) =>
  asUser(db, user, (tx) => one<{ ok: boolean }>(tx, "select public.can_view_dog_private($1) as ok", [dogId])).then((r) => r.ok);

const shareLink = (user: string, dogId: string, hours = 24, health = false, emergency = false) =>
  asUser(db, user, (tx) =>
    one<{ t: string }>(tx, "select public.create_dog_share_link($1, $2, $3, $4) as t", [dogId, hours, health, emergency]),
  ).then((r) => r.t);

type Shared = { dog: { name: string; meals: string; photo_path: string }; health: { allergies: string } | null; emergency: { contacts: unknown[] } | null };
const openLink = (token: string) =>
  asAnon(db, (tx) => one<{ p: Shared | null }>(tx, "select public.shared_passport($1) as p", [token])).then((r) => r.p);

beforeAll(async () => {
  db = await createTestDb();
});

describe("passport sections", () => {
  it("group members see identity and habits, not health or emergency", async () => {
    const s = await scenario();
    const dog = await asUser(db, s.member, (tx) => one<{ meals: string }>(tx, "select meals from dogs where id = $1", [s.dogId]));
    expect(dog.meals).toBe("2 fois par jour");
    expect(await healthOf(s.member, s.dogId)).toEqual([]);
    expect(await emergencyOf(s.member, s.dogId)).toEqual([]);
    expect(await canViewPrivate(s.member, s.dogId)).toBe(false);
  });

  it("caretakers see and edit everything", async () => {
    const s = await scenario();
    expect(await healthOf(s.owner, s.dogId)).toEqual([{ allergies: "Poulet" }]);
    expect(await emergencyOf(s.owner, s.dogId)).toHaveLength(1);
    expect(await canViewPrivate(s.owner, s.dogId)).toBe(true);
  });

  it("a sitter sees them from 7 days before a confirmed assignment until its end", async () => {
    const s = await scenario();
    await s.confirmSitter(20, 21);
    expect(await healthOf(s.sitter, s.dogId)).toEqual([]);
    await s.confirmSitter(5, 6);
    expect(await healthOf(s.sitter, s.dogId)).toEqual([{ allergies: "Poulet" }]);
    expect(await emergencyOf(s.sitter, s.dogId)).toHaveLength(1);
    expect(await canViewPrivate(s.sitter, s.dogId)).toBe(true);
  });

  it("a cancelled assignment no longer gives access", async () => {
    const s = await scenario();
    const requestId = await s.confirmSitter(2, 3);
    await asUser(db, s.sitter, (tx) =>
      tx.query("select public.cancel_assignment(id, null) from care_assignments where request_id = $1", [requestId]),
    );
    expect(await healthOf(s.sitter, s.dogId)).toEqual([]);
  });

  it("only caretakers write health and emergency; nobody writes the tables directly", async () => {
    const s = await scenario();
    await expect(
      asUser(db, s.member, (tx) => tx.query("select public.save_dog_health($1, 'x', null, null, null, null, null, null)", [s.dogId])),
    ).rejects.toThrow(/responsable/);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("insert into dog_health (dog_id, allergies) values ($1, 'x')", [s.dogId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("update dog_emergency set instructions = 'x' where dog_id = $1", [s.dogId])),
    ).rejects.toThrow(/permission denied/);
  });

  it("rejects malformed emergency contacts and phone numbers", async () => {
    const s = await scenario();
    const save = (contacts: unknown) =>
      asUser(db, s.owner, (tx) => tx.query("select public.save_dog_emergency($1, $2::jsonb, null)", [s.dogId, JSON.stringify(contacts)]));
    await expect(save([{ name: "A", phone: "<script>" }])).rejects.toThrow();
    await expect(save([{ name: "", phone: "0612345678" }])).rejects.toThrow();
    await expect(save([{ name: "A", phone: "0612345678", extra: 1 }])).rejects.toThrow();
    await expect(save(Array.from({ length: 6 }, () => ({ name: "A", phone: "0612345678" })))).rejects.toThrow();
    await expect(save({ name: "A" })).rejects.toThrow();
    await save([{ name: "Voisin", phone: "+33 6 12 34 56 78" }]);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("select public.save_dog_health($1, null, null, null, null, 'abc', null, null)", [s.dogId])),
    ).rejects.toThrow();
  });

  it("outsiders and anonymous visitors see nothing", async () => {
    const s = await scenario();
    expect(await healthOf(s.outsider, s.dogId)).toEqual([]);
    await expect(asAnon(db, (tx) => tx.query("select * from dog_health"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select * from dog_emergency"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select * from dog_share_links"))).rejects.toThrow(/permission denied/);
  });
});

describe("share links", () => {
  it("opens identity and habits only, unless health and emergency are included", async () => {
    const s = await scenario();
    const basic = await openLink(await shareLink(s.owner, s.dogId));
    expect(basic?.dog).toMatchObject({ name: "Aston", meals: "2 fois par jour" });
    expect(basic?.health).toBeNull();
    expect(basic?.emergency).toBeNull();
    const full = await openLink(await shareLink(s.owner, s.dogId, 168, true, true));
    expect(full?.health).toMatchObject({ allergies: "Poulet" });
    expect(full?.emergency?.contacts).toHaveLength(1);
  });

  it("stores only a hash and counts views", async () => {
    const s = await scenario();
    const token = await shareLink(s.owner, s.dogId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await openLink(token);
    await openLink(token);
    const links = await asUser(db, s.owner, (tx) =>
      rows<{ token_hash: string; view_count: number }>(tx, "select token_hash, view_count from dog_share_links where dog_id = $1", [s.dogId]),
    );
    expect(links).toHaveLength(1);
    expect(links[0].token_hash).not.toContain(token);
    expect(links[0].view_count).toBe(2);
  });

  it("revoked, expired, unknown links and archived dogs return nothing", async () => {
    const s = await scenario();
    const token = await shareLink(s.owner, s.dogId);
    const { id } = await asUser(db, s.owner, (tx) => one<{ id: string }>(tx, "select id from dog_share_links where dog_id = $1", [s.dogId]));
    await asUser(db, s.owner, (tx) => tx.query("select public.revoke_dog_share_link($1)", [id]));
    expect(await openLink(token)).toBeNull();

    const expired = await shareLink(s.owner, s.dogId);
    await db.query("update dog_share_links set expires_at = now() - interval '1 minute' where revoked_at is null and dog_id = $1", [s.dogId]);
    expect(await openLink(expired)).toBeNull();

    expect(await openLink("A".repeat(43))).toBeNull();
    expect(await openLink("not a token")).toBeNull();

    const live = await shareLink(s.owner, s.dogId);
    await asUser(db, s.owner, (tx) => tx.query("update dogs set archived_at = now() where id = $1", [s.dogId]));
    expect(await openLink(live)).toBeNull();
  });

  it("only caretakers create, list and revoke links", async () => {
    const s = await scenario();
    await expect(shareLink(s.member, s.dogId)).rejects.toThrow(/responsable/);
    await shareLink(s.owner, s.dogId);
    expect(await asUser(db, s.member, (tx) => rows(tx, "select id from dog_share_links"))).toEqual([]);
    const { id } = await asUser(db, s.owner, (tx) => one<{ id: string }>(tx, "select id from dog_share_links where dog_id = $1", [s.dogId]));
    await expect(asUser(db, s.member, (tx) => tx.query("select public.revoke_dog_share_link($1)", [id]))).rejects.toThrow(/introuvable/);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("update dog_share_links set revoked_at = null where id = $1", [id])),
    ).rejects.toThrow(/permission denied/);
  });

  it("limits durations and the number of live links", async () => {
    const s = await scenario();
    await expect(shareLink(s.owner, s.dogId, 0)).rejects.toThrow(/durée/);
    await expect(shareLink(s.owner, s.dogId, 721)).rejects.toThrow(/durée/);
    for (let i = 0; i < 10; i += 1) await shareLink(s.owner, s.dogId);
    await expect(shareLink(s.owner, s.dogId)).rejects.toThrow(/Trop de liens/);
  });

  it("the shared dog's current photo is readable anonymously only while a link is live", async () => {
    const s = await scenario();
    const path = `${s.dogId}/photo.webp`;
    await db.query("insert into storage.objects (bucket_id, name) values ('dog-photos', $1)", [path]);
    const visible = () => asAnon(db, (tx) => rows(tx, "select name from storage.objects where name = $1", [path]));
    expect(await visible()).toEqual([]);
    await shareLink(s.owner, s.dogId);
    expect(await visible()).toHaveLength(1);
    await db.query("update dog_share_links set revoked_at = now() where dog_id = $1", [s.dogId]);
    expect(await visible()).toEqual([]);
  });
});
