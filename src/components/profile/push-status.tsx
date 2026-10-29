"use client";

import { useEffect, useState } from "react";
import { getRememberedNativeToken, isNativeApp } from "@/lib/native";

/**
 * This device's notification state, read only (no prompt, no registration):
 * "Activées sur cet appareil", "Désactivées" or "Indisponibles ici".
 */
export function PushStatus() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = async (): Promise<string> => {
      if (isNativeApp()) {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const perm = await PushNotifications.checkPermissions();
        return perm.receive === "granted" && getRememberedNativeToken() ? "Activées" : "Désactivées";
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "Indisponibles ici";
      if (Notification.permission !== "granted") return "Désactivées";
      const reg = await navigator.serviceWorker.getRegistration("/");
      return (await reg?.pushManager.getSubscription()) ? "Activées" : "Désactivées";
    };
    read()
      .then((l) => !cancelled && setLabel(l))
      .catch(() => !cancelled && setLabel("Désactivées"));
    return () => {
      cancelled = true;
    };
  }, []);
  return <span aria-live="polite">{label ?? ""}</span>;
}
