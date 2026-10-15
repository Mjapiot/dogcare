"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { sendLoginCode, verifyLoginCode } from "@/server/actions/auth";
import { Field, PillButton, TextInput } from "@/components/ui/kit";

const RESEND_DELAY = 60;

export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(expired ? "Ce lien a expiré. Demandez un nouveau code." : null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  function requestCode() {
    setError(null);
    startTransition(async () => {
      const result = await sendLoginCode({ email, next });
      if (!result.ok) return setError(result.error);
      setStep("code");
      setCooldown(RESEND_DELAY);
    });
  }

  function submitCode() {
    setError(null);
    startTransition(async () => {
      const result = await verifyLoginCode({ email, code, next });
      // on success the server redirects; we only get here on failure
      if (result && !result.ok) setError(result.error);
    });
  }

  if (step === "email") {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          requestCode();
        }}
      >
        <Field label="Adresse e-mail" htmlFor="email" error={error ?? undefined}>
          <TextInput
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            placeholder="vous@exemple.fr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <PillButton type="submit" size="lg" loading={pending} disabled={!email.includes("@")}>
          <Mail className="size-4" aria-hidden />
          Recevoir un code
        </PillButton>
        <p className="text-center text-[13px] text-ink-3">
          Pas de mot de passe : un code à usage unique vous est envoyé par e-mail.
        </p>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submitCode();
      }}
    >
      <button
        type="button"
        onClick={() => {
          setStep("email");
          setCode("");
          setError(null);
        }}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Changer d&apos;adresse
      </button>
      <p className="text-[15px] text-ink-2" aria-live="polite">
        Code envoyé à <strong className="text-ink">{email}</strong>. Pensez à vérifier vos spams.
      </p>
      <Field label="Code reçu par e-mail" htmlFor="code" error={error ?? undefined}>
        <TextInput
          ref={codeRef}
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={12}
          required
          placeholder="123456"
          className="text-center text-2xl tracking-[0.4em] tabular"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
        />
      </Field>
      <PillButton type="submit" size="lg" loading={pending} disabled={code.length < 6}>
        Se connecter
      </PillButton>
      <PillButton variant="ghost" disabled={cooldown > 0 || pending} onClick={requestCode}>
        {cooldown > 0 ? `Renvoyer un code (${cooldown} s)` : "Renvoyer un code"}
      </PillButton>
    </form>
  );
}
