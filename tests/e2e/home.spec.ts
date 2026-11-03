/**
 * Home, "À faire maintenant": Emma answers Aston's need from her home in one
 * tap; Julie then sees "Emma peut garder Aston" to confirm. A garde happening
 * now shows on both homes with its nights. The floating navigation leads to
 * the Agenda and the Chiens tab.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, gotoStable, signIn } from "./helpers";

const SHOTS = process.env.E2E_SCREENSHOTS;

test("home: answer from a card, then the owner confirms; gardes in progress", async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const emma = await createTestUser(admin, "Emma");
  const groupIds: string[] = [];
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
    if (r.error) throw new Error(`${step}: ${r.error.message}`);
    return r.data;
  };

  try {
    const group = must(await admin.from("groups").insert({ name: "E2E accueil", created_by: owner.id }).select("id").single(), "group");
    groupIds.push(group!.id);
    must(
      await admin.from("group_members").insert([
        { group_id: group!.id, user_id: owner.id, role: "admin" },
        { group_id: group!.id, user_id: emma.id, role: "member" },
      ]),
      "members",
    );
    const dogIds: Record<string, string> = {};
    for (const name of ["Aston", "Nala"]) {
      const dog = must(await admin.from("dogs").insert({ name, created_by: owner.id }).select("id").single(), "dog");
      dogIds[name] = dog!.id as string;
      must(await admin.from("dog_caretakers").insert({ dog_id: dog!.id, user_id: owner.id, role: "owner" }), "caretaker");
      must(await admin.from("group_dogs").insert({ group_id: group!.id, dog_id: dog!.id }), "group dog");
    }
    // one reference instant: the garde must cover the request to the millisecond
    const t0 = Date.now();
    const h = (hours: number) => new Date(t0 + hours * 3_600_000).toISOString();
    // Aston: a need in two days, nobody asked yet
    must(
      await admin
        .from("care_requests")
        .insert({ group_id: group!.id, dog_id: dogIds.Aston, created_by: owner.id, request_type: "care", necessity: "required", starts_at: h(48), ends_at: h(72) }),
      "aston request",
    );
    // Nala: kept by Emma right now, for two days
    const nala = must(
      await admin
        .from("care_requests")
        .insert({ group_id: group!.id, dog_id: dogIds.Nala, created_by: owner.id, request_type: "care", necessity: "required", starts_at: h(-20), ends_at: h(28) })
        .select("id")
        .single(),
      "nala request",
    );
    must(await admin.from("request_responses").insert({ request_id: nala!.id, user_id: emma.id, response_status: "yes" }), "nala yes");
    must(
      await admin.from("care_assignments").insert({ request_id: nala!.id, assigned_user_id: emma.id, starts_at: h(-20), ends_at: h(28), confirmed_by: owner.id }),
      "nala garde",
    );

    // Emma: Aston to answer, Nala kept by her now
    const emmaPage = await signIn(contexts[1], admin, emma.email, "/");
    await emmaPage.waitForURL((u) => u.pathname === "/");
    const ask = emmaPage.getByRole("article").filter({ hasText: "Aston a besoin d'aide" });
    await expect(ask).toBeVisible({ timeout: 15_000 });
    await expect(emmaPage.getByText("Vous gardez Nala")).toBeVisible();
    if (SHOTS) await emmaPage.waitForTimeout(1500).then(() => emmaPage.screenshot({ path: `${SHOTS}/home-emma.png`, fullPage: true }));
    await ask.getByRole("button", { name: "Oui, je peux" }).click();
    await expect(emmaPage.getByText(/Le propriétaire est prévenu/)).toBeVisible({ timeout: 15_000 });

    // Julie: Emma's "Oui" to confirm, and Nala with Emma
    const julie = await signIn(contexts[0], admin, owner.email, "/");
    await julie.waitForURL((u) => u.pathname === "/");
    const toConfirm = julie.getByRole("article").filter({ hasText: /peut garder Aston/ });
    await expect(toConfirm).toBeVisible({ timeout: 15_000 });
    await expect(julie.getByText(/Nala chez Emma/)).toBeVisible();
    if (SHOTS) await julie.waitForTimeout(1500).then(() => julie.screenshot({ path: `${SHOTS}/home-julie.png`, fullPage: true }));
    await toConfirm.getByRole("link", { name: /Voir et confirmer/ }).click();
    await expect(julie).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);

    // the floating navigation
    const nav = julie.getByRole("navigation", { name: "Navigation principale" });
    await gotoStable(julie, "/");
    await nav.getByRole("link", { name: "Chiens" }).click();
    await expect(julie.getByRole("link", { name: /Aston/ }).first()).toBeVisible({ timeout: 15_000 });
    if (SHOTS) await julie.waitForTimeout(1500).then(() => julie.screenshot({ path: `${SHOTS}/dogs.png`, fullPage: true }));
    await nav.getByRole("link", { name: "Agenda" }).click();
    await expect(julie.getByRole("navigation", { name: "Agenda" }).getByRole("link", { name: "Besoins" })).toHaveAttribute("aria-current", "page", {
      timeout: 15_000,
    });
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
    await cleanup(admin, [owner.id, emma.id], groupIds);
  }
});
