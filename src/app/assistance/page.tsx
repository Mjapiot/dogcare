import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, SupportEmail } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Assistance",
  description: "Aide et contact pour Dogcare.",
  robots: { index: true, follow: true },
};

export default function SupportPage() {
  return (
    <LegalPage title="Assistance" updated="21 octobre 2026">
      <section>
        <p>
          Une question, un problème ou une idée ? Écrivez-nous à <SupportEmail />. Nous répondons généralement sous
          quelques jours.
        </p>
      </section>

      <section>
        <h2>Se connecter</h2>
        <p>
          Saisissez votre adresse e-mail : vous recevez un lien de connexion. Pas de mot de passe. Ouvrez le lien
          sur le téléphone où vous avez fait la demande. S&apos;il n&apos;arrive pas, vérifiez vos courriers
          indésirables puis demandez-en un nouveau après une minute.
        </p>
      </section>

      <section>
        <h2>Rejoindre un groupe</h2>
        <p>
          Demandez à un administrateur du groupe son <strong>code</strong> (par exemple K7PQ-M2XD) ou un{" "}
          <strong>lien d&apos;invitation</strong>, puis saisissez-le à l&apos;étape « Rejoindre un groupe ».
        </p>
      </section>

      <section>
        <h2>Notifications</h2>
        <p>
          Activez-les dans Profil → « Notifications sur cet appareil ». Sur iPhone, depuis Safari, ajoutez d&apos;abord
          Dogcare à l&apos;écran d&apos;accueil. Si vous les avez refusées, réactivez-les dans les Réglages de
          l&apos;iPhone → Notifications → Dogcare.
        </p>
      </section>

      <section>
        <h2>Supprimer son compte</h2>
        <p>
          Profil → « Supprimer mon compte ». La suppression est immédiate et définitive. Voir aussi la{" "}
          <Link href="/confidentialite" className="font-medium text-ink underline underline-offset-2">
            politique de confidentialité
          </Link>
          .
        </p>
      </section>
    </LegalPage>
  );
}
