/**
 * Targeted garde proposals: the owner sends each person their part of an
 * absence; accepting is a "Oui" on that part (never a confirmation); circle
 * people are asked on the request at the same time; the plan keeps the place.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;

const BASE = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
const inHours = (hours: number) => new Date(BASE + hours * 3_600_000).toISOString();

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9c00-${String(seq).padStart(12, "0")}`;
}

/** Owner, a member (Emma), a pro of the dog's circle outside the group, an outsider; a request hours 24–72. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const emma = await createUser(db, uid(), `Emma${seq}`);
  const pro = await createUser(db, uid(), `Pro${seq}`);
  const outsider = await createUser(db, uid(), `Out${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
  await asUser(db, emma, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  const token = (
    await asUser(db, owner, (tx) =>
      one<{ t: string }>(tx, "select public.create_circle_invitation($1, 'pro', 'during_care', 'during_care') as t", [dogId]),
    )
  ).t;
  await asUser(db, pro, (tx) => tx.query("select public.accept_circle_invitation($1)", [token]));
  const requestId = (
    await asUser(db, owner, (tx) =>
      one<{ id: string }>(
        tx,
        "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
        [groupId, dogId, inHours(24), inHours(72)],
      ),
    )
  ).id;
  return { owner, emma, pro, outsider, groupId, dogId, requestId };
}

type S = Awaited<ReturnType<typeof scenario>>;
type Proposal = { user_id: string; place?: string; slices: Array<{ starts_at: string; ends_at: string }> };

const send = (by: string, s: S, proposals: Proposal[]) =>
  asUser(db, by, (tx) => one<{ n: number }>(tx, "select public.send_proposals($1, $2::jsonb) as n", [s.requestId, JSON.stringify(proposals)])).then(
    (r) => r.n,
  );
const proposalOf = (s: S, user: string) =>
  one<{ id: string; status: string; place: string }>(db, "select id, status, place from care_proposals where request_id = $1 and user_id = $2", [
    s.requestId,
    user,
  ]);
const answer = (user: string, id: string, accept: boolean) =>
  asUser(db, user, (tx) => tx.query("select public.answer_proposal($1, $2)", [id, accept]));
const notes = (user: string, requestId: string) =>
  rows<{ notification_type: string; title: string; body: string }>(
    db,
    "select notification_type, title, body from notifications where user_id = $1 and request_id = $2 order by created_at",
    [user, requestId],
  );

beforeAll(async () => {
  db = await createTestDb();
});

describe("send_proposals", () => {
  it("sends each person their part; a member gets the proposal instead of the generic notice", async () => {
    const s = await scenario();
    expect((await notes(s.emma, s.requestId)).map((n) => n.notification_type)).toEqual(["new_request"]);
    const n = await send(s.owner, s, [
      { user_id: s.emma, slices: [{ starts_at: inHours(24), ends_at: inHours(36) }, { starts_at: inHours(48), ends_at: inHours(60) }] },
      { user_id: s.pro, place: "owner", slices: [{ starts_at: inHours(36), ends_at: inHours(48) }] },
    ]);
    expect(n).toBe(2);
    const [toEmma] = await notes(s.emma, s.requestId);
    expect(toEmma.notification_type).toBe("care_proposal");
    expect(toEmma.title).toBe("Pouvez-vous garder Aston ?");
    expect(toEmma.body).toMatch(/^2 créneaux, .* · chez vous$/);
    // the pro is now asked on the request, with one notice only
    expect(await rows(db, "select 1 from care_request_invitees where request_id = $1 and user_id = $2", [s.requestId, s.pro])).toHaveLength(1);
    const toPro = await notes(s.pro, s.requestId);
    expect(toPro.map((x) => [x.notification_type, x.body.endsWith("· chez le propriétaire")])).toEqual([["care_proposal", true]]);
    // nothing is confirmed, nobody answered
    expect(await rows(db, "select 1 from care_assignments where request_id = $1", [s.requestId])).toEqual([]);
    expect(await rows(db, "select 1 from request_responses where request_id = $1", [s.requestId])).toEqual([]);
  });

  it("one line per person, slices stored as checked", async () => {
    const s = await scenario();
    const part = { starts_at: inHours(24), ends_at: inHours(36) };
    await expect(send(s.owner, s, [{ user_id: s.emma, slices: [part] }, { user_id: s.emma, slices: [part] }])).rejects.toThrow(/deux fois/);
    await send(s.owner, s, [{ user_id: s.emma, slices: [{ ...part, extra: "x" } as typeof part] }]);
    const [p] = await rows<{ slices: Array<Record<string, string>> }>(db, "select slices from care_proposals where request_id = $1", [s.requestId]);
    expect(Object.keys(p.slices[0]).sort()).toEqual(["ends_at", "starts_at"]);
  });

  it("only the dog's caretakers send, to people around the dog, inside the request", async () => {
    const s = await scenario();
    const whole = [{ starts_at: inHours(24), ends_at: inHours(72) }];
    await expect(send(s.emma, s, [{ user_id: s.pro, slices: whole }])).rejects.toThrow(/Seul un responsable/);
    await expect(send(s.owner, s, [{ user_id: s.outsider, slices: whole }])).rejects.toThrow(/cercle du chien/);
    await expect(send(s.owner, s, [{ user_id: s.owner, slices: whole }])).rejects.toThrow(/responsable du chien ne peut/);
    await expect(send(s.owner, s, [{ user_id: s.emma, slices: [{ starts_at: inHours(20), ends_at: inHours(30) }] }])).rejects.toThrow(/sort de la demande/);
    await expect(
      send(s.owner, s, [{ user_id: s.emma, slices: [{ starts_at: inHours(30), ends_at: inHours(40) }, { starts_at: inHours(35), ends_at: inHours(45) }] }]),
    ).rejects.toThrow(/chevauche/);
    // someone who already said yes is already in the plan
    await asUser(db, s.emma, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [s.requestId]));
    await expect(send(s.owner, s, [{ user_id: s.emma, slices: whole }])).rejects.toThrow(/déjà proposé son aide/);
  });
});

describe("answer_proposal", () => {
  it("accepting is a « Oui » on that part, then the owner confirms the plan with the place", async () => {
    const s = await scenario();
    await send(s.owner, s, [{ user_id: s.pro, place: "owner", slices: [{ starts_at: inHours(36), ends_at: inHours(48) }] }]);
    const p = await proposalOf(s, s.pro);
    // only the person answers
    await expect(answer(s.emma, p.id, true)).rejects.toThrow(/introuvable/);
    await answer(s.pro, p.id, true);
    expect((await proposalOf(s, s.pro)).status).toBe("accepted");
    const [resp] = await rows<{ response_status: string; proposed_starts_at: Date; proposed_ends_at: Date }>(
      db,
      "select response_status, proposed_starts_at, proposed_ends_at from request_responses where request_id = $1 and user_id = $2",
      [s.requestId, s.pro],
    );
    expect(resp.response_status).toBe("yes");
    expect([resp.proposed_starts_at.toISOString(), resp.proposed_ends_at.toISOString()]).toEqual([inHours(36), inHours(48)]);
    expect((await notes(s.owner, s.requestId)).map((n) => n.notification_type)).toContain("new_volunteer");
    // not a confirmation: the owner confirms, and the place is kept
    expect(await rows(db, "select 1 from care_assignments where request_id = $1", [s.requestId])).toEqual([]);
    await asUser(db, s.owner, (tx) =>
      tx.query("select public.confirm_plan($1, $2::jsonb)", [
        s.requestId,
        JSON.stringify([{ user_id: s.pro, starts_at: inHours(36), ends_at: inHours(48), place: "owner" }]),
      ]),
    );
    expect(await rows(db, "select place from care_assignments where request_id = $1", [s.requestId])).toEqual([{ place: "owner" }]);
    // answered once
    await expect(answer(s.pro, p.id, false)).rejects.toThrow(/déjà une réponse/);
  });

  it("declining tells the owner and is not a « Non » to the request", async () => {
    const s = await scenario();
    await send(s.owner, s, [{ user_id: s.emma, slices: [{ starts_at: inHours(24), ends_at: inHours(48) }] }]);
    await answer(s.emma, (await proposalOf(s, s.emma)).id, false);
    expect((await proposalOf(s, s.emma)).status).toBe("declined");
    expect(await rows(db, "select 1 from request_responses where request_id = $1", [s.requestId])).toEqual([]);
    const toOwner = (await notes(s.owner, s.requestId)).filter((n) => n.notification_type === "care_proposal");
    expect(toOwner[0].title).toMatch(/^Emma\d+ ne peut pas garder Aston$/);
    // the owners read where it was, not "chez vous"
    expect(toOwner[0].body).toMatch(/ · chez Emma\d+$/);
  });
});

describe("withdraw and lifecycle", () => {
  it("the owner withdraws a proposal not answered yet; changing the dates drops the others", async () => {
    const s = await scenario();
    await send(s.owner, s, [
      { user_id: s.emma, slices: [{ starts_at: inHours(24), ends_at: inHours(48) }] },
      { user_id: s.pro, slices: [{ starts_at: inHours(48), ends_at: inHours(72) }] },
    ]);
    const e = await proposalOf(s, s.emma);
    await expect(asUser(db, s.emma, (tx) => tx.query("select public.withdraw_proposal($1)", [e.id]))).rejects.toThrow(/Seul un responsable/);
    await asUser(db, s.owner, (tx) => tx.query("select public.withdraw_proposal($1)", [e.id]));
    expect((await proposalOf(s, s.emma)).status).toBe("withdrawn");
    expect((await notes(s.emma, s.requestId)).at(-1)?.title).toBe("Proposition retirée : Aston");
    await expect(answer(s.emma, e.id, true)).rejects.toThrow(/déjà une réponse ou a été retirée/);
    await asUser(db, s.owner, (tx) => tx.query("update care_requests set ends_at = $2 where id = $1", [s.requestId, inHours(80)]));
    expect((await proposalOf(s, s.pro)).status).toBe("withdrawn");
  });

  it("only the person and the dog's caretakers read proposals; nobody writes them directly", async () => {
    const s = await scenario();
    await send(s.owner, s, [{ user_id: s.emma, slices: [{ starts_at: inHours(24), ends_at: inHours(48) }] }]);
    expect(await asUser(db, s.owner, (tx) => rows(tx, "select 1 from care_proposals where request_id = $1", [s.requestId]))).toHaveLength(1);
    expect(await asUser(db, s.emma, (tx) => rows(tx, "select 1 from care_proposals where request_id = $1", [s.requestId]))).toHaveLength(1);
    expect(await asUser(db, s.pro, (tx) => rows(tx, "select 1 from care_proposals where request_id = $1", [s.requestId]))).toEqual([]);
    expect(await asUser(db, s.outsider, (tx) => rows(tx, "select 1 from care_proposals"))).toEqual([]);
    await expect(
      asUser(db, s.emma, (tx) => tx.query("update care_proposals set status = 'accepted' where request_id = $1", [s.requestId])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("plan_absence", () => {
  const plan = (by: string, s: S, proposals: Proposal[]) =>
    asUser(db, by, (tx) =>
      one<{ id: string }>(tx, "select public.plan_absence($1, $2, $3, $4, '', $5::jsonb) as id", [s.groupId, s.dogId, inHours(100), inHours(150), JSON.stringify(proposals)]),
    ).then((r) => r.id);

  it("creates the request and the proposals together: the member only gets the proposal", async () => {
    const s = await scenario();
    const id = await plan(s.owner, s, [{ user_id: s.emma, slices: [{ starts_at: inHours(100), ends_at: inHours(120) }] }]);
    expect((await notes(s.emma, id)).map((n) => n.notification_type)).toEqual(["care_proposal"]);
    expect(await rows(db, "select splittable, necessity from care_requests where id = $1", [id])).toEqual([{ splittable: true, necessity: "required" }]);
  });

  it("is all or nothing: a refused proposal leaves no request behind", async () => {
    const s = await scenario();
    const before = await rows(db, "select id from care_requests where dog_id = $1", [s.dogId]);
    await expect(plan(s.owner, s, [{ user_id: s.outsider, slices: [{ starts_at: inHours(100), ends_at: inHours(120) }] }])).rejects.toThrow(/cercle du chien/);
    expect(await rows(db, "select id from care_requests where dog_id = $1", [s.dogId])).toEqual(before);
    // only a caretaker plans an absence for the dog
    await expect(plan(s.emma, s, [])).rejects.toThrow(/row-level security|permission/);
  });
});
