/**
 * A pet-sitter in the dog's circle, outside the group: the owner asks her on
 * a request, she answers from "Chiens confiés", the owner confirms her, she
 * sees her garde; removed from the circle, her garde is cancelled.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

test("circle invitee: asked on a request, answers, is confirmed, removal cancels", async ({ browser }) => {
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
    await page.getByLabel("Nom du groupe").fill("E2E cercle demandes");
    await page.getByRole("button", { name: "Créer le groupe" }).click();
    await page.waitForURL(/dogs\/new/);
    await page.getByLabel("Nom").fill("Aston");
    await page.getByRole("button", { name: "Ajouter ce chien" }).click();
    await page.waitForURL(/onboarding\/habits/);
    const { data: groups } = await admin.from("group_members").select("group_id").eq("user_id", owner.id);
    groupIds.push(...(groups ?? []).map((g) => g.group_id as string));
    const { data: dog } = await admin.from("dog_caretakers").select("dog_id").eq("user_id", owner.id).single();
    const dogId = dog!.dog_id as string;

    // invite the pet-sitter as a guest (default: today → in 3 days)
    await page.goto(`/dogs/${dogId}`);
    await page.getByRole("button", { name: "Inviter dans le cercle" }).click();
    await page.getByRole("button", { name: "Créer et partager le lien" }).click();
    const url = await page.locator("p[title*='/circle/join/']").getAttribute("title");
    const sitterPage = await signIn(sitterCtx, admin, sitter.email, new URL(url!).pathname);
    await sitterPage.waitForURL(/\/circle\/join\//);
    await sitterPage.getByRole("button", { name: "Accepter l'invitation" }).click();
    await sitterPage.waitForURL(new RegExp(`/circle/${dogId}$`));

    // the owner asks her on a request for tomorrow ("Demander aussi à", on by default)
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    await page.goto(`/requests/new?date=${tomorrow}`);
    await expect(page.getByText("Demander aussi à")).toBeVisible();
    await expect(page.getByRole("switch", { name: /Lea/ })).toBeChecked();
    await page.getByRole("button", { name: "Publier la demande" }).click();
    await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/);
    const requestUrl = page.url();
    const requestId = requestUrl.split("/").pop()!;
    await expect(page.getByText("Invité", { exact: true })).toBeVisible();

    // she answers from her space, without seeing the group
    await sitterPage.goto("/circle");
    await expect(sitterPage.getByText("Attend votre réponse")).toBeVisible();
    await sitterPage.getByRole("link", { name: /Aston.*Attend votre réponse/ }).click();
    await sitterPage.waitForURL(new RegExp(`/circle/requests/${requestId}$`));
    await sitterPage.getByRole("button", { name: "Oui, je peux" }).click();
    await expect(sitterPage.getByText("Vous avez proposé votre aide")).toBeVisible();
    // the group's request page sends her back to her space
    await sitterPage.goto(`/requests/${requestId}`);
    await expect(sitterPage).not.toHaveURL(new RegExp(`/requests/${requestId}$`));

    // the owner confirms her
    await page.goto(requestUrl);
    await page.getByRole("button", { name: "Confirmer" }).first().click();
    await page.getByRole("button", { name: /Confirmer Lea/ }).click();
    await expect(page.getByText("Couvert").first()).toBeVisible();

    // she sees her garde
    await sitterPage.goto(`/circle/requests/${requestId}`);
    await expect(sitterPage.getByText(/Garde confirmée :/)).toBeVisible();

    // removed from the circle: her garde is cancelled
    await page.goto(`/dogs/${dogId}`);
    await page.getByRole("button", { name: /Lea, Invité/ }).click();
    await page.getByRole("button", { name: "Retirer du cercle" }).click();
    await page.getByRole("button", { name: "Retirer", exact: true }).click();
    await expect(page.getByText("Retiré du cercle")).toBeVisible();
    const { data: live } = await admin
      .from("care_assignments")
      .select("id")
      .eq("request_id", requestId)
      .neq("status", "cancelled");
    expect(live).toEqual([]);
  } finally {
    await ownerCtx.close();
    await sitterCtx.close();
    await cleanup(admin, [owner.id, sitter.id], groupIds);
  }
});
