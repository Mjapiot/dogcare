import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";

/** In "Mes chiens" (no group yet): gardes between friends start with a group. */
export function OrganizeCard() {
  return (
    <Link href="/onboarding/group" className="glass shadow-soft flex items-center gap-3 rounded-[28px] p-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sage/15 text-ink">
        <Users className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">Organiser des gardes entre amis</span>
        <span className="block text-[14px] text-ink-2">Créez ou rejoignez un groupe : demandes, planning, carnet de garde.</span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-ink-2" aria-hidden />
    </Link>
  );
}
