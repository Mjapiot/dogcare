"use client";

import { Capacitor } from "@capacitor/core";

/** True inside the iOS app (Capacitor shell), false in Safari / browsers. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

const TOKEN_KEY = "dogcare:apns-token";

export function rememberNativeToken(endpoint: string | null) {
  try {
    if (endpoint) localStorage.setItem(TOKEN_KEY, endpoint);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

export function getRememberedNativeToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Light haptic confirmation in the iOS app; no-op on the web. */
export async function hapticSuccess() {
  if (!isNativeApp()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // ignore
  }
}

/**
 * Shares a link: native share sheet in the app, Web Share API in Safari,
 * clipboard otherwise. Returns "copied" when the link was copied.
 */
export async function shareLink(input: { title: string; text: string; url: string }): Promise<"shared" | "copied" | "cancelled"> {
  try {
    if (isNativeApp()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: input.title, text: input.text, url: input.url, dialogTitle: input.title });
      return "shared";
    }
    if (navigator.share) {
      await navigator.share(input);
      return "shared";
    }
    await navigator.clipboard.writeText(`${input.text} ${input.url}`);
    return "copied";
  } catch {
    return "cancelled";
  }
}
