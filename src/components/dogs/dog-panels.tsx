"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type DogPanel = {
  id: string;
  title: string;
  sub: string;
  /** Rendered icon element (components cannot cross the server/client boundary). */
  icon: React.ReactNode;
  /** Background of the tile's icon bubble. */
  tone: string;
  /** Full width tile (settings). */
  wide?: boolean;
  content: React.ReactNode;
};

/**
 * The dog page as tiles (Passeport, Santé, Cercle, Routines, Réglages): a tap
 * opens that part below the tiles, a second tap closes it. A link to
 * "#health" (or any tile id) opens it directly. Every part stays mounted, so
 * an editor keeps what was typed when another tile is opened.
 */
export function DogPanels({ panels }: { panels: DogPanel[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const ids = panels.map((p) => p.id).join(",");
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (ids.split(",").includes(id)) setOpen(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [ids]);

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next) requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5">
        {panels.map((p) => {
          const on = open === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-expanded={on}
              aria-controls={`panel-${p.id}`}
              onClick={() => toggle(p.id)}
              className={cn(
                "flex min-h-32 flex-col justify-between gap-4 rounded-[26px] bg-surface p-4 text-left transition-shadow active:scale-[0.98]",
                on && "ring-[2.5px] ring-ink",
                p.wide && "col-span-2 min-h-0 flex-row items-center justify-start",
              )}
            >
              <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full text-ink [&_svg]:size-5", p.tone)} aria-hidden>
                {p.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[17px] font-semibold text-ink">{p.title}</span>
                <span className="block text-[13px] text-ink-2">{p.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div ref={panelRef} className="scroll-mt-20">
        {panels.map((p) => (
          <section key={p.id} id={`panel-${p.id}`} aria-label={p.title} hidden={open !== p.id} className="flex flex-col gap-4">
            {p.content}
          </section>
        ))}
      </div>
    </div>
  );
}
