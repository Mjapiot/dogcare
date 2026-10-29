import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function BackToProfile() {
  return (
    <Link href="/profile" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-ink-2">
      <ArrowLeft className="size-4" aria-hidden /> Profil
    </Link>
  );
}
