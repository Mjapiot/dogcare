import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser, one, rows, type Db } from "./harness";

const JULIE = "00000000-0000-4000-8000-000000000001";
const EMMA = "00000000-0000-4000-8000-000000000002";
const CHLOE = "00000000-0000-4000-8000-000000000003";
const MAX = "00000000-0000-4000-8000-000000000004"; // outsider

let db: Db;
let groupId: string;
let otherGroupId: string;
let oscarId: string;
let requestId: string;

const inDays = (days: number, hour = 9) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function invite(group: string, by: string, opts = "168, 10"): Promise<string> {
  return (await asUser(db, by, (tx) => one<{ t: string }>(tx, `select public.create_invitation($1, ${opts}) as t`, [group]))).t;
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, JULIE, "Julie");
  await createUser(db, EMMA, "Emma");
  await createUser(db, CHLOE, "Chloé");
  await createUser(db, MAX, "Max");
});

describe("profiles", () => {
  it("are created automatically from auth.users", async () => {
    const p = await asUser(db, JULIE, (tx) => one<{ display_name: string }>(tx, "select display_name from profiles where id = $1", [JULIE]));
    expect(p.display_name).toBe("Julie");
  });

  it("anonymous visitors see nothing", async () => {
    await expect(asAnon(db, (tx) => rows(tx, "select * from profiles"))).rejects.toThrow(/permission denied/);
  });
});

describe("groups and invitations", () => {
  it("Julie creates a group and becomes its admin", async () => {
    groupId = (await asUser(db, JULIE, (tx) => one<{ id: string }>(tx, "select public.create_group('Les copains des chiens') as id"))).id;
    const m = await asUser(db, JULIE, (tx) => rows<{ role: string }>(tx, "select role from group_members where group_id = $1", [groupId]));
    expect(m).toEqual([{ role: "admin" }]);
  });

  it("a user cannot add themselves to a group by guessing its id", async () => {
    await expect(
      asUser(db, MAX, (tx) => tx.query("insert into group_members (group_id, user_id) values ($1, $2)", [groupId, MAX])),
    ).rejects.toThrow(/permission denied/);
  });

  it("only admins create invitations", async () => {
    await expect(invite(groupId, MAX)).rejects.toThrow(/Seul un administrateur/);
  });

  it("Emma joins with a valid link; the link only stores a hash", async () => {
    const token = await invite(groupId, JULIE);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const stored = await rows<{ token_hash: string }>(db, "select token_hash from group_invitations");
    expect(stored.every((r) => r.token_hash !== token)).toBe(true);

    const preview = await asUser(db, EMMA, (tx) => one<{ group_name: string; status: string }>(tx, "select * from public.get_invitation($1)", [token]));
    expect(preview).toMatchObject({ group_name: "Les copains des chiens", status: "valid" });

    const joined = await asUser(db, EMMA, (tx) => one<{ id: string }>(tx, "select public.accept_invitation($1) as id", [token]));
    expect(joined.id).toBe(groupId);

    const notif = await asUser(db, JULIE, (tx) => rows<{ title: string }>(tx, "select title from notifications where notification_type = 'member_joined'"));
    expect(notif[0].title).toContain("Emma");
  });

  it("revoked, expired and exhausted links are refused", async () => {
    const revoked = await invite(groupId, JULIE);
    const inv = await asUser(db, JULIE, (tx) => rows<{ id: string }>(tx, "select id from group_invitations order by created_at desc limit 1"));
    await asUser(db, JULIE, (tx) => tx.query("select public.revoke_invitation($1)", [inv[0].id]));
    await expect(asUser(db, MAX, (tx) => tx.query("select public.accept_invitation($1)", [revoked]))).rejects.toThrow(/révoqué/);

    const single = await invite(groupId, JULIE, "1, 1");
    await asUser(db, CHLOE, (tx) => tx.query("select public.accept_invitation($1)", [single]));
    await expect(asUser(db, MAX, (tx) => tx.query("select public.accept_invitation($1)", [single]))).rejects.toThrow(/nombre maximum/);

    const expiring = await invite(groupId, JULIE, "1, 5");
    await db.query("update group_invitations set expires_at = now() - interval '1 minute' where expires_at > now() and max_uses = 5");
    await expect(asUser(db, MAX, (tx) => tx.query("select public.accept_invitation($1)", [expiring]))).rejects.toThrow(/expiré/);

    await expect(asUser(db, MAX, (tx) => tx.query("select public.accept_invitation('made-up-token')"))).rejects.toThrow(/pas valide/);
  });

  it("an outsider cannot read the group, its members or its invitations", async () => {
    const seen = await asUser(db, MAX, async (tx) => ({
      groups: await rows(tx, "select * from groups"),
      members: await rows(tx, "select * from group_members"),
      invitations: await rows(tx, "select * from group_invitations"),
      profiles: await rows(tx, "select * from profiles where id <> $1", [MAX]),
    }));
    expect(seen).toEqual({ groups: [], members: [], invitations: [], profiles: [] });
  });

  it("members (non admin) cannot read invitation tokens", async () => {
    expect(await asUser(db, EMMA, (tx) => rows(tx, "select * from group_invitations"))).toEqual([]);
  });
});

