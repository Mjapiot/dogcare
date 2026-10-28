/**
 * "Demandes" screen: a member of another group, also in a dog's circle, sees
 * that dog's request among hers (badge "Cercle d'Aston"), answers it in one
 * tap, and it moves to "Déjà répondu".
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

test("requests screen: a circle request answered from Demandes", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const friend = await createTestUser(admin, "Lea");
  const groupIds: string[] = [];
  let dogId: string | null = null;
  const context = await browser.newContext();
  const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
    if (r.error) throw new Error(`${step}: ${r.error.message}`);
    return r.data;
  };

  try {
    // Julie's group and dog; Léa has her own group and is a close person of Aston
    const julieGroup = must(await admin.from("groups").insert({ name: "E2E demandes", created_by: owner.id }).select("id").single(), "group");
    const leaGroup = must(await admin.from("groups").insert({ name: "E2E demandes Lea", created_by: friend.id }).select("id").single(), "group");
    groupIds.push(julieGroup!.id, leaGroup!.id);
    must(
      await admin.from("group_members").insert([
        { group_id: julieGroup!.id, user_id: owner.id, role: "admin" },
        { group_id: leaGroup!.id, user_id: friend.id, role: "admin" },
      ]),
      "members",
    );
    const dog = must(await admin.from("dogs").insert({ name: "Aston", created_by: owner.id }).select("id").single(), "dog");
    dogId = dog!.id as string;
    must(await admin.from("dog_caretakers").insert({ dog_id: dogId, user_id: owner.id, role: "owner" }), "caretaker");
    must(await admin.from("group_dogs").insert({ group_id: julieGroup!.id, dog_id: dogId }), "group dog");
    must(
      await admin.from("dog_circle").insert({ dog_id: dogId, user_id: friend.id, role: "close", health_access: "always", emergency_access: "always" }),
      "circle",
    );
    const start = Date.now() + 2 * 86_400_000;
    const request = must(
      await admin
        .from("care_requests")
        .insert({
          group_id: julieGroup!.id,
          dog_id: dogId,
          created_by: owner.id,
          request_type: "visit",
          necessity: "required",
          starts_at: new Date(start).toISOString(),
          ends_at: new Date(start + 3_600_000).toISOString(),
        })
        .select("id")
        .single(),
      "request",
    );
    must(await admin.from("care_request_invitees").insert({ request_id: request!.id, user_id: friend.id, invited_by: owner.id }), "invitee");

    const page = await signIn(context, admin, friend.email, "/requests");
    await page.waitForURL(/\/requests$/);
    const card = page.getByRole("article").filter({ hasText: "Cercle d'Aston" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Oui, je peux" }).click();
    await expect(page.getByText("Déjà répondu (1)")).toBeVisible();
    await expect(page.getByText("Vous êtes à jour")).toBeVisible();
    const { data: answers } = await admin.from("request_responses").select("response_status").eq("request_id", request!.id).eq("user_id", friend.id);
    expect(answers).toEqual([{ response_status: "yes" }]);
  } finally {
    // after a timeout the context may already be closed: never skip the cleanup
    await Promise.allSettled([context.close()]);
    await cleanup(admin, [owner.id, friend.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
