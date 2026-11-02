import { describe, expect, it, vi } from "vitest";
import { decodeRules, describeRule, encodeRules, normalizeName, resolveAbsenceIntent, type AbsenceIntent } from "@/domain/absence-intent";
import { buildPrompt, extractAbsenceIntent } from "@/lib/gemini";
import { zonedInstant } from "@/domain/time";

const NOW = zonedInstant("2026-11-10", "12:00"); // Tuesday 10 November 2026, Paris
const DOGS = [{ id: "dog-aston", name: "Aston" }];
const PEOPLE = [
  { userId: "11111111-1111-4111-8111-111111111111", name: "Mes parents" },
  { userId: "22222222-2222-4222-8222-222222222222", name: "Léa Martin" },
  { userId: "33333333-3333-4333-8333-333333333333", name: "Emma" },
  { userId: "44444444-4444-4444-8444-444444444444", name: "Emma B" },
];
const intent = (over: Partial<AbsenceIntent> = {}): AbsenceIntent => ({
  dog: null,
  startDate: "2026-11-13",
  startTime: "18:00",
  endDate: "2026-11-16",
  endTime: "09:00",
  rules: [],
  assumptions: ["vendredi = 13 novembre"],
  ...over,
});
const resolve = (i: AbsenceIntent, dogs = DOGS) => resolveAbsenceIntent(i, { dogs, people: PEOPLE, now: NOW });

describe("resolveAbsenceIntent", () => {
  it("keeps dates, the only dog, and the model's assumptions", () => {
    const r = resolve(intent());
    expect(r).toMatchObject({ dogId: "dog-aston", startDate: "2026-11-13", startTime: "18:00", endDate: "2026-11-16", endTime: "09:00", issues: [] });
    expect(r.assumptions).toEqual(["vendredi = 13 novembre"]);
  });

  it("never guesses a date; a missing time defaults with a visible assumption", () => {
    const r = resolve(intent({ startDate: "vendredi", startTime: null, endTime: null }));
    expect(r.startDate).toBeNull();
    expect(r.issues).toContain("Je n'ai pas compris la date de départ.");
    expect(r.endTime).toBe("18:00");
    expect(r.assumptions).toContain("Heure de retour non précisée : 18 h");
  });

  it("checks the period: order, past, length", () => {
    expect(resolve(intent({ endDate: "2026-11-12" })).issues).toEqual(["Le retour doit être après le départ."]);
    expect(resolve(intent({ startDate: "2026-11-01", endDate: "2026-11-02" })).issues).toEqual(["Cette période est déjà passée."]);
    expect(resolve(intent({ endDate: "2026-12-20" })).issues).toEqual(["Une absence ne peut pas dépasser 31 jours."]);
    // across the change of time (28 March 2027) the instants stay right
    expect(resolve(intent({ startDate: "2027-03-27", endDate: "2027-03-29" })).issues).toEqual([]);
  });

  it("names a dog among several, or asks", () => {
    const dogs = [...DOGS, { id: "dog-nala", name: "Nala" }];
    expect(resolve(intent({ dog: "nala" }), dogs).dogId).toBe("dog-nala");
    expect(resolve(intent({ dog: "Rex" }), dogs).issues[0]).toMatch(/Je ne sais pas de quel chien/);
    expect(resolve(intent(), dogs).issues).toContain("Quel chien ? Choisissez-le.");
  });

  it("rules only for known people: accents and first names match, ambiguity and strangers are reported", () => {
    const r = resolve(
      intent({
        rules: [
          { person: "mes parents", maxNights: 2, place: "helper" },
          { person: "Lea", maxNights: 0, place: null },
          { person: "Emma", maxNights: 1, place: null },
          { person: "Paul", maxNights: 1, place: null },
          { person: "Rien", maxNights: null, place: null },
          { person: "Mes parents", maxNights: 40, place: null },
        ],
      }),
    );
    expect(r.rules).toEqual([
      // the second rule for the parents caps at 14 nights and keeps the place
      { userId: PEOPLE[0].userId, name: "Mes parents", maxNights: 14, place: "helper" },
      { userId: PEOPLE[1].userId, name: "Léa Martin", maxNights: 0, place: null },
      // "Emma" is the exact name of one person: no ambiguity
      { userId: PEOPLE[2].userId, name: "Emma", maxNights: 1, place: null },
    ]);
    expect(r.issues).toEqual(["« Paul » ne fait pas partie du groupe ni du cercle du chien : règle ignorée."]);
    const amb = resolve(intent({ rules: [{ person: "emma b.", maxNights: 1, place: null }, { person: "Léa M", maxNights: 1, place: null }] }));
    expect(amb.rules.map((x) => x.name)).toEqual(["Emma B"]);
    expect(amb.issues[0]).toMatch(/« Léa M » ne fait pas partie/);
  });
});

