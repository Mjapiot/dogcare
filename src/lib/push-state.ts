import { getRememberedNativeToken, isNativeApp } from "@/lib/native";

/** This device's notification state, read only (no prompt, no registration). Browser only. */
export async function readPushState(): Promise<"on" | "off" | "unavailable"> {
  if (isNativeApp()) {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.checkPermissions();
    return perm.receive === "granted" && getRememberedNativeToken() ? "on" : "off";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unavailable";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}
