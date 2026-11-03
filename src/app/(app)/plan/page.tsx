import type { Metadata } from "next";
import { PawPrint } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getGroupDogs, getGroupSnapshot, getHelperPrefs, getInviteeCandidates, getMaxDogs, getMyBlockedIds, getOtherGardes } from "@/server/data";
import { planAbsence, type AbsenceDog, type AbsencePerson, type CircleCandidate } from "@/domain/absence";
import { DEFAULT_MAX_DOGS } from "@/domain/cumul";
import { planRules } from "@/domain/plan-inputs";
import { toInterval } from "@/domain/intervals";
import { addDays, todayLocal, zonedInstant } from "@/domain/time";
import { localDate, localTime, uuid } from "@/lib/validation";
import { requestNow } from "@/server/clock";
import { EmptyState, PageTitle, PillLink } from "@/components/ui/kit";
import { AbsenceForm } from "@/components/planning/absence-form";
import { AbsencePlanner } from "@/components/planning/absence-planner";
import { decodeRules, encodeRules, type AbsenceRule } from "@/domain/absence-intent";
import { assistantEnabled } from "@/server/ai";

export const metadata: Metadata = { title: "Besoin d'une garde" };

const param = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * "Planifier une absence": dogs and dates first; then the app proposes who
 * keeps each dog when (together when possible), from what the group declared
 * and each person's rules, with the holes and who else to ask; the owner sends
 * each person their part.
 */
