import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { addDays, toLocalDate, type LocalDate, zonedInstant } from "@/domain/time";
import type { GroupSnapshot, MemberInfo } from "@/domain/views";
import type { PassportEmergency, PassportHealth } from "@/domain/passport";
import type {
  AvailabilityEntryRow,
  AvailabilityRuleRow,
  CareAssignmentRow,
  CareRequestRow,
  DogCaretakerRow,
  DogRow,
  DogShareLinkRow,
  CircleInvitationRow,
  CircleMemberRow,
  GroupMemberRow,
  InvitationRow,
  InvitedRequestRow,
  InviteeCandidateRow,
  NotificationPreferencesRow,
  NotificationRow,
  RequestInviteeRow,
  RequestResponseRow,
} from "@/lib/types";

const REQUEST_COLUMNS =
  "id, group_id, dog_id, created_by, request_type, necessity, starts_at, ends_at, description, splittable, lifecycle_status, cancelled_at, cancellation_reason, revision, created_at, updated_at";
const ASSIGNMENT_COLUMNS =
  "id, request_id, assigned_user_id, starts_at, ends_at, status, confirmed_by, confirmed_at, cancelled_at, cancellation_reason, previous_starts_at, previous_ends_at";
const DOG_COLUMNS =
  "id, name, breed, birth_date, photo_path, care_notes, sex, sterilized, weight_kg, identification, distinctive_marks, meals, walks, sleep, behavior, created_by, archived_at";

function must<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return (result.data ?? []) as T;
}

type PageResult = { data: unknown; error: unknown };
const PAGE_SIZE = 1000; // PostgREST caps responses (max_rows), so never rely on one call
const ID_CHUNK = 150; // keeps "in (...)" filters well under URL length limits

/** Reads every row of a query, page by page. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = must<T[]>((await page(from, from + PAGE_SIZE - 1)) as { data: T[] | null; error: unknown });
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

/** Same as fetchAll for an "id in (...)" query, split into chunks. */
async function fetchAllByIds<T>(
  ids: readonly string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<PageResult>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...(await fetchAll<T>((from, to) => page(chunk, from, to))));
  }
  return out;
}

export const getGroupMembers = cache(async (groupId: string): Promise<MemberInfo[]> => {
  const supabase = await createClient();
  const members = must<GroupMemberRow[]>(
    await supabase.from("group_members").select("group_id, user_id, role, share_availability, joined_at").eq("group_id", groupId),
  );
  const ids = members.map((m) => m.user_id);
  const profiles = ids.length
    ? must<{ id: string; display_name: string }[]>(await supabase.from("profiles").select("id, display_name").in("id", ids))
    : [];
  return members
    .map((m) => ({ ...m, display_name: profiles.find((p) => p.id === m.user_id)?.display_name ?? "" }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "fr"));
});

export const getGroupDogs = cache(async (groupId: string) => {
  const supabase = await createClient();
  const links = must<{ dog_id: string }[]>(await supabase.from("group_dogs").select("dog_id").eq("group_id", groupId));
  const ids = links.map((l) => l.dog_id);
  if (ids.length === 0) return { dogs: [] as DogRow[], caretakers: [] as DogCaretakerRow[] };
  const [dogs, caretakers] = await Promise.all([
    supabase.from("dogs").select(DOG_COLUMNS).in("id", ids).order("name"),
    supabase.from("dog_caretakers").select("dog_id, user_id, role").in("dog_id", ids),
  ]);
  return { dogs: must<DogRow[]>(dogs), caretakers: must<DogCaretakerRow[]>(caretakers) };
});

/**
 * Everything needed to compute statuses for requests overlapping
 * [from, to] (local dates, inclusive) in a group.
 */
