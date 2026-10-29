import type { Metadata } from "next";
import { requireAppContext } from "@/server/session";
import { getNotificationPreferences } from "@/server/data";
import { getVapidPublicKey } from "@/server/push";
import { PageTitle } from "@/components/ui/kit";
import { PushSettings } from "@/components/profile/push-settings";
import { NotificationPrefs } from "@/components/profile/notification-prefs";
import { BackToProfile } from "@/components/profile/back-to-profile";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationSettingsPage() {
  await requireAppContext();
  const prefs = await getNotificationPreferences();
  return (
    <div className="flex flex-col gap-5 pt-2">
      <BackToProfile />
      <PageTitle title="Notifications" subtitle="Sur cet appareil, et ce que vous voulez recevoir. La cloche de l'app affiche toujours tout." />
      <PushSettings vapidPublicKey={getVapidPublicKey()} />
      <section className="flex flex-col gap-2" aria-labelledby="prefs-title">
        <h2 id="prefs-title" className="px-1 text-[17px] font-semibold tracking-tight text-ink">
          Ce que je reçois en push
        </h2>
        <div className="shadow-soft overflow-hidden rounded-[24px] bg-surface ring-1 ring-white/70">
          <NotificationPrefs initial={prefs} />
        </div>
      </section>
    </div>
  );
}
