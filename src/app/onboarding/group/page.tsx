import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyGroups, getProfile, requireUserId } from "@/server/session";
import { GroupChoice } from "./group-choice";

export const metadata: Metadata = { title: "Votre groupe" };

export default async function OnboardingGroupPage() {
  await requireUserId();
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect("/onboarding");
  const groups = await getMyGroups();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-safe pb-safe">
      <div className="flex flex-1 flex-col justify-center gap-8 py-10">
        <div>
          <p className="text-[15px] font-medium text-ink-3">Étape 2 sur 2</p>
          <h1 className="mt-2 text-[40px] font-semibold leading-[1] tracking-[-0.04em] text-ink">
            Bonjour {profile.display_name.split(" ")[0]} !
          </h1>
          <p className="mt-3 text-[17px] text-ink-2">
            Rejoignez le groupe de vos amis avec son code ou le lien reçu, ou créez le vôtre.
          </p>
        </div>
        <GroupChoice hasGroups={groups.length > 0} />
      </div>
    </main>
  );
}