export async function getGroupSnapshot(
  groupId: string,
  me: string,
  range: { from: LocalDate; to: LocalDate } | { requestIds: string[] },
): Promise<GroupSnapshot> {
  const supabase = await createClient();
  const [members, { dogs, caretakers }] = await Promise.all([getGroupMembers(groupId), getGroupDogs(groupId)]);

  const requests =
    "requestIds" in range
      ? await fetchAllByIds<CareRequestRow>(range.requestIds, (chunk, from, to) =>
          supabase.from("care_requests").select(REQUEST_COLUMNS).eq("group_id", groupId).in("id", chunk).order("starts_at").range(from, to),
        )
      : await fetchAll<CareRequestRow>((from, to) =>
          supabase
            .from("care_requests")
            .select(REQUEST_COLUMNS)
            .eq("group_id", groupId)
            .lt("starts_at", new Date(zonedInstant(addDays(range.to, 1), "00:00")).toISOString())
            .gt("ends_at", new Date(zonedInstant(range.from, "00:00")).toISOString())
            .order("starts_at")
            .range(from, to),
        );
  requests.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const ids = requests.map((r) => r.id);

  // availability window covering every request in Paris time (plus the previous night)
  let minDate: LocalDate | null = null;
  let maxDate: LocalDate | null = null;
  for (const r of requests) {
    const s = toLocalDate(r.starts_at);
    const e = toLocalDate(r.ends_at);
    if (!minDate || s < minDate) minDate = s;
    if (!maxDate || e > maxDate) maxDate = e;
  }

  const memberIds = members.map((m) => m.user_id);
  const [responses, assignments, entries, rules, invitees] = await Promise.all([
    fetchAllByIds<RequestResponseRow>(ids, (chunk, from, to) =>
      supabase
        .from("request_responses")
        .select("id, request_id, user_id, response_status, proposed_starts_at, proposed_ends_at, note, responded_at")
        .in("request_id", chunk)
        .order("id")
        .range(from, to),
    ),
    fetchAllByIds<CareAssignmentRow>(ids, (chunk, from, to) =>
      supabase.from("care_assignments").select(ASSIGNMENT_COLUMNS).in("request_id", chunk).order("id").range(from, to),
    ),
    minDate && maxDate
      ? fetchAllByIds<AvailabilityEntryRow>(memberIds, (chunk, from, to) =>
          supabase
            .from("availability_entries")
            .select("user_id, date, slot, status")
            .in("user_id", chunk)
            .gte("date", addDays(minDate, -1))
            .lte("date", maxDate)
            .order("date")
            .order("user_id")
            .order("slot")
            .range(from, to),
        )
      : Promise.resolve([] as AvailabilityEntryRow[]),
    fetchAllByIds<AvailabilityRuleRow>(memberIds, (chunk, from, to) =>
      supabase.from("availability_rules").select("id, user_id, weekday, slot, status").in("user_id", chunk).order("id").range(from, to),
    ),
    getRequestInvitees(ids),
  ]);

  return {
    me,
    members,
    dogs,
    caretakers,
    requests,
    responses,
    assignments,
    availabilityEntries: entries,
    availabilityRules: rules,
    invitees,
  };
}

/** Circle people asked on these requests (names included), as a member of their group sees them. */
async function getRequestInvitees(requestIds: readonly string[]): Promise<RequestInviteeRow[]> {
  if (requestIds.length === 0) return [];
  const supabase = await createClient();
  const out: RequestInviteeRow[] = [];
  for (let i = 0; i < requestIds.length; i += ID_CHUNK) {
    const chunk = requestIds.slice(i, i + ID_CHUNK);
    out.push(...must<RequestInviteeRow[]>(await supabase.rpc("request_invitees_of", { p_request_ids: chunk })));
  }
  return out;
}

/** Close people and guests of my dogs in this group, who may be asked on a request. */
export async function getInviteeCandidates(groupId: string): Promise<InviteeCandidateRow[]> {
  const supabase = await createClient();
  return must<InviteeCandidateRow[]>(await supabase.rpc("request_invitee_candidates", { p_group_id: groupId }));
}

/** Requests I am asked on as a person of a dog's circle (those ahead, or one by id). */
export async function getMyInvitedRequests(requestId?: string): Promise<InvitedRequestRow[]> {
  const supabase = await createClient();
  return must<InvitedRequestRow[]>(await supabase.rpc("my_invited_requests", requestId ? { p_request_id: requestId } : {}));
}

