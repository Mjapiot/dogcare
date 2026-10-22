"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativeApp } from "@/lib/native";
import { safeRedirectPath } from "@/lib/safe-redirect";

const APP_HOST = "dogcare-gamma.vercel.app";
/** Custom URL scheme (Info.plist) used by the e-mail login link. */
const APP_SCHEME = "app.dogcare.ios:";

/** In-app path for a universal link or a notification URL, or null. */
function toInAppPath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("/")) {
    const path = safeRedirectPath(raw, "");
    return path || null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol === APP_SCHEME) {
      // app.dogcare.ios:///auth/confirm?code=… (login link); tolerate "//auth/…"
      const path = `${url.host ? `/${url.host}` : ""}${url.pathname}`;
      return safeRedirectPath(`${path}${url.search}`, "") || null;
    }
    if (url.host !== APP_HOST && url.host !== window.location.host) return null;
    return safeRedirectPath(`${url.pathname}${url.search}`, "") || null;
  } catch {
    return null;
  }
}

// getLaunchUrl keeps returning the same URL for the whole app session
const handledLaunchUrls = new Set<string>();

/**
 * Native glue for the iOS app (no-op on the web):
 * - universal links and app.dogcare.ios:// links (invitations, requests,
 *   login links) open inside the app, including when they launch it
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

      const keep = (handle: { remove: () => Promise<void> }) => {
        // the effect may have been cleaned up while we were awaiting
        if (disposed) void handle.remove();
        else cleanups.push(() => void handle.remove());
      };
      const open = (url: string | undefined) => {
        const path = toInAppPath(url);
        if (!path) return;
        // /auth/confirm is a route handler: it needs a full navigation
        if (path.startsWith("/auth/")) window.location.assign(path);
        else router.push(path);
      };
      keep(await App.addListener("appUrlOpen", ({ url }) => open(url)));
      // the app may have been launched by the link itself
      const launch = await App.getLaunchUrl().catch(() => undefined);
      if (!disposed && launch?.url && !handledLaunchUrls.has(launch.url)) {
        handledLaunchUrls.add(launch.url);
        open(launch.url);
      }
      keep(
        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          const data = action.notification.data as { url?: string } | undefined;
          router.push(toInAppPath(data?.url) ?? "/notifications");
        }),
      );
      keep(
        await PushNotifications.addListener("pushNotificationReceived", () => {
          // app in foreground: refresh data so the bell and screens are up to date
          router.refresh();
        }),
      );
    })().catch(() => {});

    return () => {
      disposed = true;
      for (const c of cleanups) c();
    };
  }, [router]);

  return null;
}
