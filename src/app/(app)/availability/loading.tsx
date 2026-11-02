import { ScreenSkeleton } from "@/components/ui/kit";

export default function Loading() {
  return <ScreenSkeleton title="Mes dispos" subtitle="Indiquez à l'avance quand vous pourriez aider. Ce n'est jamais un engagement." tabs={3} cards={2} />;
}
