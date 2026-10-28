/**
 * Circle of trust: roles, per-person health/emergency access, guests and
 * close people invited directly to a dog, dates, and who manages it.
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
  return `00000000-0000-4000-9500-${String(seq).padStart(12, "0")}`;
}

/** Owner + co-owner + member in a group, an outsider, and a dog with health and emergency info. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const coOwner = await createUser(db, uid(), `Co${seq}`);
  const member = await createUser(db, uid(), `Member${seq}`);
  const outsider = await createUser(db, uid(), `Out${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  for (const u of [coOwner, member]) {
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, u, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  }
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  await asUser(db, owner, async (tx) => {
    await tx.query("select public.add_dog_caretaker($1, $2)", [dogId, coOwner]);
    await tx.query("select public.save_dog_health($1, 'Poulet', null, null, null, null, null, null)", [dogId]);
    await tx.query("select public.save_dog_emergency($1, '[]'::jsonb, 'Appeler le véto')", [dogId]);
  });
  return { owner, coOwner, member, outsider, groupId, dogId };
}

const access = (user: string, dogId: string) =>
  asUser(db, user, (tx) => one<{ a: { health: boolean; emergency: boolean } }>(tx, "select public.dog_section_access($1) as a", [dogId])).then(
    (r) => r.a,
  );
const seesDog = (user: string, dogId: string) =>
  asUser(db, user, (tx) => rows(tx, "select id from dogs where id = $1", [dogId])).then((r) => r.length === 1);
const healthRows = (user: string, dogId: string) =>
  asUser(db, user, (tx) => rows(tx, "select allergies from dog_health where dog_id = $1", [dogId]));

const invite = (by: string, dogId: string, role: string, health = "always", emergency = "always", starts: string | null = null, ends: string | null = null) =>
  asUser(db, by, (tx) =>
    one<{ t: string }>(tx, "select public.create_circle_invitation($1, $2, $3, $4, $5, $6) as t", [dogId, role, health, emergency, starts, ends]),
  ).then((r) => r.t);
const accept = (user: string, token: string) =>
  asUser(db, user, (tx) => one<{ d: string }>(tx, "select public.accept_circle_invitation($1) as d", [token])).then((r) => r.d);

beforeAll(async () => {
  db = await createTestDb();
});

describe("roles inside the group", () => {
  it("entourage (default) sees health only around a confirmed assignment", async () => {
    const s = await scenario();
    expect(await access(s.member, s.dogId)).toEqual({ health: false, emergency: false });
    expect(await healthRows(s.member, s.dogId)).toEqual([]);
  });

  it("a member made 'close' always sees health and emergency", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) =>
      tx.query("select public.set_circle_member($1, $2, 'close', 'always', 'always')", [s.dogId, s.member]),
    );
    expect(await access(s.member, s.dogId)).toEqual({ health: true, emergency: true });
    expect(await healthRows(s.member, s.dogId)).toHaveLength(1);
  });

  it("per-person switches: emergency only, or nothing even during a garde", async () => {
    const s = await scenario();
    await asUser(db, s.coOwner, (tx) =>
      tx.query("select public.set_circle_member($1, $2, 'entourage', 'never', 'always')", [s.dogId, s.member]),
    );
    expect(await access(s.member, s.dogId)).toEqual({ health: false, emergency: true });
    // a confirmed garde does not override "never"
    const requestId = (
      await asUser(db, s.owner, (tx) =>
        one<{ id: string }>(
          tx,
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
          [s.groupId, s.dogId, inDays(1, 8), inDays(1, 20)],
        ),
      )
    ).id;
    await asUser(db, s.member, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
    await asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2, null, null)", [requestId, s.member]));
    expect(await access(s.member, s.dogId)).toEqual({ health: false, emergency: true });
  });

  it("removing settings brings a member back to entourage", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) => tx.query("select public.set_circle_member($1, $2, 'close', 'always', 'always')", [s.dogId, s.member]));
    await asUser(db, s.owner, (tx) => tx.query("select public.remove_circle_member($1, $2)", [s.dogId, s.member]));
    expect(await access(s.member, s.dogId)).toEqual({ health: false, emergency: false });
    expect(await seesDog(s.member, s.dogId)).toBe(true);
  });

  it("an entourage setting gives nothing once the person leaves the group", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) => tx.query("select public.set_circle_member($1, $2, 'entourage', 'always', 'always')", [s.dogId, s.member]));
    await asUser(db, s.member, (tx) => tx.query("delete from group_members where group_id = $1 and user_id = $2", [s.groupId, s.member]));
    expect(await seesDog(s.member, s.dogId)).toBe(false);
    expect(await access(s.member, s.dogId)).toEqual({ health: false, emergency: false });
  });
});

describe("people invited directly to the dog", () => {
  it("a guest sees the passport between its dates only, never the group", async () => {
    const s = await scenario();
    const token = await invite(s.owner, s.dogId, "guest", "never", "always", null, inDays(3));
    expect(await accept(s.outsider, token)).toBe(s.dogId);
    expect(await seesDog(s.outsider, s.dogId)).toBe(true);
    expect(await access(s.outsider, s.dogId)).toEqual({ health: false, emergency: true });
    expect(await asUser(db, s.outsider, (tx) => rows(tx, "select id from groups"))).toEqual([]);
    expect(await asUser(db, s.outsider, (tx) => rows(tx, "select id from care_requests"))).toEqual([]);
    // after the end date, nothing
    await db.query("update dog_circle set ends_at = now() - interval '1 minute' where user_id = $1", [s.outsider]);
    expect(await seesDog(s.outsider, s.dogId)).toBe(false);
    expect(await access(s.outsider, s.dogId)).toEqual({ health: false, emergency: false });
  });

  it("a guest whose access starts later sees nothing yet", async () => {
    const s = await scenario();
    const token = await invite(s.owner, s.dogId, "guest", "always", "always", inDays(2), inDays(4));
    await accept(s.outsider, token);
    expect(await seesDog(s.outsider, s.dogId)).toBe(false);
  });

  it("a close person outside the group keeps access with no end date", async () => {
    const s = await scenario();
    await accept(s.outsider, await invite(s.owner, s.dogId, "close"));
    expect(await seesDog(s.outsider, s.dogId)).toBe(true);
    expect(await healthRows(s.outsider, s.dogId)).toHaveLength(1);
    const mine = await asUser(db, s.outsider, (tx) => rows<{ name: string; role: string }>(tx, "select name, role from public.my_circle_dogs()"));
    expect(mine).toEqual([{ name: "Aston", role: "close" }]);
  });

  it("invitations are single use, revocable, stored as a hash and expire", async () => {
    const s = await scenario();
    const token = await invite(s.owner, s.dogId, "close");
    const stored = await rows<{ token_hash: string }>(db, "select token_hash from dog_circle_invitations where dog_id = $1", [s.dogId]);
    expect(stored[0].token_hash).not.toContain(token);
    await accept(s.outsider, token);
    const other = await createUser(db, uid(), `Other${seq}`);
    await expect(accept(other, token)).rejects.toThrow(/déjà été utilisé/);

    const revoked = await invite(s.owner, s.dogId, "close");
    const { id } = await one<{ id: string }>(db, "select id from dog_circle_invitations where used_at is null and dog_id = $1", [s.dogId]);
    await asUser(db, s.coOwner, (tx) => tx.query("select public.revoke_circle_invitation($1)", [id]));
    await expect(accept(other, revoked)).rejects.toThrow(/révoqué/);

    const expired = await invite(s.owner, s.dogId, "close");
    await db.query("update dog_circle_invitations set expires_at = now() - interval '1 minute' where used_at is null and revoked_at is null");
    await expect(accept(other, expired)).rejects.toThrow(/expiré/);
    expect(await seesDog(other, s.dogId)).toBe(false);
  });

  it("the invitation preview tells the status without revealing the dog to strangers before accepting", async () => {
    const s = await scenario();
    const token = await invite(s.owner, s.dogId, "guest", "never", "never", null, inDays(5));
    const preview = await asUser(db, s.outsider, (tx) =>
      one<{ dog_name: string; status: string; role: string }>(tx, "select dog_name, status, role from public.get_circle_invitation($1)", [token]),
    );
    expect(preview).toMatchObject({ dog_name: "Aston", status: "valid", role: "guest" });
    const bad = await asUser(db, s.outsider, (tx) => one<{ status: string }>(tx, "select status from public.get_circle_invitation('nope')"));
    expect(bad.status).toBe("invalid");
    expect(await seesDog(s.outsider, s.dogId)).toBe(false);
  });
});

describe("managing the circle", () => {
  it("only caretakers manage it; nobody writes the tables directly", async () => {
    const s = await scenario();
    await expect(invite(s.member, s.dogId, "close")).rejects.toThrow(/responsable/);
    await expect(
      asUser(db, s.member, (tx) => tx.query("select public.set_circle_member($1, $2, 'close', 'always', 'always')", [s.dogId, s.member])),
    ).rejects.toThrow(/responsable/);
    await expect(
      asUser(db, s.member, (tx) =>
        tx.query("insert into dog_circle (dog_id, user_id, role, health_access, emergency_access) values ($1, $2, 'close', 'always', 'always')", [
          s.dogId,
          s.member,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("strangers cannot be added by id, only through an invitation", async () => {
    const s = await scenario();
    await expect(
      asUser(db, s.owner, (tx) => tx.query("select public.set_circle_member($1, $2, 'close', 'always', 'always')", [s.dogId, s.outsider])),
    ).rejects.toThrow(/Invitez-la/);
  });

  it("guest settings need an end date within a year", async () => {
    const s = await scenario();
    await expect(invite(s.owner, s.dogId, "guest", "always", "always", null, null)).rejects.toThrow(/jusqu'à quand/);
    await expect(invite(s.owner, s.dogId, "guest", "always", "always", null, inDays(400))).rejects.toThrow(/un an/);
    await expect(invite(s.owner, s.dogId, "guest", "always", "always", inDays(3), inDays(2))).rejects.toThrow(/après son début/);
  });

  it("a co-owner cannot remove the owner, but the owner can remove a co-owner", async () => {
    const s = await scenario();
    const removed = await asUser(db, s.coOwner, (tx) =>
      rows(tx, "delete from dog_caretakers where dog_id = $1 and user_id = $2 returning user_id", [s.dogId, s.owner]),
    );
    expect(removed).toEqual([]);
    const ok = await asUser(db, s.owner, (tx) =>
      rows(tx, "delete from dog_caretakers where dog_id = $1 and user_id = $2 returning user_id", [s.dogId, s.coOwner]),
    );
    expect(ok).toHaveLength(1);
  });

  it("the list shows everyone to caretakers and only caretakers to others", async () => {
    const s = await scenario();
    await accept(s.outsider, await invite(s.owner, s.dogId, "guest", "never", "always", null, inDays(3)));
    const full = await asUser(db, s.owner, (tx) =>
      rows<{ user_id: string; kind: string }>(tx, "select user_id, kind from public.dog_circle_list($1)", [s.dogId]),
    );
    expect(full.map((p) => p.kind)).toEqual(["owner", "co_owner", "entourage", "guest"]);
    const partial = await asUser(db, s.outsider, (tx) => rows<{ kind: string }>(tx, "select kind from public.dog_circle_list($1)", [s.dogId]));
    expect(partial.map((p) => p.kind)).toEqual(["owner", "co_owner"]);
    expect(await asUser(db, s.member, (tx) => rows(tx, "select * from dog_circle"))).toEqual([]);
  });
});
