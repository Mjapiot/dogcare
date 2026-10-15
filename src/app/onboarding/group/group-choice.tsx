"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Users } from "lucide-react";
import { createGroup } from "@/server/actions/groups";
import { Card, Field, PillButton, PillLink, TextInput } from "@/components/ui/kit";

function extractToken(value: string): string | null {
  const trimmed = value.trim();
  const match = /\/invite\/([A-Za-z0-9_-]{16,100})/.exec(trimmed);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{16,100}$/.test(trimmed) ? trimmed : null;
}

export function GroupChoice({ hasGroups }: { hasGroups: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-[17px] font-semibold text-ink">
          <Users className="size-5" aria-hidden /> Créer un groupe
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await createGroup(name);
              if (!result.ok) return setError(result.error);
              router.replace("/dogs/new?welcome=1");
            });
          }}
        >
          <Field label="Nom du groupe" htmlFor="group-name" error={error ?? undefined}>
            <TextInput
              id="group-name"
              maxLength={60}
              placeholder="Les copains des chiens"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <PillButton type="submit" loading={pending} disabled={!name.trim()}>
            Créer le groupe
          </PillButton>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-[17px] font-semibold text-ink">
          <Link2 className="size-5" aria-hidden /> J&apos;ai un lien d&apos;invitation
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const token = extractToken(link);
            if (!token) return setLinkError("Collez le lien complet reçu de votre ami.");
            router.push(`/invite/${token}`);
          }}
        >
          <Field
            label="Lien d'invitation"
            htmlFor="invite-link"
            hint="Le plus simple : ouvrez directement le lien reçu."
            error={linkError ?? undefined}
          >
            <TextInput
              id="invite-link"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://…/invite/…"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setLinkError(null);
              }}
            />
          </Field>
          <PillButton type="submit" variant="outline" disabled={!link.trim()}>
            Continuer
          </PillButton>
        </form>
      </Card>
      {hasGroups && (
        <PillLink href="/" variant="ghost">
          Retour à l&apos;application
        </PillLink>
      )}
    </div>
  );
}
