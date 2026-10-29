/**
 * Profile: "Cette année" counts a garde I gave; the Notifications page opens
 * from the settings and turning off "Rappels de la veille" is saved.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

test("profile: this year's summary, notification settings page", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const emma = await createTestUser(admin, "Emma");
  const groupIds: string[] = [];
  let dogId: string | null = null;
  const context = await browser.newContext();
  const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
    if (r.error) throw new Error(`${step}: ${r.error.message}`);
    return r.data;
  };

  try {
    const group = must(await admin.from("groups").insert({ name: "E2E profil", created_by: owner.id }).select("id").single(), "group");
    groupIds.push(group!.id);
    must(
      await admin.from("group_members").insert([
        { group_id: group!.id, user_id: owner.id, role: "admin" },
        { group_id: group!.id, user_id: emma.id, role: "member" },
      ]),
      "members",
    );
    const dog = must(await admin.from("dogs").insert({ name: "Aston", created_by: owner.id }).select("id").single(), "dog");
    dogId = dog!.id as string;
    must(await admin.from("dog_caretakers").insert({ dog_id: dogId, user_id: owner.id, role: "owner" }), "caretaker");
    must(await admin.from("group_dogs").insert({ group_id: group!.id, dog_id: dogId }), "group dog");
    // a request (still ahead, as the database requires) with a garde of Emma that is already over
    const request = must(
      await admin
        .from("care_requests")
        .insert({
          group_id: group!.id,
          dog_id: dogId,
          created_by: owner.id,
          request_type: "visit",
          necessity: "required",
          starts_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          ends_at: new Date(Date.now() + 3_600_000).toISOString(),
        })
        .select("id")
        .single(),
      "request",
    );
    must(
      await admin.from("care_assignments").insert({
        request_id: request!.id,
        assigned_user_id: emma.id,
        starts_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        ends_at: new Date(Date.now() - 3_600_000).toISOString(),
        confirmed_by: owner.id,
      }),
      "assignment",
    );

    const page = await signIn(context, admin, emma.email, "/profile");
    await page.waitForURL(/\/profile$/);
    await expect(page.getByText("Cette année : 1 garde assurée")).toBeVisible();

    // the header bell is also called "Notifications": target the settings row
    await page.locator('a[href="/profile/notifications"]').click();
    await page.waitForURL(/\/profile\/notifications$/);
    const reminders = page.getByRole("switch", { name: /Rappels de la veille/ });
    await expect(reminders).toBeChecked();
    await reminders.click();
    await expect(reminders).not.toBeChecked();
    await expect
      .poll(async () => (await admin.from("notification_preferences").select("reminders_enabled").eq("user_id", emma.id).maybeSingle()).data?.reminders_enabled)
      .toBe(false);

    await page.getByRole("main").getByRole("link", { name: "Profil", exact: true }).click();
    await page.waitForURL(/\/profile$/);
  } finally {
    // after a timeout the context may already be closed: never skip the cleanup
    await Promise.allSettled([context.close()]);
    await cleanup(admin, [owner.id, emma.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