describe("dogs", () => {
  it("Julie adds Oscar, visible in her group only", async () => {
    oscarId = (
      await asUser(db, JULIE, (tx) => one<{ id: string }>(tx, "select public.create_dog('Oscar', array[$1]::uuid[], 'Beagle') as id", [groupId]))
    ).id;
    expect(await asUser(db, EMMA, (tx) => rows(tx, "select name from dogs"))).toEqual([{ name: "Oscar" }]);
    expect(await asUser(db, MAX, (tx) => rows(tx, "select name from dogs"))).toEqual([]);
  });

  it("only caretakers edit a dog", async () => {
    await asUser(db, EMMA, (tx) => tx.query("update dogs set name = 'Hacked' where id = $1", [oscarId]));
    expect((await one<{ name: string }>(db, "select name from dogs where id = $1", [oscarId])).name).toBe("Oscar");
  });

  it("a dog cannot be created in a group the user is not part of", async () => {
    await expect(
      asUser(db, MAX, (tx) => tx.query("select public.create_dog('Rex', array[$1]::uuid[])", [groupId])),
    ).rejects.toThrow(/ne faites pas partie/);
  });

  it("a dog keeps at least one caretaker", async () => {
    await expect(
      asUser(db, JULIE, (tx) => tx.query("delete from dog_caretakers where dog_id = $1", [oscarId])),
    ).rejects.toThrow(/au moins un responsable/);
  });
});

