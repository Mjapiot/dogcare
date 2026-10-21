"use client";

import { useState, useTransition } from "react";
import { signInDemoAccount } from "@/server/actions/auth";
import { Field, PillButton, TextInput } from "@/components/ui/kit";

/** Discreet access for the App Store review account only. */
export function DemoLogin({ next }: { next: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto min-h-11 text-[13px] font-medium text-ink-3 underline-offset-2 hover:underline"
      >
        Compte de démonstration
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-3xl bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await signInDemoAccount({ email, password, next });
          if (r && !r.ok) setError(r.error);
        });
      }}
    >
      <p className="text-[14px] text-ink-2">
        Réservé au compte de démonstration communiqué aux testeurs. Les autres comptes se connectent avec un code reçu
        par e-mail.
      </p>
      <Field label="Identifiant" htmlFor="demo-email">
        <TextInput
          id="demo-email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Mot de passe" htmlFor="demo-password" error={error ?? undefined}>
        <TextInput
          id="demo-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <PillButton type="submit" loading={pending} disabled={!email || !password}>
        Se connecter à la démonstration
      </PillButton>
    </form>
  );
}
