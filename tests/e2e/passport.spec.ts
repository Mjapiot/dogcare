/**
 * Dog passport: the owner fills in health and emergency, shares a temporary
 * link including them, a visitor without an account reads it, then the owner
 * revokes it and the link stops working.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

test("passport: fill in, share without an account, revoke", async ({ browser }) => {
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const groupIds: string[] = [];
  const ownerCtx = await browser.newContext();
  // no share sheet in tests: the app falls back to showing the link
  await ownerCtx.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined }));
  const visitorCtx = await browser.newContext();

  try {
    const page = await signIn(ownerCtx, admin, owner.email);
    await page.waitForURL(/onboarding/);
    if (page.url().endsWith("/onboarding")) {
      await page.getByLabel("Prénom ou surnom").fill("Julie");
      await page.getByRole("button", { name: "Continuer" }).click();
    }
    await page.getByLabel("Nom du groupe").fill("E2E passeport");
    await page.getByRole("button", { name: "Créer le groupe" }).click();
    await page.waitForURL(/dogs\/new/);
    await page.getByLabel("Nom").fill("Aston");
    await page.getByRole("button", { name: "Ajouter ce chien" }).click();
    await page.waitForURL(/onboarding\/habits/);
    const { data: groups } = await admin.from("group_members").select("group_id").eq("user_id", owner.id);
    groupIds.push(...(groups ?? []).map((g) => g.group_id as string));
    const { data: dog } = await admin.from("dog_caretakers").select("dog_id").eq("user_id", owner.id).single();
    const dogId = dog!.dog_id as string;

    // health and emergency sections
    await page.goto(`/dogs/${dogId}`);
    await page.getByRole("button", { name: "Modifier : Santé" }).click();
    await page.getByLabel("Allergies").fill("Poulet");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("button", { name: "Modifier : Santé" })).toBeVisible();
    await expect(page.getByText("Poulet")).toBeVisible();
    await page.getByRole("button", { name: "Modifier : Urgences" }).click();
    await page.getByLabel("Nom", { exact: true }).fill("Samantha");
    await page.getByLabel("Téléphone", { exact: true }).fill("06 12 34 56 78");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("link", { name: "Appeler Samantha" })).toBeVisible();

    // share with health included
    await page.getByRole("button", { name: "Créer un lien" }).click();
    await page.getByLabel("Inclure : Santé").click();
    await page.getByRole("button", { name: "Créer et partager" }).click();
    const url = await page.locator("p[title*='/p/']").getAttribute("title");
    expect(url).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);
    const path = new URL(url!).pathname;

    // a visitor without an account reads it
    const visitor = await visitorCtx.newPage();
    await visitor.goto(path);
    await expect(visitor.getByRole("heading", { name: "Aston" })).toBeVisible();
    await expect(visitor.getByText("Poulet")).toBeVisible();
    await expect(visitor.getByRole("link", { name: "Appeler Samantha" })).toBeVisible();
    await expect(visitor.getByText("Créé avec Dogcare")).toBeVisible();

    // revoke: the link stops working
    await page.getByRole("button", { name: "Terminé" }).click();
    await page.reload();
    await expect(page.getByText("1 ouverture")).toBeVisible();
    await page.getByRole("button", { name: "Révoquer" }).click();
    await page.getByRole("button", { name: "Révoquer" }).last().click();
    await expect(page.getByText("Lien révoqué")).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByText("Ce lien n'est plus valide")).toBeVisible();
  } finally {
    // after a timeout the contexts may already be closed: never skip the cleanup
    await Promise.allSettled([ownerCtx.close(), visitorCtx.close()]);
    await cleanup(admin, [owner.id], groupIds);
  }
});
