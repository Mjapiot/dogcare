import { Phone } from "lucide-react";
import {
  hasEmergency,
  hasHabits,
  hasHealth,
  telHref,
  type PassportDog,
  type PassportEmergency,
  type PassportHealth,
} from "@/domain/passport";

/**
 * Read-only passport sections, shared by the dog's page and the public
 * shared-passport page. Empty fields are left out.
 */
function Facts({ rows }: { rows: Array<[label: string, value: string | null | undefined]> }) {
  const filled = rows.filter((r): r is [string, string] => Boolean(r[1]));
  if (!filled.length) return null;
  return (
    <dl className="flex flex-col gap-3">
      {filled.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[13px] font-medium text-ink-3">{label}</dt>
          <dd className="whitespace-pre-line text-[15px] text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptySection({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] text-ink-3">{children}</p>;
}

const BIRTH = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

/** Details not already shown by the passport header (breed, age, weight and sex live there). */
export function IdentityView({ dog }: { dog: PassportDog }) {
  const rows: Array<[string, string | null]> = [
    ["Date de naissance", dog.birth_date ? BIRTH.format(new Date(`${dog.birth_date}T00:00:00Z`)) : null],
    ["N° d'identification", dog.identification],
    ["Signes particuliers", dog.distinctive_marks],
  ];
  return rows.some((r) => r[1]) ? <Facts rows={rows} /> : <EmptySection>Ni puce ni signe particulier renseigné.</EmptySection>;
}

export function HabitsView({ dog }: { dog: PassportDog }) {
  if (!hasHabits(dog)) return <EmptySection>Aucune habitude renseignée.</EmptySection>;
  return (
    <Facts
      rows={[
        ["Repas", dog.meals],
        ["Promenades", dog.walks],
        ["Sommeil", dog.sleep],
        ["Comportement", dog.behavior],
        ["Autres consignes", dog.care_notes],
      ]}
    />
  );
}

export function HealthView({ health }: { health: PassportHealth | null }) {
  if (!health || !hasHealth(health)) return <EmptySection>Aucune information de santé.</EmptySection>;
  const vet = [health.vet_name, health.vet_clinic].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-3">
      <Facts
        rows={[
          ["Allergies", health.allergies],
          ["Traitements en cours", health.treatments],
          ["Vétérinaire", vet || null],
          ["Adresse du vétérinaire", health.vet_address],
          ["Notes de santé", health.notes],
        ]}
      />
      {health.vet_phone && <CallButton phone={health.vet_phone} label={`Appeler le vétérinaire`} />}
    </div>
  );
}

export function EmergencyView({ emergency }: { emergency: PassportEmergency | null }) {
  if (!emergency || !hasEmergency(emergency)) return <EmptySection>Aucun contact d&apos;urgence.</EmptySection>;
  return (
    <div className="flex flex-col gap-3">
      {emergency.contacts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {emergency.contacts.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium text-ink">{c.name}</p>
                <p className="truncate text-[13px] text-ink-3">{[c.relation, c.phone].filter(Boolean).join(" · ")}</p>
              </div>
              <a
                href={telHref(c.phone)}
                aria-label={`Appeler ${c.name}`}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-surface"
              >
                <Phone className="size-4" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
      <Facts rows={[["Consignes en cas d'urgence", emergency.instructions]]} />
    </div>
  );
}

function CallButton({ phone, label }: { phone: string; label: string }) {
  return (
    <a
      href={telHref(phone)}
      className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full bg-surface-2 px-4 text-sm font-medium text-ink"
    >
      <Phone className="size-4" aria-hidden /> {label} · {phone}
    </a>
  );
}
