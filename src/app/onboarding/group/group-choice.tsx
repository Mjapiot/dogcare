"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Users } from "lucide-react";
import { createGroup, joinGroupWithCode } from "@/server/actions/groups";
import { normalizeJoinCode } from "@/lib/join-code";
import { toast } from "sonner";
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
          <KeyRound className="size-5" aria-hidden /> Rejoindre un groupe
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const code = normalizeJoinCode(link);
            if (code) {
              setLinkError(null);
              startTransition(async () => {
                const r = await joinGroupWithCode(code);
                if (!r.ok) return setLinkError(r.error);
                toast.success(`Bienvenue dans « ${r.data.groupName} » !`);
                router.replace("/availability?welcome=1");
              });
              return;
            }
            const token = extractToken(link);
            if (!token) return setLinkError("Saisissez le code du groupe (8 caractères) ou collez le lien reçu.");
            router.push(`/invite/${token}`);
          }}
        >
          <Field
            label="Code du groupe ou lien d'invitation"
            htmlFor="invite-link"
            hint="Le code (ex. K7PQ-M2XD) vous est donné par un administrateur du groupe."
            error={linkError ?? undefined}
          >
            <TextInput
              id="invite-link"
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="K7PQ-M2XD"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setLinkError(null);
              }}
            />
          </Field>
          <PillButton type="submit" variant="outline" loading={pending} disabled={!link.trim()}>
            Rejoindre
          </PillButton>
        </form>
      </Card>
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

      {hasGroups && (
        <PillLink href="/" variant="ghost">
          Retour à l&apos;application
        </PillLink>
      )}
    </div>
  );
}
