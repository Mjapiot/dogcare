import { redirect } from "next/navigation";
import { localDate } from "@/lib/validation";

/** New needs go through "Besoin d'une garde" (a date from the calendar is kept). */
export default async function NewRequestPage({ searchParams }: PageProps<"/requests/new">) {
  const date = localDate.safeParse((await searchParams).date).data;
  redirect(date ? `/plan?date=${date}` : "/plan");
}
