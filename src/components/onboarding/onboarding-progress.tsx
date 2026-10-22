"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Linear onboarding progress: one rounded segment per step, completed ones
 * filled, the current one filling up on arrival. Not clickable (steps
 * cannot be skipped ahead); announced as "Étape 2 sur 4 : Groupe".
 */
export function OnboardingProgress({ steps, current }: { steps: readonly string[]; current: number }) {
  // start empty, then fill: the current segment animates in on every step
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <nav aria-label="Progression de l'inscription">
      <p className="sr-only">
        Étape {current} sur {steps.length} : {steps[current - 1]}
      </p>
      <ol className="flex gap-2" aria-hidden>
        {steps.map((title, i) => {
          const step = i + 1;
          const state = step < current ? "completed" : step === current ? "active" : "inactive";
          return (
            <li key={title} className="flex min-w-0 flex-1 flex-col gap-2.5" data-state={state}>
              <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full bg-ink motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out",
                    state === "completed" && "w-full",
                    state === "active" && (filled ? "w-full" : "w-0"),
                    state === "inactive" && "w-0",
                  )}
                />
              </span>
              <span
                className={cn(
                  "truncate text-[13px] font-semibold transition-colors duration-500",
                  state === "inactive" ? "text-ink-3" : "text-ink",
                )}
              >
                {title}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
