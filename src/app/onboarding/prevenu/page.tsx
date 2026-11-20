import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BellRing, CalendarPlus } from "lucide-react";
import { getProfile, requireUserId } from "@/server/session";
import { getCalendarFeedToken } from "@/server/data";
import { getVapidPublicKey } from "@/server/push";
import { ONBOARDING_STEPS } from "@/lib/onboarding";
import { PillLink } from "@/components/ui/kit";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { PushSettings } from "@/components/profile/push-settings";
import { CalendarFeed } from "@/components/profile/calendar-feed";

export const metadata: Metadata = { title: "Restez prévenu" };

/**
 * Last onboarding step (optional), also offered from the home screen:
 * notifications on this device, and my gardes in the iPhone's Calendar, so
 * nobody has to look for them in the settings later.
 */
export default async function StayInformedPage({ searchParams }: PageProps<"/onboarding/prevenu">) {
  await requireUserId();
  const params = await searchParams;
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect("/onboarding");
  const fromHome = params.from === "home";
  const steps = params.dog === "1" ? ONBOARDING_STEPS.create : ONBOARDING_STEPS.join;
  const [token, h] = await Promise.all([getCalendarFeedToken(), headers()]);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-safe pb-safe">
      <div className="flex flex-1 flex-col justify-center gap-6 py-10">
        {!fromHome && <OnboardingProgress steps={steps} current={steps.length} />}
        <div>
          <h1 className="text-[40px] font-light leading-[1] tracking-[-0.04em] text-ink">
            Restez <b className="font-semibold">prévenu</b>
          </h1>
          <p className="mt-3 text-[17px] text-ink-2">
            Deux réglages, une seule fois : être averti quand on a besoin de vous, et retrouver vos gardes dans le
            Calendrier de l&apos;iPhone.
          </p>
        </div>

        <section aria-labelledby="stay-push" className="flex flex-col gap-3">
          <h2 id="stay-push" className="flex items-center gap-2 px-1 text-[17px] font-semibold text-ink">
            <BellRing className="size-5" aria-hidden /> Les notifications
          </h2>
          <PushSettings vapidPublicKey={getVapidPublicKey()} />
        </section>

        <section aria-labelledby="stay-calendar" className="flex flex-col gap-3">
          <h2 id="stay-calendar" className="flex items-center gap-2 px-1 text-[17px] font-semibold text-ink">
            <CalendarPlus className="size-5" aria-hidden /> Mes gardes dans le Calendrier
          </h2>
          <CalendarFeed key={token ?? "off"} origin={origin} initialToken={token} />
        </section>

        <div className="flex flex-col gap-2">
          <PillLink href="/" size="lg">
            Terminer
          </PillLink>
          <p className="text-center text-[13px] text-ink-3">Modifiable à tout moment dans le Profil.</p>
        </div>
      </div>
    </main>
  );
}
