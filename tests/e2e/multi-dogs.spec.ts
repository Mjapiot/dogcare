/**
 * Several dogs: the owner plans one absence for Aston and Nala; the app
 * proposes Emma for both together; Emma gets one notice and answers once;
 * both requests have her "Oui".
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

/** A date in Paris, `days` from today (YYYY-MM-DD). */
const parisDate = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + days * 86_400_000));

test("an absence of two dogs: kept together, one notice, one answer", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const emma = await createTestUser(admin, "Emma");
  const groupIds: string[] = [];
  const ownerCtx = await browser.newContext();
  const emmaCtx = await browser.newContext();
  const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
    if (r.error) throw new Error(`${step}: ${r.error.message}`);
    return r.data;
  };

  try {
    const group = must(await admin.from("groups").insert({ name: "E2E deux chiens", created_by: owner.id }).select("id").single(), "group");
    groupIds.push(group!.id);
    must(
      await admin.from("group_members").insert([
        { group_id: group!.id, user_id: owner.id, role: "admin" },
        { group_id: group!.id, user_id: emma.id, role: "member" },
      ]),
      "members",
    );
    const dogIds: string[] = [];
    for (const name of ["Aston", "Nala"]) {
      const dog = must(await admin.from("dogs").insert({ name, created_by: owner.id }).select("id").single(), "dog");
      dogIds.push(dog!.id as string);
      must(await admin.from("dog_caretakers").insert({ dog_id: dog!.id, user_id: owner.id, role: "owner" }), "caretaker");
      must(await admin.from("group_dogs").insert({ group_id: group!.id, dog_id: dog!.id }), "group dog");
    }
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

    // the owner plans the absence for both dogs: Emma keeps them together
    const page = await signIn(ownerCtx, admin, owner.email, `/plan?dog=${dogIds.join(",")}&from=${d1}&fromTime=18:00&to=${d2}&toTime=18:00`);
    await page.waitForURL(/\/plan\?/);
    await expect(page.getByRole("heading", { name: "On vous propose" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^Pour Aston et Nala · /)).toBeVisible();
    await expect(page.getByText("1 personne · 0 relais · gardés ensemble")).toBeVisible();
    await expect(page.getByText(/· Aston et Nala/)).toBeVisible();
    await page.getByRole("button", { name: "Envoyer les propositions" }).click();
    await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    // the other dog's request is linked
    await expect(page.getByRole("region", { name: "Même absence" }).getByRole("link")).toHaveCount(1, { timeout: 15_000 });

    const { data: requests } = await admin.from("care_requests").select("id, absence_id").in("dog_id", dogIds);
    expect(requests).toHaveLength(2);
    expect(requests![0].absence_id).toBeTruthy();
    expect(requests![0].absence_id).toBe(requests![1].absence_id);
    const requestIds = requests!.map((r) => r.id as string);

    // one notice for Emma, one card, one answer
    const { data: notes } = await admin.from("notifications").select("title").eq("user_id", emma.id).in("request_id", requestIds);
    expect(notes).toEqual([{ title: "Pouvez-vous garder Aston et Nala ?" }]);
    const emmaPage = await signIn(emmaCtx, admin, emma.email, "/requests");
    await emmaPage.waitForURL(/\/requests$/);
    await expect(emmaPage.getByText("Pouvez-vous garder Aston et Nala ?")).toBeVisible({ timeout: 15_000 });
    await expect(emmaPage.getByRole("button", { name: "Accepter" })).toHaveCount(1);
    await emmaPage.getByRole("button", { name: "Accepter" }).click();
    await expect(emmaPage.getByText("C'est noté : le propriétaire va confirmer")).toBeVisible();
    await expect
      .poll(async () => (await admin.from("care_proposals").select("status").eq("user_id", emma.id).in("request_id", requestIds)).data?.map((p) => p.status), {
        timeout: 15_000,
      })
      .toEqual(["accepted", "accepted"]);
  } finally {
    // after a timeout the contexts may already be closed: never skip the cleanup
    await Promise.allSettled([ownerCtx.close(), emmaCtx.close()]);
    await cleanup(admin, [owner.id, emma.id], groupIds);
  }
});
