/**
 * Planning engine: two partial "Oui" on a shareable garde; the owner sees
 * the proposal, confirms it in one tap, the request is covered and both
 * helpers are told.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

test("planning: two partial offers confirmed in one tap", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const emma = await createTestUser(admin, "Emma");
  const lea = await createTestUser(admin, "Lea");
  const groupIds: string[] = [];
  let dogId: string | null = null;
  const context = await browser.newContext();
  const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
    if (r.error) throw new Error(`${step}: ${r.error.message}`);
    return r.data;
  };

  try {
    const group = must(await admin.from("groups").insert({ name: "E2E planning", created_by: owner.id }).select("id").single(), "group");
    groupIds.push(group!.id);
    must(
      await admin.from("group_members").insert([
        { group_id: group!.id, user_id: owner.id, role: "admin" },
        { group_id: group!.id, user_id: emma.id, role: "member" },
        { group_id: group!.id, user_id: lea.id, role: "member" },
      ]),
      "members",
    );
    const dog = must(await admin.from("dogs").insert({ name: "Aston", created_by: owner.id }).select("id").single(), "dog");
    dogId = dog!.id as string;
    must(await admin.from("dog_caretakers").insert({ dog_id: dogId, user_id: owner.id, role: "owner" }), "caretaker");
    must(await admin.from("group_dogs").insert({ group_id: group!.id, dog_id: dogId }), "group dog");
    // in two days, 57 hours (two nights), shareable; Emma takes the first 30 hours, Léa the rest
    const start = Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 48 * 3_600_000;
    const split = start + 30 * 3_600_000;
    const end = start + 57 * 3_600_000;
    const at = (t: number) => new Date(t).toISOString();
    const request = must(
      await admin
        .from("care_requests")
        .insert({ group_id: group!.id, dog_id: dogId, created_by: owner.id, request_type: "care", necessity: "required", starts_at: at(start), ends_at: at(end), splittable: true })
        .select("id")
        .single(),
      "request",
    );
    const requestId = request!.id as string;
    must(
      await admin.from("request_responses").insert([
        { request_id: requestId, user_id: emma.id, response_status: "yes", proposed_starts_at: at(start), proposed_ends_at: at(split) },
        { request_id: requestId, user_id: lea.id, response_status: "yes", proposed_starts_at: at(split), proposed_ends_at: at(end) },
      ]),
      "responses",
    );

    const page = await signIn(context, admin, owner.email, `/requests/${requestId}`);
    await page.waitForURL(new RegExp(`/requests/${requestId}$`));
    const card = page.getByRole("region", { name: "Proposition de planning" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Couvre 100 % de ce qui reste · 2 gardiens · 1 relais")).toBeVisible();
    await card.getByRole("button", { name: "Confirmer ce planning" }).click();
    await expect(page.getByText(/Planning confirmé : 2 gardes/)).toBeVisible();
    await expect(page.getByText("Couvert").first()).toBeVisible({ timeout: 15_000 });
    // nothing left to plan
    await expect(page.getByRole("region", { name: "Proposition de planning" })).toHaveCount(0);

    const { data: live } = await admin
      .from("care_assignments")
      .select("assigned_user_id")
      .eq("request_id", requestId)
      .neq("status", "cancelled")
      .order("starts_at");
    expect((live ?? []).map((a) => a.assigned_user_id)).toEqual([emma.id, lea.id]);
    const { data: notes } = await admin
      .from("notifications")
      .select("user_id")
      .eq("request_id", requestId)
      .eq("notification_type", "assignment_confirmed");
    expect(new Set((notes ?? []).map((n) => n.user_id))).toEqual(new Set([emma.id, lea.id]));
  } finally {
    // after a timeout the context may already be closed: never skip the cleanup
    await Promise.allSettled([context.close()]);
    await cleanup(admin, [owner.id, emma.id, lea.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
