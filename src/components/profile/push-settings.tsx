"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { BellOff, BellRing, Send } from "lucide-react";
import { removePushSubscription, saveNativePushToken, savePushSubscription, sendTestPush } from "@/server/actions/push";
import { getRememberedNativeToken, isNativeApp, rememberNativeToken } from "@/lib/native";
import { urlBase64ToUint8Array } from "@/lib/push-payload";
import { PillButton } from "@/components/ui/kit";
import { InstallHint } from "@/components/pwa/install-hint";

type State = "loading" | "unsupported" | "ios-browser" | "denied" | "off" | "on";

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function getRegistration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

/** Asks iOS for permission and returns the APNs device token (native app). */
async function registerNative(): Promise<string | null> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return null;
  return new Promise<string | null>((resolve) => {
    const handles: Array<{ remove: () => Promise<void> }> = [];
    const done = (value: string | null) => {
      clearTimeout(timeout);
      for (const h of handles) void h.remove();
      resolve(value);
    };
    const timeout = setTimeout(() => done(null), 15_000);
    void Promise.all([
      PushNotifications.addListener("registration", ({ value }) => done(value)),
      PushNotifications.addListener("registrationError", () => done(null)),
    ]).then((hs) => {
      handles.push(...hs);
      void PushNotifications.register();
    });
  });
}

/** Removes this device's subscription (sign-out, account deletion). */
export async function forgetThisDevice({ localOnly = false }: { localOnly?: boolean } = {}) {
  if (isNativeApp()) {
    const endpoint = getRememberedNativeToken();
    if (endpoint && !localOnly) await removePushSubscription(endpoint).catch(() => {});
    rememberNativeToken(null);
    return;
  }
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    if (!localOnly) await removePushSubscription(sub.endpoint);
    await sub.unsubscribe();
  } catch {
    // best effort
  }
}

export function PushSettings({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [nativeApp] = useState(() => typeof window !== "undefined" && isNativeApp());

  const refresh = useCallback(async () => {
    if (isNativeApp()) {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const perm = await PushNotifications.checkPermissions();
      if (perm.receive === "denied") return setState("denied");
      if (perm.receive === "granted") {
        // re-attach this iPhone to the account currently signed in
        const token = await registerNative();
        if (token && getRememberedNativeToken() === `apns:${token.toLowerCase()}`) {
          setEndpoint(`apns:${token.toLowerCase()}`);
          return setState("on");
        }
        if (token) {
          const r = await saveNativePushToken(token, navigator.userAgent);
          if (r.ok) {
            rememberNativeToken(r.data.endpoint);
            setEndpoint(r.data.endpoint);
            return setState("on");
          }
        }
      }
      return setState("off");
    }
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return setState(isIos() && !isStandalone() ? "ios-browser" : "unsupported");
    if (Notification.permission === "denied") return setState("denied");
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === "granted") {
      // re-attach the device to the account currently signed in
      await savePushSubscription(sub.toJSON(), navigator.userAgent);
      setEndpoint(sub.endpoint);
      setState("on");
    } else {
      setState("off");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser APIs once on mount
    refresh().catch(() => setState("unsupported"));
  }, [refresh]);

  const enable = () =>
    startTransition(async () => {
      if (isNativeApp()) {
        const token = await registerNative();
        if (!token) {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const perm = await PushNotifications.checkPermissions();
          setState(perm.receive === "denied" ? "denied" : "off");
          if (perm.receive !== "denied") toast.error("Impossible d'activer les notifications sur cet iPhone.");
          return;
        }
        const r = await saveNativePushToken(token, navigator.userAgent);
        if (!r.ok) return void toast.error(r.error);
        rememberNativeToken(r.data.endpoint);
        setEndpoint(r.data.endpoint);
        setState("on");
        toast.success("Notifications activées sur cet iPhone");
        return;
      }
      if (!vapidPublicKey) return void toast.error("Les notifications ne sont pas encore configurées sur le serveur.");
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await getRegistration();
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
        const r = await savePushSubscription(sub.toJSON(), navigator.userAgent);
        if (!r.ok) return void toast.error(r.error);
        setEndpoint(sub.endpoint);
        setState("on");
        toast.success("Notifications activées sur cet appareil");
      } catch {
        toast.error("Impossible d'activer les notifications sur cet appareil.");
      }
    });

  const disable = () =>
    startTransition(async () => {
      await forgetThisDevice();
      setEndpoint(null);
      setState("off");
      toast.success("Notifications désactivées sur cet appareil");
    });

  const test = () =>
    startTransition(async () => {
      if (!endpoint) return;
      const r = await sendTestPush(endpoint);
      if (!r.ok) toast.error(r.error);
      else toast.success("Notification de test envoyée");
    });

  if (state === "loading") return <div className="h-24 animate-pulse rounded-[24px] bg-surface/70" aria-hidden />;

  if (state === "ios-browser") {
    return (
      <div className="flex flex-col gap-2">
        <p className="px-1 text-[14px] text-ink-2">
          Sur iPhone, les notifications ne fonctionnent qu&apos;une fois Dogcare ajouté à l&apos;écran d&apos;accueil.
          Ouvrez ensuite l&apos;app depuis son icône et revenez ici.
        </p>
        <InstallHint always />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-surface p-4">
      {state === "unsupported" && (
        <p className="text-[14px] text-ink-2">Ce navigateur ne permet pas les notifications. L&apos;application reste utilisable normalement.</p>
      )}
      {state === "denied" && (
        <p className="text-[14px] text-ink-2">
          Les notifications ont été refusées pour Dogcare. Pour les réactiver : Réglages de l&apos;iPhone → Notifications →
          Dogcare → Autoriser les notifications, puis revenez ici.
          {nativeApp && " (Réglages → Apps → Dogcare → Notifications sur les versions récentes d'iOS.)"}
        </p>
      )}
      {state === "off" && (
        <>
          <p className="text-[14px] text-ink-2">
            Recevez les nouvelles demandes, propositions d&apos;aide, confirmations et annulations même quand l&apos;app est
            fermée. Les préférences ci-dessus s&apos;appliquent aussi.
          </p>
          <PillButton onClick={enable} loading={pending} disabled={!vapidPublicKey && !nativeApp}>
            <BellRing className="size-4" aria-hidden /> Activer sur cet appareil
          </PillButton>
          {!vapidPublicKey && !nativeApp && <p className="text-[13px] text-ink-3">Configuration serveur en attente.</p>}
        </>
      )}
      {state === "on" && (
        <>
          <p className="flex items-center gap-2 text-[15px] font-medium text-[var(--tone-covered-ink)]">
            <BellRing className="size-4" aria-hidden /> Activées sur cet appareil
          </p>
          <div className="grid grid-cols-2 gap-2">
            <PillButton size="sm" variant="soft" onClick={test} disabled={pending}>
              <Send className="size-4" aria-hidden /> Tester
            </PillButton>
            <PillButton size="sm" variant="outline" onClick={disable} disabled={pending}>
              <BellOff className="size-4" aria-hidden /> Désactiver
            </PillButton>
          </div>
        </>
      )}
    </div>
  );
}
