#!/usr/bin/env node
/**
 * Prepares the demonstration account used by Apple's App Store reviewers.
 *
 *   node --env-file=.env.local scripts/seed-demo.mjs
 *
 * Needs (in .env.local, never committed):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY,
 *   DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_PASSWORD (12+ characters)
 *
 * Idempotent: the demo group is rebuilt from scratch on every run. It is a
 * separate, clearly labelled group ("Démo Dogcare"); no real user is in it.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { TZDate } from "@date-fns/tz";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const demoEmail = process.env.DEMO_ACCOUNT_EMAIL?.trim().toLowerCase();
const demoPassword = process.env.DEMO_ACCOUNT_PASSWORD;

if (!url || !secret || !demoEmail || !demoPassword || demoPassword.length < 12) {
  console.error("Missing SUPABASE_URL, SUPABASE_SECRET_KEY, DEMO_ACCOUNT_EMAIL or DEMO_ACCOUNT_PASSWORD (12+ chars).");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const GROUP_NAME = "Démo Dogcare";

function must(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const { users } = must(await admin.auth.admin.listUsers({ page, perPage: 200 }), "listUsers");
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (users.length < 200) return null;
  }
  return null;
}

async function ensureUser(email, displayName, password) {
  const existing = await findUser(email);
  const attributes = { email_confirm: true, user_metadata: { display_name: displayName }, password };
  const user = existing
    ? must(await admin.auth.admin.updateUserById(existing.id, attributes), "updateUser").user
    : must(await admin.auth.admin.createUser({ email, ...attributes }), "createUser").user;
  must(await admin.from("profiles").upsert({ id: user.id, display_name: displayName, onboarded_at: new Date().toISOString() }), "profile");
  return user.id;
}

/** Paris wall-clock time, `days` from today. */
function at(days, hour) {
  const now = new TZDate(Date.now(), "Europe/Paris");
  return new TZDate(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0, 0, "Europe/Paris").toISOString();
}

function localDate(days) {
  return at(days, 12).slice(0, 10);
}

const demoId = await ensureUser(demoEmail, "Testeur Apple", demoPassword);
// a fictitious friend so the reviewer sees a lively group; nobody can sign in as her
const camilleId = await ensureUser("demo+camille@example.com", "Camille (démo)", randomBytes(24).toString("base64url"));

// rebuild the demo group
const old = must(await admin.from("groups").select("id").eq("name", GROUP_NAME).eq("created_by", demoId), "find groups");
if (old.length) must(await admin.from("groups").delete().in("id", old.map((g) => g.id)), "delete old group");
must(await admin.from("dogs").delete().in("created_by", [demoId, camilleId]), "delete old dogs");

const group = must(await admin.from("groups").insert({ name: GROUP_NAME, created_by: demoId }).select("id").single(), "group");
must(
  await admin.from("group_members").insert([
    { group_id: group.id, user_id: demoId, role: "admin" },
    { group_id: group.id, user_id: camilleId, role: "member" },
  ]),
  "members",
);

const [pistache, moka] = must(
  await admin
    .from("dogs")
    .insert([
      { name: "Pistache", breed: "Cocker", care_notes: "Deux promenades par jour, adore la balle. Sociable avec les chiens.", created_by: demoId },
      { name: "Moka", breed: "Border collie", care_notes: "Très énergique, a besoin de courir. Repas à 8 h et 19 h.", created_by: camilleId },
    ])
    .select("id, name")
    .order("name", { ascending: false }),
  "dogs",
);
must(
  await admin.from("dog_caretakers").insert([
    { dog_id: pistache.id, user_id: demoId, role: "owner" },
    { dog_id: moka.id, user_id: camilleId, role: "owner" },
  ]),
  "caretakers",
);
must(await admin.from("group_dogs").insert([{ group_id: group.id, dog_id: pistache.id }, { group_id: group.id, dog_id: moka.id }]), "group dogs");

const requests = must(
  await admin
    .from("care_requests")
    .insert([
      // Camille needs help: waits for the reviewer's answer
      { group_id: group.id, dog_id: moka.id, created_by: camilleId, request_type: "care", necessity: "required", starts_at: at(2, 9), ends_at: at(2, 18), description: "Je suis en déplacement toute la journée." },
      // the reviewer's walk: Camille volunteered, to be confirmed
      { group_id: group.id, dog_id: pistache.id, created_by: demoId, request_type: "visit", necessity: "nice_to_have", starts_at: at(4, 12), ends_at: at(4, 13) },
      // weekend care, partially covered by Camille
      { group_id: group.id, dog_id: pistache.id, created_by: demoId, request_type: "care", necessity: "required", starts_at: at(6, 18), ends_at: at(8, 10), splittable: true },
      // information only
      { group_id: group.id, dog_id: pistache.id, created_by: demoId, request_type: "alone_info", necessity: "info", starts_at: at(9, 9), ends_at: at(9, 17) },
    ])
    .select("id, starts_at")
    .order("starts_at"),
  "requests",
);
const [, walk, weekend] = requests;

must(
  await admin.from("request_responses").insert([
    { request_id: walk.id, user_id: camilleId, response_status: "yes" },
    { request_id: weekend.id, user_id: camilleId, response_status: "yes", proposed_starts_at: at(6, 18), proposed_ends_at: at(7, 12) },
  ]),
  "responses",
);
must(
  await admin.from("care_assignments").insert({
    request_id: weekend.id,
    assigned_user_id: camilleId,
    starts_at: at(6, 18),
    ends_at: at(7, 12),
    confirmed_by: demoId,
  }),
  "assignment",
);

// availability for the next two weeks
const entries = [];
for (let d = 0; d < 14; d++) {
  entries.push({ user_id: camilleId, date: localDate(d), slot: "evening", status: d % 3 === 0 ? "unavailable" : "available" });
  if (d % 2 === 0) entries.push({ user_id: demoId, date: localDate(d), slot: "afternoon", status: "available" });
}
must(await admin.from("availability_entries").delete().in("user_id", [demoId, camilleId]), "clear availability");
must(await admin.from("availability_entries").insert(entries), "availability");

console.log(`Demo ready: account ${demoEmail}, group "${GROUP_NAME}", ${requests.length} requests.`);
