/**
 * Calendar: a 3-day need shows once in the agenda and as a bar in the month;
 * the day sheet lists who declared themselves available.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

test("calendar: one card per need, month bars, available members", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const emma = await createTestUser(admin, "Emma");
  const groupIds: string[] = [];
  let dogId: string | null = null;
  const context = await browser.newContext();
  const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
    if (r.error) throw new Error(`${step}: ${r.error.message}`);
    return r.data;
  };
  const parisDate = (t: number) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

  try {
    const group = must(await admin.from("groups").insert({ name: "E2E calendrier", created_by: owner.id }).select("id").single(), "group");
    groupIds.push(group!.id);
    must(
      await admin.from("group_members").insert([
        { group_id: group!.id, user_id: owner.id, role: "admin" },
        { group_id: group!.id, user_id: emma.id, role: "member" },
      ]),
      "members",
    );
    const dog = must(await admin.from("dogs").insert({ name: "Aston", created_by: owner.id }).select("id").single(), "dog");
    dogId = dog!.id as string;
    must(await admin.from("dog_caretakers").insert({ dog_id: dogId, user_id: owner.id, role: "owner" }), "caretaker");
    must(await admin.from("group_dogs").insert({ group_id: group!.id, dog_id: dogId }), "group dog");
    // from the day after tomorrow, 3 days; Emma is free the morning of its second day
    const start = Date.now() + 2 * 86_400_000;
    const end = start + 3 * 86_400_000;
    must(
      await admin.from("care_requests").insert({
        group_id: group!.id,
        dog_id: dogId,
        created_by: owner.id,
        request_type: "care",
        necessity: "required",
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(end).toISOString(),
      }),
      "request",
    );
    const freeDay = parisDate(start + 86_400_000);
    must(await admin.from("availability_entries").insert({ user_id: emma.id, date: freeDay, slot: "morning", status: "available" }), "availability");

    const page = await signIn(context, admin, owner.email, "/calendar");
    await page.waitForURL(/\/calendar$/);
    // agenda: one card for the whole need, the next days say it goes on
    await expect(page.getByRole("link", { name: /Aston · Garde/ })).toHaveCount(1);
    await expect(page.getByText(/en cours : Aston/).first()).toBeVisible();

    // the day sheet lists Emma as available that morning
    const [y, m, d] = freeDay.split("-").map(Number);
    const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
    await page.getByRole("button", { name: new RegExp(label.replace(".", "\\.")) }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Disponibles ce jour")).toBeVisible();
    await expect(sheet.getByText("Emma")).toBeVisible();
    await page.keyboard.press("Escape");

    // month: the need is a bar; tapping one of its days opens it
    await page.getByRole("radio", { name: "Mois" }).click();
    await page.waitForURL(/view=month/);
    const dayCell = page.getByRole("gridcell", { name: /1 besoin/ }).first();
    await expect(dayCell).toBeVisible();
    await dayCell.click();
    await expect(page.getByRole("dialog").getByRole("link", { name: /Aston · Garde/ })).toBeVisible();
  } finally {
    // after a timeout the context may already be closed: never skip the cleanup
    await Promise.allSettled([context.close()]);
    await cleanup(admin, [owner.id, emma.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
