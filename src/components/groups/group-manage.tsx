"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, KeyRound, Link2, LogOut, RefreshCw, Share2, Shield, X } from "lucide-react";
import {
  createGroupJoinCode,
  createInvitation,
  removeMember,
  renameGroup,
  resetGroupJoinCode,
  revokeInvitation,
  setMemberRole,
} from "@/server/actions/groups";
import { formatJoinCode } from "@/lib/join-code";
import { formatRelative } from "@/lib/format";
import { shareLink } from "@/lib/native";
import { Avatar, Card, Field, PillButton, Select, SectionTitle, TextInput } from "@/components/ui/kit";
import { ConfirmationDialog } from "@/components/domain/confirmation-dialog";

type Member = { userId: string; name: string; role: "admin" | "member" };
type Invitation = { id: string; expiresAt: string; uses: number; maxUses: number };

export function GroupManage({
  groupId,
  groupName,
  me,
  isAdmin,
  members,
  invitations,
  joinCode,
}: {
  groupId: string;
  groupName: string;
  me: string;
  isAdmin: boolean;
  members: Member[];
  invitations: Invitation[];
  joinCode: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [hours, setHours] = useState("168");
  const [maxUses, setMaxUses] = useState("10");
  const [name, setName] = useState(groupName);
  const [confirm, setConfirm] = useState<{ kind: "remove" | "leave"; member: Member } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Erreur");
      toast.success(success);
      after?.();
      router.refresh();
    });

  const share = async (url: string) => {
    const text = `Rejoins notre groupe « ${groupName} » sur Dogcare pour organiser la garde de nos chiens :`;
    const result = await shareLink({ title: "Dogcare", text, url });
    if (result === "copied") toast.success("Lien copié");
  };

  const meMember = members.find((m) => m.userId === me);

  return (
    <div className="flex flex-col gap-7">
      {isAdmin && <JoinCodeCard groupId={groupId} groupName={groupName} code={joinCode} />}

      {isAdmin && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Inviter avec un lien</SectionTitle>
          <Card className="flex flex-col gap-3">
            <p className="text-[14px] text-ink-2">
              Le lien est personnel au groupe, expire automatiquement et peut être révoqué. La personne doit se connecter
              avant de rejoindre.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Valable" htmlFor="inv-hours">
                <Select id="inv-hours" value={hours} onChange={(e) => setHours(e.target.value)}>
                  <option value="24">24 heures</option>
                  <option value="72">3 jours</option>
                  <option value="168">7 jours</option>
                  <option value="720">30 jours</option>
                </Select>
              </Field>
              <Field label="Utilisations" htmlFor="inv-uses">
                <Select id="inv-uses" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
                  <option value="1">1 personne</option>
                  <option value="5">5 personnes</option>
                  <option value="10">10 personnes</option>
                  <option value="25">25 personnes</option>
                </Select>
              </Field>
            </div>
            <PillButton
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await createInvitation(groupId, Number(hours), Number(maxUses));
                  if (!r.ok) return void toast.error(r.error);
                  setLink(`${window.location.origin}/invite/${r.data.token}`);
                  router.refresh();
                })
              }
            >
              <Link2 className="size-4" aria-hidden /> Créer un lien d&apos;invitation
            </PillButton>
            {link && (
              <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3">
                <p className="break-all text-[13px] text-ink-2">{link}</p>
                <p className="text-[12px] text-ink-3">Copiez-le maintenant : pour des raisons de sécurité, il ne sera plus affiché.</p>
                <div className="grid grid-cols-2 gap-2">
                  <PillButton size="sm" onClick={() => share(link)}>
                    <Share2 className="size-4" aria-hidden /> Partager
                  </PillButton>
                  <PillButton
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        toast.success("Lien copié");
                      } catch {
                        toast.error("Copie impossible, sélectionnez le lien manuellement.");
                      }
                    }}
                  >
                    <Copy className="size-4" aria-hidden /> Copier
                  </PillButton>
                </div>
              </div>
            )}
          </Card>
          {invitations.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-2.5 text-[14px]">
                  <span className="text-ink-2">
                    Lien actif · expire {formatRelative(i.expiresAt)} · {i.uses}/{i.maxUses} utilisé{i.uses > 1 ? "s" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => run(() => revokeInvitation(i.id, groupId), "Lien révoqué")}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-medium text-[#9b1c14] hover:bg-[#f6dcd9]"
                  >
                    <X className="size-3.5" aria-hidden /> Révoquer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionTitle>Membres</SectionTitle>
        <ul className="flex flex-col gap-1.5">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 rounded-2xl bg-surface p-3">
              <Avatar name={m.name} />
              <span className="flex-1">
                <span className="block text-[15px] font-medium text-ink">
                  {m.name} {m.userId === me && <span className="text-ink-3">(vous)</span>}
                </span>
                {m.role === "admin" && (
                  <span className="flex items-center gap-1 text-[13px] text-ink-3">
                    <Shield className="size-3.5" aria-hidden /> Administrateur
                  </span>
                )}
              </span>
              {isAdmin && m.userId !== me && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => setMemberRole(groupId, m.userId, m.role === "admin" ? "member" : "admin"), m.role === "admin" ? "Rôle retiré" : "Nommé administrateur")
                    }
                    className="min-h-11 rounded-full px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2"
                  >
                    {m.role === "admin" ? "Retirer admin" : "Nommer admin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: "remove", member: m })}
                    className="flex size-11 items-center justify-center rounded-full hover:bg-surface-2"
                    aria-label={`Retirer ${m.name} du groupe`}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Nom du groupe</SectionTitle>
          <Card className="flex flex-col gap-3">
            <TextInput aria-label="Nom du groupe" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            <PillButton variant="soft" disabled={pending || !name.trim() || name.trim() === groupName} onClick={() => run(() => renameGroup(groupId, name), "Groupe renommé")}>
              Renommer
            </PillButton>
          </Card>
        </section>
      )}

      {meMember && (
        <PillButton variant="danger" onClick={() => setConfirm({ kind: "leave", member: meMember })}>
          <LogOut className="size-4" aria-hidden /> Quitter le groupe
        </PillButton>
      )}

      <ConfirmationDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === "leave" ? "Quitter ce groupe ?" : `Retirer ${confirm?.member.name} ?`}
        description={
          confirm?.kind === "leave"
            ? "Vous ne verrez plus les demandes ni les disponibilités de ce groupe. Si vous êtes le dernier membre, le groupe sera supprimé."
            : "Cette personne n'aura plus accès aux informations du groupe."
        }
        confirmLabel={confirm?.kind === "leave" ? "Quitter" : "Retirer"}
        destructive
        pending={pending}
        onConfirm={() => {
          const c = confirm;
          if (!c) return;
          setConfirm(null);
          run(
            () => removeMember(groupId, c.member.userId),
            c.kind === "leave" ? "Vous avez quitté le groupe" : "Membre retiré",
            c.kind === "leave" ? () => router.replace("/") : undefined,
          );
        }}
      />
    </div>
  );
}

