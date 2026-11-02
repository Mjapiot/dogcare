import { ScreenSkeleton } from "@/components/ui/kit";

export default function Loading() {
  return <ScreenSkeleton title="Demandes" subtitle="Un « oui » est une proposition : la garde n'est confiée qu'une fois confirmée." tabs={3} cards={3} />;
}
