"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, X } from "lucide-react";
import { updateDisplayName } from "@/server/actions/groups";
import { RoundIconButton } from "@/components/ui/kit";

/**
 * Profile header: the display name with a pencil to edit it in place
 * (Enter saves, Escape cancels).
 */
export function ProfileHeader({ displayName, email }: { displayName: string; email: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pencilRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setEditing(false);
    setError(null);
    // give focus back to the pencil once it is rendered again
    requestAnimationFrame(() => pencilRef.current?.focus());
  };

  const cancel = () => {
    setName(displayName);
    close();
  };

  const save = () => {
    if (name.trim() === displayName) return close();
    setError(null);
    startTransition(async () => {
      const r = await updateDisplayName(name);
      if (!r.ok) return setError(r.error);
      toast.success("Prénom mis à jour");
      close();
      router.refresh();
    });
  };

  return (
    <div className="px-1">
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="profile-name" className="sr-only">
            Prénom affiché
          </label>
          <input
            id="profile-name"
            autoFocus
            autoComplete="given-name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && cancel()}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "profile-name-error" : undefined}
            className="min-h-12 min-w-0 flex-1 rounded-2xl bg-surface px-3 text-[28px] font-semibold tracking-[-0.03em] text-ink outline-none ring-ink/20 focus:ring-2"
          />
          <RoundIconButton
            type="submit"
            icon={Check}
            label="Enregistrer le prénom"
            disabled={pending || !name.trim()}
            className="bg-ink text-white hover:bg-ink/90 disabled:opacity-50"
          />
          <RoundIconButton icon={X} label="Annuler" onClick={cancel} disabled={pending} />
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 truncate text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">{displayName}</h1>
          <RoundIconButton
            ref={pencilRef}
            icon={Pencil}
            label="Modifier le prénom"
            onClick={() => {
              setName(displayName);
              setEditing(true);
            }}
            className="shrink-0 bg-transparent text-ink-3 hover:bg-surface-2 hover:text-ink [&_svg]:size-4"
          />
        </div>
      )}
      {error ? (
        <p id="profile-name-error" role="alert" className="mt-1.5 text-[14px] font-medium text-[#9b1c14]">
          {error}
        </p>
      ) : (
        email && <p className="mt-1.5 text-[15px] text-ink-3">{email}</p>
      )}
    </div>
  );
}
