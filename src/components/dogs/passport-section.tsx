"use client";

import { createContext, useContext, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Card } from "@/components/ui/kit";

const SectionEditContext = createContext<{ close: () => void }>({ close: () => {} });

/** For editors rendered inside a PassportSection: closes the editor. */
export function useSectionEdit() {
  return useContext(SectionEditContext);
}

/**
 * A passport card: read view, and for caretakers a "Modifier" button that
 * swaps it for the section's editor.
 */
export function PassportSection({
  id,
  title,
  icon,
  note,
  editor,
  children,
}: {
  id: string;
  title: string;
  /** Rendered icon element (components cannot cross the server/client boundary). */
  icon: React.ReactNode;
  note?: string;
  editor?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => editRef.current?.focus());
  };

  return (
    <Card className="flex flex-col gap-4" aria-labelledby={`${id}-title`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="flex items-center gap-3 text-[17px] font-semibold tracking-tight text-ink">
          <span className="flex size-10 items-center justify-center rounded-full bg-sage/12 text-sage [&_svg]:size-[18px]" aria-hidden>
            {icon}
          </span>
          {title}
        </h2>
        {editor && !editing && (
          <button
            ref={editRef}
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-ink/5"
            aria-label={`Modifier : ${title}`}
          >
            <Pencil className="size-4" aria-hidden /> Modifier
          </button>
        )}
      </div>
      {note && <p className="-mt-2 text-[13px] text-ink-3">{note}</p>}
      {editing ? <SectionEditContext.Provider value={{ close }}>{editor}</SectionEditContext.Provider> : children}
    </Card>
  );
}
