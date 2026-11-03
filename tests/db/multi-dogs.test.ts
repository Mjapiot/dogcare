/**
 * Several dogs at once: an absence of several dogs is one request per dog,
 * linked (same creator, group, dates); each person gets one notice for it and
 * answers once for all the dogs; "kept alone" and the number of dogs a person
 * keeps at once are stored with the right permissions.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;

const BASE = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
const inHours = (hours: number) => new Date(BASE + hours * 3_600_000).toISOString();

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9d00-${String(seq).padStart(12, "0")}`;
}

/** Julie owns Aston and Nala; Emma and Léa are in the group; Paul is in another group. */
async function scenario() {
  const owner = await createUser(db, uid(), `Julie${seq}`);
  const emma = await createUser(db, uid(), `Emma${seq}`);
  const lea = await createUser(db, uid(), `Léa${seq}`);
  const paul = await createUser(db, uid(), `Paul${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  for (const u of [emma, lea]) {
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, u, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  }
  const dog = async (name: string) =>
    (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog($1, array[$2]::uuid[]) as id", [name, groupId]))).id;
  const aston = await dog("Aston");
  const nala = await dog("Nala");
  return { owner, emma, lea, paul, groupId, aston, nala };
}

type S = Awaited<ReturnType<typeof scenario>>;
type Proposal = { dog_id: string; user_id: string; place?: string; slices: Array<{ starts_at: string; ends_at: string }> };

const plan = (s: S, dogs: string[], proposals: Proposal[] = [], by = s.owner) =>
  asUser(db, by, (tx) =>
    one<{ ids: string[] }>(tx, "select public.plan_absence_multi($1, $2::uuid[], $3, $4, '', $5::jsonb) as ids", [
      s.groupId,
      dogs,
      inHours(24),
      inHours(72),
      JSON.stringify(proposals),
    ]),
  ).then((r) => r.ids);
const whole = [{ starts_at: inHours(24), ends_at: inHours(72) }];
const notes = (user: string, type?: string) =>
  rows<{ title: string; body: string; request_id: string }>(
    db,
    "select title, body, request_id from notifications where user_id = $1 and ($2::text is null or notification_type::text = $2) order by created_at",
    [user, type ?? null],
  );
const proposalsOf = (user: string, ids: string[]) =>
  rows<{ id: string; status: string; request_id: string }>(db, "select id, status, request_id from care_proposals where user_id = $1 and request_id = any($2::uuid[])", [
    user,
    ids,
  ]);

beforeAll(async () => {
  db = await createTestDb();
});

describe("plan_absence_multi", () => {
  it("creates one linked request per dog; the group gets one notice for the absence", async () => {
    const s = await scenario();
    const ids = await plan(s, [s.aston, s.nala]);
    expect(ids).toHaveLength(2);
    const reqs = await rows<{ absence_id: string | null; dog_id: string }>(db, "select absence_id, dog_id from care_requests where id = any($1::uuid[])", [ids]);
    expect(new Set(reqs.map((r) => r.absence_id)).size).toBe(1);
    expect(reqs[0].absence_id).not.toBeNull();
    const toLea = await notes(s.lea, "new_request");
    expect(toLea.map((n) => n.title)).toEqual(["Nouvelle demande pour Aston et Nala"]);
  });

  it("a single dog stays a plain request (no absence link)", async () => {
    const s = await scenario();
    const [id] = await plan(s, [s.aston]);
    expect((await one<{ a: string | null }>(db, "select absence_id as a from care_requests where id = $1", [id])).a).toBeNull();
    expect((await notes(s.lea, "new_request")).map((n) => n.title)).toEqual(["Nouvelle demande pour Aston"]);
  });

  it("each person gets one proposal notice for all their dogs", async () => {
    const s = await scenario();
    await plan(s, [s.aston, s.nala], [
      { dog_id: s.aston, user_id: s.emma, slices: whole },
      { dog_id: s.nala, user_id: s.emma, slices: whole },
      { dog_id: s.nala, user_id: s.lea, slices: [{ starts_at: inHours(24), ends_at: inHours(48) }] },
    ]);
    const toEmma = await notes(s.emma);
    expect(toEmma.map((n) => n.title)).toEqual(["Pouvez-vous garder Aston et Nala ?"]);
    expect(toEmma[0].body).toMatch(/ · chez vous$/);
    // Léa is asked for Nala only; the request notice for Aston (and Nala) stays
    expect((await notes(s.lea, "care_proposal")).map((n) => n.title)).toEqual(["Pouvez-vous garder Nala ?"]);
  });

  it("different parts per dog: the notice says so", async () => {
    const s = await scenario();
    await plan(s, [s.aston, s.nala], [
      { dog_id: s.aston, user_id: s.emma, slices: whole },
      { dog_id: s.nala, user_id: s.emma, slices: [{ starts_at: inHours(24), ends_at: inHours(48) }] },
    ]);
    const [n] = await notes(s.emma, "care_proposal");
    expect(n.body).toMatch(/^Créneaux selon le chien · /);
  });

  it("refuses a proposal for a dog outside the absence, and dogs of someone else", async () => {
    const s = await scenario();
    await expect(plan(s, [s.aston], [{ dog_id: s.nala, user_id: s.emma, slices: whole }])).rejects.toThrow(/autre chien/);
    await expect(plan(s, [s.aston, s.aston])).rejects.toThrow(/1 à 5 chiens/);
    // Emma is not a caretaker: RLS refuses the request, nothing is created
    await expect(plan(s, [s.aston, s.nala], [], s.emma)).rejects.toThrow();
    expect(await rows(db, "select 1 from care_requests where dog_id = $1", [s.aston])).toHaveLength(0);
  });
});

describe("one answer for the absence", () => {
  it("accepting answers every dog; the owner is told once", async () => {
    const s = await scenario();
    const ids = await plan(s, [s.aston, s.nala], [
      { dog_id: s.aston, user_id: s.emma, slices: whole },
      { dog_id: s.nala, user_id: s.emma, slices: whole },
    ]);
    const [first] = await proposalsOf(s.emma, ids);
    await asUser(db, s.emma, (tx) => tx.query("select public.answer_proposal($1, true)", [first.id]));
    expect((await proposalsOf(s.emma, ids)).map((p) => p.status)).toEqual(["accepted", "accepted"]);
    expect(await rows(db, "select 1 from request_responses where user_id = $1 and response_status = 'yes' and request_id = any($2::uuid[])", [s.emma, ids])).toHaveLength(2);
    expect((await notes(s.owner, "new_volunteer")).map((n) => n.title)).toEqual([`Emma${seq - 2} peut aider pour Aston et Nala`]);
  });

  it("declining answers every dog; the owner gets one notice naming them", async () => {
    const s = await scenario();
    const ids = await plan(s, [s.aston, s.nala], [
      { dog_id: s.aston, user_id: s.emma, slices: whole },
      { dog_id: s.nala, user_id: s.emma, slices: whole },
    ]);
    const [first] = await proposalsOf(s.emma, ids);
    await asUser(db, s.emma, (tx) => tx.query("select public.answer_proposal($1, false)", [first.id]));
    expect((await proposalsOf(s.emma, ids)).map((p) => p.status)).toEqual(["declined", "declined"]);
    const toOwner = await notes(s.owner, "care_proposal");
    expect(toOwner.map((n) => n.title)).toEqual([`Emma${seq - 2} ne peut pas garder Aston et Nala`]);
    // a refusal is not a "Non" to the requests
    expect(await rows(db, "select 1 from request_responses where user_id = $1", [s.emma])).toHaveLength(0);
  });

  it("a request whose dates changed leaves the absence: its proposal is not answered with the others", async () => {
    const s = await scenario();
    const ids = await plan(s, [s.aston, s.nala], [
      { dog_id: s.aston, user_id: s.emma, slices: whole },
      { dog_id: s.nala, user_id: s.emma, slices: whole },
    ]);
    await asUser(db, s.owner, (tx) => tx.query("update care_requests set ends_at = $2 where id = $1", [ids[1], inHours(60)]));
    expect((await one<{ a: string | null }>(db, "select absence_id as a from care_requests where id = $1", [ids[1]])).a).toBeNull();
    // its proposal was withdrawn with the change; the other one is answered alone
    const props = await proposalsOf(s.emma, ids);
    const pending = props.find((p) => p.status === "pending")!;
    await asUser(db, s.emma, (tx) => tx.query("select public.answer_proposal($1, true)", [pending.id]));
    expect((await proposalsOf(s.emma, ids)).map((p) => p.status).sort()).toEqual(["accepted", "withdrawn"]);
  });
});

describe("absence links are checked", () => {
  it("nobody joins someone else's absence, nor with other dates", async () => {
    const s = await scenario();
    const ids = await plan(s, [s.aston, s.nala]);
    const absence = (await one<{ a: string }>(db, "select absence_id as a from care_requests where id = $1", [ids[0]])).a;
    // Emma's dog in the same group, with the same absence id
    const rex = (await asUser(db, s.emma, (tx) => one<{ id: string }>(tx, "select public.create_dog('Rex', array[$1]::uuid[]) as id", [s.groupId]))).id;
    const insert = (by: string, dog: string, end: string) =>
      asUser(db, by, (tx) =>
        tx.query(
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at, absence_id) values ($1, $2, 'care', 'required', $3, $4, $5)",
          [s.groupId, dog, inHours(24), end, absence],
        ),
      );
    await expect(insert(s.emma, rex, inHours(72))).rejects.toThrow(/même absence/);
    // Julie's same dog again, or other dates
    await expect(insert(s.owner, s.aston, inHours(72))).rejects.toThrow(/même absence/);
    const milo = (await asUser(db, s.owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Milo', array[$1]::uuid[]) as id", [s.groupId]))).id;
    await expect(insert(s.owner, milo, inHours(70))).rejects.toThrow(/même absence/);
    // the absence id cannot be changed afterwards
    await expect(asUser(db, s.owner, (tx) => tx.query("update care_requests set absence_id = null where id = $1", [ids[0]]))).rejects.toThrow(/permission/);
  });
});

describe("kept alone, dogs at once", () => {
  it("only a caretaker marks a dog as kept alone; everyone who sees the dog reads it", async () => {
    const s = await scenario();
    const upd = (by: string) => asUser(db, by, (tx) => tx.query("update dogs set alone_only = true where id = $1 returning id", [s.aston]));
    expect((await upd(s.emma)).rows).toHaveLength(0);
    expect((await upd(s.owner)).rows).toHaveLength(1);
    expect((await asUser(db, s.lea, (tx) => one<{ a: boolean }>(tx, "select alone_only as a from dogs where id = $1", [s.aston]))).a).toBe(true);
  });

  it("each person sets their own number of dogs at once (1 to 5, or no limit); group mates read it", async () => {
    const s = await scenario();
    expect((await one<{ m: number }>(db, "select max_dogs_at_once as m from profiles where id = $1", [s.emma])).m).toBe(2);
    await asUser(db, s.emma, (tx) => tx.query("update profiles set max_dogs_at_once = 3 where id = $1", [s.emma]));
    await asUser(db, s.emma, (tx) => tx.query("update profiles set max_dogs_at_once = 1 where id = $1", [s.lea]));
    await expect(asUser(db, s.emma, (tx) => tx.query("update profiles set max_dogs_at_once = 9 where id = $1", [s.emma]))).rejects.toThrow();
    expect((await asUser(db, s.owner, (tx) => rows<{ id: string; m: number | null }>(tx, "select id, max_dogs_at_once as m from profiles where id = any($1::uuid[]) order by id", [[s.emma, s.lea, s.paul]])))).toEqual([
      { id: s.emma, m: 3 },
      { id: s.lea, m: 2 },
    ]);
    await asUser(db, s.emma, (tx) => tx.query("update profiles set max_dogs_at_once = null where id = $1", [s.emma]));
    expect((await one<{ m: number | null }>(db, "select max_dogs_at_once as m from profiles where id = $1", [s.emma])).m).toBeNull();
  });
});