/** Active requests of the group that are not over yet (most imminent first). */
export async function getUpcomingRequestIds(groupId: string): Promise<string[]> {
  const supabase = await createClient();
  const rows = must<{ id: string }[]>(
    await supabase
      .from("care_requests")
      .select("id")
      .eq("group_id", groupId)
      .eq("lifecycle_status", "active")
      .gt("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(300),
  );
  return rows.map((r) => r.id);
}

/** Snapshot of upcoming requests, shared by the nav badge and the Demandes screen. */
export const getUpcomingSnapshot = cache(async (groupId: string, me: string): Promise<GroupSnapshot> => {
  return getGroupSnapshot(groupId, me, { requestIds: await getUpcomingRequestIds(groupId) });
});

export async function getMyAvailability(userId: string, from: LocalDate, to: LocalDate) {
  const supabase = await createClient();
  const [entries, rules] = await Promise.all([
    supabase.from("availability_entries").select("user_id, date, slot, status").eq("user_id", userId).gte("date", from).lte("date", to),
    supabase.from("availability_rules").select("id, user_id, weekday, slot, status").eq("user_id", userId),
  ]);
  return { entries: must<AvailabilityEntryRow[]>(entries), rules: must<AvailabilityRuleRow[]>(rules) };
}

export async function getNotifications(limit = 50): Promise<NotificationRow[]> {
  const supabase = await createClient();
  return must<NotificationRow[]>(
    await supabase
      .from("notifications")
      .select("id, group_id, notification_type, title, body, request_id, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
  );
}

export const getUnreadCount = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
});

export async function getNotificationPreferences(): Promise<NotificationPreferencesRow> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("new_requests_enabled, responses_enabled, confirmations_enabled, cancellations_enabled, reminders_enabled, summary_enabled")
    .maybeSingle();
  return (
    (data as NotificationPreferencesRow | null) ?? {
      new_requests_enabled: true,
      responses_enabled: true,
      confirmations_enabled: true,
      cancellations_enabled: true,
      reminders_enabled: true,
      summary_enabled: false,
    }
  );
}

export async function getMyDogs(userId: string) {
  const supabase = await createClient();
  const links = must<{ dog_id: string; role: string }[]>(
    await supabase.from("dog_caretakers").select("dog_id, role").eq("user_id", userId),
  );
  const ids = links.map((l) => l.dog_id);
  if (!ids.length) return [] as DogRow[];
  return must<DogRow[]>(await supabase.from("dogs").select(DOG_COLUMNS).in("id", ids).order("name"));
}

export async function getDog(dogId: string) {
  const supabase = await createClient();
  const dog = (await supabase.from("dogs").select(DOG_COLUMNS).eq("id", dogId).maybeSingle()).data as DogRow | null;
  if (!dog) return null;
  const [caretakers, groups] = await Promise.all([
    supabase.from("dog_caretakers").select("dog_id, user_id, role").eq("dog_id", dogId),
    supabase.from("group_dogs").select("group_id").eq("dog_id", dogId),
  ]);
  return {
    dog,
    caretakers: must<DogCaretakerRow[]>(caretakers),
    groupIds: must<{ group_id: string }[]>(groups).map((g) => g.group_id),
  };
}