export default async function PlanAbsencePage({ searchParams }: PageProps<"/plan">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const { dogs, caretakers } = await getGroupDogs(group.id);
  const myDogs = dogs.filter((d) => !d.archived_at && caretakers.some((c) => c.dog_id === d.id && c.user_id === userId));

  if (myDogs.length === 0) {
    return (
      <div className="flex flex-col gap-6 pt-2">
        <PageTitle title="Besoin d'une garde" />
        <EmptyState
          icon={PawPrint}
          title="Aucun chien dans ce groupe"
          description="Ajoutez votre chien (ou partagez-le avec ce groupe) pour planifier sa garde."
          action={<PillLink href="/dogs/new">Ajouter un chien</PillLink>}
        />
      </div>
    );
  }

  const today = todayLocal();
  // several dogs: "dog=id,id"; one dog of mine: that one; none chosen: all of them
  const dogParam = (param(params.dog) ?? "").split(",").filter(Boolean);
  const chosen = dogParam.length ? myDogs.filter((d) => dogParam.includes(d.id)) : myDogs;
  // a day chosen in the calendar: that day, daytime; otherwise a long weekend from tomorrow
  const day = localDate.safeParse(param(params.date)).data;
  const oneDay = day && day >= today ? day : null;
  const form = {
    dogIds: chosen.map((d) => d.id),
    startDate: localDate.safeParse(param(params.from)).data ?? oneDay ?? addDays(today, 1),
    startTime: localTime.safeParse(param(params.fromTime)).data ?? (oneDay ? "09:00" : "18:00"),
    endDate: localDate.safeParse(param(params.to)).data ?? oneDay ?? addDays(today, 4),
    endTime: localTime.safeParse(param(params.toTime)).data ?? (oneDay ? "18:00" : "09:00"),
    description: (param(params.desc) ?? "").slice(0, 1000),
  };
  const submitted = Boolean(chosen.length && params.from && params.to);
  const start = zonedInstant(form.startDate, form.startTime);
  const end = zonedInstant(form.endDate, form.endTime);
  const error = !submitted
    ? null
    : end <= start
      ? "La fin doit être après le début."
      : end <= requestNow()
        ? "Cette période est déjà passée."
        : end - start > 31 * 24 * 3_600_000
          ? "Une absence ne peut pas dépasser 31 jours."
          : null;
  const skip = (param(params.skip) ?? "").split(",").filter((s) => uuid.safeParse(s).success);

  const overrides = decodeRules(param(params.rules));
  let rules: AbsenceRule[] = [];
  let result: React.ReactNode = null;
  if (submitted && !error) {
    const period = { start, end };
    const chosenIds = new Set(chosen.map((d) => d.id));
    const [snapshot, blocked, prefsByDog, candidates] = await Promise.all([
      getGroupSnapshot(group.id, userId, { from: form.startDate, to: form.endDate }),
      getMyBlockedIds(),
      Promise.all(chosen.map((d) => getHelperPrefs(d.id))),
      getInviteeCandidates(group.id),
    ]);
    // nobody who looks after one of these dogs is asked to keep them
    const dogCaretakers = new Set(caretakers.filter((c) => chosenIds.has(c.dog_id)).map((c) => c.user_id));
    const members = snapshot.members.filter((m) => !dogCaretakers.has(m.user_id) && !blocked.includes(m.user_id));
    const memberIds = members.map((m) => m.user_id);
    const [gardes, maxDogs] = await Promise.all([getOtherGardes(memberIds, period), getMaxDogs(memberIds)]);
    // people with a dog of their own (in this group): a dog kept alone only goes to them at its owner's
    const owners = new Set(caretakers.filter((c) => dogs.some((d) => d.id === c.dog_id && !d.archived_at)).map((c) => c.user_id));
    const circleOf = (dogId: string) => candidates.filter((c) => c.dog_id === dogId && !blocked.includes(c.user_id));
    const nameOf = new Map<string, string>([
      ...members.map((m) => [m.user_id, m.display_name] as const),
      ...chosen.flatMap((d) => circleOf(d.id)).map((c) => [c.user_id, c.display_name] as const),
    ]);
    // rules said for this absence win over the saved preferences
    rules = overrides.filter((o) => nameOf.has(o.userId)).map((o) => ({ ...o, name: nameOf.get(o.userId)! }));
    const people: AbsencePerson[] = members.map((m) => {
      const rule = rules.find((r) => r.userId === m.user_id);
      const prefs = Object.fromEntries(
        chosen.map((d, i) => {
          const saved = prefsByDog[i].find((p) => p.user_id === m.user_id);
          if (!saved && !rule) return [d.id, undefined];
          return [d.id, { place: rule?.place ?? saved?.place ?? ("helper" as const), maxNights: rule && rule.maxNights !== null ? rule.maxNights : (saved?.max_nights ?? null) }];
        }),
      );
      return {
        userId: m.user_id,
        name: m.display_name,
        entries: snapshot.availabilityEntries.filter((e) => e.user_id === m.user_id),
        rules: snapshot.availabilityRules.filter((r) => r.user_id === m.user_id),
        gardes: gardes.filter((g) => g.assigned_user_id === m.user_id).map((g) => ({ ...toInterval(g.starts_at, g.ends_at), aloneOnly: g.alone_only })),
        maxDogs: m.user_id in maxDogs ? maxDogs[m.user_id] : DEFAULT_MAX_DOGS,
        ownsDog: owners.has(m.user_id),
        prefs,
      };
    });
    const absenceDogs: AbsenceDog[] = chosen.map((d) => ({
      id: d.id,
      name: d.name,
      aloneOnly: d.alone_only,
      rules: planRules(d),
      candidates: circleOf(d.id).map(
        (c): CircleCandidate => ({
          userId: c.user_id,
          name: c.display_name,
          role: c.role,
          startsAt: c.starts_at ? Date.parse(c.starts_at) : null,
          endsAt: c.ends_at ? Date.parse(c.ends_at) : null,
        }),
      ),
    }));
    const absence = planAbsence({ period, dogs: absenceDogs, people, skip });
    // where each circle person keeps each dog, and their limit of nights for this absence
    const placeOf = Object.fromEntries(
      chosen.map((d, i) => [
        d.id,
        Object.fromEntries([...prefsByDog[i].map((p) => [p.user_id, p.place] as const), ...rules.filter((r) => r.place).map((r) => [r.userId, r.place!] as const)]),
      ]),
    );
    const circleIds = new Set(chosen.flatMap((d) => circleOf(d.id)).map((c) => c.user_id));
    result = (
      <AbsencePlanner
        key={`${form.dogIds.join(",")}-${start}-${end}-${skip.join(",")}-${param(params.rules) ?? ""}`}
        rulesParam={rules.length ? encodeRules(rules) : undefined}
        groupId={group.id}
        dogs={absenceDogs.map((d) => ({ id: d.id, name: d.name, aloneOnly: d.aloneOnly, maxNights: d.rules.maxConsecutiveNights }))}
        form={form}
        period={period}
        absence={absence}
        names={Object.fromEntries([...nameOf])}
        placeOf={placeOf}
        nightsOf={Object.fromEntries(rules.filter((r) => circleIds.has(r.userId)).map((r) => [r.userId, r.maxNights]))}
        hasPro={absenceDogs.some((d) => d.candidates.some((c) => c.role === "pro"))}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <AbsenceForm
        key={`${form.dogIds.join(",")}-${form.startDate}-${form.endDate}-${param(params.rules) ?? ""}-${submitted}`}
        groupId={group.id}
        dogs={myDogs.map((d) => ({ id: d.id, name: d.name }))}
        initial={form}
        initialRules={rules}
        error={error}
        assistant={assistantEnabled()}
        submitted={Boolean(result)}
      />
      {result}
    </div>
  );
}
