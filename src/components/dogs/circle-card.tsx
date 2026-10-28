"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronRight, HeartPulse, Phone, UserPlus, Users, X } from "lucide-react";
import { createCircleInvitation, removeCircleMember, revokeCircleInvitation, setCircleMember } from "@/server/actions/circle";
import { addCaretaker, removeCaretaker } from "@/server/actions/dogs";
import {
  ACCESS_LABELS,
  CIRCLE_KIND_HINTS,
  CIRCLE_KIND_LABELS,
  ROLE_DEFAULTS,
  guestState,
  guestWindow,
  lastGuestDay,
  type CircleKind,
  type SectionAccess,
} from "@/domain/circle";
import { addDays, toLocalDate, todayLocal } from "@/domain/time";
import { shareLink } from "@/lib/native";
import type { CircleInvitationRow, CircleMemberRow, ActionResult } from "@/lib/types";
import { Avatar, Card, Field, PillButton, Segmented, TextInput } from "@/components/ui/kit";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";
import { CreatedLink } from "./passport-share";
import { cn } from "@/lib/utils";
import { deName } from "@/lib/format";

const DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });

const KIND_STYLES: Record<CircleKind, string> = {
  owner: "bg-ink text-surface",
  co_owner: "bg-ink/85 text-surface",
  close: "bg-sage/15 text-sage",
  entourage: "bg-surface-2 text-ink-2",
  guest: "bg-[var(--tone-pending)] text-[var(--tone-pending-ink)]",
};

/**
 * Circle of trust (caretakers only): who sees what about the dog. Each person
 * opens a sheet to change their role, health/emergency access and dates;
 * people outside the groups are invited with a single-use link.
 */
export function CircleCard({
  dogId,
  dogName,
  origin,
  me,
  members,
  invitations,
}: {
  dogId: string;
  dogName: string;
  origin: string;
  me: string;
  members: CircleMemberRow[];
  invitations: CircleInvitationRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CircleMemberRow | null>(null);
  const [inviting, setInviting] = useState(false);
  const [pending, startTransition] = useTransition();
  const now = new Date();

  const revoke = (id: string) =>
    startTransition(async () => {
      const r = await revokeCircleInvitation(dogId, id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Invitation annulée");
      router.refresh();
    });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-sage/12 text-sage" aria-hidden>
          <Users className="size-[18px]" />
        </span>
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Cercle de confiance</h2>
          <p className="text-[13px] text-ink-3">Qui voit quoi sur {dogName}.</p>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {members.map((m) => {
          const editable = m.kind !== "owner";
          const state = m.kind === "guest" ? guestState(m, now) : null;
          const row = (
            <>
              <Avatar name={m.display_name} className="size-10 text-[14px]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-ink">
                    {m.display_name}
                    {m.user_id === me && <span className="font-normal text-ink-3"> (vous)</span>}
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", KIND_STYLES[m.kind])}>
                    {CIRCLE_KIND_LABELS[m.kind]}
                  </span>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-3">
                  {m.kind === "owner" || m.kind === "co_owner" ? (
                    <span>Tous les droits</span>
                  ) : (
                    <>
                      <AccessHint icon={HeartPulse} label="Santé" access={m.health_access} />
                      <AccessHint icon={Phone} label="Urgences" access={m.emergency_access} />
                    </>
                  )}
                  {m.ends_at && (
                    <span className={cn("font-medium", state === "ended" ? "text-[#7a1b14]" : "text-ink-2")}>
                      {state === "ended"
                        ? "Accès terminé"
                        : state === "upcoming" && m.starts_at
                          ? `Du ${DAY.format(new Date(m.starts_at))} au ${DAY.format(new Date(m.ends_at).getTime() - 1)}`
                          : `Jusqu'au ${DAY.format(new Date(m.ends_at).getTime() - 1)}`}
                    </span>
                  )}
                </span>
              </span>
            </>
          );
          return (
            <li key={m.user_id}>
              {editable ? (
                <button
                  type="button"
                  onClick={() => setEditing(m)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-surface-2 active:bg-surface-2"
                  aria-label={`${m.display_name}, ${CIRCLE_KIND_LABELS[m.kind]}. Modifier ses accès`}
                >
                  {row}
                  <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                </button>
              ) : (
                <div className="flex min-h-14 items-center gap-3 px-2 py-2">{row}</div>
              )}
            </li>
          );
        })}
      </ul>

      {invitations.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface-2" aria-label="Invitations en attente">
          {invitations.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">
                  Invitation « {CIRCLE_KIND_LABELS[i.role]} » en attente
                </p>
                <p className="text-[12px] text-ink-3">Lien valable jusqu&apos;au {DAY.format(new Date(i.expires_at))}</p>
              </div>
              <button
                type="button"
                onClick={() => revoke(i.id)}
                disabled={pending}
                className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-[#7a1b14] hover:bg-[#f6dcd9]"
              >
                <X className="size-4" aria-hidden /> Annuler
              </button>
            </li>
          ))}
        </ul>
      )}

      <PillButton variant="outline" onClick={() => setInviting(true)}>
        <UserPlus className="size-4" aria-hidden /> Inviter dans le cercle
      </PillButton>
      <p className="-mt-2 text-[12px] text-ink-3">
        Les membres de vos groupes font déjà partie de l&apos;entourage. Invitez ici vos parents, une amie ou un pet-sitter :
        ils verront le passeport, pas vos groupes.
      </p>

      {editing && (
        <MemberSheet key={editing.user_id} dogId={dogId} member={editing} self={editing.user_id === me} onClose={() => setEditing(null)} />
      )}
      <InviteSheet open={inviting} onOpenChange={setInviting} dogId={dogId} dogName={dogName} origin={origin} />
    </Card>
  );
}

