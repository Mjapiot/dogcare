# Fiche App Store — Dogcare – Garde entre amis

Textes à copier-coller dans App Store Connect (onglet de la version 1.0).

## Informations de l'app

- **Nom** : Dogcare – Garde entre amis
- **Sous-titre** (30 car. max) : `Organisez vos gardes de chiens`
- **Catégorie principale** : Style de vie
- **Catégorie secondaire** : Productivité
- **Prix** : Gratuit
- **Classement par âge** : 4+ (répondre « Non » à toutes les questions du questionnaire)

## Texte promotionnel (170 car. max)

```
Partagez vos disponibilités avec vos amis et voyez tout de suite qui peut garder votre chien, et quels jours restent sans solution.
```

## Description

```
Dogcare aide un petit groupe d'amis à organiser la garde de leurs chiens, sans messages qui se perdent.

PARTAGEZ VOS DISPONIBILITÉS
Indiquez en quelques secondes quand vous pourriez aider : matin, après-midi, soir ou nuit. Définissez vos habitudes (par exemple « libre le mercredi après-midi ») et ajustez au jour le jour.

DEMANDEZ DE L'AIDE
Publiez une demande de garde, de visite ou de promenade. Dogcare montre tout de suite qui est potentiellement disponible.

RÉPONDEZ EN UN GESTE
« Oui, je peux », « Non », ou seulement une partie de la période : chacun répond quand il veut.

CONFIRMEZ, SANS AMBIGUÏTÉ
Une disponibilité n'est pas un engagement, et une réponse « Oui » non plus : la garde n'est sûre que lorsque le propriétaire du chien la confirme. Une garde peut être partagée entre plusieurs personnes.

REPÉREZ LES JOURS SANS SOLUTION
Le calendrier affiche l'état de chaque jour avec une couleur, une icône et un libellé : couvert, à organiser, partiellement couvert ou sans solution.

RESTEZ INFORMÉ
Notifications pour les nouvelles demandes, les propositions d'aide, les confirmations et les annulations. Abonnez-vous à vos gardes confirmées dans le Calendrier de l'iPhone.

PRIVÉ PAR CONCEPTION
Vos groupes sont fermés : on les rejoint uniquement avec un code ou un lien d'invitation. Aucune publicité, aucun pistage.
```

## Mots-clés (100 car. max, séparés par des virgules)

```
chien,garde,dog sitting,amis,promenade,animaux,calendrier,disponibilités,pet sitter,entraide
```

## Liens

- **URL d'assistance** : https://dogcare-gamma.vercel.app/assistance
- **URL de la politique de confidentialité** : https://dogcare-gamma.vercel.app/confidentialite
- **URL marketing** : (laisser vide)

## Captures d'écran

Dossier `app-store/screenshots/` (1206 × 2622, emplacement « iPhone avec Dynamic Island (écran moyen) ») :
1-aujourdhui, 2-calendrier, 3-demandes, 4-demande, 5-garde-partagee, 6-dispos.
En-tête et résultats de recherche : `header-5244x2950.png`, généré depuis `app-store/header/header.html`.

## Confidentialité de l'app (questionnaire « App Privacy »)

« Collectez-vous des données ? » → **Oui**. Pour chaque type : **lié à l'identité**, **non utilisé pour le pistage**,
finalité **Fonctionnalité de l'app** uniquement.

| Type Apple | Donnée Dogcare |
| --- | --- |
| Coordonnées → Adresse e-mail | connexion au compte |
| Coordonnées → Nom | prénom affiché aux membres du groupe |
| Contenu utilisateur → Photos | photo du chien (facultative) |
| Contenu utilisateur → Autre contenu | demandes de garde, disponibilités, notes sur les chiens |
| Identifiants → ID d'appareil | jeton de notification de l'iPhone |

## Informations pour la vérification (App Review)

- **Connexion requise** : oui
- **Identifiant** : `apple.review@example.com`
- **Mot de passe** : valeur `DEMO_ACCOUNT_PASSWORD` du fichier `.env.local` (ne pas l'écrire ici)
- **Notes** :

```
Dogcare is a private app for a small group of friends to coordinate dog sitting. Accounts normally sign in with a one-time link sent by e-mail; for the review, please use the demo account below.

How to sign in: on the login screen, tap "Compte de démonstration" (below the e-mail form), then enter the user name and password provided.

The demo account belongs to a sample group "Démo Dogcare" with two dogs (Pistache, Moka), a pending request from another member (open "Demandes" and answer "Oui, je peux"), a request awaiting confirmation and a partially covered weekend.

Push notifications are optional (Profil → Notifications). Users can delete their account in Profil → "Supprimer mon compte".
```

## Version

- **Build** : 202610221858 (TestFlight)
- **Copyright** : `2026 Maxence Japiot`
- **Chiffrement** : déjà déclaré dans l'app (aucun chiffrement non exempté)
