/**
 * Agenda, "Besoins": a 3-day need shows once, as a card on its first day, with
 * who declared themselves available that day; the next month has its own list.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, signIn } from "./helpers";

test("agenda: one card per need, available members, month switch", async ({ browser }) => {
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
    // from the day after tomorrow, 3 days; Emma is free the morning of its first day
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
    const freeDay = parisDate(start);
    must(await admin.from("availability_entries").insert({ user_id: emma.id, date: freeDay, slot: "morning", status: "available" }), "availability");

    const page = await signIn(context, admin, owner.email, `/calendar?start=${freeDay}`);
    await page.waitForURL(/\/calendar/);
    // one card for the whole need, on its first day, with who is available that day
    const card = page.getByRole("link", { name: /Aston/ });
    await expect(card).toHaveCount(1, { timeout: 15_000 });
    await expect(card).toContainText("Dispo ce jour : Emma");
    await expect(card).toHaveAttribute("href", /\/requests\/[0-9a-f-]{36}$/);

    // the month after: the need is not there (unless it runs into it)
    await page.getByRole("link", { name: /Mois suivant/ }).click();
    await page.waitForURL(/start=\d{4}-\d{2}-01/);
    const runsInto = parisDate(end - 1).slice(0, 7) !== freeDay.slice(0, 7);
    await expect(page.getByRole("link", { name: /Aston/ })).toHaveCount(runsInto ? 1 : 0);
  } finally {
    // after a timeout the context may already be closed: never skip the cleanup
    await Promise.allSettled([context.close()]);
    await cleanup(admin, [owner.id, emma.id], groupIds);
    if (dogId) await admin.from("dogs").delete().eq("id", dogId);
  }
});
