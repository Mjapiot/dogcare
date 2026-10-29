/**
 * "Mes dispos": a need of the group shows on its day with "Répondre"; the
 * "Le week-end" shortcut then "Dispo" saves Saturday and Sunday.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

test("availability: needs on my days, weekend shortcut", async ({ browser }) => {
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
    const group = must(await admin.from("groups").insert({ name: "E2E dispos", created_by: owner.id }).select("id").single(), "group");
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
    const start = Date.now() + 2 * 86_400_000;
    must(
      await admin.from("care_requests").insert({
        group_id: group!.id,
        dog_id: dogId,
        created_by: owner.id,
        request_type: "visit",
        necessity: "required",
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(start + 3_600_000).toISOString(),
      }),
      "request",
    );

    const page = await signIn(context, admin, emma.email, "/availability");
    await page.waitForURL(/\/availability$/);
    // the need is in this week or the next one
    const badge = page.getByRole("link", { name: /Aston a besoin d'aide/ });
    if (!(await badge.isVisible())) await page.getByRole("button", { name: "Semaine suivante" }).click();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("href", /\/requests\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: "Le week-end" }).click();
    await page.getByRole("button", { name: "Dispo", exact: true }).click();
    await expect(page.getByText(/marqués? disponibles?/)).toBeVisible();
    const { data: entries } = await admin.from("availability_entries").select("date, slot, status").eq("user_id", emma.id);
    expect(entries!.length).toBeGreaterThan(0);
    expect(entries!.length % 4).toBe(0);
    for (const e of entries!) {
      expect(e.status).toBe("available");
      expect([0, 6]).toContain(new Date(`${e.date}T12:00:00Z`).getUTCDay());
    }
  } finally {
    // after a timeout the context may already be closed: never skip the cleanup
    await Promise.allSettled([context.close()]);
    await cleanup(admin, [owner.id, emma.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
