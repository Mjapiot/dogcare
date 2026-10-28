/**
 * Care log ("carnet de garde"): who writes and when, who reads, photos,
 * notifications, reports and photo retention.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

let db: Db;
let seq = 0;

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-9700-${String(seq).padStart(12, "0")}`;
}

/** Owner, helper and another member in a group; a confirmed garde for the helper starting in `startsIn` hours. */
async function scenario(startsIn = 1) {
  const owner = await createUser(db, uid(), `Owner${seq}`);
  const helper = await createUser(db, uid(), `Helper${seq}`);
  const member = await createUser(db, uid(), `Member${seq}`);
  const groupId = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_group('G') as id"))).id;
  for (const u of [helper, member]) {
    const t = (await asUser(db, owner, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [groupId]))).t;
    await asUser(db, u, (tx) => tx.query("select public.accept_invitation($1)", [t]));
  }
  const dogId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.create_dog('Aston', array[$1]::uuid[]) as id", [groupId]))
  ).id;
  const requestId = (
    await asUser(db, owner, (tx) =>
      one<{ id: string }>(
        tx,
        "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
        [groupId, dogId, inHours(startsIn), inHours(startsIn + 24)],
      ),
    )
  ).id;
  await asUser(db, helper, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
  const assignmentId = (
    await asUser(db, owner, (tx) => one<{ id: string }>(tx, "select public.confirm_assignment($1, $2) as id", [requestId, helper]))
  ).id;
  return { owner, helper, member, groupId, dogId, requestId, assignmentId };
}


const add = (user: string, assignmentId: string, kind: string, note: string | null = null, at: string | null = null, photo: string | null = null) =>
  asUser(db, user, (tx) =>
    one<{ id: string }>(tx, "select public.add_care_log($1, $2, $3, $4, $5) as id", [assignmentId, kind, at, note, photo]),
  ).then((r) => r.id);
const entries = (user: string) =>
  asUser(db, user, (tx) => rows<{ kind: string; note: string | null }>(tx, "select kind, note from care_log_entries order by created_at"));
const careNotes = (user: string) =>
  rows<{ title: string }>(db, "select title from notifications where user_id = $1 and notification_type = 'care_log' order by created_at", [user]);
const upload = (user: string, name: string) =>
  asUser(db, user, (tx) => tx.query("insert into storage.objects (bucket_id, name, owner) values ('care-logs', $1, $2)", [name, user]));

beforeAll(async () => {
  db = await createTestDb();
});

