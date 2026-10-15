import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserId } from "@/server/session";
import { getSupabaseEnv } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const configured = Boolean(getSupabaseEnv());
  if (configured && (await getUserId())) redirect(next.startsWith("/") ? next : "/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-safe pb-safe">
      <div className="flex flex-1 flex-col justify-center gap-10 py-10">
        <div>
          <p className="text-[15px] font-medium text-ink-3">Entre amis, pour nos chiens</p>
          <h1 className="mt-2 text-[64px] font-semibold leading-[0.9] tracking-[-0.05em] text-ink">
            Dog
            <br />
            care
          </h1>
          <p className="mt-5 max-w-xs text-[17px] leading-snug text-ink-2">
            Anticipez les gardes, voyez qui est disponible et repérez tout de suite les jours sans solution.
          </p>
        </div>
        {configured ? (
          <LoginForm next={next} expired={params.error === "link"} />
        ) : (
          <div className="rounded-3xl bg-surface p-5 text-[15px] text-ink-2" role="alert">
            L&apos;application n&apos;est pas encore configurée (variables Supabase manquantes).
          </div>
        )}
      </div>
    </main>
  );
}
