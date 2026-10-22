import type { Metadata } from "next";
import { LegalPage, SupportEmail } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Quelles données Dogcare utilise, pourquoi, et comment les supprimer.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" updated="21 octobre 2026">
      <section>
        <p>
          Dogcare aide des groupes d&apos;amis à organiser la garde de leurs chiens. Nous ne collectons que ce qui est
          nécessaire à ce service. <strong>Aucune publicité, aucun pistage, aucune revente de données.</strong>
        </p>
        <p>
          Responsable du traitement : Maxence Japiot, éditeur de Dogcare. Contact : <SupportEmail />.
        </p>
      </section>

      <section>
        <h2>Données utilisées</h2>
        <ul>
          <li><strong>Compte</strong> : adresse e-mail (pour vous envoyer votre lien de connexion) et prénom affiché.</li>
          <li><strong>Groupes</strong> : groupes dont vous êtes membre et votre rôle.</li>
          <li>
            <strong>Chiens</strong> : nom, race, date de naissance, photo et consignes de garde que vous choisissez de
            renseigner. Les informations de santé sont facultatives.
          </li>
          <li>
            <strong>Organisation des gardes</strong> : vos disponibilités (sans motif), vos demandes, vos réponses et
            les gardes qui vous sont confiées.
          </li>
          <li>
            <strong>Notifications</strong> : notifications dans l&apos;application et, si vous les activez, un
            identifiant technique de votre appareil pour recevoir des notifications push.
          </li>
          <li>
            <strong>Sécurité</strong> : un journal minimal des actions sensibles (confirmations, annulations,
            invitations) et un cookie de session pour rester connecté.
          </li>
        </ul>
      </section>

      <section>
        <h2>Qui voit quoi</h2>
        <p>
          Vos informations ne sont visibles que par les membres des groupes dont vous faites partie. Vos disponibilités
          ne sont partagées qu&apos;avec les groupes pour lesquels vous l&apos;avez accepté (réglable dans « Mes
          dispos »). Votre adresse e-mail n&apos;est jamais montrée aux autres membres.
        </p>
      </section>

      <section>
        <h2>Prestataires techniques</h2>
        <ul>
          <li><strong>Supabase</strong> : base de données, authentification et stockage des photos.</li>
          <li><strong>Vercel</strong> : hébergement de l&apos;application.</li>
          <li>
            <strong>Apple, Google ou Mozilla</strong> : acheminement des notifications push vers votre appareil,
            uniquement si vous les activez.
          </li>
        </ul>
        <p>Ces prestataires traitent les données pour notre compte et uniquement pour faire fonctionner Dogcare.</p>
      </section>

      <section>
        <h2>Durées de conservation</h2>
        <ul>
          <li>Vos données sont conservées tant que votre compte existe.</li>
          <li>Les notifications sont supprimées après 6 mois, le journal de sécurité après 1 an.</li>
          <li>
            Si vous supprimez votre compte, vos données personnelles sont effacées immédiatement. Les gardes passées
            restent dans l&apos;historique du groupe sans votre nom ; les chiens dont vous étiez le seul responsable sont
            archivés.
          </li>
        </ul>
      </section>

      <section>
        <h2>Vos droits</h2>
        <p>
          Vous pouvez consulter et modifier vos informations dans l&apos;application, et{" "}
          <strong>supprimer votre compte à tout moment</strong> depuis Profil → « Supprimer mon compte ». Pour toute
          autre demande (accès, rectification, portabilité, opposition), écrivez à <SupportEmail />. Vous pouvez aussi
          saisir la CNIL (cnil.fr).
        </p>
      </section>
    </LegalPage>
  );
}
