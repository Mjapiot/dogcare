"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import { sendLoginLink } from "@/server/actions/auth";
import { Field, PillButton, TextInput } from "@/components/ui/kit";
import { isNativeApp } from "@/lib/native";

const RESEND_DELAY = 60;

/**
 * Passwordless sign-in with a magic link (Supabase default e-mail template).
 * The link must be opened on the device that asked for it: in the iPhone app
 * it comes back to the app through its URL scheme.
 */
export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [step, setStep] = useState<"email" | "sent">("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(
    expired ? "Ce lien n'est plus valide (expiré, déjà utilisé ou ouvert sur un autre appareil). Demandez-en un nouveau." : null,
  );
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function requestLink() {
    setError(null);
    startTransition(async () => {
      const result = await sendLoginLink({ email, next, native: isNativeApp() });
      if (!result.ok) return setError(result.error);
      setStep("sent");
      setCooldown(RESEND_DELAY);
    });
  }

  if (step === "email") {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          requestLink();
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
          Recevoir un lien de connexion
        </PillButton>
        <p className="text-center text-[13px] text-ink-3">
          Pas de mot de passe : un lien de connexion vous est envoyé par e-mail.
        </p>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => {
          setStep("email");
          setError(null);
        }}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Changer d&apos;adresse
      </button>
      <div className="flex flex-col gap-3 rounded-3xl bg-surface p-5" aria-live="polite">
        <MailCheck className="size-7 text-[var(--tone-covered-ink)]" aria-hidden />
        <p className="text-[17px] font-semibold text-ink">Vérifiez votre boîte mail</p>
        <p className="text-[15px] text-ink-2">
          Un lien de connexion a été envoyé à <strong className="text-ink">{email}</strong>.{" "}
          <strong className="text-ink">Ouvrez-le sur cet appareil</strong> : vous serez connecté automatiquement.
        </p>
        <p className="text-[13px] text-ink-3">
          Rien reçu ? Regardez dans les courriers indésirables. Le lien est valable une heure et ne sert qu&apos;une
          fois.
        </p>
      </div>
      {error && (
        <p className="text-[14px] font-medium text-[#9b1c14]" role="alert">
          {error}
        </p>
      )}
      <PillButton variant="ghost" disabled={cooldown > 0 || pending} onClick={requestLink}>
        {cooldown > 0 ? `Renvoyer le lien (${cooldown} s)` : "Renvoyer le lien"}
      </PillButton>
    </div>
  );
}
