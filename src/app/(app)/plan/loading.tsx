import { ScreenSkeleton } from "@/components/ui/kit";

export default function Loading() {
  return <ScreenSkeleton title="Planifier une absence" subtitle="L'app propose qui garde quand, d'après les dispos de chacun. Rien n'est envoyé sans vous." cards={2} />;
}
