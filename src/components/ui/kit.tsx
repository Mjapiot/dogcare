import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Loader2, type LucideIcon } from "lucide-react";

type PillVariant = "primary" | "outline" | "soft" | "ghost" | "danger";
type PillSize = "md" | "lg" | "sm";

const PILL_VARIANTS: Record<PillVariant, string> = {
  primary: "bg-ink text-surface hover:bg-ink/90",
  outline: "border border-ink/25 bg-transparent text-ink hover:bg-ink/5",
  soft: "bg-surface-2 text-ink hover:bg-[#e9e6df]",
  ghost: "bg-transparent text-ink hover:bg-ink/5",
  danger: "bg-[#f6dcd9] text-[#7a1b14] hover:bg-[#f1cbc6]",
};

const PILL_SIZES: Record<PillSize, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-11 px-5 text-[15px]",
  lg: "min-h-13 px-6 text-base",
};

export function pillClasses(variant: PillVariant = "primary", size: PillSize = "md", className?: string) {
  return cn(
    "inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45",
    PILL_VARIANTS[variant],
    PILL_SIZES[size],
    className,
  );
}

export function PillButton({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> & { variant?: PillVariant; size?: PillSize; loading?: boolean }) {
  return (
    <button
      type="button"
      className={pillClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function PillLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: PillVariant; size?: PillSize }) {
  return <Link className={pillClasses(variant, size, className)} {...props} />;
}

export function RoundIconButton({
  icon: Icon,
  label,
  className,
  badge,
  ...props
}: React.ComponentProps<"button"> & { icon: LucideIcon; label: string; badge?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "relative inline-flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink transition-colors hover:bg-[#e2dfd8]",
        className,
      )}
      {...props}
    >
      <Icon className="size-5" aria-hidden />
      {badge ? <Badge count={badge} /> : null}
    </button>
  );
}

export function RoundIconLink({
  icon: Icon,
  label,
  className,
  badge,
  ...props
}: React.ComponentProps<typeof Link> & { icon: LucideIcon; label: string; badge?: number }) {
  return (
    <Link
      aria-label={badge ? `${label} (${badge})` : label}
      className={cn(
        "relative inline-flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink transition-colors hover:bg-[#e2dfd8]",
        className,
      )}
      {...props}
    >
      <Icon className="size-5" aria-hidden />
      {badge ? <Badge count={badge} /> : null}
    </Link>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-[#b3261e] px-1.5 text-[11px] font-semibold leading-5 text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-3xl bg-surface p-5", className)} {...props} />;
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="text-[17px] font-semibold tracking-tight text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 px-1">
      <div>
        <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-[13px] text-ink-3">{hint}</p>}
      {error && (
        <p className="text-[13px] font-medium text-[#9b1c14]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputBase =
  "w-full rounded-2xl border border-line bg-surface px-4 text-[16px] text-ink placeholder:text-ink-3/70 outline-none transition focus:border-ink/40 focus:ring-2 focus:ring-ink/10 disabled:opacity-50";

export function TextInput({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(inputBase, "min-h-12", className)} {...props} />;
}

export function TextArea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(inputBase, "min-h-24 py-3", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(inputBase, "min-h-12 appearance-none bg-surface", className)} {...props} />;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-1 rounded-full bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-11 flex-1 rounded-full px-3 text-sm font-medium transition-colors",
            value === o.value ? "bg-ink text-surface" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-3xl bg-surface px-6 py-10 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Icon className="size-6 text-ink-2" aria-hidden />
      </div>
      <div>
        <p className="text-[17px] font-semibold text-ink">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-xs text-[15px] text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-3xl bg-surface/70", className)} aria-hidden />;
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Chargement">
      <Skeleton className="h-28" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-36" />
      ))}
    </div>
  );
}

export function Avatar({ name, className, tone = "beige" }: { name: string; className?: string; tone?: "beige" | "ink" }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ring-2 ring-surface",
        tone === "beige" ? "bg-beige text-ink" : "bg-ink text-surface",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
