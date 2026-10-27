import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { Clock, HeartPulse, IdCard, Link2Off, PawPrint, Phone, Utensils } from "lucide-react";
import { getSupabaseEnv } from "@/lib/env";
import { todayLocal } from "@/domain/time";
import type { PassportDog, PassportEmergency, PassportHealth } from "@/domain/passport";
import { Card } from "@/components/ui/kit";
import { DogAvatar } from "@/components/domain/request-bits";
import { PassportHero } from "@/components/dogs/passport-hero";
import { EmergencyView, HabitsView, HealthView, IdentityView } from "@/components/dogs/passport-view";

export const metadata: Metadata = {
  title: "Passeport partagé",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const APP_STORE_URL = "https://apps.apple.com/fr/app/dogcare-garde-entre-amis/id6823693947";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UNTIL = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

type SharedPassport = {
  expires_at: string;
  dog: PassportDog;
  health: PassportHealth | null;
  emergency: PassportEmergency | null;
};

/**
 * Shared passport, readable without an account. The secret token is the only
 * key: the database returns nothing for an unknown, expired or revoked link.
 */
export default async function SharedPassportPage({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
  const env = getSupabaseEnv();
  let passport: SharedPassport | null = null;
  let photoUrl: string | null = null;

  if (env && TOKEN_RE.test(token)) {
    const supabase = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.rpc("shared_passport", { p_token: token });
    if (error) console.error("[dogcare] shared passport", error.code, error.message);
    passport = (data as SharedPassport | null) ?? null;
    if (passport?.dog.photo_path) {
      const signed = await supabase.storage.from("dog-photos").createSignedUrl(passport.dog.photo_path, 60 * 30);
      photoUrl = signed.data?.signedUrl ?? null;
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-safe pb-safe">
      <div className="pt-4" />
      {passport ? (
        <>
          <PassportHero
            dog={passport.dog}
            today={todayLocal()}
            photo={<DogAvatar name={passport.dog.name} photoUrl={photoUrl} size={104} className="ring-4" />}
          />
          <p className="flex items-center gap-1.5 px-1 text-[13px] text-ink-3">
            <Clock className="size-3.5" aria-hidden /> Lien valable jusqu&apos;au {UNTIL.format(new Date(passport.expires_at))}
          </p>
          <ReadSection title="Identité" icon={IdCard}>
            <IdentityView dog={passport.dog} />
          </ReadSection>
          <ReadSection title="Habitudes" icon={Utensils}>
            <HabitsView dog={passport.dog} />
          </ReadSection>
          {passport.health && (
            <ReadSection title="Santé" icon={HeartPulse}>
              <HealthView health={passport.health} />
            </ReadSection>
          )}
          {passport.emergency && (
            <ReadSection title="Urgences" icon={Phone}>
              <EmergencyView emergency={passport.emergency} />
            </ReadSection>
          )}
        </>
      ) : (
        <Card className="mt-10 flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Link2Off className="size-6 text-ink-2" aria-hidden />
          </span>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Ce lien n&apos;est plus valide</h1>
          <p className="text-[15px] text-ink-3">
            Il a expiré ou a été révoqué. Demandez un nouveau lien à la personne qui vous l&apos;a envoyé.
          </p>
        </Card>
      )}

      <footer className="mt-4 mb-8 flex flex-col items-center gap-3 rounded-[28px] bg-ink px-6 py-6 text-center text-surface">
        <span className="flex size-11 items-center justify-center rounded-full bg-surface/10">
          <PawPrint className="size-5" aria-hidden />
        </span>
        <p className="text-[17px] font-semibold tracking-tight">Créé avec Dogcare</p>
        <p className="text-[14px] text-surface/70">
          Le passeport de votre chien et la garde entre amis, au même endroit. Gratuit.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <a href={APP_STORE_URL} className="inline-flex min-h-11 items-center rounded-full bg-surface px-5 text-[15px] font-medium text-ink">
            Télécharger sur l&apos;App Store
          </a>
          <Link href="/login" className="inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-medium text-surface/80">
            Ouvrir sur le web
          </Link>
        </div>
      </footer>
    </main>
  );
}

function ReadSection({ title, icon: Icon, children }: { title: string; icon: typeof Phone; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="flex items-center gap-3 text-[17px] font-semibold tracking-tight text-ink">
        <span className="flex size-10 items-center justify-center rounded-full bg-sage/12 text-sage" aria-hidden>
          <Icon className="size-[18px]" />
        </span>
        {title}
      </h2>
      {children}
    </Card>
  );
}
