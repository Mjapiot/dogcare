"use client";

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseEnv } from "@/lib/env";

const SupabaseConfigContext = createContext<SupabaseEnv | null>(null);

/** Receives the public Supabase config from the server (root layout). */
export function SupabaseConfigProvider({ value, children }: { value: SupabaseEnv | null; children: ReactNode }) {
  return createElement(SupabaseConfigContext.Provider, { value }, children);
}

/** Browser client, used for realtime subscriptions and photo uploads. */
export function useBrowserClient() {
  const config = useContext(SupabaseConfigContext);
  const url = config?.url;
  const key = config?.key;
  // @supabase/ssr keeps a single browser instance internally
  return useMemo(() => (url && key ? createBrowserClient(url, key) : null), [url, key]);
}
