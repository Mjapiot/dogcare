import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireAppContext } from "@/server/session";
import { getCalendarFeedToken } from "@/server/data";
import { PageTitle } from "@/components/ui/kit";
import { CalendarFeed } from "@/components/profile/calendar-feed";
import { BackToProfile } from "@/components/profile/back-to-profile";

export const metadata: Metadata = { title: "Mes gardes dans mon calendrier" };

export default async function CalendarFeedPage() {
  await requireAppContext();
  const [token, h] = await Promise.all([getCalendarFeedToken(), headers()]);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return (
    <div className="flex flex-col gap-5 pt-2">
      <BackToProfile />
      <PageTitle title="Mon calendrier" subtitle="Vos gardes confirmées dans le Calendrier de votre iPhone, mises à jour automatiquement." />
      <CalendarFeed origin={origin} initialToken={token} />
    </div>
  );
}
