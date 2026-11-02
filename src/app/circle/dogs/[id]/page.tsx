import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getMyGroups, getProfile, requireUserId } from "@/server/session";
import { uuid } from "@/lib/validation";
import { DogScreen } from "@/components/dogs/dog-screen";

export const metadata: Metadata = { title: "Passeport" };

/** A dog's passport in "Mes chiens" (no group): the same screen as in the app, without planning. */
export default async function SoloDogPage({ params }: PageProps<"/circle/dogs/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const userId = await requireUserId();
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect(`/onboarding?next=/circle/dogs/${id}`);
  // members of a group use the full app
  if ((await getMyGroups()).length) redirect(`/dogs/${id}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-safe pb-safe">
      <div className="pt-2 pb-10">
        <DogScreen dogId={id} userId={userId} mode="solo" back={{ href: "/circle", label: "Mes chiens" }} />
      </div>
    </main>
  );
}
