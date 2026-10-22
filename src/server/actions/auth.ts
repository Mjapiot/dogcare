"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import type { ActionResult } from "@/lib/types";

const safeNext = (next: unknown) => safeRedirectPath(next);

/** Custom URL scheme of the iOS app (Info.plist), so the e-mail link reopens the app. */
const NATIVE_SCHEME = "app.dogcare.ios";

/**
 * Sends a magic link (Supabase default "Magic Link" template). In the iOS app
 * the link comes back through the app's URL scheme: the login then finishes
 * inside the app, where the PKCE verifier cookie lives.
 */
export async function sendLoginLink(input: { email: string; next?: string; native?: boolean }): Promise<ActionResult> {
  const parsed = emailSchema.safeParse({ email: input.email.trim().toLowerCase() });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const origin = input.native ? `${NATIVE_SCHEME}://` : ((await headers()).get("origin") ?? "");
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext(input.next))}`,
    },
  });
  if (error) {
    if (error.status === 429) {
      return { ok: false, error: "Trop de demandes. Patientez une minute avant de redemander un lien." };
    }
    console.error("[dogcare] signInWithOtp", error.status, error.message);
    return { ok: false, error: "Impossible d'envoyer le lien pour le moment. Réessayez." };
  }
  return { ok: true, data: undefined };
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
 * reviewers (they cannot receive our e-mails). Every other account signs in
 * with an e-mail link.
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
