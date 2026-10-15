/**
 * Supabase configuration, read on the server. Accepted names:
 * - URL: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
 * - key: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *        SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY
 * The URL and the publishable key are public by design (RLS protects data);
 * the browser receives them from the root layout (SupabaseConfigProvider).
 * Never use a secret / service-role key here.
 */
export type SupabaseEnv = { url: string; key: string };

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error("Configuration Supabase manquante : définissez SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY.");
  }
  return env;
}
