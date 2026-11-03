/**
 * Passport first: a new user without a group creates their dog's passport,
 * fills in its health, shares it by link, finds it in "Mes chiens", then
 * creates a group and shares the dog with it.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, gotoStable, openTile, signIn } from "./helpers";

test("passport without a group, then shared with a new group", async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const groupIds: string[] = [];
  let dogId: string | null = null;
  const context = await browser.newContext();
  // no share sheet in tests: the app falls back to showing the link
  await context.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined }));

  try {
    const page = await signIn(context, admin, owner.email);
    await page.waitForURL(/onboarding/);
    if (page.url().endsWith("/onboarding")) {
      await page.getByLabel("Prénom ou surnom").fill("Julie");
      await page.getByRole("button", { name: "Continuer" }).click();
    }
    // passport first
    await page.getByRole("link", { name: "Créer son passeport" }).click();
    await page.waitForURL(/\/circle\/dogs\/new$/);
    await page.getByLabel("Nom").fill("Aston");
    await page.getByRole("button", { name: "Ajouter ce chien" }).click();
    await page.waitForURL(/\/circle\/dogs\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    dogId = page.url().split("/").at(-1)!;

    await openTile(page, "Santé");
    await page.getByRole("button", { name: "Modifier : Santé" }).click();
    await page.getByLabel("Allergies").fill("Poulet");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Poulet")).toBeVisible({ timeout: 15_000 });
    await openTile(page, "Réglages");
    await page.getByRole("button", { name: "Créer un lien" }).click();
    await page.getByRole("button", { name: "Créer et partager" }).click();
    await expect(page.getByRole("dialog").getByText(/\/p\//)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Terminé" }).click();
    // no planning without a group, but a way to start one
    await expect(page.getByRole("link", { name: /Planifier une absence/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Organiser des gardes entre amis/ })).toBeVisible();

    // "Mes chiens" is home
    await gotoStable(page, "/");
    await page.waitForURL(/\/circle$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Mes chiens", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Aston/ })).toBeVisible();

    // later: a group, and the dog is offered to it
    await gotoStable(page, "/onboarding/group");
    await page.getByLabel("Nom du groupe").fill("E2E solo");
    await page.getByRole("button", { name: "Créer le groupe" }).click();
    await page.waitForURL(/\/onboarding\/share-dogs/, { timeout: 15_000 });
    const { data: groups } = await admin.from("group_members").select("group_id").eq("user_id", owner.id);
    groupIds.push(...(groups ?? []).map((g) => g.group_id as string));
    await expect(page.getByRole("switch", { name: "Aston" })).toBeChecked();
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.waitForURL(/\/onboarding\/habits/, { timeout: 15_000 });
    const { data: shared } = await admin.from("group_dogs").select("group_id").eq("dog_id", dogId);
    expect((shared ?? []).map((s) => s.group_id)).toEqual(groupIds);
  } finally {
    // after a timeout the context may already be closed: never skip the cleanup
    await Promise.allSettled([context.close()]);
    await cleanup(admin, [owner.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