function AccessHint({ icon: Icon, label, access }: { icon: typeof Phone; label: string; access: SectionAccess }) {
  return (
    <span className={cn("inline-flex items-center gap-1", access === "never" && "line-through decoration-ink-3/60")}>
      <Icon className={cn("size-3.5", access === "always" ? "text-sage" : "text-ink-3")} aria-hidden />
      {label} : {ACCESS_LABELS[access].toLowerCase()}
    </span>
  );
}

type EditableRole = "co_owner" | "close" | "entourage" | "guest";

/** Role picker as large tappable cards, each explaining what it allows. */
function RolePicker({ value, options, onChange }: { value: EditableRole; options: EditableRole[]; onChange: (r: EditableRole) => void }) {
  return (
    <div role="radiogroup" aria-label="Rôle" className="flex flex-col gap-1.5">
      {options.map((r) => {
        const on = value === r;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(r)}
            className={cn(
              "flex min-h-14 items-center gap-3 rounded-2xl px-4 py-2.5 text-left ring-1 transition-colors",
              on ? "bg-ink text-surface ring-ink" : "bg-surface text-ink ring-line hover:bg-surface-2",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{CIRCLE_KIND_LABELS[r]}</span>
              <span className={cn("block text-[13px]", on ? "text-surface/75" : "text-ink-3")}>{CIRCLE_KIND_HINTS[r]}</span>
            </span>
            <span
              className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", on ? "bg-surface text-ink" : "ring-1 ring-line")}
              aria-hidden
            >
              {on && <Check className="size-4" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AccessPicker({
  label,
  value,
  onChange,
  withDuringCare,
}: {
  label: string;
  value: SectionAccess;
  onChange: (v: SectionAccess) => void;
  withDuringCare: boolean;
}) {
  const options = (withDuringCare ? (["always", "during_care", "never"] as const) : (["always", "never"] as const)).map((v) => ({
    value: v as SectionAccess,
    label: v === "during_care" ? "En garde" : ACCESS_LABELS[v],
  }));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <Segmented label={label} value={value} onChange={onChange} options={options} />
    </div>
  );
}

function GuestDates({
  from,
  to,
  onFrom,
  onTo,
  idPrefix,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="À partir du" htmlFor={`${idPrefix}-from`} hint="Vide : dès maintenant">
        <TextInput id={`${idPrefix}-from`} type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
      </Field>
      <Field label="Jusqu'au (inclus)" htmlFor={`${idPrefix}-to`}>
        <TextInput id={`${idPrefix}-to`} type="date" required value={to} onChange={(e) => onTo(e.target.value)} />
      </Field>
    </div>
  );
}

function MemberSheet({
  dogId,
  member,
  self,
  onClose,
}: {
  dogId: string;
  member: CircleMemberRow;
  /** a co-owner looking at their own row can only step down */
  self: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const today = todayLocal();
  const initialRole: EditableRole = member.kind === "owner" ? "co_owner" : member.kind;
  const [role, setRole] = useState<EditableRole>(initialRole);
  const [health, setHealth] = useState<SectionAccess>(member.health_access);
  const [emergency, setEmergency] = useState<SectionAccess>(member.emergency_access);
  const [from, setFrom] = useState(member.starts_at ? toLocalDate(member.starts_at) : "");
  const [to, setTo] = useState(member.ends_at ? lastGuestDay(member.ends_at) : addDays(today, 3));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const roles: EditableRole[] = self
    ? ["co_owner", "entourage"]
    : member.in_group
      ? ["co_owner", "close", "entourage", "guest"]
      : ["close", "guest"];
  const hasSettings = member.kind === "close" || member.kind === "guest" || (member.kind === "entourage" && !isDefault(member));

  const pickRole = (r: EditableRole) => {
    setRole(r);
    if (r !== "co_owner") {
      setHealth(ROLE_DEFAULTS[r]);
      setEmergency(ROLE_DEFAULTS[r]);
    }
  };

  const run = (task: () => Promise<ActionResult>, done: string) => {
    setError(null);
    startTransition(async () => {
      const r = await task();
      if (!r.ok) return setError(r.error);
      toast.success(done);
      onClose();
      router.refresh();
    });
  };

  const save = () =>
    run(async () => {
      if (role === "co_owner") {
        return member.kind === "co_owner" ? { ok: true, data: undefined } : addCaretaker(dogId, member.user_id);
      }
      if (member.kind === "co_owner") {
        const r = await removeCaretaker(dogId, member.user_id);
        // once stepped down, one can no longer change one's own settings
        if (!r.ok || self) return r;
      }
      const window = role === "guest" ? guestWindow(from, to) : { startsAt: null, endsAt: null };
      return setCircleMember(dogId, member.user_id, { role, health, emergency, startsAt: window.startsAt, endsAt: window.endsAt });
    }, "Accès mis à jour");

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-[28px] border-0 pb-safe">
        <SheetHeader>
          <SheetTitle className="text-xl font-semibold">{member.display_name}</SheetTitle>
          <SheetDescription>
            {member.in_group ? "Membre d'un groupe du chien." : "Invité directement, hors de vos groupes."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <RolePicker value={role} options={roles} onChange={pickRole} />
          {role !== "co_owner" && !self && (
            <>
              <AccessPicker label="Santé" value={health} onChange={setHealth} withDuringCare={member.in_group} />
              <AccessPicker label="Urgences" value={emergency} onChange={setEmergency} withDuringCare={member.in_group} />
            </>
          )}
          {role === "guest" && <GuestDates from={from} to={to} onFrom={setFrom} onTo={setTo} idPrefix="member" />}
          {error && (
            <p className="rounded-2xl bg-[#f6dcd9] px-4 py-3 text-[14px] font-medium text-[#7a1b14]" role="alert">
              {error}
            </p>
          )}
          <PillButton size="lg" loading={pending} onClick={save}>
            Enregistrer
          </PillButton>
          {hasSettings && member.kind !== "co_owner" && (
            <PillButton variant="ghost" disabled={pending} onClick={() => setConfirmRemove(true)} className="text-[#7a1b14]">
              {member.in_group ? "Revenir au rôle « Entourage »" : "Retirer du cercle"}
            </PillButton>
          )}
        </div>
        <ConfirmationDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title={member.in_group ? "Revenir au rôle « Entourage » ?" : `Retirer ${member.display_name} du cercle ?`}
          description={
            member.in_group
              ? "Ses réglages particuliers sont supprimés : il verra la santé et les urgences seulement pendant ses gardes."
              : "Cette personne ne verra plus le passeport."
          }
          confirmLabel={member.in_group ? "Confirmer" : "Retirer"}
          destructive={!member.in_group}
          pending={pending}
          onConfirm={() => {
            setConfirmRemove(false);
            run(() => removeCircleMember(dogId, member.user_id), member.in_group ? "Rôle « Entourage » rétabli" : "Retiré du cercle");
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function isDefault(m: CircleMemberRow) {
  return m.health_access === "during_care" && m.emergency_access === "during_care";
}

function InviteSheet({
  open,
  onOpenChange,
  dogId,
  dogName,
  origin,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dogId: string;
  dogName: string;
  origin: string;
}) {
  const router = useRouter();
  const today = todayLocal();
  const [role, setRole] = useState<"close" | "guest">("guest");
  const [health, setHealth] = useState(true);
  const [emergency, setEmergency] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(addDays(today, 3));
  const [created, setCreated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      const window = role === "guest" ? guestWindow(from, to) : { startsAt: null, endsAt: null };
      const r = await createCircleInvitation(dogId, {
        role,
        health: health ? "always" : "never",
        emergency: emergency ? "always" : "never",
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      });
      if (!r.ok) return void toast.error(r.error);
      const url = `${origin}/circle/join/${r.data.token}`;
      setCreated(url);
      router.refresh();
      const shared = await shareLink({ title: `Le cercle ${deName(dogName)}`, text: `Je vous invite dans le cercle ${deName(dogName)} sur Dogcare :`, url });
      if (shared === "copied") toast.success("Lien copié");
    });

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setCreated(null);
      }}
    >
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-[28px] border-0 pb-safe">
        <SheetHeader>
          <SheetTitle className="text-xl font-semibold">Inviter dans le cercle {deName(dogName)}</SheetTitle>
          <SheetDescription>Un lien à usage unique, valable 7 jours. La personne crée son compte avec son e-mail.</SheetDescription>
        </SheetHeader>
        {created ? (
          <CreatedLink
            url={created}
            note="Ce lien ne fonctionne qu'une fois : envoyez-le à une seule personne."
            onDone={() => {
              onOpenChange(false);
              setCreated(null);
            }}
          />
        ) : (
          <div className="flex flex-col gap-4 px-4 pb-6">
            <RolePicker value={role} options={["guest", "close"]} onChange={(r) => setRole(r as "close" | "guest")} />
            {role === "guest" && <GuestDates from={from} to={to} onFrom={setFrom} onTo={setTo} idPrefix="invite" />}
            <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface-2">
              <li className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                <label htmlFor="invite-health" className="flex items-center gap-3 text-[15px] font-medium text-ink">
                  <HeartPulse className="size-5 text-ink-2" aria-hidden /> Voir la santé
                </label>
                <Switch id="invite-health" checked={health} onCheckedChange={setHealth} />
              </li>
              <li className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                <label htmlFor="invite-emergency" className="flex items-center gap-3 text-[15px] font-medium text-ink">
                  <Phone className="size-5 text-ink-2" aria-hidden /> Voir les urgences
                </label>
                <Switch id="invite-emergency" checked={emergency} onCheckedChange={setEmergency} />
              </li>
            </ul>
            <PillButton size="lg" loading={pending} onClick={create}>
              <UserPlus className="size-4" aria-hidden /> Créer et partager le lien
            </PillButton>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
