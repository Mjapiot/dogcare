import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Contact address shown on the public pages (SUPPORT_EMAIL env). */
export function getSupportEmail(): string | null {
  return process.env.SUPPORT_EMAIL?.trim() || null;
}

export function SupportEmail() {
  const email = getSupportEmail();
  if (!email) {
    return <mark className="rounded bg-[var(--tone-pending)] px-1 text-[var(--tone-pending-ink)]">[adresse de contact à renseigner]</mark>;
  }
  return (
    <a href={`mailto:${email}`} className="font-medium text-ink underline underline-offset-2">
      {email}
    </a>
  );
}

/** Simple readable layout for public pages (privacy, support). */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-5 pt-safe pb-safe">
      <div className="pt-6">
        <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-ink-2">
          <ArrowLeft className="size-4" aria-hidden /> Dogcare
        </Link>
        <h1 className="mt-2 text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">{title}</h1>
        <p className="mt-2 text-[14px] text-ink-3">Dernière mise à jour : {updated}</p>
      </div>
      <article className="flex flex-col gap-6 pb-12 text-[16px] leading-relaxed text-ink-2 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_section]:flex [&_section]:flex-col [&_section]:gap-2 [&_strong]:text-ink">
        {children}
      </article>
    </main>
  );
}
