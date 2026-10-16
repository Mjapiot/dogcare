"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/server/session";
import { toUserMessage } from "@/server/errors";
import { isPushConfigured, sendPushToSubscriptions, SUBSCRIPTION_COLUMNS } from "@/server/push";
import type { ActionResult } from "@/lib/types";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(10).max(100) }),
});

export async function savePushSubscription(input: unknown, userAgent: string): Promise<ActionResult> {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Abonnement aux notifications invalide." };
  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: userAgent.slice(0, 300),
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  return { ok: true, data: undefined };
}

/** Native iOS app: registers the APNs device token of this iPhone. */
export async function saveNativePushToken(token: string, userAgent: string): Promise<ActionResult<{ endpoint: string }>> {
  const parsed = z.string().regex(/^[0-9a-fA-F]{64,200}$/).safeParse(token);
  if (!parsed.success) return { ok: false, error: "Jeton de notification invalide." };
  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_native_push", { p_token: parsed.data, p_user_agent: userAgent.slice(0, 300) });
  if (error) return { ok: false, error: toUserMessage(error) };
  return { ok: true, data: { endpoint: `apns:${parsed.data.toLowerCase()}` } };
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  const parsed = z.string().min(10).max(1000).safeParse(endpoint);
  if (!parsed.success) return { ok: false, error: "Abonnement invalide." };
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", parsed.data);
  if (error) return { ok: false, error: toUserMessage(error) };
  return { ok: true, data: undefined };
}

/** Sends a test notification to this device only. */
export async function sendTestPush(endpoint: string): Promise<ActionResult<{ sent: number }>> {
  if (!isPushConfigured()) return { ok: false, error: "Les notifications push ne sont pas encore configurées sur le serveur." };
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data?.length) return { ok: false, error: "Cet appareil n'est pas abonné. Réactivez les notifications." };
  const result = await sendPushToSubscriptions(data, {
    title: "Dogcare",
    body: "Les notifications fonctionnent sur cet appareil 🐾",
    url: "/profile",
    tag: "test",
  });
  if (result.sent === 0) {
    const detail = result.reasons.length ? ` (${result.reasons.join(" ; ")})` : "";
    return { ok: false, error: `L'envoi a échoué${detail}. Désactivez puis réactivez les notifications.` };
  }
  return { ok: true, data: { sent: result.sent } };
}
