/**
 * "Planifier une absence": Emma declared herself available; the owner plans
 * an absence, the app proposes Emma, the owner sends the proposal; Emma
 * accepts (a "Oui", not a garde); the owner confirms the plan.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, gotoStable, signIn } from "./helpers";

/** A date in Paris, `days` from today (YYYY-MM-DD). */
const parisDate = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + days * 86_400_000));

test("plan an absence: proposal sent, accepted, then confirmed", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const emma = await createTestUser(admin, "Emma");
  const groupIds: string[] = [];
  let dogId: string | null = null;
  const ownerCtx = await browser.newContext();
  const emmaCtx = await browser.newContext();
  const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
    if (r.error) throw new Error(`${step}: ${r.error.message}`);
    return r.data;
  };

  try {
    const group = must(await admin.from("groups").insert({ name: "E2E absence", created_by: owner.id }).select("id").single(), "group");
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
    // Emma: available from the evening in 3 days to the evening of the day after (one night)
    const [d1, d2] = [parisDate(3), parisDate(4)];
    must(
      await admin.from("availability_entries").insert([
        { user_id: emma.id, date: d1, slot: "evening", status: "available" },
        { user_id: emma.id, date: d1, slot: "night", status: "available" },
        { user_id: emma.id, date: d2, slot: "morning", status: "available" },
        { user_id: emma.id, date: d2, slot: "afternoon", status: "available" },
      ]),
      "availability",
    );

    // the owner plans the absence: the app proposes Emma for all of it
    const page = await signIn(ownerCtx, admin, owner.email, `/plan?dog=${dogId}&from=${d1}&fromTime=18:00&to=${d2}&toTime=18:00`);
    await page.waitForURL(/\/plan\?/);
    await expect(page.getByRole("heading", { name: "Proposition pour Aston" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Couvre 100 % de l'absence · 1 personne · 0 relais")).toBeVisible();
    await page.getByRole("button", { name: "Envoyer les propositions" }).click();
    await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const requestId = page.url().split("/").at(-1)!;
    const sent = page.getByRole("region", { name: "Propositions envoyées" });
    await expect(sent.getByText("En attente")).toBeVisible({ timeout: 15_000 });

    // Emma gets the proposal instead of the generic notice, and accepts
    const { data: notes } = await admin.from("notifications").select("notification_type").eq("user_id", emma.id).eq("request_id", requestId);
    expect((notes ?? []).map((n) => n.notification_type)).toEqual(["care_proposal"]);
    const emmaPage = await signIn(emmaCtx, admin, emma.email, "/requests");
    await emmaPage.waitForURL(/\/requests$/);
    await expect(emmaPage.getByText("Pouvez-vous garder Aston ?")).toBeVisible({ timeout: 15_000 });
    await emmaPage.getByRole("button", { name: "Accepter" }).click();
    await expect(emmaPage.getByText("C'est noté : le propriétaire va confirmer")).toBeVisible();
    // a "Oui", not a garde
    const { data: none } = await admin.from("care_assignments").select("id").eq("request_id", requestId);
    expect(none).toEqual([]);

    // the owner confirms the plan, with where the dog stays
    await gotoStable(page, `/requests/${requestId}`);
    await expect(sent.getByText("Acceptée")).toBeVisible({ timeout: 15_000 });
    const card = page.getByRole("region", { name: "Proposition de planning" });
    await card.getByRole("button", { name: "Confirmer ce planning" }).click();
    await expect(page.getByText(/Planning confirmé : 1 garde/)).toBeVisible({ timeout: 15_000 });
    const { data: live } = await admin.from("care_assignments").select("assigned_user_id, place").eq("request_id", requestId).neq("status", "cancelled");
    expect(live).toEqual([{ assigned_user_id: emma.id, place: "helper" }]);
  } finally {
    // after a timeout the contexts may already be closed: never skip the cleanup
    await Promise.allSettled([ownerCtx.close(), emmaCtx.close()]);
    await cleanup(admin, [owner.id, emma.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
