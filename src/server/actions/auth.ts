"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { codeSchema, emailSchema } from "@/lib/validation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import type { ActionResult } from "@/lib/types";

const safeNext = (next: unknown) => safeRedirectPath(next);

export async function sendLoginCode(input: { email: string; next?: string }): Promise<ActionResult> {
  const parsed = emailSchema.safeParse({ email: input.email.trim().toLowerCase() });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext(input.next))}`,
    },
  });
  if (error) {
    if (error.status === 429) {
      return { ok: false, error: "Trop de demandes. Patientez une minute avant de redemander un code." };
    }
    console.error("[dogcare] signInWithOtp", error.status, error.message);
    return { ok: false, error: "Impossible d'envoyer le code pour le moment. Réessayez." };
  }
  return { ok: true, data: undefined };
}

export async function verifyLoginCode(input: { email: string; code: string; next?: string }): Promise<ActionResult> {
  const parsed = codeSchema.safeParse({ email: input.email.trim().toLowerCase(), code: input.code.replace(/\s/g, "") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
  if (error) {
    return { ok: false, error: "Code incorrect ou expiré. Vérifiez le dernier e-mail reçu ou demandez un nouveau code." };
  }
  redirect(safeNext(input.next));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** The single demonstration account (App Store review), or null if not configured. */
function demoAccountEmail(): string | null {
  const email = process.env.DEMO_ACCOUNT_EMAIL?.trim().toLowerCase();
  return email ? email : null;
}

/**
 * Password sign-in, reserved to the demonstration account given to Apple's
 * reviewers (they cannot receive our e-mail codes). Every other account
 * signs in with an e-mail code.
 */
export async function signInDemoAccount(input: { email: string; password: string; next?: string }): Promise<ActionResult> {
  const demo = demoAccountEmail();
  const email = input.email.trim().toLowerCase();
  if (!demo || email !== demo || input.password.length < 8 || input.password.length > 200) {
    return { ok: false, error: "Identifiants de démonstration incorrects." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: input.password });
  if (error) {
    if (error.status === 429) return { ok: false, error: "Trop de tentatives. Patientez une minute." };
    return { ok: false, error: "Identifiants de démonstration incorrects." };
  }
  redirect(safeNext(input.next));
}
