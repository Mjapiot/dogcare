import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/** One line of a settings list (iOS Settings style): icon, label, state, chevron. */
export function SettingsRow({ href, icon: Icon, label, status }: { href: string; icon: LucideIcon; label: string; status?: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sage/15 text-ink">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">{label}</span>
      {status && <span className="shrink-0 text-[14px] text-ink-3">{status}</span>}
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
