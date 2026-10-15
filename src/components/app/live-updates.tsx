"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { useBrowserClient } from "@/lib/supabase/client";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * Keeps screens fresh without depending on a permanent connection:
 * - Supabase Realtime (RLS-filtered) triggers a refresh on relevant changes
 * - returning to the app (visibility/focus) and reconnecting also refresh
 * - an offline banner explains why actions are unavailable
 */
export function LiveUpdates({ groupId, userId }: { groupId: string; userId: string }) {
  const router = useRouter();
  const supabase = useBrowserClient();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };

    const channel = supabase
      ?.channel(`group-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "care_requests", filter: `group_id=eq.${groupId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_responses" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "care_assignments" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();

    let lastHidden = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") lastHidden = Date.now();
      else if (Date.now() - lastHidden > 15_000) refresh();
    };
    const onOnline = () => refresh();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (supabase && channel) supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [groupId, userId, router, supabase]);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 top-[calc(env(safe-area-inset-top,0px)+72px)] z-40 mx-auto flex max-w-md items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[14px] font-medium text-surface shadow-lg"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      Hors ligne — les informations peuvent ne pas être à jour.
    </div>
  );
}
