"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Eye, HeartPulse, Link2, Phone, Share2, X } from "lucide-react";
import { createPassportLink, revokePassportLink } from "@/server/actions/dogs";
import { SHARE_DURATIONS, shareLinkState } from "@/domain/passport";
import { shareLink } from "@/lib/native";
import type { DogShareLinkRow } from "@/lib/types";
import { Card, PillButton, Segmented } from "@/components/ui/kit";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";
import { cn } from "@/lib/utils";
import { deName } from "@/lib/format";

const DATE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * Caretakers share the passport through a temporary link: duration, optional
 * health and emergency sections, then the share sheet. Live links are listed
 * with their views and can be revoked.
 */
export function PassportShare({ dogId, dogName, origin, links }: { dogId: string; dogName: string; origin: string; links: DogShareLinkRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState<"24" | "168" | "720">("168");
  const [health, setHealth] = useState(false);
  const [emergency, setEmergency] = useState(true);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const now = new Date();
  const active = links.filter((l) => shareLinkState(l, now) === "active");

  const create = () =>
    startTransition(async () => {
      const r = await createPassportLink(dogId, { hours: Number(hours) as 24 | 168 | 720, health, emergency });
      if (!r.ok) return void toast.error(r.error);
      const url = `${origin}/p/${r.data.token}`;
      setCreated(url);
      router.refresh();
      const result = await shareLink({ title: `Passeport ${deName(dogName)}`, text: `Le passeport ${deName(dogName)} sur Dogcare :`, url });
      if (result === "copied") toast.success("Lien copié");
    });

  const revoke = (id: string) =>
    startTransition(async () => {
      const r = await revokePassportLink(dogId, id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Lien révoqué : il ne fonctionne plus");
      router.refresh();
    });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-beige text-ink">
          <Share2 className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Partager le passeport</h2>
          <p className="text-[14px] text-ink-3">
            Un lien temporaire, lisible sans compte : idéal pour un pet-sitter, un proche ou le vétérinaire.
          </p>
        </div>
      </div>
      <PillButton
        onClick={() => {
          setCreated(null);
          setOpen(true);
        }}
      >
        <Link2 className="size-4" aria-hidden /> Créer un lien
      </PillButton>

      {active.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface-2" aria-label="Liens actifs">
          {active.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">Jusqu&apos;au {DATE.format(new Date(l.expires_at))}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-3">
                  <span>{sectionsLabel(l)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Eye className="size-3.5" aria-hidden />
                    {l.view_count === 0 ? "pas encore ouvert" : `${l.view_count} ouverture${l.view_count > 1 ? "s" : ""}`}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRevoking(l.id)}
                disabled={pending}
                className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-[#7a1b14] hover:bg-[#f6dcd9]"
              >
                <X className="size-4" aria-hidden /> Révoquer
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-0 pb-safe">
          <SheetHeader>
            <SheetTitle className="text-xl font-semibold">Partager le passeport {deName(dogName)}</SheetTitle>
            <SheetDescription>Identité et habitudes sont toujours incluses. Vous pouvez révoquer le lien à tout moment.</SheetDescription>
          </SheetHeader>
          {created ? (
            <CreatedLink
              url={created}
              note={`Toute personne qui a ce lien peut voir le passeport ${deName(dogName)} jusqu'à son expiration.`}
              onDone={() => setOpen(false)}
            />
          ) : (
            <div className="flex flex-col gap-4 px-4 pb-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Valable pendant</span>
                <Segmented
                  label="Durée de validité"
                  value={hours}
                  onChange={setHours}
                  options={SHARE_DURATIONS.map((d) => ({ value: String(d.hours) as "24" | "168" | "720", label: d.label }))}
                />
              </div>
              <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface-2">
                <ToggleRow
                  id="share-health"
                  icon={HeartPulse}
                  title="Santé"
                  description="Allergies, traitements, vétérinaire."
                  checked={health}
                  onChange={setHealth}
                />
                <ToggleRow
                  id="share-emergency"
                  icon={Phone}
                  title="Urgences"
                  description="Contacts à appeler et consignes."
                  checked={emergency}
                  onChange={setEmergency}
                />
              </ul>
              <PillButton size="lg" loading={pending} onClick={create}>
                <Share2 className="size-4" aria-hidden /> Créer et partager
              </PillButton>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmationDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Révoquer ce lien ?"
        description="Les personnes qui l'ont reçu ne pourront plus consulter le passeport."
        confirmLabel="Révoquer"
        destructive
        pending={pending}
        onConfirm={() => {
          const id = revoking;
          setRevoking(null);
          if (id) revoke(id);
        }}
      />
    </Card>
  );
}

function sectionsLabel(l: DogShareLinkRow): string {
  const extra = [l.include_health && "santé", l.include_emergency && "urgences"].filter(Boolean);
  return extra.length ? `Avec ${extra.join(" et ")}` : "Identité et habitudes";
}

function ToggleRow({
  id,
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  id: string;
  icon: typeof Phone;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <li className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
      <label htmlFor={id} className="flex items-center gap-3">
        <Icon className="size-5 text-ink-2" aria-hidden />
        <span>
          <span className="block text-[15px] font-medium text-ink">Inclure : {title}</span>
          <span className="block text-[13px] text-ink-3">{description}</span>
        </span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </li>
  );
}

/** The link, with a copy button that turns into a check mark once copied. */
export function CreatedLink({ url, note, onDone }: { url: string; note: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-1.5 pl-4">
        <p className="min-w-0 flex-1 truncate text-[14px] text-ink-2" title={url}>
          {url.replace(/^https?:\/\//, "")}
        </p>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              toast.error("Copie impossible.");
            }
          }}
          aria-label={copied ? "Lien copié" : "Copier le lien"}
          className={cn(
            "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
            copied ? "bg-sage text-surface" : "bg-ink text-surface",
          )}
        >
          <Copy className={cn("absolute size-4 transition-all duration-300", copied ? "scale-50 opacity-0" : "scale-100 opacity-100")} aria-hidden />
          <Check className={cn("absolute size-4 transition-all duration-300", copied ? "scale-100 opacity-100" : "scale-50 opacity-0")} aria-hidden />
        </button>
      </div>
      <p className="text-[13px] text-ink-3" aria-live="polite">
        {copied ? "Lien copié." : note}
      </p>
      <PillButton variant="soft" onClick={onDone}>
        Terminé
      </PillButton>
    </div>
  );
}
