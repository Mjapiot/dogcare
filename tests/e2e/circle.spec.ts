/**
 * Circle of trust: the owner invites a pet-sitter as a guest without health;
 * the pet-sitter (no group) accepts, sees the passport and emergency but not
 * health nor any group; the owner removes them and access stops.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, gotoStable, signIn } from "./helpers";

test("circle: invite a guest, guest sees the passport only, removal", async ({ browser }) => {
  // two sign-ups against a deployed app: slower than the default budget
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const sitter = await createTestUser(admin, "Lea");
  const groupIds: string[] = [];
  const ownerCtx = await browser.newContext();
  // no share sheet in tests: the app falls back to showing the link
  await ownerCtx.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined }));
  const sitterCtx = await browser.newContext();

  try {
    const page = await signIn(ownerCtx, admin, owner.email);
    await page.waitForURL(/onboarding/);
    if (page.url().endsWith("/onboarding")) {
      await page.getByLabel("Prénom ou surnom").fill("Julie");
      await page.getByRole("button", { name: "Continuer" }).click();
    }
    await page.getByLabel("Nom du groupe").fill("E2E cercle");
    await page.getByRole("button", { name: "Créer le groupe" }).click();
    await page.waitForURL(/dogs\/new/);
    await page.getByLabel("Nom").fill("Aston");
    await page.getByRole("button", { name: "Ajouter ce chien" }).click();
    await page.waitForURL(/onboarding\/habits/);
    const { data: groups } = await admin.from("group_members").select("group_id").eq("user_id", owner.id);
    groupIds.push(...(groups ?? []).map((g) => g.group_id as string));
    const { data: dog } = await admin.from("dog_caretakers").select("dog_id").eq("user_id", owner.id).single();
    const dogId = dog!.dog_id as string;

    await page.goto(`/dogs/${dogId}`);
    await page.getByRole("button", { name: "Modifier : Santé" }).click();
    await page.getByLabel("Allergies").fill("Poulet");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("button", { name: "Modifier : Santé" })).toBeVisible();
    await page.getByRole("button", { name: "Modifier : Urgences" }).click();
    await page.getByLabel("Consignes en cas d'urgence").fill("Appeler le véto");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("button", { name: "Modifier : Urgences" })).toBeVisible();

    // invite a guest, without health
    await page.getByRole("button", { name: "Inviter dans le cercle" }).click();
    await page.getByLabel("Voir la santé").click();
    await page.getByRole("button", { name: "Créer et partager le lien" }).click();
    const url = await page.locator("p[title*='/circle/join/']").getAttribute("title");
    expect(url).toMatch(/\/circle\/join\/[A-Za-z0-9_-]{43}$/);

    // the pet-sitter signs up through the link
    // (test users already have a first name, so no name step; and never the group steps)
    const sitterPage = await signIn(sitterCtx, admin, sitter.email, new URL(url!).pathname);
    await sitterPage.waitForURL(/\/circle\/join\//);
    await expect(sitterPage.getByRole("heading", { name: "d'Aston" })).toBeVisible();
    await sitterPage.getByRole("button", { name: "Accepter l'invitation" }).click();
    await sitterPage.waitForURL(new RegExp(`/circle/${dogId}$`));
    await expect(sitterPage.getByRole("heading", { name: "Aston" })).toBeVisible();
    await expect(sitterPage.getByText("Appeler le véto")).toBeVisible();
    await expect(sitterPage.getByText("Poulet")).toHaveCount(0);
    // no group: the app home leads to the circle page
    await sitterPage.goto("/");
    await sitterPage.waitForURL(/\/circle$/);
    await expect(sitterPage.getByRole("link", { name: /Aston/ })).toBeVisible();

    // the owner was told she joined, sees her and removes her
    await gotoStable(page, "/notifications");
    await expect(page.getByText("Lea a rejoint le cercle d'Aston")).toBeVisible();
    await gotoStable(page, `/dogs/${dogId}`);
    await page.getByRole("button", { name: /Lea, Invité/ }).click();
    await page.getByRole("button", { name: "Retirer du cercle" }).click();
    await page.getByRole("button", { name: "Retirer", exact: true }).click();
    await expect(page.getByText("Retiré du cercle")).toBeVisible();
    await sitterPage.goto(`/circle/${dogId}`);
    await expect(sitterPage.getByRole("heading", { name: "Aston" })).toHaveCount(0);
  } finally {
    // after a timeout the contexts may already be closed: never skip the cleanup
    await Promise.allSettled([ownerCtx.close(), sitterCtx.close()]);
    await cleanup(admin, [owner.id, sitter.id], groupIds);
  }
});