describe("availability", () => {
  it("members read shared availability; outsiders do not", async () => {
    await asUser(db, EMMA, (tx) =>
      tx.query("insert into availability_entries (date, slot, status) values (current_date + 2, 'afternoon', 'available')"),
    );
    expect(await asUser(db, JULIE, (tx) => rows(tx, "select slot from availability_entries where user_id = $1", [EMMA]))).toHaveLength(1);
    expect(await asUser(db, MAX, (tx) => rows(tx, "select * from availability_entries"))).toEqual([]);
  });

  it("nobody can write someone else's availability", async () => {
    await expect(
      asUser(db, MAX, (tx) =>
        tx.query("insert into availability_entries (user_id, date, slot, status) values ($1, current_date, 'morning', 'available')", [EMMA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a member can stop sharing with a group", async () => {
    await asUser(db, EMMA, (tx) => tx.query("update group_members set share_availability = false where group_id = $1 and user_id = $2", [groupId, EMMA]));
    expect(await asUser(db, JULIE, (tx) => rows(tx, "select * from availability_entries where user_id = $1", [EMMA]))).toEqual([]);
    await asUser(db, EMMA, (tx) => tx.query("update group_members set share_availability = true where group_id = $1 and user_id = $2", [groupId, EMMA]));
  });

  it("a member cannot promote themselves admin", async () => {
    await expect(
      asUser(db, EMMA, (tx) => tx.query("update group_members set role = 'admin' where group_id = $1 and user_id = $2", [groupId, EMMA])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("requests, responses, confirmations", () => {
  it("only a caretaker can create a request for the dog", async () => {
    await expect(
      asUser(db, EMMA, (tx) =>
        tx.query(
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4)",
          [groupId, oscarId, inDays(3, 8), inDays(4, 8)],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("Julie creates a request; eligible members are notified", async () => {
    requestId = (
      await asUser(db, JULIE, (tx) =>
        one<{ id: string }>(
          tx,
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4) returning id",
          [groupId, oscarId, inDays(3, 8), inDays(4, 8)],
        ),
      )
    ).id;
    const emma = await asUser(db, EMMA, (tx) => rows(tx, "select * from notifications where notification_type = 'new_request'"));
    const julie = await asUser(db, JULIE, (tx) => rows(tx, "select * from notifications where notification_type = 'new_request'"));
    expect(emma).toHaveLength(1);
    expect(julie).toHaveLength(0); // the owner is not notified of her own request
    expect(await asUser(db, MAX, (tx) => rows(tx, "select * from care_requests"))).toEqual([]);
  });

  it("a request cannot target a dog that is not in the group", async () => {
    otherGroupId = (await asUser(db, JULIE, (tx) => one<{ id: string }>(tx, "select public.create_group('Autre groupe') as id"))).id;
    await expect(
      asUser(db, JULIE, (tx) =>
        tx.query(
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $4)",
          [otherGroupId, oscarId, inDays(3), inDays(4)],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects invalid periods", async () => {
    await expect(
      asUser(db, JULIE, (tx) =>
        tx.query(
          "insert into care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at) values ($1, $2, 'care', 'required', $3, $3)",
          [groupId, oscarId, inDays(3)],
        ),
      ),
    ).rejects.toThrow(/care_requests_period_valid/);
  });

  it("the owner cannot answer her own request; nobody answers for someone else", async () => {
    await expect(
      asUser(db, JULIE, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, MAX, (tx) => tx.query("insert into request_responses (request_id, user_id, response_status) values ($1, $2, 'yes')", [requestId, EMMA])),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  it("Emma says yes; Julie is notified; it is not a confirmation", async () => {
    await asUser(db, EMMA, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
    const n = await asUser(db, JULIE, (tx) => rows<{ title: string }>(tx, "select title from notifications where notification_type = 'new_volunteer'"));
    expect(n[0].title).toBe("Emma peut aider pour Oscar");
    expect(await rows(db, "select * from care_assignments")).toEqual([]);
  });

  it("nobody can write assignments directly", async () => {
    await expect(
      asUser(db, JULIE, (tx) =>
        tx.query("insert into care_assignments (request_id, assigned_user_id, starts_at, ends_at) values ($1, $2, $3, $4)", [
          requestId,
          EMMA,
          inDays(3, 8),
          inDays(4, 8),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("a helper cannot confirm herself; only the owner confirms a volunteer", async () => {
    await expect(asUser(db, EMMA, (tx) => tx.query("select public.confirm_assignment($1, $2)", [requestId, EMMA]))).rejects.toThrow(
      /Seul un responsable/,
    );
    await expect(asUser(db, JULIE, (tx) => tx.query("select public.confirm_assignment($1, $2)", [requestId, CHLOE]))).rejects.toThrow(
      /pas proposé son aide/,
    );
    await asUser(db, JULIE, (tx) => tx.query("select public.confirm_assignment($1, $2, $3, $4)", [requestId, EMMA, inDays(3, 8), inDays(3, 20)]));
    const n = await asUser(db, EMMA, (tx) => rows(tx, "select * from notifications where notification_type = 'assignment_confirmed'"));
    expect(n).toHaveLength(1);
  });

  it("prevents two overlapping confirmations on the same request", async () => {
    await asUser(db, CHLOE, (tx) => tx.query("insert into request_responses (request_id, response_status) values ($1, 'yes')", [requestId]));
    await expect(
      asUser(db, JULIE, (tx) => tx.query("select public.confirm_assignment($1, $2, $3, $4)", [requestId, CHLOE, inDays(3, 19), inDays(4, 8)])),
    ).rejects.toThrow(/déjà confiée/);
    // adjacent [20h, …) is fine: intervals are half-open
    await asUser(db, JULIE, (tx) => tx.query("select public.confirm_assignment($1, $2, $3, $4)", [requestId, CHLOE, inDays(3, 20), inDays(4, 8)]));
    expect(await rows(db, "select * from care_assignments where status = 'confirmed'")).toHaveLength(2);
  });

  it("a confirmed helper cannot silently switch to 'no'", async () => {
    await expect(
      asUser(db, EMMA, (tx) => tx.query("update request_responses set response_status = 'no' where request_id = $1", [requestId])),
    ).rejects.toThrow(/annulez-la explicitement/);
  });

  it("when the helper cancels, the owner is alerted and the offer is withdrawn", async () => {
    const a = await one<{ id: string }>(db, "select id from care_assignments where assigned_user_id = $1", [EMMA]);
    await asUser(db, EMMA, (tx) => tx.query("select public.cancel_assignment($1, 'Imprévu')", [a.id]));
    const n = await asUser(db, JULIE, (tx) => rows<{ title: string; body: string }>(tx, "select title, body from notifications where notification_type = 'assignment_cancelled'"));
    expect(n[0].title).toBe("Emma ne peut plus garder Oscar");
    expect(n[0].body).toContain("Imprévu");
    const r = await one<{ response_status: string }>(db, "select response_status from request_responses where user_id = $1", [EMMA]);
    expect(r.response_status).toBe("no");
  });

  it("an outsider cannot cancel someone's assignment", async () => {
    const a = await one<{ id: string }>(db, "select id from care_assignments where assigned_user_id = $1", [CHLOE]);
    await expect(asUser(db, MAX, (tx) => tx.query("select public.cancel_assignment($1)", [a.id]))).rejects.toThrow(/ne pouvez pas/);
  });

  it("changing the period asks the helper to reconfirm and resets other answers", async () => {
    await asUser(db, JULIE, (tx) => tx.query("update care_requests set ends_at = $2 where id = $1", [requestId, inDays(4, 6)]));
    const a = await one<{ status: string; ends_at: Date; previous_ends_at: Date }>(
      db,
      "select status, ends_at, previous_ends_at from care_assignments where assigned_user_id = $1",
      [CHLOE],
    );
    expect(a.status).toBe("pending_reconfirmation");
    expect(new Date(a.ends_at).toISOString()).toBe(inDays(4, 6));
    expect(new Date(a.previous_ends_at).toISOString()).toBe(inDays(4, 8));
    // Emma's (no) answer was given for the old period: she is asked again
    expect(await rows(db, "select * from request_responses where user_id = $1", [EMMA])).toEqual([]);
    const n = await asUser(db, CHLOE, (tx) => rows(tx, "select * from notifications where notification_type = 'reconfirmation_needed'"));
    expect(n).toHaveLength(1);

    const id = (await one<{ id: string }>(db, "select id from care_assignments where assigned_user_id = $1", [CHLOE])).id;
    await asUser(db, CHLOE, (tx) => tx.query("select public.answer_reconfirmation($1, true)", [id]));
    expect((await one<{ status: string }>(db, "select status from care_assignments where id = $1", [id])).status).toBe("confirmed");
  });

  it("cancelling the request cancels assignments and informs the helper", async () => {
    await asUser(db, JULIE, (tx) => tx.query("update care_requests set lifecycle_status = 'cancelled' where id = $1", [requestId]));
    expect(await rows(db, "select * from care_assignments where status <> 'cancelled'")).toEqual([]);
    const n = await asUser(db, CHLOE, (tx) => rows(tx, "select * from notifications where notification_type = 'request_cancelled'"));
    expect(n).toHaveLength(1);
    await expect(
      asUser(db, JULIE, (tx) => tx.query("update care_requests set lifecycle_status = 'active' where id = $1", [requestId])),
    ).rejects.toThrow(/annulée/);
  });
});

describe("notifications privacy", () => {
  it("each user only sees their own notifications", async () => {
    const own = await asUser(db, EMMA, (tx) => rows<{ user_id: string }>(tx, "select user_id from notifications"));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((n) => n.user_id === EMMA)).toBe(true);
  });

  it("users cannot forge notifications", async () => {
    await expect(
      asUser(db, MAX, (tx) => tx.query("insert into notifications (user_id, notification_type, title) values ($1, 'new_request', 'spam')", [EMMA])),
    ).rejects.toThrow(/permission denied/);
  });

  it("private helpers are not callable to send notifications", async () => {
    await expect(
      asUser(db, MAX, (tx) => tx.query("select private.notify($1, null, 'new_request', 'x', null, null, null)", [EMMA])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("web push", () => {
  const sub = (endpoint: string) => [endpoint, "B".repeat(87), "A".repeat(22), "iPhone"];

  it("a device registers for its current user and moves when another account signs in", async () => {
    await asUser(db, EMMA, (tx) => tx.query("select public.register_push_subscription($1, $2, $3, $4)", sub("https://push.example/device-1")));
    expect(await asUser(db, EMMA, (tx) => rows(tx, "select endpoint from push_subscriptions"))).toHaveLength(1);
    await asUser(db, CHLOE, (tx) => tx.query("select public.register_push_subscription($1, $2, $3, $4)", sub("https://push.example/device-1")));
    expect(await asUser(db, EMMA, (tx) => rows(tx, "select endpoint from push_subscriptions"))).toEqual([]);
    expect(await asUser(db, CHLOE, (tx) => rows(tx, "select endpoint from push_subscriptions"))).toHaveLength(1);
    expect(await asUser(db, MAX, (tx) => rows(tx, "select endpoint from push_subscriptions"))).toEqual([]);
  });

  it("rejects malformed subscriptions", async () => {
    await expect(
      asUser(db, EMMA, (tx) => tx.query("select public.register_push_subscription('http://insecure', 'x', 'y')")),
    ).rejects.toThrow(/invalide/);
  });

  it("only the server (service role) can claim notifications to push", async () => {
    await expect(asUser(db, EMMA, (tx) => tx.query("select * from public.claim_push_batch(10)"))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, EMMA, (tx) => tx.query("update notifications set push_state = 'sent' where user_id = $1", [EMMA])),
    ).rejects.toThrow(/permission denied/);
  });

  it("claims each pending notification once, then marks it sent", async () => {
    await db.query(
      "insert into notifications (user_id, notification_type, title) values ($1, 'new_request', 'Test push')",
      [EMMA],
    );
    const claim = () =>
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        return rows<{ id: string; title: string }>(tx, "select * from public.claim_push_batch(50)");
      });
    const first = await claim();
    expect(first.map((r) => r.title)).toContain("Test push");
    expect(await claim()).toEqual([]); // already being sent
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("select public.complete_push_batch($1::uuid[])", [first.map((r) => r.id)]);
    });
    const states = await rows<{ push_state: string }>(db, "select push_state from notifications where title = 'Test push'");
    expect(states).toEqual([{ push_state: "sent" }]);
  });
});

describe("storage", () => {
  it("only caretakers upload photos into their dog's folder", async () => {
    await asUser(db, JULIE, (tx) =>
      tx.query("insert into storage.objects (bucket_id, name) values ('dog-photos', $1)", [`${oscarId}/photo.webp`]),
    );
    await expect(
      asUser(db, EMMA, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('dog-photos', $1)", [`${oscarId}/evil.webp`])),
    ).rejects.toThrow(/row-level security/);
    expect(await asUser(db, EMMA, (tx) => rows(tx, "select name from storage.objects"))).toHaveLength(1);
    expect(await asUser(db, MAX, (tx) => rows(tx, "select name from storage.objects"))).toEqual([]);
  });
});

describe("membership rules", () => {
  it("the last admin cannot leave while other members remain", async () => {
    await expect(
      asUser(db, JULIE, (tx) => tx.query("delete from group_members where group_id = $1 and user_id = $2", [groupId, JULIE])),
    ).rejects.toThrow(/au moins un administrateur/);
  });

  it("a member can leave; an admin can remove a member", async () => {
    await asUser(db, CHLOE, (tx) => tx.query("delete from group_members where group_id = $1 and user_id = $2", [groupId, CHLOE]));
    expect(await asUser(db, CHLOE, (tx) => rows(tx, "select * from groups where id = $1", [groupId]))).toEqual([]);
  });

  it("a group whose last member leaves is deleted", async () => {
    await asUser(db, JULIE, (tx) => tx.query("delete from group_members where group_id = $1 and user_id = $2", [otherGroupId, JULIE]));
    expect(await rows(db, "select * from groups where id = $1", [otherGroupId])).toEqual([]);
  });

  it("an account deleted by an operator promotes another admin instead of failing", async () => {
    const ZOE = "00000000-0000-4000-8000-000000000005";
    await createUser(db, ZOE, "Zoé");
    const gid = (await asUser(db, ZOE, (tx) => one<{ id: string }>(tx, "select public.create_group('Zoé & co') as id"))).id;
    const token = (await asUser(db, ZOE, (tx) => one<{ t: string }>(tx, "select public.create_invitation($1) as t", [gid]))).t;
    await asUser(db, MAX, (tx) => tx.query("select public.accept_invitation($1)", [token]));
    await db.query("delete from auth.users where id = $1", [ZOE]);
    const m = await rows<{ user_id: string; role: string }>(db, "select user_id, role from group_members where group_id = $1", [gid]);
    expect(m).toEqual([{ user_id: MAX, role: "admin" }]);
  });

  it("deleting an account archives dogs left without caretaker and keeps the group", async () => {
    await asUser(db, JULIE, (tx) => tx.query("select public.delete_my_account()"));
    const dog = await one<{ archived_at: Date | null }>(db, "select archived_at from dogs where id = $1", [oscarId]);
    expect(dog.archived_at).not.toBeNull();
    const emma = await one<{ role: string }>(db, "select role from group_members where group_id = $1 and user_id = $2", [groupId, EMMA]);
    expect(emma.role).toBe("admin");
  });
});
