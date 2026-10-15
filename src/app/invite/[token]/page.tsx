import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleAlert, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, requireUserId } from "@/server/session";
import { PillLink } from "@/components/ui/kit";
import { JoinButton } from "./join-button";

export const metadata: Metadata = { title: "Invitation" };

type Preview = { group_id: string | null; group_name: string | null; inviter_name: string | null; status: string };

const STATUS_MESSAGES: Record<string, string> = {
  invalid: "Ce lien d'invitation n'est pas valide.",
  revoked: "Ce lien d'invitation a été révoqué.",
  expired: "Ce lien d'invitation a expiré. Demandez-en un nouveau.",
  exhausted: "Ce lien a déjà été utilisé le nombre maximum de fois.",
};

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  await requireUserId();
  const profile = await getProfile();
  if (!profile?.display_name.trim()) redirect(`/onboarding?next=${encodeURIComponent(`/invite/${token}`)}`);

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_invitation", { p_token: token });
  const preview = ((data as Preview[] | null) ?? [])[0] ?? { status: "invalid", group_id: null, group_name: null, inviter_name: null };
  if (preview.status === "already_member") redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 pt-safe pb-safe">
      {preview.status === "valid" ? (
        <>
          <div className="flex size-14 items-center justify-center rounded-full bg-[var(--tone-covered)]">
            <Users className="size-7 text-[var(--tone-covered-ink)]" aria-hidden />
          </div>
          <div>
            <p className="text-[15px] font-medium text-ink-3">{preview.inviter_name} vous invite à rejoindre</p>
            <h1 className="mt-1 text-[40px] font-semibold leading-[1] tracking-[-0.04em] text-ink">{preview.group_name}</h1>
            <p className="mt-3 text-[15px] text-ink-2">
              Vous verrez les besoins de garde du groupe et pourrez partager vos disponibilités.
            </p>
          </div>
          <JoinButton token={token} />
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