/** Admin: the group's permanent code (share, renew, disable). */
function JoinCodeCard({ groupId, groupName, code }: { groupId: string; groupName: string; code: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"renew" | "disable" | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Erreur");
      toast.success(success);
      router.refresh();
    });

  const share = async () => {
    if (!code) return;
    const text = `Rejoins « ${groupName} » sur Dogcare : ouvre l'app, puis saisis le code ${formatJoinCode(code)}.`;
    const result = await shareLink({ title: "Dogcare", text, url: window.location.origin });
    if (result === "copied") toast.success("Message copié");
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Code du groupe</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-[14px] text-ink-2">
          Toute personne connectée qui saisit ce code rejoint le groupe. Il reste valable jusqu&apos;à ce que vous le
          changiez : ne le partagez qu&apos;avec vos proches.
        </p>
        {code ? (
          <>
            <p
              className="rounded-2xl bg-surface-2 py-4 text-center text-[34px] font-semibold tracking-[0.18em] text-ink tabular"
              aria-label={`Code du groupe : ${code.split("").join(" ")}`}
            >
              {formatJoinCode(code)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <PillButton size="sm" onClick={share}>
                <Share2 className="size-4" aria-hidden /> Partager
              </PillButton>
              <PillButton
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(formatJoinCode(code));
                    toast.success("Code copié");
                  } catch {
                    toast.error("Copie impossible, notez le code à la main.");
                  }
                }}
              >
                <Copy className="size-4" aria-hidden /> Copier
              </PillButton>
              <PillButton size="sm" variant="soft" disabled={pending} onClick={() => setConfirm("renew")}>
                <RefreshCw className="size-4" aria-hidden /> Nouveau code
              </PillButton>
              <PillButton size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm("disable")}>
                Désactiver
              </PillButton>
            </div>
          </>
        ) : (
          <PillButton loading={pending} onClick={() => run(() => createGroupJoinCode(groupId), "Code du groupe créé")}>
            <KeyRound className="size-4" aria-hidden /> Créer un code de groupe
          </PillButton>
        )}
      </Card>
      <ConfirmationDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "renew" ? "Générer un nouveau code ?" : "Désactiver le code ?"}
        description={
          confirm === "renew"
            ? "L'ancien code ne fonctionnera plus. Les membres actuels restent dans le groupe."
            : "Plus personne ne pourra rejoindre le groupe avec un code. Les liens d'invitation restent possibles."
        }
        confirmLabel={confirm === "renew" ? "Nouveau code" : "Désactiver"}
        destructive={confirm === "disable"}
        pending={pending}
        onConfirm={() => {
          const enabled = confirm === "renew";
          setConfirm(null);
          run(() => resetGroupJoinCode(groupId, enabled), enabled ? "Nouveau code généré" : "Code désactivé");
        }}
      />
    </section>
  );
}
