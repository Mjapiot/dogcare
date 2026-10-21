"use client";

import { useSyncExternalStore, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";
import { isNativeApp } from "@/lib/native";

const KEY = "dogcare:install-hint-dismissed";

function readEnvironment() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(KEY) === "1";
  } catch {
    // storage unavailable (private mode): just show the hint
  }
  if (isNativeApp()) return "native";
  return ios && !standalone && !dismissed ? "show" : "hide";
}

const subscribe = () => () => {};

/** Explains how to install the app on iPhone (only in Safari, not installed). */
export function InstallHint({ always = false }: { always?: boolean }) {
  const env = useSyncExternalStore(subscribe, readEnvironment, () => "hide");
  const [closed, setClosed] = useState(false);
  if (env === "native" || (!always && env !== "show") || closed) return null;

  return (
    <aside className="relative mx-1 rounded-2xl bg-[var(--tone-info)] p-4 pr-12 text-[var(--tone-info-ink)]">
      <p className="text-[15px] font-semibold">Installez Dogcare sur votre iPhone</p>
      <ol className="mt-2 flex flex-col gap-1.5 text-[14px]">
        <li className="flex items-center gap-2">
          1. Touchez <Share className="size-4" aria-label="Partager" /> dans Safari
        </li>
        <li className="flex items-center gap-2">
          2. Choisissez « Sur l&apos;écran d&apos;accueil » <SquarePlus className="size-4" aria-hidden />
        </li>
      </ol>
      <p className="mt-2 text-[13px] opacity-80">
        L&apos;application s&apos;ouvrira en plein écran, comme une app native, et pourra recevoir des notifications.
      </p>
      {!always && (
        <button
          type="button"
          aria-label="Masquer"
          onClick={() => {
            try {
              localStorage.setItem(KEY, "1");
            } catch {
              // ignore
            }
            setClosed(true);
          }}
          className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-full hover:bg-black/5"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </aside>
  );
}
