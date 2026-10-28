import { PawPrint } from "lucide-react";
import { dogAge, formatSex, formatWeight, type PassportDog } from "@/domain/passport";
import { deName } from "@/lib/format";
import type { LocalDate } from "@/domain/time";

/**
 * Passport header: an identity-card look (soft beige-to-sage gradient, large
 * photo, name, then key facts as frosted tiles). `photo` is the avatar or the
 * photo uploader.
 */
export function PassportHero({
  dog,
  today,
  photo,
  caption,
}: {
  dog: PassportDog;
  today: LocalDate;
  photo: React.ReactNode;
  caption?: string;
}) {
  const sex = dog.sex === "male" ? "Mâle" : dog.sex === "female" ? "Femelle" : null;
  const tiles = [
    { label: "Âge", value: dogAge(dog.birth_date, today) },
    { label: "Poids", value: formatWeight(dog.weight_kg) },
    { label: "Sexe", value: sex },
  ].filter((t): t is { label: string; value: string } => Boolean(t.value));
  const sterilized = formatSex(null, dog.sterilized);

  return (
    <section
      aria-label={`Passeport ${deName(dog.name)}`}
      className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-beige via-[#e9e7dc] to-[#d9e3d5] p-5 shadow-[0_1px_0_rgba(28,27,25,0.04),0_16px_40px_-24px_rgba(79,111,82,0.55)]"
    >
      {/* soft light blobs and a paw watermark, purely decorative */}
      <span aria-hidden className="pointer-events-none absolute -top-16 -left-10 size-48 rounded-full bg-surface/50 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -right-12 -bottom-16 size-56 rounded-full bg-sage/20 blur-3xl" />
      <PawPrint aria-hidden className="pointer-events-none absolute -top-6 -right-6 size-40 rotate-12 text-ink/[0.05]" />

      <p className="relative flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.14em] text-sage uppercase">
        <PawPrint className="size-3.5" aria-hidden /> Passeport Dogcare
      </p>
      <div className="relative mt-4 flex items-center gap-4">
        {photo}
        <div className="min-w-0">
          <h1 className="truncate text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">{dog.name}</h1>
          {(dog.breed || sterilized) && (
            <p className="mt-1 text-[15px] font-medium text-ink-2">{[dog.breed, sterilized].filter(Boolean).join(" · ")}</p>
          )}
          {caption && <p className="mt-0.5 text-[13px] text-ink-3">{caption}</p>}
        </div>
      </div>
      {tiles.length > 0 && (
        <dl className="relative mt-5 grid grid-cols-3 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl bg-surface/65 px-3 py-2.5 ring-1 ring-surface/80 backdrop-blur-md">
              <dt className="text-[12px] font-medium text-ink-3">{t.label}</dt>
              <dd className="mt-0.5 truncate text-[19px] font-semibold tracking-[-0.02em] text-ink">{t.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
