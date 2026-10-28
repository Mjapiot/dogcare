import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleAlert, HeartHandshake } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, requireUserId } from "@/server/session";
import { CIRCLE_KIND_LABELS, lastGuestDay } from "@/domain/circle";
import { PillLink } from "@/components/ui/kit";
import { deName } from "@/lib/format";
import { JoinCircleButton } from "./join-circle-button";

export const metadata: Metadata = { title: "Invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Preview = {
  dog_id: string | null;
  dog_name: string | null;
  inviter_name: string | null;
  role: "close" | "guest" | null;
  ends_at: string | null;
  status: "valid" | "accepted" | "invalid" | "revoked" | "used" | "expired";
};

const STATUS_MESSAGES: Record<string, string> = {
  invalid: "Ce lien d'invitation n'est pas valide.",
  revoked: "Ce lien d'invitation a été annulé.",
  used: "Ce lien a déjà été utilisé. Demandez-en un nouveau.",
  expired: "Ce lien d'invitation a expiré. Demandez-en un nouveau.",
};

const DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" });

/** Invitation to a dog's circle of trust: no group to join, just the dog's passport. */
export default async function JoinCirclePage({ params }: PageProps<"/circle/join/[token]">) {
  const { token } = await params;
  await requireUserId();
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect(`/onboarding?next=${encodeURIComponent(`/circle/join/${token}`)}`);

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_circle_invitation", { p_token: token });
  const preview = ((data as Preview[] | null) ?? [])[0] ?? ({ status: "invalid" } as Preview);
  if (preview.status === "accepted" && preview.dog_id) redirect(`/circle/${preview.dog_id}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 pt-safe pb-safe">
      {preview.status === "valid" && preview.dog_id ? (
        <>
          <div className="flex size-14 items-center justify-center rounded-full bg-sage/15">
            <HeartHandshake className="size-7 text-sage" aria-hidden />
          </div>
          <div>
            <p className="text-[15px] font-medium text-ink-3">{preview.inviter_name} vous invite dans le cercle</p>
            <h1 className="mt-1 text-[40px] font-semibold leading-[1] tracking-[-0.04em] text-ink">{deName(preview.dog_name ?? "")}</h1>
            <p className="mt-3 text-[15px] text-ink-2">
              En tant que <strong className="text-ink">{CIRCLE_KIND_LABELS[preview.role ?? "guest"].toLowerCase()}</strong>, vous verrez
              son passeport : habitudes, consignes et ce que ses responsables ont choisi de partager
              {preview.role === "guest" && preview.ends_at
                ? `, jusqu'au ${DAY.format(new Date(`${lastGuestDay(preview.ends_at)}T00:00:00Z`))}`
                : ""}
              . Vous ne rejoignez aucun groupe.
            </p>
          </div>
          <JoinCircleButton token={token} />
        </>
      ) : (
        <>
          <div className="flex size-14 items-center justify-center rounded-full bg-[var(--tone-uncovered)]">
            <CircleAlert className="size-7 text-[var(--tone-uncovered-ink)]" aria-hidden />
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight text-ink">{STATUS_MESSAGES[preview.status] ?? STATUS_MESSAGES.invalid}</h1>
          <PillLink href="/" variant="outline">
            Retour à l&apos;accueil
          </PillLink>
        </>
      )}
    </main>
  );
}
