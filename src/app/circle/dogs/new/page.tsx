import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getProfile, requireUserId } from "@/server/session";
import { PageTitle } from "@/components/ui/kit";
import { DogForm } from "@/components/dogs/dog-form";

export const metadata: Metadata = { title: "Passeport de mon chien" };

/** Passport first: a dog created without any group (shared with a group later, if ever). */
export default async function NewSoloDogPage() {
  await requireUserId();
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect("/onboarding?next=/circle/dogs/new");

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-safe pb-safe">
      <div className="flex flex-col gap-6 pt-4 pb-10">
        <Link href="/circle" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2">
          <ArrowLeft className="size-4" aria-hidden /> Mes chiens
        </Link>
        <PageTitle title="Votre chien" subtitle="Son passeport : identité, habitudes, santé et urgences. Gratuit, sans groupe." />
        <DogForm initial={{ name: "", breed: "", birthDate: "", careNotes: "" }} groups={[]} defaultGroupIds={[]} afterCreate="/circle/dogs/{dog}" />
      </div>
    </main>
  );
}
