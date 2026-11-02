import { Skeleton } from "@/components/ui/kit";

export default function Loading() {
  return (
    <div className="flex flex-col gap-7 pt-2" role="status" aria-label="Chargement">
      <Skeleton className="h-44 rounded-[32px]" />
      <Skeleton className="h-28 rounded-[28px]" />
      <Skeleton className="h-56 rounded-[28px]" />
    </div>
  );
}
