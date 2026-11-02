import { Skeleton } from "@/components/ui/kit";

/** Home (calendar) and other screens: the date block, then the day's cards. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 pt-2" role="status" aria-label="Chargement">
      <Skeleton className="h-40 rounded-[32px]" />
      <Skeleton className="h-11 rounded-full" />
      <Skeleton className="h-32 rounded-[28px]" />
      <Skeleton className="h-32 rounded-[28px]" />
    </div>
  );
}
