"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | undefined;

/** Browser client, used for realtime subscriptions and photo uploads. */
export function getBrowserClient() {
  if (!client) {
    const { url, key } = requireSupabaseEnv();
    client = createBrowserClient(url, key);
  }
  return client;
}
