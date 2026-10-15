import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { GroupMemberRow, GroupRow, ProfileRow } from "@/lib/types";

export const CURRENT_GROUP_COOKIE = "dc_group";

/** Current user id from the verified session, or null. */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

export const getUserEmail = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
});

export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) redirect("/login");
  return id;
}

export const getProfile = cache(async (): Promise<ProfileRow | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_path, timezone, onboarded_at")
    .eq("id", userId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
});

export type MyGroup = GroupRow & { role: GroupMemberRow["role"]; share_availability: boolean };

export const getMyGroups = cache(async (): Promise<MyGroup[]> => {
  const userId = await getUserId();
  if (!userId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_members")
    .select("role, share_availability, groups (id, name, created_by, created_at)")
    .eq("user_id", userId)
    .order("joined_at");
  if (error) throw error;
  type Row = { role: MyGroup["role"]; share_availability: boolean; groups: GroupRow | null };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.groups)
    .map((r) => ({ ...(r.groups as GroupRow), role: r.role, share_availability: r.share_availability }));
});

/** Group selected in the UI (cookie), validated against memberships. */
export const getCurrentGroup = cache(async (): Promise<MyGroup | null> => {
  const groups = await getMyGroups();
  if (groups.length === 0) return null;
  const selected = (await cookies()).get(CURRENT_GROUP_COOKIE)?.value;
  return groups.find((g) => g.id === selected) ?? groups[0];
});

/**
 * Guard for app screens: signed in, profile completed, member of a group.
 */
export async function requireAppContext() {
  const userId = await requireUserId();
  const profile = await getProfile();
  if (!profile || !profile.display_name.trim()) redirect("/onboarding");
  const group = await getCurrentGroup();
  if (!group) redirect("/onboarding/group");
  return { userId, profile, group };
}
