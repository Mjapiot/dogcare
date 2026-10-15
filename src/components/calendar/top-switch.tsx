import Link from "next/link";
import { cn } from "@/lib/utils";

/** "Aujourd'hui | Calendrier" pills, as in the reference design. */
export function TopSwitch({ active }: { active: "today" | "calendar" }) {
  const item = (href: string, label: string, isActive: boolean) => (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full px-6 text-[15px] font-medium transition-colors",
        isActive ? "bg-ink text-surface" : "border border-ink/25 text-ink hover:bg-ink/5",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Vue" className="flex gap-2">
      {item("/", "Aujourd'hui", active === "today")}
      {item("/calendar", "Calendrier", active === "calendar")}
    </nav>
  );
}
