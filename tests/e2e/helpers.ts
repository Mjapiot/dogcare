import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * page.goto that tolerates the app's own refresh: live updates (Realtime)
 * may navigate the page to the same URL at the same moment.
 */
export async function gotoStable(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (error) {
    if (!(error instanceof Error) || !/interrupted by another navigation/.test(error.message)) throw error;
    await page.waitForLoadState("load");
    if (!page.url().endsWith(url)) await page.goto(url);
  }
}

export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("E2E requires SUPABASE_URL and SUPABASE_SECRET_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Creates a confirmed test user (no e-mail is sent). Addresses are clearly fake. */
export async function createTestUser(admin: SupabaseClient, name: string): Promise<{ id: string; email: string }> {
  // e-mail addresses must stay ASCII ("Chloé" → "chloe")
  const slug = name.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const email = `e2e+${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name: name } });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return { id: data.user.id, email };
}

/** Signs a browser context in without e-mail, through the app's /auth/confirm route. */
export async function signIn(context: BrowserContext, admin: SupabaseClient, email: string, next = "/"): Promise<Page> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw error ?? new Error("generateLink failed");
  const page = await context.newPage();
  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`);
  return page;
}

/** Removes everything created by a test run (groups first, then users). */
export async function cleanup(admin: SupabaseClient, userIds: string[], groupIds: string[]) {
  if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
}
