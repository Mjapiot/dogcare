import "server-only";
import { after } from "next/server";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";
import { buildPushPayload, type PushNotificationInput, type PushPayload } from "@/lib/push-payload";

type SubscriptionRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; failure_count: number };

/** VAPID public key (safe to expose) or null when push is not configured. */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

function configureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

/**
 * Service-role client, used ONLY to deliver pushes to other members (read
 * their subscriptions, claim notifications). Never exposed to the browser.
 */
function getAdminClient(): SupabaseClient | null {
  const env = getSupabaseEnv();
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !secret) return null;
  return createAdminClient(env.url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

async function sendToSubscription(sub: SubscriptionRow, payload: PushPayload): Promise<"ok" | "gone" | "error"> {
  const target: PushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
  try {
    await webpush.sendNotification(target, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: "high", topic: payload.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "") });
    return "ok";
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return "gone";
    console.error("[dogcare] push failed", error instanceof WebPushError ? error.statusCode : "unknown");
    return "error";
  }
}

/**
 * Delivers pending notifications as pushes. Safe to call concurrently:
 * notifications are claimed atomically in the database.
 */
export async function dispatchPendingPush(): Promise<{ sent: number }> {
  if (!configureVapid()) return { sent: 0 };
  const admin = getAdminClient();
  if (!admin) return { sent: 0 };

  let sent = 0;
  for (let round = 0; round < 3; round++) {
    const { data, error } = await admin.rpc("claim_push_batch", { p_limit: 100 });
    if (error) {
      console.error("[dogcare] claim_push_batch", error.code);
      break;
    }
    const batch = (data ?? []) as Array<PushNotificationInput & { user_id: string }>;
    if (batch.length === 0) break;

    const userIds = [...new Set(batch.map((n) => n.user_id))];
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth, failure_count")
      .in("user_id", userIds);
    const byUser = new Map<string, SubscriptionRow[]>();
    for (const s of (subs ?? []) as SubscriptionRow[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

    const gone: string[] = [];
    const succeeded = new Set<string>();
    const failed = new Map<string, number>();
    await Promise.all(
      batch.map(async (n) => {
        const payload = buildPushPayload(n);
        for (const sub of byUser.get(n.user_id) ?? []) {
          const result = await sendToSubscription(sub, payload);
          if (result === "ok") {
            succeeded.add(sub.id);
            sent++;
          } else if (result === "gone") gone.push(sub.id);
          else failed.set(sub.id, sub.failure_count + 1);
        }
      }),
    );

    if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
    if (succeeded.size) {
      await admin
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .in("id", [...succeeded]);
    }
    for (const [id, count] of failed) {
      // a device failing repeatedly is forgotten; it can subscribe again
      if (count >= 5) await admin.from("push_subscriptions").delete().eq("id", id);
      else await admin.from("push_subscriptions").update({ failure_count: count }).eq("id", id);
    }
    await admin.rpc("complete_push_batch", { p_ids: batch.map((n) => n.id) });
    if (batch.length < 100) break;
  }
  return { sent };
}

/** Schedules delivery after the current response (does not slow the user down). */
export function schedulePushDispatch() {
  if (!isPushConfigured()) return;
  after(async () => {
    try {
      await dispatchPendingPush();
    } catch (error) {
      console.error("[dogcare] push dispatch error", error instanceof Error ? error.message : "unknown");
    }
  });
}

/** Sends a test push to the current user's own devices (no secret key needed). */
export async function sendPushToSubscriptions(subs: SubscriptionRow[], payload: PushPayload) {
  if (!configureVapid()) return { sent: 0, total: subs.length };
  let sent = 0;
  for (const sub of subs) if ((await sendToSubscription(sub, payload)) === "ok") sent++;
  return { sent, total: subs.length };
}
