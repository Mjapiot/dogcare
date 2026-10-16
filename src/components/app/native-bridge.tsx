"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativeApp } from "@/lib/native";

const APP_HOST = "dogcare-gamma.vercel.app";

/** In-app path for a universal link or a notification URL, or null. */
function toInAppPath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    if (url.host !== APP_HOST && url.host !== window.location.host) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Native glue for the iOS app (no-op on the web):
 * - universal links (invitations, requests, login links) open inside the app
 * - tapping a push notification opens the related screen
 * - status bar matches the warm canvas
 */
export function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      const [{ App }, { PushNotifications }, { StatusBar, Style }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/push-notifications"),
        import("@capacitor/status-bar"),
      ]);
      if (disposed) return;
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});

      const urlListener = await App.addListener("appUrlOpen", ({ url }) => {
        const path = toInAppPath(url);
        if (path) router.push(path);
      });
      const tapListener = await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const data = action.notification.data as { url?: string } | undefined;
        const path = toInAppPath(data?.url) ?? "/notifications";
        router.push(path);
      });
      const receivedListener = await PushNotifications.addListener("pushNotificationReceived", () => {
        // app in foreground: refresh data so the bell and screens are up to date
        router.refresh();
      });
      cleanups.push(() => urlListener.remove(), () => tapListener.remove(), () => receivedListener.remove());
    })().catch(() => {});

    return () => {
      disposed = true;
      for (const c of cleanups) c();
    };
  }, [router]);

  return null;
}
