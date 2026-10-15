"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDisplayName } from "@/server/actions/groups";
import { Field, PillButton, TextInput } from "@/components/ui/kit";

export function NameForm({ defaultName, redirectTo }: { defaultName: string; redirectTo: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await updateDisplayName(name);
          if (!result.ok) return setError(result.error);
          router.replace(redirectTo);
        });
      }}
    >
      <Field label="Prénom ou surnom" htmlFor="display-name" error={error ?? undefined}>
        <TextInput
          id="display-name"
          autoComplete="given-name"
          autoFocus
          maxLength={40}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Julie"
        />
      </Field>
      <PillButton type="submit" size="lg" loading={pending} disabled={!name.trim()}>
        Continuer
      </PillButton>
    </form>
  );
}
