import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/server/session";
import { uuid } from "@/lib/validation";
import { DogScreen } from "@/components/dogs/dog-screen";

export const metadata: Metadata = { title: "Passeport" };

export default async function DogPage({ params }: PageProps<"/dogs/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { userId } = await requireAppContext();
  return <DogScreen dogId={id} userId={userId} mode="group" back={{ href: "/profile", label: "Profil" }} />;
}
