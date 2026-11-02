/**
 * "Professionnel" circle role and per-person garde preferences.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9b00-${String(seq).padStart(12, "0")}`;
}

async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const member = await createUser(db, uid(), `Member${seq}`);
  const pro = await createUser(db, uid(), `Pro${seq}`);
  const outsider = await createUser(db, uid(), `Out${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
  await asUser(db, member, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  await asUser(db, owner, async (tx) => {
    await tx.query("select public.save_dog_health($1, 'Poulet', null, null, null, null, null, null)", [dogId]);
  });
  return { owner, member, pro, outsider, groupId, dogId };
}

type S = Awaited<ReturnType<typeof scenario>>;

const invitePro = async (s: S) => {
  const token = (
    await asUser(db, s.owner, (tx) =>
      one<{ t: string }>(tx, "select public.create_circle_invitation($1, 'pro', 'during_care', 'during_care') as t", [s.dogId]),
    )
  ).t;
  await asUser(db, s.pro, (tx) => tx.query("select public.accept_circle_invitation($1)", [token]));
};
const access = (user: string, dogId: string) =>
  asUser(db, user, (tx) => one<{ a: { health: boolean; emergency: boolean } }>(tx, "select public.dog_section_access($1) as a", [dogId])).then((r) => r.a);
const setPref = (by: string, s: S, user: string, place: string, maxNights: number | null, note: string | null) =>
  asUser(db, by, (tx) => tx.query("select public.set_helper_pref($1, $2, $3, $4, $5)", [s.dogId, user, place, maxNights, note]));

beforeAll(async () => {
  db = await createTestDb();
});

describe("professional role", () => {
  it("a pro sees the passport, and health only during a garde", async () => {
    const s = await scenario();
    await invitePro(s);
    expect(await asUser(db, s.pro, (tx) => rows(tx, "select id from dogs where id = $1", [s.dogId]))).toHaveLength(1);
    expect(await access(s.pro, s.dogId)).toEqual({ health: false, emergency: false });
    const [mine] = await asUser(db, s.pro, (tx) => rows<{ role: string }>(tx, "select role from public.my_circle_dogs()"));
    expect(mine.role).toBe("pro");
    // listed as such, and askable on a request
    const list = await asUser(db, s.owner, (tx) => rows<{ kind: string }>(tx, "select kind from public.dog_circle_list($1) where user_id = $2", [s.dogId, s.pro]));
    expect(list).toEqual([{ kind: "pro" }]);
    const candidates = await asUser(db, s.owner, (tx) => rows<{ user_id: string; role: string }>(tx, "select user_id, role from public.request_invitee_candidates($1)", [s.groupId]));
    expect(candidates).toEqual([{ user_id: s.pro, role: "pro" }]);
  });

  it("a pro asked on a request and confirmed sees health from 7 days before", async () => {
    const s = await scenario();
    await invitePro(s);
    const requestId = (
      await asUser(db, s.owner, (tx) =>
        one<{ id: string }>(
          tx,
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
          [s.groupId, s.dogId, inHours(24), inHours(48)],
        ),
      )
    ).id;
    await asUser(db, s.owner, (tx) => tx.query("select public.set_request_invitees($1, $2::uuid[])", [requestId, [s.pro]]));
    await asUser(db, s.pro, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
    await asUser(db, s.owner, (tx) => tx.query("select public.confirm_assignment($1, $2)", [requestId, s.pro]));
    expect(await access(s.pro, s.dogId)).toEqual({ health: true, emergency: true });
  });

  it("circle notifications name the role", async () => {
    const s = await scenario();
    await invitePro(s);
    const [n] = await rows<{ title: string; body: string }>(
      db,
      "select title, body from notifications where user_id = $1 and notification_type = 'circle_update'",
      [s.owner],
    );
    expect(n.body).toBe("Professionnel · santé : pendant vos gardes · urgences : pendant vos gardes");
  });
});

describe("per-person garde preferences", () => {
  it("caretakers set them for someone of the dog's groups or circle; others cannot", async () => {
    const s = await scenario();
    await invitePro(s);
    await setPref(s.owner, s, s.member, "helper", 2, "Ils ont un chat");
    await setPref(s.owner, s, s.pro, "owner", null, null);
    const prefs = await asUser(db, s.owner, (tx) =>
      rows<{ user_id: string; place: string; max_nights: number | null; note: string | null }>(
        tx,
        "select user_id, place, max_nights, note from dog_helper_prefs where dog_id = $1 order by place",
        [s.dogId],
      ),
    );
    expect(prefs).toEqual([
      { user_id: s.member, place: "helper", max_nights: 2, note: "Ils ont un chat" },
      { user_id: s.pro, place: "owner", max_nights: null, note: null },
    ]);
    // updating keeps one row
    await setPref(s.owner, s, s.member, "helper", 0, null);
    expect(await rows(db, "select max_nights from dog_helper_prefs where dog_id = $1 and user_id = $2", [s.dogId, s.member])).toEqual([{ max_nights: 0 }]);
    // only caretakers, only people around the dog, sane values
    await expect(setPref(s.member, s, s.pro, "helper", 1, null)).rejects.toThrow(/Seul un responsable/);
    await expect(setPref(s.owner, s, s.outsider, "helper", 1, null)).rejects.toThrow(/entourage/);
    await expect(setPref(s.owner, s, s.owner, "helper", 1, null)).rejects.toThrow(/responsable du chien n'a pas/);
    await expect(setPref(s.owner, s, s.member, "garden", 1, null)).rejects.toThrow(/Lieu/);
    await expect(setPref(s.owner, s, s.member, "helper", 20, null)).rejects.toThrow(/nuits/);
  });

  it("only the dog's caretakers read them, nobody writes them directly", async () => {
    const s = await scenario();
    await setPref(s.owner, s, s.member, "helper", 2, "Ils ont un chat");
    expect(await asUser(db, s.member, (tx) => rows(tx, "select * from dog_helper_prefs"))).toEqual([]);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("insert into dog_helper_prefs (dog_id, user_id) values ($1, $2)", [s.dogId, s.outsider])),
    ).rejects.toThrow(/permission denied/);
  });
});