export async function getInvitations(groupId: string): Promise<InvitationRow[]> {
  const supabase = await createClient();
  return must<InvitationRow[]>(
    await supabase
      .from("group_invitations")
      .select("id, group_id, created_by, expires_at, revoked_at, max_uses, use_count, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(20),
  );
}

/**
 * Health and emergency sections of a dog's passport, with whether the current
 * user may see them (caretakers and live sitters; RLS returns nothing otherwise).
 */
export async function getDogPassportPrivate(dogId: string): Promise<{
  access: { health: boolean; emergency: boolean };
  health: PassportHealth | null;
  emergency: PassportEmergency | null;
}> {
  const supabase = await createClient();
  const [access, health, emergency] = await Promise.all([
    supabase.rpc("dog_section_access", { p_dog_id: dogId }),
    supabase
      .from("dog_health")
      .select("allergies, treatments, vet_name, vet_clinic, vet_phone, vet_address, notes")
      .eq("dog_id", dogId)
      .maybeSingle(),
    supabase.from("dog_emergency").select("contacts, instructions").eq("dog_id", dogId).maybeSingle(),
  ]);
  if (access.error) throw access.error;
  if (health.error) throw health.error;
  if (emergency.error) throw emergency.error;
  return {
    access: (access.data as { health: boolean; emergency: boolean } | null) ?? { health: false, emergency: false },
    health: (health.data as PassportHealth | null) ?? null,
    emergency: (emergency.data as PassportEmergency | null) ?? null,
  };
}

/** The dog's circle: everyone for caretakers, only the caretakers for other viewers. */
export async function getDogCircle(dogId: string): Promise<CircleMemberRow[]> {
  const supabase = await createClient();
  return must<CircleMemberRow[]>(await supabase.rpc("dog_circle_list", { p_dog_id: dogId }));
}

/** Caretakers only (RLS): circle invitations still waiting to be accepted. */
export async function getPendingCircleInvitations(dogId: string): Promise<CircleInvitationRow[]> {
  const supabase = await createClient();
  return must<CircleInvitationRow[]>(
    await supabase
      .from("dog_circle_invitations")
      .select("id, role, health_access, emergency_access, starts_at, ends_at, expires_at, created_at")
      .eq("dog_id", dogId)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  );
}

export type CircleDog = { dog_id: string; name: string; photo_path: string | null; role: "close" | "guest"; starts_at: string | null; ends_at: string | null };

/** Dogs opened to the current user by a circle invitation (not as caretaker or group member). */
export async function getMyCircleDogs(): Promise<CircleDog[]> {
  const supabase = await createClient();
  return must<CircleDog[]>(await supabase.rpc("my_circle_dogs"));
}

/** Caretakers only (RLS): the dog's recent share links, newest first. */
export async function getDogShareLinks(dogId: string): Promise<DogShareLinkRow[]> {
  const supabase = await createClient();
  return must<DogShareLinkRow[]>(
    await supabase
      .from("dog_share_links")
      .select("id, include_health, include_emergency, expires_at, revoked_at, view_count, last_viewed_at, created_at")
      .eq("dog_id", dogId)
      .order("created_at", { ascending: false })
      .limit(20),
  );
}

/** Short-lived signed URLs for dog photos (private bucket). */
export async function signDogPhotos(dogs: Array<Pick<DogRow, "id" | "photo_path">>): Promise<Record<string, string>> {
  const paths = dogs.map((d) => d.photo_path).filter((p): p is string => Boolean(p));
  if (!paths.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from("dog-photos").createSignedUrls(paths, 60 * 60);
  const out: Record<string, string> = {};
  for (const dog of dogs) {
    const match = data?.find((d) => d.path === dog.photo_path);
    if (match?.signedUrl) out[dog.id] = match.signedUrl;
  }
  return out;
}



/** Group of a request the user can see (RLS), or null. */
export async function getRequestGroupId(requestId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("care_requests").select("group_id").eq("id", requestId).maybeSingle();
  return (data as { group_id: string } | null)?.group_id ?? null;
}

/** Admin only: current group code, or null if none / disabled. */
export async function getGroupJoinCode(groupId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_group_join_code", { p_group_id: groupId, p_create: false });
  if (error) return null;
  return (data as string | null) ?? null;
}

/** Current user's calendar subscription token, or null if not enabled. */
export async function getCalendarFeedToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_calendar_feed_token", { p_create: false });
  if (error) return null;
  return (data as string | null) ?? null;
}

/** Members the current user has blocked. */
export async function getMyBlockedIds(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_blocks").select("blocked_id");
  if (error) return [];
  return (data ?? []).map((b) => b.blocked_id as string);
}
