/**
 * Circle notifications (joined, added, changed, removed, left, access ending)
 * and day-before reminders (gardes, uncovered needs), sent once, in Paris days.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";
import { addDays, todayLocal, zonedInstant } from "@/domain/time";

let db: Db;
let seq = 0;

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9800-${String(seq).padStart(12, "0")}`;
}

const tomorrow = addDays(todayLocal(), 1);
const at = (date: string, time: string) => new Date(zonedInstant(date, time)).toISOString();

/** Owner and helper in a group, with a dog. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const helper = await createUser(db, uid(), `Helper${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
  await asUser(db, helper, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  return { owner, helper, groupId, dogId };
}

type S = Awaited<ReturnType<typeof scenario>>;

const request = (s: S, starts: string, ends: string, necessity = "required") =>
  asUser(db, s.owner, (tx) =>
    one<{ id: string }>(
      tx,
      "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', $3, $4, $5) returning id",
      [s.groupId, s.dogId, necessity, starts, ends],
    ),
  ).then((r) => r.id);
const confirm = async (s: S, requestId: string, starts: string | null = null, ends: string | null = null) => {
  await asUser(db, s.helper, (tx) =>
    tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes') on conflict (request_id, user_id) do nothing", [requestId]),
  );
  return (
    await asUser(db, s.owner, (tx) => one<{ id: string }>(tx, "select public.confirm_assignment($1, $2, $3, $4) as id", [requestId, s.helper, starts, ends]))
  ).id;
};
const run = (now: string | null = null) =>
  one<{ n: number }>(db, "select public.run_daily_reminders(coalesce($1::timestamptz, now())) as n", [now]).then((r) => r.n);
const titles = (user: string, type: string) =>
  rows<{ title: string }>(db, "select title from notifications where user_id = $1 and notification_type = $2 order by created_at", [user, type]).then(
    (r) => r.map((x) => x.title),
  );

beforeAll(async () => {
  db = await createTestDb();
});

describe("day-before reminders", () => {
  it("a confirmed garde starting tomorrow reminds the helper and the owner, once", async () => {
    const s = await scenario();
    const requestId = await request(s, at(tomorrow, "09:00"), at(tomorrow, "18:00"));
    await confirm(s, requestId);
    await run();
    expect(await titles(s.helper, "care_reminder")).toEqual(["Demain : garde d'Aston"]);
    expect(await titles(s.owner, "care_reminder")).toEqual([`Demain : Helper${seq} garde Aston`]);
    await run();
    expect(await titles(s.helper, "care_reminder")).toHaveLength(1);
    expect(await titles(s.owner, "care_reminder")).toHaveLength(1);
  });

  it("ignores gardes that are cancelled, waiting for reconfirmation, or not tomorrow", async () => {
    const s = await scenario();
    const cancelled = await request(s, at(tomorrow, "08:00"), at(tomorrow, "09:00"));
    const a = await confirm(s, cancelled);
    await asUser(db, s.helper, (tx) => tx.query("select public.cancel_assignment($1, null)", [a]));
    const moved = await request(s, at(tomorrow, "10:00"), at(tomorrow, "12:00"));
    await confirm(s, moved);
    await asUser(db, s.owner, (tx) => tx.query("update care_requests set ends_at = $2 where id = $1", [moved, at(tomorrow, "11:00")]));
    const later = await request(s, at(addDays(tomorrow, 1), "10:00"), at(addDays(tomorrow, 1), "12:00"));
    await confirm(s, later);
    await run();
    expect(await titles(s.helper, "care_reminder")).toEqual([]);
  });

  it("alerts the owner when a required need of tomorrow is not (fully) covered", async () => {
    const s = await scenario();
    await request(s, at(tomorrow, "08:00"), at(tomorrow, "10:00"));
    const partial = await request(s, at(tomorrow, "12:00"), at(tomorrow, "18:00"));
    await confirm(s, partial, at(tomorrow, "12:00"), at(tomorrow, "14:00"));
    const covered = await request(s, at(tomorrow, "19:00"), at(tomorrow, "20:00"));
    await confirm(s, covered);
    await request(s, at(tomorrow, "21:00"), at(tomorrow, "22:00"), "nice_to_have");
    await run();
    const alerts = (await titles(s.owner, "care_reminder")).filter((t) => t.includes("couvert"));
    expect(alerts.sort()).toEqual(["Demain : Aston n'est pas encore couvert", "Demain : Aston n'est que partiellement couvert"]);
  });

  it("respects the 'Rappels' preference for push (the bell keeps it)", async () => {
    const s = await scenario();
    await asUser(db, s.helper, (tx) => tx.query("insert into notification_preferences (reminders_enabled) values (false)"));
    await confirm(s, await request(s, at(tomorrow, "09:00"), at(tomorrow, "10:00")));
    await run();
    const [n] = await rows<{ push_state: string }>(
      db,
      "select push_state from notifications where user_id = $1 and notification_type = 'care_reminder'",
      [s.helper],
    );
    expect(n.push_state).toBe("skipped");
  });

  it("uses Paris days across the daylight saving change", async () => {
    const s = await scenario();
    // Paris switches to summer time on 2027-03-28: that day ends at 22:00 UTC
    const inside = await request(s, "2027-03-28T21:30:00Z", "2027-03-28T21:50:00Z");
    const outside = await request(s, "2027-03-28T22:30:00Z", "2027-03-28T23:00:00Z");
    await confirm(s, inside);
    await confirm(s, outside);
    await run("2027-03-27T17:00:00Z");
    const ids = await rows<{ request_id: string }>(
      db,
      "select request_id from notifications where user_id = $1 and notification_type = 'care_reminder'",
      [s.helper],
    );
    expect(ids.map((r) => r.request_id)).toEqual([inside]);
  });

  it("cannot be run by users", async () => {
    const s = await scenario();
    await expect(asUser(db, s.owner, (tx) => tx.query("select public.run_daily_reminders()"))).rejects.toThrow(/permission denied/);
  });
});

describe("circle notifications", () => {
  const invite = (s: S, role: string, ends: string | null) =>
    asUser(db, s.owner, (tx) =>
      one<{ t: string }>(tx, "select public.create_circle_invitation($1, $2, 'never', 'always', null, $3) as t", [s.dogId, role, ends]),
    ).then((r) => r.t);

  it("joining and leaving notify the caretakers; being removed notifies the person", async () => {
    const s = await scenario();
    const guest = await createUser(db, uid(), `Guest${seq}`);
    const tguest = await invite(s, "guest", at(addDays(tomorrow, 5), "00:00"));
    await asUser(db, guest, (tx) => tx.query("select public.accept_circle_invitation($1)", [tguest]));
    const [joined] = await titles(s.owner, "circle_update");
    expect(joined).toBe(`Guest${seq} a rejoint le cercle d'Aston`);
    await asUser(db, s.owner, (tx) => tx.query("select public.remove_circle_member($1, $2)", [s.dogId, guest]));
    expect(await titles(guest, "circle_update")).toEqual(["Votre accès au passeport d'Aston est terminé"]);

    const close = await createUser(db, uid(), `Close${seq}`);
    const tclose = await invite(s, "close", null);
    await asUser(db, close, (tx) => tx.query("select public.accept_circle_invitation($1)", [tclose]));
    await asUser(db, close, (tx) => tx.query("select public.leave_dog_circle($1)", [s.dogId]));
    expect((await titles(s.owner, "circle_update")).at(-1)).toBe(`Close${seq} a quitté le cercle d'Aston`);
    expect(await titles(close, "circle_update")).toEqual([]);
  });

  it("a caretaker adding or changing someone's access notifies them, with a summary", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) => tx.query("select public.set_circle_member($1, $2, 'close', 'always', 'always')", [s.dogId, s.helper]));
    await asUser(db, s.owner, (tx) => tx.query("select public.set_circle_member($1, $2, 'close', 'never', 'always')", [s.dogId, s.helper]));
    // saving the same settings again says nothing
    await asUser(db, s.owner, (tx) => tx.query("select public.set_circle_member($1, $2, 'close', 'never', 'always')", [s.dogId, s.helper]));
    await asUser(db, s.owner, (tx) => tx.query("select public.remove_circle_member($1, $2)", [s.dogId, s.helper]));
    const notes = await rows<{ title: string; body: string }>(
      db,
      "select title, body from notifications where user_id = $1 and notification_type = 'circle_update' order by created_at",
      [s.helper],
    );
    expect(notes).toEqual([
      { title: `Owner${seq - 1} vous a ajouté au cercle d'Aston`, body: "Proche · santé : toujours · urgences : toujours" },
      { title: `Owner${seq - 1} a modifié vos accès à Aston`, body: "Proche · santé : non · urgences : toujours" },
      { title: "Vos accès à Aston ont changé", body: "Entourage · santé : pendant vos gardes · urgences : pendant vos gardes" },
    ]);
  });

  it("a guest is told the day before their access ends", async () => {
    const s = await scenario();
    const guest = await createUser(db, uid(), `Guest${seq}`);
    // access until the end of tomorrow (Paris)
    const tguest = await invite(s, "guest", at(addDays(tomorrow, 1), "00:00"));
    await asUser(db, guest, (tx) => tx.query("select public.accept_circle_invitation($1)", [tguest]));
    await run();
    await run();
    expect(await titles(guest, "circle_update")).toEqual(["Votre accès à Aston se termine demain soir"]);
  });
});

describe("French elision in database messages", () => {
  it("writes d'Aston, d'Hector, de Moka", async () => {
    const r = await rows<{ a: string; h: string; m: string }>(
      db,
      "select private.de_name('Aston') as a, private.de_name('Hector') as h, private.de_name('Moka') as m",
    );
    expect(r[0]).toEqual({ a: "d'Aston", h: "d'Hector", m: "de Moka" });
  });

  it("a cancelled garde is announced with the elision", async () => {
    const s = await scenario();
    const requestId = await request(s, at(tomorrow, "09:00"), at(tomorrow, "10:00"));
    const assignmentId = await confirm(s, requestId);
    await asUser(db, s.owner, (tx) => tx.query("select public.cancel_assignment($1, null)", [assignmentId]));
    expect(await titles(s.helper, "assignment_cancelled")).toEqual(["Votre garde d'Aston est annulée"]);
  });
});
