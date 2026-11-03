import { Skeleton } from "@/components/ui/kit";

/** The passport: hero card, then its sections. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4 pt-2" role="status" aria-label="Chargement">
      <Skeleton className="h-11 w-24 rounded-full" />
      <Skeleton className="h-56 rounded-[32px]" />
      <Skeleton className="h-28 rounded-[28px]" />
      <Skeleton className="h-40 rounded-[28px]" />
    </div>
  );
}