describe("rules in the URL and their wording", () => {
  it("round-trips and rejects junk", () => {
    const rules = [
      { userId: PEOPLE[0].userId, maxNights: 2, place: "helper" as const },
      { userId: PEOPLE[1].userId, maxNights: null, place: "owner" as const },
    ];
    expect(decodeRules(encodeRules(rules))).toEqual(rules);
    expect(decodeRules("nope:2:helper,11111111-1111-4111-8111-111111111111:99:")).toEqual([]);
  });

  it("reads like a sentence", () => {
    expect(describeRule({ name: "Mes parents", maxNights: 2, place: "helper" })).toBe("Mes parents : 2 nuits d'affilée max, chez eux");
    expect(describeRule({ name: "Léa", maxNights: 0, place: "owner" })).toBe("Léa : jamais la nuit, chez moi");
    expect(normalizeName("  Léa-Martin ")).toBe("lea martin");
  });
});

describe("Gemini", () => {
  const ctx = { today: "2026-11-10", weekday: "mardi", dogs: ["Aston"], people: ["Mes parents", "Léa Martin"] };
  const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const wrap = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

  it("sends the date of the day, the known names and the sentence; reads a valid answer", async () => {
    const fetchImpl = answer(wrap(JSON.stringify(intent({ dog: "Aston", rules: [{ person: "Mes parents", maxNights: 2, place: "helper" }] }))));
    const r = await extractAbsenceIntent("Je pars vendredi", ctx, { apiKey: "k", fetchImpl });
    expect(r).toEqual({ ok: true, intent: intent({ dog: "Aston", rules: [{ person: "Mes parents", maxNights: 2, place: "helper" }] }) });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/models\/gemini-[^:]+:generateContent$/);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    const prompt = buildPrompt("Je pars vendredi", ctx);
    expect(JSON.parse(init.body as string).contents[0].parts[0].text).toBe(prompt);
    expect(prompt).toContain("mardi 2026-11-10");
    expect(prompt).toContain("Mes parents, Léa Martin");
  });

  it("quota, outage or network error: unavailable; malformed answer: not understood", async () => {
    expect(await extractAbsenceIntent("x", ctx, { apiKey: "k", fetchImpl: answer({ error: { status: "RESOURCE_EXHAUSTED" } }, 429) })).toEqual({ ok: false, reason: "unavailable" });
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await extractAbsenceIntent("x", ctx, { apiKey: "k", fetchImpl: failing })).toEqual({ ok: false, reason: "unavailable" });
    expect(await extractAbsenceIntent("x", ctx, { apiKey: "k", fetchImpl: answer(wrap("pas du json")) })).toEqual({ ok: false, reason: "not_understood" });
    expect(await extractAbsenceIntent("x", ctx, { apiKey: "k", fetchImpl: answer(wrap(JSON.stringify({ dog: 3 }))) })).toEqual({ ok: false, reason: "not_understood" });
  });
});
