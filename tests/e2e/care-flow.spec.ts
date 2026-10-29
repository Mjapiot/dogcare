/**
 * Critical journey from the product spec (§20):
 * Julie creates a group (onboarding: name, group, dog, habits) → Emma joins → Julie adds Oscar → Emma declares
 * availability → Julie posts a request → Emma says yes → Julie confirms →
 * calendar shows "Couvert" → Emma cancels → need is uncovered again →
 * Chloé offers help → Julie confirms Chloé. Plus: an outsider sees nothing.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, gotoStable, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("full care coordination flow", async ({ browser }) => {
  const admin = adminClient();
  const users = {
    julie: await createTestUser(admin, "Julie"),
    emma: await createTestUser(admin, "Emma"),
    chloe: await createTestUser(admin, "Chloé"),
    max: await createTestUser(admin, "Max"),
  };
  const groupIds: string[] = [];
  const contexts = await Promise.all(Object.keys(users).map(() => browser.newContext()));
  const [julieCtx, emmaCtx, chloeCtx, maxCtx] = contexts;

  try {
    // 1. Julie: onboarding + group
    const julie = await signIn(julieCtx, admin, users.julie.email);
    await julie.waitForURL(/onboarding/);
    if (julie.url().endsWith("/onboarding")) {
      await julie.getByLabel("Prénom ou surnom").fill("Julie");
      await julie.getByRole("button", { name: "Continuer" }).click();
    }
    await julie.getByLabel("Nom du groupe").fill("E2E copains");
    await julie.getByRole("button", { name: "Créer le groupe" }).click();

    // 3. Julie adds Oscar
    await julie.waitForURL(/dogs\/new/);
    await julie.getByLabel("Nom").fill("Oscar");
    await julie.getByRole("button", { name: "Ajouter ce chien" }).click();
    // last onboarding step: weekly habits (optional)
    await julie.waitForURL(/onboarding\/habits/);
    await expect(julie.getByText("Étape 4 sur 4 : Habitudes")).toBeAttached();
    await julie.getByRole("link", { name: "Passer pour l'instant" }).click();
    await julie.waitForURL((url) => url.pathname === "/");
    const { data: groups } = await admin.from("group_members").select("group_id").eq("user_id", users.julie.id);
    groupIds.push(...(groups ?? []).map((g) => g.group_id as string));

    // 2. Invitation link, Emma and Chloé join
    await julie.goto(`/groups/${groupIds[0]}`);
    await julie.getByRole("button", { name: "Créer un lien d'invitation" }).click();
    const link = (await julie.getByText(/\/invite\//).textContent())!.trim();
    const invitePath = new URL(link).pathname;

    for (const [ctx, user, name] of [
      [emmaCtx, users.emma, "Emma"],
      [chloeCtx, users.chloe, "Chloé"],
    ] as const) {
      const page = await signIn(ctx, admin, user.email, invitePath);
      if (page.url().includes("/onboarding")) {
        await page.getByLabel("Prénom ou surnom").fill(name);
        await page.getByRole("button", { name: "Continuer" }).click();
      }
      await page.getByRole("button", { name: "Rejoindre le groupe" }).click();
      await page.waitForURL(/onboarding\/habits/);
      await page.close();
    }

    // 4. Emma declares availability (whole "Après-midi" column)
    const emma = await emmaCtx.newPage();
    await emma.goto("/availability");
    await emma.getByRole("button", { name: "Sélectionner tous les créneaux Après-midi" }).click();
    await emma.getByRole("button", { name: /Dispo/ }).first().click();
    await expect(emma.getByText(/marqués? disponibles?/)).toBeVisible();

    // 5. Julie posts a request for Oscar tomorrow 13:00–17:00
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    await julie.goto(`/requests/new?date=${tomorrow}`);
    await julie.getByRole("button", { name: /Garde partielle/ }).click();
    await julie.getByLabel("Heure").first().fill("13:00");
    await julie.getByLabel("Heure").nth(1).fill("17:00");
    await julie.getByRole("button", { name: "Publier la demande" }).click();
    await julie.waitForURL(/\/requests\/[0-9a-f-]{36}$/);
    const requestUrl = julie.url();
    await expect(julie.getByText("Aides potentielles").first()).toBeVisible();

    // 6. Emma says yes from "Demandes"
    await emma.goto("/requests");
    await emma.getByRole("button", { name: "Oui, je peux" }).first().click();
    await expect(emma.getByText(/Le propriétaire est prévenu/)).toBeVisible();

    // 7. Julie confirms Emma
    await gotoStable(julie, requestUrl);
    await expect(julie.getByText("Volontaire à confirmer").first()).toBeVisible();
    await julie.getByRole("button", { name: "Confirmer", exact: true }).first().click();
    await julie.getByRole("button", { name: /Confirmer Emma/ }).click();

    // 8. Covered
    await expect(julie.getByText("Couvert").first()).toBeVisible();

    // 9. Emma cancels
    await emma.goto(requestUrl);
    await emma.getByRole("button", { name: "Je ne peux plus assurer cette garde" }).click();
    await emma.getByRole("button", { name: "Oui, annuler la garde" }).click();
    await expect(emma.getByText(/le propriétaire est prévenu/)).toBeVisible();

    // 10. Uncovered again, Julie is notified
    await gotoStable(julie, requestUrl);
    await expect(julie.getByText("Couvert", { exact: true })).toHaveCount(0);
    await julie.goto("/notifications");
    await expect(julie.getByText("Emma ne peut plus garder Oscar")).toBeVisible();

    // 11. Chloé offers help, 12. Julie confirms Chloé
    const chloe = await chloeCtx.newPage();
    await chloe.goto(requestUrl);
    await chloe.getByRole("button", { name: "Oui, je peux" }).click();
    await gotoStable(julie, requestUrl);
    await julie.getByRole("button", { name: "Confirmer", exact: true }).first().click();
    await julie.getByRole("button", { name: /Confirmer Chloé/ }).click();
    await expect(julie.getByText("Couvert").first()).toBeVisible();

    // Outsider: no access to the group's request
    const max = await signIn(maxCtx, admin, users.max.email, requestUrl);
    await expect(max).not.toHaveURL(requestUrl);
  } finally {
    // after a timeout the contexts may already be closed: never skip the cleanup
    await Promise.allSettled(contexts.map((ctx) => ctx.close()));
    await cleanup(admin, Object.values(users).map((u) => u.id), groupIds);
  }
});
