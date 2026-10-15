"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateDisplayName } from "@/server/actions/groups";
import { Card, Field, PillButton, TextInput } from "@/components/ui/kit";

export function ProfileForm({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = await updateDisplayName(name);
            if (!r.ok) return setError(r.error);
            toast.success("Prénom mis à jour");
            router.refresh();
          });
        }}
      >
        <Field label="Prénom affiché" htmlFor="profile-name" error={error ?? undefined}>
          <TextInput id="profile-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        </Field>
        <PillButton type="submit" variant="soft" loading={pending} disabled={name.trim() === displayName || !name.trim()}>
          Enregistrer
        </PillButton>
      </form>
    </Card>
  );
}
