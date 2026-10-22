import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyGroups, getProfile, requireUserId } from "@/server/session";
import { getMyAvailability } from "@/server/data";
import { todayLocal } from "@/domain/time";
import { PillLink } from "@/components/ui/kit";
import { RulesEditor } from "@/components/availability/rules-editor";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { ONBOARDING_STEPS } from "@/lib/onboarding";

export const metadata: Metadata = { title: "Vos habitudes" };

/** Last onboarding step (optional): weekly availability habits. */
export default async function OnboardingHabitsPage({ searchParams }: PageProps<"/onboarding/habits">) {
  const userId = await requireUserId();
  const params = await searchParams;
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect("/onboarding");
  if ((await getMyGroups()).length === 0) redirect("/onboarding/group");
  const today = todayLocal();
  const { rules } = await getMyAvailability(userId, today, today);
  const steps = params.dog === "1" ? ONBOARDING_STEPS.create : ONBOARDING_STEPS.join;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-safe pb-safe">
      <div className="flex flex-1 flex-col justify-center gap-8 py-10">
        <OnboardingProgress steps={steps} current={steps.length} />
        <div>
          <h1 className="text-[40px] font-semibold leading-[1] tracking-[-0.04em] text-ink">Vos habitudes</h1>
          <p className="mt-3 text-[17px] text-ink-2">
            Êtes-vous souvent libre le mercredi après-midi ou le week-end ? Touchez les créneaux concernés puis
            « Dispo ». Ce n&apos;est jamais un engagement, et ce que vous indiquerez jour par jour restera prioritaire.
          </p>
        </div>
        <RulesEditor embedded rules={rules.map((r) => ({ weekday: r.weekday, slot: r.slot, status: r.status }))} />
        <div className="flex flex-col gap-2">
          <PillLink href="/" size="lg">
            {rules.length > 0 ? "Terminer" : "Passer pour l'instant"}
          </PillLink>
          <p className="text-center text-[13px] text-ink-3">Modifiable à tout moment dans « Mes dispos ».</p>
        </div>
      </div>
    </main>
  );
}
