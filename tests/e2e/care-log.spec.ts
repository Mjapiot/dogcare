/**
 * Care log: during a confirmed garde, the helper notes a meal, a drop-off
 * and a photo; the owner reads the log and is notified of the drop-off;
 * another member of the group sees nothing of it.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

// 2×2 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGM4MS0FiBggFAAy1gcJoK2BeAAAAABJRU5ErkJggg==",
  "base64",
);

test("care log: helper writes during the garde, owner reads, others do not", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const helper = await createTestUser(admin, "Emma");
  const other = await createTestUser(admin, "Chloe");
  const groupIds: string[] = [];
  let dogId: string | null = null;
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);

  try {
    // setup through the admin API: a group, a dog, a garde happening now confirmed for Emma
    const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
      if (r.error) throw new Error(`${step}: ${r.error.message}`);
      return r.data;
    };
    const group = must(await admin.from("groups").insert({ name: "E2E carnet", created_by: owner.id }).select("id").single(), "group");
    const groupId = group!.id as string;
    groupIds.push(groupId);
    must(
      await admin.from("group_members").insert([
        { group_id: groupId, user_id: owner.id, role: "admin" },
        { group_id: groupId, user_id: helper.id, role: "member" },
        { group_id: groupId, user_id: other.id, role: "member" },
      ]),
      "members",
    );
    const dog = must(await admin.from("dogs").insert({ name: "Aston", created_by: owner.id, meals: "Croquettes à 19h" }).select("id").single(), "dog");
    dogId = dog!.id as string;
    must(await admin.from("dog_caretakers").insert({ dog_id: dogId, user_id: owner.id, role: "owner" }), "caretaker");
    must(await admin.from("group_dogs").insert({ group_id: groupId, dog_id: dogId }), "group dog");
    const startsAt = new Date(Date.now() - 3_600_000).toISOString();
    const endsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const { data: request, error: requestError } = await admin
      .from("care_requests")
      .insert({ group_id: groupId, dog_id: dogId, created_by: owner.id, request_type: "care", necessity: "required", starts_at: startsAt, ends_at: endsAt })
      .select("id")
      .single();
    if (requestError) throw requestError;
    const requestId = request!.id as string;
    must(await admin.from("request_responses").insert({ request_id: requestId, user_id: helper.id, response_status: "yes" }), "response");
    const { error: assignmentError } = await admin
      .from("care_assignments")
      .insert({ request_id: requestId, assigned_user_id: helper.id, starts_at: startsAt, ends_at: endsAt, confirmed_by: owner.id });
    if (assignmentError) throw assignmentError;

    // Emma notes a meal, a drop-off and a photo with a word
    const emma = await signIn(contexts[0], admin, helper.email, `/requests/${requestId}`);
    await emma.waitForURL(new RegExp(`/requests/${requestId}$`));
    await expect(emma.getByRole("heading", { name: "Carnet de garde" })).toBeVisible();
    await expect(emma.getByText("Croquettes à 19h")).toBeVisible();
    // each entry refreshes the page: slower when several tests run against production
    const buttons = emma.getByRole("group", { name: "Noter pour Aston" });
    await buttons.getByRole("button", { name: "Repas" }).click();
    await expect(emma.getByText(/· Repas/)).toBeVisible({ timeout: 15_000 });
    await buttons.getByRole("button", { name: "Déposé" }).click();
    await expect(emma.getByText(/· Déposé/)).toBeVisible({ timeout: 15_000 });
    await emma.getByLabel("Choisir une photo").first().setInputFiles({ name: "aston.png", mimeType: "image/png", buffer: PNG });
    await emma.getByLabel("Un mot (facultatif)").fill("Sieste au soleil");
    await emma.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(emma.getByText("Sieste au soleil")).toBeVisible({ timeout: 15_000 });

    // Julie reads the log, with the photo, and was told about the drop-off
    const julie = await signIn(contexts[1], admin, owner.email, `/requests/${requestId}`);
    await julie.waitForURL(new RegExp(`/requests/${requestId}$`));
    await expect(julie.getByText("Sieste au soleil")).toBeVisible();
    await expect(julie.getByRole("img", { name: /Photo du/ })).toBeVisible();
    await expect(julie.getByText(/· Repas/)).toBeVisible();
    await julie.goto("/");
    await expect(julie.getByText(/Aston chez Emma/)).toBeVisible();
    await julie.goto("/notifications");
    await expect(julie.getByText("Emma a pris en charge Aston")).toBeVisible();
    await expect(julie.getByText("Nouvelle photo d'Aston")).toBeVisible();

    // Chloé, in the group, sees the request but not its log
    const chloe = await signIn(contexts[2], admin, other.email, `/requests/${requestId}`);
    await chloe.waitForURL(new RegExp(`/requests/${requestId}$`));
    await expect(chloe.getByText("Emma").first()).toBeVisible();
    await expect(chloe.getByRole("heading", { name: "Carnet de garde" })).toHaveCount(0);
    await expect(chloe.getByText("Sieste au soleil")).toHaveCount(0);
  } finally {
    // after a timeout the contexts may already be closed: never skip the cleanup
    await Promise.allSettled(contexts.map((ctx) => ctx.close()));
    if (dogId) {
      const { data: photos } = await admin.from("care_log_entries").select("photo_path").eq("dog_id", dogId).not("photo_path", "is", null);
      const paths = (photos ?? []).map((p) => p.photo_path as string);
      if (paths.length) await admin.storage.from("care-logs").remove(paths);
    }
    await cleanup(admin, [owner.id, helper.id, other.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
