/**
 * Routines: the owner turns them on and adds "Médicament" at the current
 * hour; during the garde Emma checks it off from the care log; the owner
 * sees it done, by Emma.
 */
import { expect, test } from "@playwright/test";
import { adminClient, cleanup, createTestUser, gotoStable, signIn } from "./helpers";

/** The current hour in Paris, "HH:00" (inside the garde, today). */
const parisHour = () =>
  `${new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(new Date())}:00`;

test("routines: added by the owner, checked off by the helper, seen by the owner", async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = await createTestUser(admin, "Julie");
  const helper = await createTestUser(admin, "Emma");
  const groupIds: string[] = [];
  let dogId: string | null = null;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const must = <T>(r: { data: T; error: { message: string } | null }, step: string): T => {
    if (r.error) throw new Error(`${step}: ${r.error.message}`);
    return r.data;
  };

  try {
    // a garde happening now, confirmed for Emma
    const group = must(await admin.from("groups").insert({ name: "E2E routines", created_by: owner.id }).select("id").single(), "group");
    groupIds.push(group!.id as string);
    must(
      await admin.from("group_members").insert([
        { group_id: group!.id, user_id: owner.id, role: "admin" },
        { group_id: group!.id, user_id: helper.id, role: "member" },
      ]),
      "members",
    );
    const dog = must(await admin.from("dogs").insert({ name: "Aston", created_by: owner.id }).select("id").single(), "dog");
    dogId = dog!.id as string;
    must(await admin.from("dog_caretakers").insert({ dog_id: dogId, user_id: owner.id, role: "owner" }), "caretaker");
    must(await admin.from("group_dogs").insert({ group_id: group!.id, dog_id: dogId }), "group dog");
    const startsAt = new Date(Date.now() - 3_600_000).toISOString();
    const endsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const request = must(
      await admin
        .from("care_requests")
        .insert({ group_id: group!.id, dog_id: dogId, created_by: owner.id, request_type: "care", necessity: "required", starts_at: startsAt, ends_at: endsAt })
        .select("id")
        .single(),
      "request",
    );
    const requestId = request!.id as string;
    must(await admin.from("request_responses").insert({ request_id: requestId, user_id: helper.id, response_status: "yes" }), "response");
    must(
      await admin.from("care_assignments").insert({ request_id: requestId, assigned_user_id: helper.id, starts_at: startsAt, ends_at: endsAt, confirmed_by: owner.id }),
      "assignment",
    );

    // the owner turns routines on and adds the medication at this hour
    const julie = await signIn(contexts[0], admin, owner.email, `/dogs/${dogId}`);
    await julie.waitForURL(new RegExp(`/dogs/${dogId}$`));
    await julie.getByRole("switch", { name: "Activer les routines" }).click();
    await expect(julie.getByText("Routines activées")).toBeVisible({ timeout: 15_000 });
    await julie.getByRole("button", { name: "Ajouter une routine" }).click();
    const sheet = julie.getByRole("dialog");
    await sheet.getByRole("radio", { name: "Médicament" }).click();
    await sheet.getByRole("button", { name: "Retirer 08:00" }).click();
    const hour = parisHour();
    await sheet.getByLabel("Nouvelle heure").fill(hour);
    await sheet.getByRole("button", { name: "Ajouter l'heure" }).click();
    await sheet.getByLabel("Consigne (facultatif)").fill("½ comprimé");
    await sheet.getByRole("button", { name: "Enregistrer" }).click();
    await expect(julie.getByText(/^Médicament \d+ h$/)).toBeVisible({ timeout: 15_000 });

    // Emma checks it off in the care log
    const emma = await signIn(contexts[1], admin, helper.email, `/requests/${requestId}`);
    await emma.waitForURL(new RegExp(`/requests/${requestId}$`));
    const today = emma.getByRole("region", { name: "Routines du jour" });
    await expect(today.getByText("½ comprimé")).toBeVisible({ timeout: 15_000 });
    await today.getByRole("button", { name: /Médicament de .* : cocher/ }).click();
    await expect(today.getByText(/^Fait à/)).toBeVisible({ timeout: 15_000 });

    // Julie sees it done, by Emma
    await gotoStable(julie, `/requests/${requestId}`);
    await expect(julie.getByRole("region", { name: /Routines du jour · Emma/ }).getByText(/Fait à .* par Emma/)).toBeVisible({ timeout: 15_000 });
    const { data: entries } = await admin.from("care_log_entries").select("kind, note, routine_id").eq("request_id", requestId);
    expect(entries).toEqual([expect.objectContaining({ kind: "medication", note: "Médicament" })]);
  } finally {
    // after a timeout the contexts may already be closed: never skip the cleanup
    await Promise.allSettled(contexts.map((c) => c.close()));
    await cleanup(admin, [owner.id, helper.id], groupIds);
  }
});
