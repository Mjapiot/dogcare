/**
 * Routines: off by default, written by caretakers only, read with the dog;
 * an occurrence is checked off once during the garde; tomorrow's routines
 * appear in the reminder of the day before.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9e00-${String(seq).padStart(12, "0")}`;
}

/** Paris local "YYYY-MM-DD HH:MM" → ISO instant, through the database (DST-safe). */
const paris = (local: string) =>
  one<{ t: Date }>(db, "select ($1::timestamp at time zone 'Europe/Paris') as t", [local]).then((r) => r.t.toISOString());
const parisToday = () => one<{ d: string }>(db, "select to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as d").then((r) => r.d);

/** Owner, helper and another member; a confirmed garde for the helper from 2 days ago to 2 days ahead. */
async function scenario() {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const helper = await createUser(db, uid(), `Helper${seq}`);
  const member = await createUser(db, uid(), `Member${seq}`);
  const outsider = await createUser(db, uid(), `Out${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  for (const u of [helper, member]) {
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, u, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  }
  const dogId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))).id;
  // a garde in progress: created in the future then moved back as the system would have it
  const requestId = (
    await one<{ id: string }>(
      db,
      "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at, created_by) values ($1, $2, 'care', 'required', now() - interval '2 days', now() + interval '2 days', $3) returning id",
      [groupId, dogId, owner],
    )
  ).id;
  const assignmentId = (
    await one<{ id: string }>(
      db,
      "insert into care_assignments (request_id, assigned_user_id, starts_at, ends_at, confirmed_by) values ($1, $2, now() - interval '2 days', now() + interval '2 days', $3) returning id",
      [requestId, helper, owner],
    )
  ).id;
  return { owner, helper, member, outsider, groupId, dogId, requestId, assignmentId };
}

type S = Awaited<ReturnType<typeof scenario>>;

const setRoutine = (by: string, s: S, kind: string, label: string, times: string[], weekdays: number[] | null = null, id: string | null = null) =>
  asUser(db, by, (tx) =>
    one<{ id: string }>(tx, "select public.set_dog_routine($1, $2, $3, $4, $5::text[], $6::smallint[], null) as id", [s.dogId, id, kind, label, times, weekdays]),
  ).then((r) => r.id);
const enable = (s: S, on = true) => asUser(db, s.owner, (tx) => tx.query("update dogs set routines_enabled = $2 where id = $1", [s.dogId, on]));
const check = (by: string, s: S, routineId: string, at: string) =>
  asUser(db, by, (tx) =>
    one<{ id: string }>(tx, "select public.add_care_log($1, 'meal', null, null, null, $2, $3) as id", [s.assignmentId, routineId, at]),
  ).then((r) => r.id);

beforeAll(async () => {
  db = await createTestDb();
});

describe("routines", () => {
  it("are off by default; caretakers write them, people around the dog read them", async () => {
    const s = await scenario();
    expect(await rows(db, "select routines_enabled from dogs where id = $1", [s.dogId])).toEqual([{ routines_enabled: false }]);
    const id = await setRoutine(s.owner, s, "medication", "Médicament", ["20:00", "08:00", "20:00"], [1, 2, 3, 4, 5, 6, 7]);
    // times sorted and deduplicated, "every day" stored as null
    expect(await rows(db, "select times, weekdays from dog_routines where id = $1", [id])).toEqual([{ times: ["08:00", "20:00"], weekdays: null }]);
    // a medication follows the health access: a member without a garde does not see it, the helper does
    await setRoutine(s.owner, s, "meal", "Repas", ["08:00"]);
    const labels = (user: string) =>
      asUser(db, user, (tx) => rows<{ label: string }>(tx, "select label from dog_routines where dog_id = $1 order by label", [s.dogId])).then((r) => r.map((x) => x.label));
    expect(await labels(s.member)).toEqual(["Repas"]);
    expect(await labels(s.helper)).toEqual(["Médicament", "Repas"]);
    expect(await asUser(db, s.outsider, (tx) => rows(tx, "select label from dog_routines where dog_id = $1", [s.dogId]))).toEqual([]);
    await expect(setRoutine(s.member, s, "meal", "Repas", ["08:00"])).rejects.toThrow(/Seul un responsable/);
    await expect(setRoutine(s.owner, s, "meal", "Repas", ["8h"])).rejects.toThrow(/HH:MM/);
    await expect(setRoutine(s.owner, s, "sing", "Chanter", ["08:00"])).rejects.toThrow(/Type de routine/);
    await expect(
      asUser(db, s.owner, (tx) => tx.query("insert into dog_routines (dog_id, kind, label, times) values ($1, 'meal', 'x', '{08:00}')", [s.dogId])),
    ).rejects.toThrow(/permission denied/);
    // the dog's caretakers turn them on; others cannot
    await asUser(db, s.member, (tx) => tx.query("update dogs set routines_enabled = true where id = $1", [s.dogId]));
    expect(await rows(db, "select routines_enabled from dogs where id = $1", [s.dogId])).toEqual([{ routines_enabled: false }]);
  });

  it("an occurrence is checked off once, by the helper, during the garde, when routines are on", async () => {
    const s = await scenario();
    const today = await parisToday();
    const id = await setRoutine(s.owner, s, "meal", "Repas du matin", ["00:00"]);
    const at = await paris(`${today} 00:00`);
    await expect(check(s.helper, s, id, at)).rejects.toThrow(/Routine introuvable/);
    await enable(s);
    const entry = await check(s.helper, s, id, at);
    expect(await rows(db, "select kind, note from care_log_entries where id = $1", [entry])).toEqual([{ kind: "meal", note: "Repas du matin" }]);
    await expect(check(s.helper, s, id, at)).rejects.toThrow(/Déjà coché/);
    // not a time of the routine, not someone else, not another dog's routine
    await expect(check(s.helper, s, id, await paris(`${today} 00:30`))).rejects.toThrow(/ne correspond pas/);
    await expect(check(s.member, s, id, at)).rejects.toThrow();
    const other = await scenario();
    await expect(check(other.helper, other, id, at)).rejects.toThrow(/Routine introuvable/);
    // unchecking = deleting the entry; the routine can then be checked again
    await asUser(db, s.helper, (tx) => tx.query("select public.delete_care_log($1)", [entry]));
    await check(s.helper, s, id, at);
  });

  it("an occurrence is a whole minute; at most 12 routines per dog", async () => {
    const s = await scenario();
    await enable(s);
    const today = await parisToday();
    const id = await setRoutine(s.owner, s, "meal", "Repas", ["00:00"]);
    const at = await paris(`${today} 00:00`);
    await expect(check(s.helper, s, id, new Date(Date.parse(at) + 30_000).toISOString())).rejects.toThrow(/ne correspond pas/);
    for (let i = 1; i < 12; i++) await setRoutine(s.owner, s, "other", `R${i}`, [`0${i % 10}:15`]);
    await expect(setRoutine(s.owner, s, "other", "R12", ["09:45"])).rejects.toThrow(/12 routines au plus/);
  });

  it("deleting a routine keeps what the care log already says", async () => {
    const s = await scenario();
    await enable(s);
    const today = await parisToday();
    const id = await setRoutine(s.owner, s, "walk", "Promenade", ["00:00"]);
    const entry = await check(s.helper, s, id, await paris(`${today} 00:00`));
    await asUser(db, s.owner, (tx) => tx.query("select public.delete_dog_routine($1)", [id]));
    expect(await rows(db, "select note, routine_id from care_log_entries where id = $1", [entry])).toEqual([{ note: "Promenade", routine_id: null }]);
  });

  it("the reminder of the day before lists tomorrow's routines for the helper", async () => {
    const owner = await createUser(db, uid(), `Owner${seq}`);
    const helper = await createUser(db, uid(), `Helper${seq}`);
    const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, helper, (tx) => tx.query("select public.accept_invitation($1)", [t]));
    const dogId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Nala', array[$1]::uuid[]) as id", [groupId]))).id;
    const s = { owner, dogId } as S;
    await setRoutine(owner, s, "meal", "Repas", ["08:00", "19:00"]);
    await setRoutine(owner, s, "medication", "Médicament", ["20:00"]);
    await asUser(db, owner, (tx) => tx.query("update dogs set routines_enabled = true where id = $1", [dogId]));
    // a garde starting tomorrow at 10:00 (Paris), checked from today 18:00
    const today = await parisToday();
    const tomorrow = (await one<{ d: string }>(db, "select to_char($1::date + 1, 'YYYY-MM-DD') as d", [today])).d;
    const requestId = (
      await one<{ id: string }>(
        db,
        "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at, created_by) values ($1, $2, 'care', 'required', $3, $4, $5) returning id",
        [groupId, dogId, await paris(`${tomorrow} 10:00`), await paris(`${tomorrow} 22:00`), owner],
      )
    ).id;
    await one(db, "insert into care_assignments (request_id, assigned_user_id, starts_at, ends_at, confirmed_by) select id, $2, starts_at, ends_at, $3 from care_requests where id = $1 returning id", [
      requestId,
      helper,
      owner,
    ]);
    await db.query("select public.run_daily_reminders($1)", [await paris(`${today} 18:00`)]);
    const [n] = await rows<{ body: string }>(db, "select body from notifications where user_id = $1 and request_id = $2 and notification_type = 'care_reminder'", [helper, requestId]);
    // from the start of the garde (10:00): not the 08:00 meal
    expect(n.body).toMatch(/ · routines : repas 19:00, médicament 20:00$/);
  });
});