describe("writing", () => {
  it("the helper of a confirmed garde writes; the caretakers read; the rest of the group does not", async () => {
    const s = await scenario();
    await add(s.helper, s.assignmentId, "meal", "Croquettes");
    await add(s.helper, s.assignmentId, "note", "Très calme");
    expect(await entries(s.helper)).toHaveLength(2);
    expect(await entries(s.owner)).toEqual([
      { kind: "meal", note: "Croquettes" },
      { kind: "note", note: "Très calme" },
    ]);
    expect(await entries(s.member)).toEqual([]);
    await expect(add(s.member, s.assignmentId, "meal")).rejects.toThrow(/Seul le gardien/);
    await expect(add(s.owner, s.assignmentId, "meal")).rejects.toThrow(/Seul le gardien/);
    // no direct writes
    await expect(
      asUser(db, s.helper, (tx) =>
        tx.query(
          "insert into care_log_entries (assignment_id, request_id, dog_id, author_id, kind, occurred_at) values ($1, $2, $3, $4, 'meal', now())",
          [s.assignmentId, s.requestId, s.dogId, s.helper],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("opens 2 hours before the garde and closes 24 hours after it", async () => {
    const later = await scenario(3);
    await expect(add(later.helper, later.assignmentId, "meal")).rejects.toThrow(/s'ouvre 2 heures avant/);
    const s = await scenario();
    await add(s.helper, s.assignmentId, "walk");
    // the time must belong to the garde, and not be in the future
    await expect(add(s.helper, s.assignmentId, "walk", null, inHours(-4))).rejects.toThrow(/correspondre à la garde/);
    await expect(add(s.helper, s.assignmentId, "walk", null, inHours(0.5))).rejects.toThrow(/pas encore passée/);
    await db.query("update care_assignments set starts_at = now() - interval '3 days', ends_at = now() - interval '25 hours' where id = $1", [
      s.assignmentId,
    ]);
    await expect(add(s.helper, s.assignmentId, "walk")).rejects.toThrow(/fermé/);
  });

  it("is closed on a cancelled garde or one waiting for reconfirmation", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) =>
      tx.query("update care_requests set ends_at = $2 where id = $1", [s.requestId, inHours(20)]),
    );
    await expect(add(s.helper, s.assignmentId, "meal")).rejects.toThrow(/Reconfirmez/);
    await asUser(db, s.helper, (tx) => tx.query("select public.answer_reconfirmation($1, true)", [s.assignmentId]));
    await add(s.helper, s.assignmentId, "meal");
    await asUser(db, s.helper, (tx) => tx.query("select public.cancel_assignment($1, null)", [s.assignmentId]));
    await expect(add(s.helper, s.assignmentId, "meal")).rejects.toThrow(/annulée/);
  });

  it("a note needs text; the helper edits and deletes only their own entries", async () => {
    const s = await scenario();
    await expect(add(s.helper, s.assignmentId, "note", "  ")).rejects.toThrow(/Écrivez un mot/);
    const id = await add(s.helper, s.assignmentId, "walk", "Parc");
    await asUser(db, s.helper, (tx) => tx.query("select public.update_care_log($1, null, 'Grand parc')", [id]));
    expect((await entries(s.owner))[0].note).toBe("Grand parc");
    await expect(asUser(db, s.owner, (tx) => tx.query("select public.update_care_log($1, null, 'x')", [id]))).rejects.toThrow(/introuvable/);
    await expect(asUser(db, s.owner, (tx) => tx.query("select public.delete_care_log($1)", [id]))).rejects.toThrow(/introuvable/);
    await asUser(db, s.helper, (tx) => tx.query("select public.delete_care_log($1)", [id]));
    expect(await entries(s.owner)).toEqual([]);
  });
});

describe("photos and notifications", () => {
  it("drop-off, pick-up and photos notify the caretakers; meals and walks do not", async () => {
    const s = await scenario();
    await add(s.helper, s.assignmentId, "meal");
    await add(s.helper, s.assignmentId, "drop_off");
    expect(await careNotes(s.owner)).toEqual([{ title: `Helper${seq - 1} a pris en charge Aston` }]);
    await upload(s.helper, `${s.assignmentId}/p1.webp`);
    await add(s.helper, s.assignmentId, "photo", "Sieste", null, `${s.assignmentId}/p1.webp`);
    await add(s.helper, s.assignmentId, "pick_up");
    expect((await careNotes(s.owner)).map((n) => n.title)).toEqual([
      `Helper${seq - 1} a pris en charge Aston`,
      "Nouvelle photo d'Aston",
      "Aston a été récupéré",
    ]);
    expect(await careNotes(s.member)).toEqual([]);
  });

  it("photos: only the helper uploads, only the log's readers see them, paths are checked", async () => {
    const s = await scenario();
    await expect(upload(s.member, `${s.assignmentId}/x.webp`)).rejects.toThrow(/row-level security/);
    await upload(s.helper, `${s.assignmentId}/p2.webp`);
    const see = (user: string) =>
      asUser(db, user, (tx) => rows(tx, "select name from storage.objects where bucket_id = 'care-logs' and name = $1", [`${s.assignmentId}/p2.webp`]));
    expect(await see(s.owner)).toHaveLength(1);
    expect(await see(s.member)).toEqual([]);
    // a photo entry needs an uploaded file of this assignment
    await expect(add(s.helper, s.assignmentId, "photo")).rejects.toThrow(/Ajoutez une photo/);
    await expect(add(s.helper, s.assignmentId, "photo", null, null, `${s.assignmentId}/missing.webp`)).rejects.toThrow(/Photo introuvable/);
    await expect(add(s.helper, s.assignmentId, "photo", null, null, `other/p2.webp`)).rejects.toThrow(/Photo introuvable/);
    await add(s.helper, s.assignmentId, "photo", null, null, `${s.assignmentId}/p2.webp`);
    // the same file cannot be attached twice
    await expect(add(s.helper, s.assignmentId, "photo", null, null, `${s.assignmentId}/p2.webp`)).rejects.toThrow(/Photo introuvable/);
  });

  it("photos are purged 90 days after the garde (text kept), and orphan files after a day", async () => {
    const s = await scenario();
    await upload(s.helper, `${s.assignmentId}/old.webp`);
    await add(s.helper, s.assignmentId, "photo", "Souvenir", null, `${s.assignmentId}/old.webp`);
    await upload(s.helper, `${s.assignmentId}/orphan.webp`);
    await db.query("update storage.objects set created_at = now() - interval '2 days' where name = $1", [`${s.assignmentId}/orphan.webp`]);
    const purge = async () =>
      (await rows<{ path: string }>(db, "select path from public.care_log_photos_to_purge(500)")).map((r) => r.path).filter((p) => p.startsWith(s.assignmentId));
    expect(await purge()).toEqual([`${s.assignmentId}/orphan.webp`]);
    await db.query("update care_assignments set starts_at = now() - interval '92 days', ends_at = now() - interval '91 days' where id = $1", [
      s.assignmentId,
    ]);
    expect((await purge()).sort()).toEqual([`${s.assignmentId}/old.webp`, `${s.assignmentId}/orphan.webp`]);
    await db.query("select public.forget_care_log_photos($1::text[])", [[`${s.assignmentId}/old.webp`]]);
    const [entry] = await rows<{ photo_path: string | null; note: string; photo_removed_at: string | null }>(
      db,
      "select photo_path, note, photo_removed_at from care_log_entries where assignment_id = $1",
      [s.assignmentId],
    );
    expect(entry.photo_path).toBeNull();
    expect(entry.note).toBe("Souvenir");
    expect(entry.photo_removed_at).not.toBeNull();
    // never callable by users
    await expect(asUser(db, s.owner, (tx) => tx.query("select * from public.care_log_photos_to_purge(10)"))).rejects.toThrow(/permission denied/);
  });

  it("a caretaker can report an entry, another member cannot", async () => {
    const s = await scenario();
    const id = await add(s.helper, s.assignmentId, "note", "Bizarre");
    await asUser(db, s.owner, (tx) => tx.query("select public.report_content($1, 'care_log', $2, null)", [s.groupId, id]));
    await expect(
      asUser(db, s.member, (tx) => tx.query("select public.report_content($1, 'care_log', $2, null)", [s.groupId, id])),
    ).rejects.toThrow(/introuvable/);
  });

  it("the care_log push can be switched off (the bell still shows it)", async () => {
    const s = await scenario();
    await asUser(db, s.owner, (tx) => tx.query("insert into notification_preferences (care_log_enabled) values (false)"));
    await add(s.helper, s.assignmentId, "drop_off");
    const [n] = await rows<{ push_state: string }>(
      db,
      "select push_state from notifications where user_id = $1 and notification_type = 'care_log'",
      [s.owner],
    );
    expect(n.push_state).toBe("skipped");
  });
});

describe("an invitee helper", () => {
  it("keeps a log too, read by the caretakers", async () => {
    const s = await scenario();
    const guest = await createUser(db, uid(), `Guest${seq}`);
    const token = (
      await asUser(db, s.owner, (tx) =>
        one<{ t: string }>(tx, "select public.create_circle_invitation($1, 'guest', 'never', 'always', null, $2) as t", [s.dogId, inHours(24 * 5)]),
      )
    ).t;
    await asUser(db, guest, (tx) => tx.query("select public.accept_circle_invitation($1)", [token]));
    const requestId = (
      await asUser(db, s.owner, (tx) =>
        one<{ id: string }>(
          tx,
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'visit', 'required', $3, $4) returning id",
          [s.groupId, s.dogId, inHours(1), inHours(2)],
        ),
      )
    ).id;
    await asUser(db, s.owner, (tx) => tx.query("select public.set_request_invitees($1, $2::uuid[])", [requestId, [guest]]));
    await asUser(db, guest, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
    const assignmentId = (
      await asUser(db, s.owner, (tx) => one<{ id: string }>(tx, "select public.confirm_assignment($1, $2) as id", [requestId, guest]))
    ).id;
    await add(guest, assignmentId, "walk", "20 min");
    expect(await entries(s.owner)).toEqual([{ kind: "walk", note: "20 min" }]);
    expect(await entries(guest)).toEqual([{ kind: "walk", note: "20 min" }]);
  });
});
