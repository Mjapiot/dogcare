import type { Metadata } from "next";
import { PawPrint } from "lucide-react";
import { requireAppContext } from "@/server/session";
import { getBusyAssignments, getGroupDogs, getGroupSnapshot, getHelperPrefs, getInviteeCandidates, getMyBlockedIds } from "@/server/data";
import { planAbsence, type CircleCandidate } from "@/domain/absence";
import { planRules, type PlanPerson } from "@/domain/plan-inputs";
import { toInterval } from "@/domain/intervals";
import { addDays, todayLocal, zonedInstant } from "@/domain/time";
import { localDate, localTime, uuid } from "@/lib/validation";
import { requestNow } from "@/server/clock";
import { EmptyState, PageTitle, PillLink } from "@/components/ui/kit";
import { AbsenceForm } from "@/components/planning/absence-form";
import { AbsencePlanner } from "@/components/planning/absence-planner";
import { decodeRules, encodeRules, type AbsenceRule } from "@/domain/absence-intent";
import { assistantEnabled } from "@/server/ai";

export const metadata: Metadata = { title: "Planifier une absence" };

const param = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * "Planifier une absence": dates first; then the app proposes who keeps the
 * dog when, from what the group declared and each person's rules, with the
 * holes and who else to ask; the owner sends each person their part.
 */
export default async function PlanAbsencePage({ searchParams }: PageProps<"/plan">) {
  const { userId, group } = await requireAppContext();
  const params = await searchParams;
  const { dogs, caretakers } = await getGroupDogs(group.id);
  const myDogs = dogs.filter((d) => !d.archived_at && caretakers.some((c) => c.dog_id === d.id && c.user_id === userId));

  if (myDogs.length === 0) {
    return (
      <div className="flex flex-col gap-6 pt-2">
        <PageTitle title="Planifier une absence" />
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
  const dogParam = param(params.dog);
  const dog = myDogs.find((d) => d.id === dogParam) ?? (myDogs.length === 1 ? myDogs[0] : undefined);
  const form = {
    dogId: dog?.id ?? "",
    startDate: localDate.safeParse(param(params.from)).data ?? addDays(today, 1),
    startTime: localTime.safeParse(param(params.fromTime)).data ?? "18:00",
    endDate: localDate.safeParse(param(params.to)).data ?? addDays(today, 4),
    endTime: localTime.safeParse(param(params.toTime)).data ?? "09:00",
  };
  const submitted = Boolean(dog && params.from && params.to);
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
  if (dog && submitted && !error) {
    const period = { start, end };
    const [snapshot, blocked, prefs, candidates] = await Promise.all([
      getGroupSnapshot(group.id, userId, { from: form.startDate, to: form.endDate }),
      getMyBlockedIds(),
      getHelperPrefs(dog.id),
      getInviteeCandidates(group.id),
    ]);
    const dogCaretakers = new Set(caretakers.filter((c) => c.dog_id === dog.id).map((c) => c.user_id));
    const members = snapshot.members.filter((m) => !dogCaretakers.has(m.user_id) && !blocked.includes(m.user_id));
    const busy = await getBusyAssignments(
      members.map((m) => m.user_id),
      period,
    );
    const circleOfDog = candidates.filter((c) => c.dog_id === dog.id && !blocked.includes(c.user_id));
    const nameOf = new Map<string, string>([...members.map((m) => [m.user_id, m.display_name] as const), ...circleOfDog.map((c) => [c.user_id, c.display_name] as const)]);
    // rules said for this absence win over the saved preferences
    rules = overrides.filter((o) => nameOf.has(o.userId)).map((o) => ({ ...o, name: nameOf.get(o.userId)! }));
    const people: PlanPerson[] = members.map((m) => {
      const saved = prefs.find((p) => p.user_id === m.user_id);
      const rule = rules.find((r) => r.userId === m.user_id);
      const pref =
        saved || rule
          ? { place: rule?.place ?? saved?.place ?? ("helper" as const), maxNights: rule && rule.maxNights !== null ? rule.maxNights : (saved?.max_nights ?? null) }
          : null;
      return {
        userId: m.user_id,
        name: m.display_name,
        entries: snapshot.availabilityEntries.filter((e) => e.user_id === m.user_id),
        rules: snapshot.availabilityRules.filter((r) => r.user_id === m.user_id),
        busy: busy.filter((b) => b.assigned_user_id === m.user_id).map((b) => toInterval(b.starts_at, b.ends_at)),
        pref,
      };
    });
    const circle: CircleCandidate[] = circleOfDog.map((c) => ({
        userId: c.user_id,
        name: c.display_name,
        role: c.role,
        startsAt: c.starts_at ? Date.parse(c.starts_at) : null,
        endsAt: c.ends_at ? Date.parse(c.ends_at) : null,
      }));
    const absence = planAbsence({ period, people, rules: planRules(dog), candidates: circle, skip });
    const placeOf = Object.fromEntries([
      ...prefs.map((p) => [p.user_id, p.place] as const),
      ...rules.filter((r) => r.place).map((r) => [r.userId, r.place!] as const),
    ]);
    result = (
      <AbsencePlanner
        key={`${start}-${end}-${skip.join(",")}-${param(params.rules) ?? ""}`}
        rulesParam={rules.length ? encodeRules(rules) : undefined}
        groupId={group.id}
        dog={{ id: dog.id, name: dog.name }}
        form={form}
        period={period}
        absence={absence}
        names={Object.fromEntries([...people.map((p) => [p.userId, p.name]), ...circle.map((c) => [c.userId, c.name])])}
        placeOf={placeOf}
        maxNights={planRules(dog).maxConsecutiveNights}
        hasPro={circle.some((c) => c.role === "pro")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-2">
      <PageTitle title="Planifier une absence" subtitle="L'app propose qui garde quand, d'après les dispos de chacun. Rien n'est envoyé sans vous." />
      <AbsenceForm
        key={`${form.dogId}-${form.startDate}-${form.endDate}-${param(params.rules) ?? ""}`}
        groupId={group.id}
        dogs={myDogs.map((d) => ({ id: d.id, name: d.name }))}
        initial={form}
        initialRules={rules}
        error={error}
        assistant={assistantEnabled()}
      />
      {result}
    </div>
  );
}
