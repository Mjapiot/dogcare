import "server-only";
import { after } from "next/server";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";
import { buildPushPayload, isAllowedPushEndpoint, type PushNotificationInput, type PushPayload } from "@/lib/push-payload";
import { isApnsConfigured, sendApns, type ApnsEnvironment } from "@/server/apns";
import { decideDevice, decideNotification, type DeviceOutcome } from "@/lib/push-delivery";

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  platform: "web" | "ios";
  p256dh: string | null;
  auth: string | null;
  apns_environment: ApnsEnvironment | null;
  failure_count: number;
};

const SUBSCRIPTION_COLUMNS = "id, user_id, endpoint, platform, p256dh, auth, apns_environment, failure_count";

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

function isWebPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

/** True when at least one channel (Web Push or native iOS) can deliver. */
export function isPushConfigured(): boolean {
  return isWebPushConfigured() || isApnsConfigured();
}

type SendOutcome = { status: DeviceOutcome; apnsEnvironment?: ApnsEnvironment | null; reason?: string };

async function sendToSubscription(sub: SubscriptionRow, payload: PushPayload): Promise<SendOutcome> {
  if (sub.platform === "ios") {
    if (!isApnsConfigured()) return { status: "unconfigured", reason: "APNs non configuré (variables APNS_*)" };
    const token = sub.endpoint.replace(/^apns:/, "");
    try {
      const { result, environment, reason } = await sendApns(token, payload, sub.apns_environment);
      return { status: result === "ok" ? "ok" : result === "gone" ? "gone" : "error", apnsEnvironment: environment, reason };
    } catch (error) {
      return { status: "error", reason: error instanceof Error ? error.message : "unknown" };
    }
  }
  // never call an address that is not a known push service (SSRF guard)
  if (!isAllowedPushEndpoint(sub.endpoint)) return { status: "gone", reason: "unsupported push service" };
  if (!configureVapid()) return { status: "unconfigured", reason: "Web Push non configuré (variables VAPID_*)" };
  if (!sub.p256dh || !sub.auth) return { status: "gone", reason: "incomplete subscription" };
  const target: PushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
  try {
    await webpush.sendNotification(target, JSON.stringify(payload), {
      TTL: 60 * 60 * 6,
      urgency: "high",
      topic: payload.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, ""),
    });
    return { status: "ok" };
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return { status: "gone" };
    console.error("[dogcare] push failed", error instanceof WebPushError ? error.statusCode : "unknown");
    return { status: "error" };
  }
}

/**
 * Delivers pending notifications as pushes. Safe to call concurrently:
 * notifications are claimed atomically in the database. A notification that
 * could not reach any device because of a transient error is put back in the
 * queue (retried on a later dispatch, at most 5 times within 30 minutes).
 */
export async function dispatchPendingPush(): Promise<{ sent: number }> {
  if (!isPushConfigured()) return { sent: 0 };
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
    const { data: subs } = await admin.from("push_subscriptions").select(SUBSCRIPTION_COLUMNS).in("user_id", userIds);
    const byUser = new Map<string, SubscriptionRow[]>();
    for (const sub of (subs ?? []) as SubscriptionRow[]) byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub]);

    // every device gets one aggregated outcome per batch (it may receive several notifications)
    const deviceOutcomes = new Map<string, DeviceOutcome[]>();
    const environments = new Map<string, ApnsEnvironment>();
    const completed: string[] = [];
    const retry: string[] = [];

    await Promise.all(
      batch.map(async (n) => {
        const payload = buildPushPayload(n);
        const outcomes: DeviceOutcome[] = [];
        for (const sub of byUser.get(n.user_id) ?? []) {
          const outcome = await sendToSubscription(sub, payload);
          outcomes.push(outcome.status);
          deviceOutcomes.set(sub.id, [...(deviceOutcomes.get(sub.id) ?? []), outcome.status]);
          if (outcome.status === "ok") sent++;
          if (outcome.apnsEnvironment && outcome.apnsEnvironment !== sub.apns_environment) {
            environments.set(sub.id, outcome.apnsEnvironment);
          }
        }
        (decideNotification(outcomes) === "complete" ? completed : retry).push(n.id);
      }),
    );

    const allSubs = new Map(((subs ?? []) as SubscriptionRow[]).map((sub) => [sub.id, sub]));
    const forget: string[] = [];
    const succeeded: string[] = [];
    for (const [id, outcomes] of deviceOutcomes) {
      const aggregated: DeviceOutcome = outcomes.includes("ok")
        ? "ok"
        : outcomes.includes("gone")
          ? "gone"
          : outcomes.includes("error")
            ? "error"
            : "unconfigured";
      const decision = decideDevice(aggregated, allSubs.get(id)?.failure_count ?? 0);
      if (decision.action === "success") succeeded.push(id);
      else if (decision.action === "forget") forget.push(id);
      else if (decision.action === "count-failure") {
        await admin.from("push_subscriptions").update({ failure_count: decision.failures }).eq("id", id);
      }
    }
    if (forget.length) await admin.from("push_subscriptions").delete().in("id", forget);
    if (succeeded.length) {
      await admin
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .in("id", succeeded);
    }
    for (const [id, environment] of environments) {
      await admin.from("push_subscriptions").update({ apns_environment: environment }).eq("id", id);
    }
    if (completed.length) await admin.rpc("complete_push_batch", { p_ids: completed });
    if (retry.length) await admin.rpc("release_push_batch", { p_ids: retry });
    if (batch.length < 100) break;
  }

  return { sent };
}

/** Care log photos: 90 days after the garde, and files no entry references (the text stays). */
async function purgeCareLogPhotos(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("care_log_photos_to_purge", { p_limit: 100 });
  if (error) return void console.error("[dogcare] care_log_photos_to_purge", error.code);
  const paths = ((data ?? []) as Array<{ path: string }>).map((r) => r.path);
  if (paths.length === 0) return;
  const { error: removeError } = await admin.storage.from("care-logs").remove(paths);
  if (removeError) return void console.error("[dogcare] care-logs remove", removeError.message);
  const { error: forgetError } = await admin.rpc("forget_care_log_photos", { p_paths: paths });
  if (forgetError) console.error("[dogcare] forget_care_log_photos", forgetError.code);
}

/** Daily job: tomorrow's reminders (run_daily_reminders), then delivery of the pushes. */
export async function runDailyJob(): Promise<{ ok: boolean; reminders: number; sent: number }> {
  const admin = getAdminClient();
  if (!admin) return { ok: false, reminders: 0, sent: 0 };
  const { data, error } = await admin.rpc("run_daily_reminders");
  if (error) {
    console.error("[dogcare] run_daily_reminders", error.code);
    return { ok: false, reminders: 0, sent: 0 };
  }
  const { sent } = await dispatchPendingPush();
  // housekeeping once a day: old notifications and audit events, care log photos
  const { error: purgeError } = await admin.rpc("purge_old_records");
  if (purgeError) console.error("[dogcare] purge_old_records", purgeError.code);
  await purgeCareLogPhotos(admin);
  return { ok: true, reminders: Number(data ?? 0), sent };
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
  let sent = 0;
  const reasons: string[] = [];
  for (const sub of subs) {
    const outcome = await sendToSubscription(sub, payload);
    if (outcome.status === "ok") sent++;
    else if (outcome.reason) reasons.push(outcome.reason);
  }
  return { sent, total: subs.length, reasons };
}

export { SUBSCRIPTION_COLUMNS };
