/**
 * People of a dog's circle asked on its requests: visibility, answers,
 * confirmation within guest dates, what they can and cannot read, and
 * cancellations when they leave the circle or their dates change.
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
  return `00000000-0000-4000-9600-${String(seq).padStart(12, "0")}`;
}

/**
 * Owner and member in a group with a dog; a guest (days 0 → 10), a close
 * person and an outsider outside the group.
 */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const member = await createUser(db, uid(), `Member${seq}`);
  const guest = await createUser(db, uid(), `Guest${seq}`);
  const close = await createUser(db, uid(), `Close${seq}`);
  const outsider = await createUser(db, uid(), `Out${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
  await asUser(db, member, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  for (const [user, role, ends] of [
    [guest, "guest", inDays(10)],
    [close, "close", null],
  ] as const) {
    const token = (
      await asUser(db, owner, (tx) =>
        one<{ t: string }>(tx, "select public.create_circle_invitation($1, $2, 'never', 'always', null, $3) as t", [dogId, role, ends]),
      )
    ).t;
    await asUser(db, user, (tx) => tx.query("select public.accept_circle_invitation($1)", [token]));
  }
  return { owner, member, guest, close, outsider, groupId, dogId };
}

type S = Awaited<ReturnType<typeof scenario>>;

const createRequest = (s: S, starts = inDays(2, 8), ends = inDays(3, 20), necessity = "required") =>
  asUser(db, s.owner, (tx) =>
    one<{ id: string }>(
      tx,
      "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', $3, $4, $5) returning id",
      [s.groupId, s.dogId, necessity, starts, ends],
    ),
  ).then((r) => r.id);
const setInvitees = (by: string, requestId: string, ids: string[]) =>
  asUser(db, by, (tx) => tx.query("select public.set_request_invitees($1, $2::uuid[])", [requestId, ids]));
const answer = (user: string, requestId: string, status: "yes" | "no") =>
  asUser(db, user, (tx) =>
    tx.query(
      "insert into request_responses (request_id, response_status) values ($1, $2) on conflict (request_id, user_id) do update set response_status = excluded.response_status",
      [requestId, status],
    ),
  );
const confirm = (requestId: string, by: string, user: string, starts: string | null = null, ends: string | null = null) =>
  asUser(db, by, (tx) => one<{ id: string }>(tx, "select public.confirm_assignment($1, $2, $3, $4) as id", [requestId, user, starts, ends])).then(
    (r) => r.id,
  );
const invited = (user: string) =>
  asUser(db, user, (tx) => rows<{ id: string; my_response: unknown; confirmed_slots: unknown[]; owner_names: string[] }>(tx, "select * from public.my_invited_requests()"));
const notifications = (user: string) =>
  rows<{ title: string; group_id: string | null; notification_type: string }>(
    db,
    "select title, group_id, notification_type from notifications where user_id = $1 order by created_at",
    [user],
  );

beforeAll(async () => {
  db = await createTestDb();
});

describe("asking circle people on a request", () => {
  it("an invitee sees the request, answers it and is notified without the group", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select id from care_requests"))).toEqual([]);
    await setInvitees(s.owner, requestId, [s.guest, s.close]);

    expect(await asUser(db, s.guest, (tx) => rows(tx, "select id from care_requests"))).toEqual([{ id: requestId }]);
    // still no group, no member, no availability
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select id from groups"))).toEqual([]);
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select user_id from group_members"))).toEqual([]);
    const notes = await notifications(s.guest);
    expect(notes).toEqual([{ title: "Nouvelle demande pour Aston", group_id: null, notification_type: "new_request" }]);

    await answer(s.guest, requestId, "yes");
    const list = await invited(s.guest);
    expect(list).toHaveLength(1);
    expect(list[0].my_response).toMatchObject({ response_status: "yes" });
    expect(list[0].owner_names).toEqual([`Owner${seq - 4}`]);
    // the owner is told about the new volunteer, and sees the invitee by name
    expect((await notifications(s.owner)).map((n) => n.notification_type)).toContain("new_volunteer");
    const names = await asUser(db, s.owner, (tx) =>
      rows<{ display_name: string; role: string }>(tx, "select display_name, role from public.request_invitees_of($1::uuid[]) order by role", [[requestId]]),
    );
    expect(names.map((n) => n.role)).toEqual(["close", "guest"]);
  });

  it("an invitee reads only their own answer and assignments, and covered slots without names", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    await setInvitees(s.owner, requestId, [s.guest]);
    await answer(s.member, requestId, "yes");
    await answer(s.guest, requestId, "yes");
    await confirm(requestId, s.owner, s.member, inDays(2, 8), inDays(2, 20));

    const own = await asUser(db, s.guest, (tx) => rows<{ user_id: string }>(tx, "select user_id from request_responses"));
    expect(own).toEqual([{ user_id: s.guest }]);
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select id from care_assignments"))).toEqual([]);
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select user_id from care_request_invitees"))).toEqual([{ user_id: s.guest }]);
    // nor the invitee list of the request through the member function
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select * from public.request_invitees_of($1::uuid[])", [[requestId]]))).toEqual([]);
    const [r] = await invited(s.guest);
    expect(r.confirmed_slots).toHaveLength(1);
    expect(JSON.stringify(r.confirmed_slots)).not.toContain(s.member);
    // members still see the invitee's answer
    expect(await asUser(db, s.member, (tx) => rows(tx, "select user_id from request_responses where user_id = $1", [s.guest]))).toHaveLength(1);
  });

  it("only circle people outside the group, covering the period, can be asked", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    await expect(setInvitees(s.owner, requestId, [s.outsider])).rejects.toThrow(/cercle du chien/);
    await expect(setInvitees(s.owner, requestId, [s.member])).rejects.toThrow(/déjà partie du groupe/);
    await expect(setInvitees(s.owner, requestId, [s.owner])).rejects.toThrow(/responsable/);
    await expect(setInvitees(s.member, requestId, [s.guest])).rejects.toThrow(/Seul un responsable/);
    // the guest's dates end on day 10
    const late = await createRequest(s, inDays(9, 8), inDays(11, 20));
    await expect(setInvitees(s.owner, late, [s.guest])).rejects.toThrow(/pour toute cette période/);
    await setInvitees(s.owner, late, [s.close]);
    // nobody can write the table directly
    await expect(
      asUser(db, s.owner, (tx) => tx.query("insert into care_request_invitees (request_id, user_id) values ($1, $2)", [requestId, s.guest])),
    ).rejects.toThrow(/permission denied/);
  });

  it("an outsider cannot answer, an invitee no longer can once removed", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    await expect(answer(s.outsider, requestId, "yes")).rejects.toThrow(/row-level security/);
    await setInvitees(s.owner, requestId, [s.guest]);
    await answer(s.guest, requestId, "yes");
    await setInvitees(s.owner, requestId, []);
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select id from care_requests"))).toEqual([]);
    expect(await asUser(db, s.owner, (tx) => rows(tx, "select user_id from request_responses where user_id = $1", [s.guest]))).toEqual([]);
    await expect(answer(s.guest, requestId, "yes")).rejects.toThrow(/row-level security/);
    expect((await notifications(s.guest)).map((n) => n.title)).toContain("Demande retirée : Aston");
  });

  it("an information request becoming a real need is announced to invitees", async () => {
    const s = await scenario();
    const requestId = await createRequest(s, inDays(2, 8), inDays(2, 20), "info");
    await asUser(db, s.owner, (tx) => tx.query("update care_requests set request_type = 'alone_info' where id = $1", [requestId]));
    await setInvitees(s.owner, requestId, [s.close]);
    expect(await notifications(s.close)).toEqual([]);
    await asUser(db, s.owner, (tx) =>
      tx.query("update care_requests set request_type = 'care', necessity = 'required' where id = $1", [requestId]),
    );
    expect((await notifications(s.close)).map((n) => n.notification_type)).toEqual(["new_request"]);
  });
});

describe("confirming an invitee", () => {
  it("is possible, then the invitee sees health per their circle settings and can cancel", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    await setInvitees(s.owner, requestId, [s.guest]);
    await answer(s.guest, requestId, "yes");
    const assignmentId = await confirm(requestId, s.owner, s.guest);
    expect((await notifications(s.guest)).map((n) => n.notification_type)).toContain("assignment_confirmed");
    const [r] = await invited(s.guest);
    expect(r.confirmed_slots).toHaveLength(1);
    await asUser(db, s.guest, (tx) => tx.query("select public.cancel_assignment($1, 'Malade')", [assignmentId]));
    expect((await notifications(s.owner)).at(-1)?.notification_type).toBe("assignment_cancelled");
  });

  it("an invitee can be confirmed only after a yes, an outsider never", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    await setInvitees(s.owner, requestId, [s.guest]);
    await expect(confirm(requestId, s.owner, s.guest)).rejects.toThrow(/proposé son aide/);
    await expect(confirm(requestId, s.owner, s.outsider)).rejects.toThrow(/ne fait plus partie/);
  });
});

describe("leaving the circle or changing dates", () => {
  it("removing a guest cancels their assignment, notifies both sides and drops the invitation", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    await setInvitees(s.owner, requestId, [s.guest]);
    await answer(s.guest, requestId, "yes");
    await confirm(requestId, s.owner, s.guest);
    // cannot just stop asking someone with a commitment
    await expect(setInvitees(s.owner, requestId, [])).rejects.toThrow(/garde confirmée/);

    await asUser(db, s.owner, (tx) => tx.query("select public.remove_circle_member($1, $2)", [s.dogId, s.guest]));
    const live = await rows(db, "select id from care_assignments where request_id = $1 and status <> 'cancelled'", [requestId]);
    expect(live).toEqual([]);
    const guestTitles = (await notifications(s.guest)).map((n) => n.title);
    expect(guestTitles).toContain("Votre garde de Aston est annulée");
    expect(guestTitles.at(-1)).toBe("Votre accès au passeport d'Aston est terminé");
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select id from care_requests"))).toEqual([]);
  });

  it("a guest who leaves the circle by themselves: owners are told", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    await setInvitees(s.owner, requestId, [s.guest]);
    await answer(s.guest, requestId, "yes");
    await confirm(requestId, s.owner, s.guest);
    await asUser(db, s.guest, (tx) => tx.query("select public.leave_dog_circle($1)", [s.dogId]));
    const ownerTitles = (await notifications(s.owner)).map((n) => n.title);
    expect(ownerTitles.some((t) => /ne peut plus garder Aston/.test(t))).toBe(true);
    expect(ownerTitles.at(-1)).toMatch(/a quitté le cercle d'Aston/);
    expect(await asUser(db, s.guest, (tx) => rows(tx, "select id from dogs"))).toEqual([]);
  });

  it("shorter guest dates cancel what falls outside, keep what still fits", async () => {
    const s = await scenario();
    const early = await createRequest(s, inDays(2, 8), inDays(2, 20));
    const later = await createRequest(s, inDays(6, 8), inDays(6, 20));
    await setInvitees(s.owner, early, [s.guest]);
    await setInvitees(s.owner, later, [s.guest]);
    for (const r of [early, later]) {
      await answer(s.guest, r, "yes");
      await confirm(r, s.owner, s.guest);
    }
    await asUser(db, s.owner, (tx) =>
      tx.query("select public.set_circle_member($1, $2, 'guest', 'never', 'always', null, $3)", [s.dogId, s.guest, inDays(4)]),
    );
    const live = await rows<{ request_id: string }>(
      db,
      "select request_id from care_assignments where assigned_user_id = $1 and status <> 'cancelled'",
      [s.guest],
    );
    expect(live).toEqual([{ request_id: early }]);
    expect((await invited(s.guest)).map((r) => r.id)).toEqual([early]);
  });

  it("a request moved outside a guest's dates stops asking them", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    await setInvitees(s.owner, requestId, [s.guest]);
    await answer(s.guest, requestId, "no");
    await asUser(db, s.owner, (tx) =>
      tx.query("update care_requests set starts_at = $2, ends_at = $3 where id = $1", [requestId, inDays(12, 8), inDays(12, 20)]),
    );
    expect(await invited(s.guest)).toEqual([]);
    expect((await notifications(s.guest)).at(-1)?.title).toBe("La demande pour Aston a changé");
  });
});

describe("reports", () => {
  it("an invitee can report a request they are asked on, not another one", async () => {
    const s = await scenario();
    const requestId = await createRequest(s);
    const other = await createRequest(s, inDays(4, 8), inDays(4, 20));
    await setInvitees(s.owner, requestId, [s.guest]);
    await asUser(db, s.guest, (tx) => tx.query("select public.report_content($1, 'request', $2, 'Bizarre')", [s.groupId, requestId]));
    await expect(
      asUser(db, s.guest, (tx) => tx.query("select public.report_content($1, 'request', $2, null)", [s.groupId, other])),
    ).rejects.toThrow(/ne faites pas partie/);
  });
});
