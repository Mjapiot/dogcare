import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyGroups, getProfile, requireUserId } from "@/server/session";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { NameForm } from "./name-form";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { ONBOARDING_STEPS } from "@/lib/onboarding";

export const metadata: Metadata = { title: "Bienvenue" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireUserId();
  const params = await searchParams;
  const next = params.next === undefined ? null : safeRedirectPath(params.next);
  const profile = await getProfile();
  const groups = await getMyGroups();
  const afterName = next ?? (groups.length ? "/" : "/onboarding/group");
  if (profile?.display_name.trim() && !params.edit) redirect(afterName);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-safe pb-safe">
      <div className="flex flex-1 flex-col justify-center gap-8 py-10">
        {/* someone joining a dog's circle does not go through the group steps */}
        {groups.length === 0 && !next?.startsWith("/circle/") && <OnboardingProgress steps={ONBOARDING_STEPS.create} current={1} />}
        <div>
          <h1 className=" text-[40px] font-semibold leading-[1] tracking-[-0.04em] text-ink">Comment vous appelle-t-on ?</h1>
          <p className="mt-3 text-[17px] text-ink-2">Votre prénom sera visible par les membres de vos groupes.</p>
        </div>
        <NameForm defaultName={profile?.display_name ?? ""} redirectTo={afterName} />
      </div>
    </main>
  );
}
