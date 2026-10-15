import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-[64px] font-semibold tracking-[-0.05em] text-ink">404</p>
      <p className="text-[17px] text-ink-2">
        Cette page n&apos;existe pas, ou vous n&apos;y avez pas accès.
      </p>
      <Link href="/" className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[15px] font-medium text-surface">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
