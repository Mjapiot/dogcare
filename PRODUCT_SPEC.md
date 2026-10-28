# Spécification produit — Dogcare

## Vision

Outil privé, gratuit et communautaire pour qu'un petit groupe d'amis organise la garde de ses chiens.
Ce n'est **pas** une marketplace : pas de paiement, pas de prestataires, pas de réservation professionnelle.

Promesse : *anticiper les gardes, connaître les disponibilités de ses amis et repérer immédiatement les jours sans solution.*

## Les trois niveaux d'engagement (invariant)

| Niveau | Signification | Où |
| --- | --- | --- |
| Disponibilité | « Je pourrais être disponible » | `availability_entries`, `availability_rules` |
| Réponse « Oui » | « Je peux m'occuper de ce chien » (proposition) | `request_responses` |
| Garde confirmée | « Le propriétaire m'a confié la garde » | `care_assignments` (statut `confirmed`) |

Une disponibilité n'est jamais une acceptation ; un « Oui » n'est jamais une confirmation.

## Utilisateurs, groupes, chiens

- Compte personnel par e-mail (lien de connexion à usage unique, modèle Supabase par défaut ; à ouvrir sur l'appareil qui l'a demandé). Profil : prénom affiché (modifiable sur place), fuseau horaire.
- Inscription guidée avec barre de progression : Prénom → Groupe (rejoindre ou créer) → Chien (facultatif,
  seulement si l'on crée un groupe) → Habitudes de disponibilité (facultatif).
- Groupes privés : un administrateur au moins, des membres. Un utilisateur peut être dans plusieurs groupes.
- Invitation par lien sécurisé : créé par un administrateur, expiration (24 h → 30 j), nombre d'utilisations
  limité, révocable, connexion obligatoire avant d'adhérer.
- Code de groupe permanent (ex. K7PQ-M2XD), visible et renouvelable par les administrateurs, désactivable.
  Toute personne connectée qui le saisit rejoint le groupe ; 10 essais erronés par quart d'heure au maximum.
- Un chien a une fiche unique, un ou plusieurs responsables, et est visible dans un ou plusieurs groupes.
  Archivable sans perdre l'historique. Aucune information de santé obligatoire.
- Ajouter un chien est facultatif : on peut simplement aider.

### Passeport du chien

La fiche du chien est son passeport, en quatre rubriques (tout est facultatif sauf le nom) :

| Rubrique | Contenu | Qui la voit dans l'app |
| --- | --- | --- |
| Identité | nom, photo, naissance (âge calculé), race, sexe, stérilisé, poids, n° d'identification, signes particuliers | membres des groupes du chien |
| Habitudes | repas, promenades, sommeil, comportement, autres consignes | membres des groupes du chien |
| Santé | allergies, traitements, vétérinaire (nom, cabinet, téléphone, adresse), notes de santé | selon le cercle de confiance (par défaut : responsables + gardien d'une garde confirmée, de 7 jours avant jusqu'à la fin) |
| Urgences | jusqu'à 5 contacts (nom, lien, téléphone) et consignes | idem Santé |

- Seuls les responsables modifient le passeport, rubrique par rubrique.
- Les anciens « Besoins particuliers » sont devenus les notes de la rubrique Santé.
- **Partage temporaire** : un responsable crée un lien secret (24 h, 7 jours ou 30 jours), lisible sans
  compte, en choisissant d'y inclure ou non Santé et Urgences (Identité et Habitudes toujours). Le lien
  est révocable à tout moment ; le nombre d'ouvertures est affiché ; 10 liens actifs au plus par chien.
  La page publique ne montre ni e-mail, ni groupe, ni planning, et n'est pas indexée.

### Cercle de confiance

Chaque chien a un cercle : qui voit quoi. Rôles (accès Santé / Urgences réglables par personne :
toujours, pendant ses gardes, jamais) :

| Rôle | Qui | Santé / Urgences par défaut | Modifier, publier, confirmer, gérer le cercle |
| --- | --- | --- | --- |
| Propriétaire | créateur de la fiche | toujours | oui ; ne peut pas être retiré par un copropriétaire |
| Copropriétaire | responsable ajouté (membre d'un groupe du chien) | toujours | oui |
| Proche | membre d'un groupe ou personne invitée directement | toujours | non |
| Entourage | tout membre d'un groupe du chien, sans réglage | pendant ses gardes (J-7 → fin) | non |
| Invité | personne invitée directement, entre deux dates (≤ 1 an) | au choix (oui / non) | non |

- On invite un proche ou un invité par un **lien à usage unique** (7 jours, révocable, empreinte seule
  stockée). La personne crée son compte avec le lien e-mail habituel, sans rejoindre de groupe.
- Une personne invitée hors des groupes voit le passeport et **les demandes sur lesquelles on la sollicite**
  (pas les groupes, leurs membres ni le planning), dans « Chiens confiés » (`/circle`) ; à la fin de ses dates,
  l'accès s'arrête seul.
- Un réglage « Entourage » ne donne rien à quelqu'un qui a quitté le groupe ; un proche garde l'accès
  jusqu'à ce qu'un responsable le retire.
- **Demander aussi à** : en créant ou modifiant une demande, un responsable choisit, personne par personne,
  les proches et invités du cercle du chien (hors du groupe) à solliciter. Activé par défaut quand les dates de
  l'invité couvrent toute la période ; grisé sinon. Ils sont prévenus comme les membres.
- Une personne sollicitée répond Oui / Non (partiellement si la demande est partageable), compte parmi les
  éligibles et peut être confirmée, dans ses dates d'invité. Elle ne voit ni les noms ni les réponses des
  autres, seulement si la demande est déjà couverte. Elle peut signaler la demande et **quitter le cercle** du chien.
- Retrait du cercle, départ ou dates raccourcies : ses gardes qui sortent de ses dates sont annulées, elle et les
  responsables sont prévenus. On ne peut pas cesser de solliciter quelqu'un qui a une garde confiée sur la
  demande (il faut d'abord l'annuler). Une demande déplacée hors de ses dates ne la sollicite plus.

## Disponibilités

- Créneaux par défaut (configurables dans `src/domain/config.ts`) : Matin 6h–12h, Après-midi 12h–18h,
  Soir 18h–22h, Nuit 22h–6h (lendemain). Fuseau Europe/Paris, changements d'heure gérés.
- États : Disponible / Indisponible / Non renseigné (défaut).
- Saisie rapide : sélection de cases, d'un jour entier ou d'un créneau sur toute la période, puis
  Disponible / Indisponible / Effacer. Horizon 2 ou 4 semaines.
- Habitudes hebdomadaires (ex. « tous les mercredis après-midi »). **Une saisie ponctuelle prime toujours
  sur une habitude.**
- Les disponibilités sont saisies une fois et partagées groupe par groupe (interrupteur, activé par défaut).
  Aucun motif d'indisponibilité n'est demandé ni affiché.

### Évaluation d'une période

Pour une demande donnée, chaque membre est :
`Potentiellement disponible` (tous les créneaux touchés sont « disponible »), `À vérifier` (une partie
seulement), `Indisponible` (tout est « indisponible ») ou `Disponibilité inconnue`.

## Demandes de garde

Types : **Chien seul** (information), **Visite ou promenade**, **Garde**, **Garde partielle**.
Nécessité : information / souhaitable / indispensable (« Chien seul » est toujours une information).
Champs : chien, groupe (groupe courant), type, début, fin, nécessité, précisions, partage possible entre
plusieurs personnes. Durée maximale : 31 jours.

### Modification et annulation (jamais silencieuses)

- Annulation de la demande : les gardes confirmées sont annulées, gardiens et volontaires prévenus.
- Changement d'horaires ou de type : chaque garde confirmée impactée passe en **reconfirmation**
  (le gardien voit « avant / désormais » et accepte ou refuse). Une garde entièrement hors de la nouvelle
  période est annulée avec notification. Les réponses données pour l'ancienne période sont remises à zéro
  et les personnes concernées invitées à répondre à nouveau.
- Changement de précisions : les gardiens sont informés.
- Une information (« Chien seul ») qui devient un besoin réel est annoncée au groupe comme une nouvelle demande.
- Passer une demande en « non partageable » est refusé si des gardes partielles sont déjà confiées ;
  les propositions partielles sont remises à zéro et leurs auteurs prévenus.
- Une demande terminée ne peut plus recevoir de confirmation.

### Départ d'un membre

Si un gardien quitte le groupe, en est retiré ou supprime son compte, ses gardes à venir sont annulées
et le propriétaire est prévenu : le jour redevient « à organiser » au lieu de rester faussement couvert.

## Réponses

Une réponse reste attachée à sa demande (elle ne peut pas être déplacée). La proposition d'un gardien
confirmé inclut toujours sa garde ; si la période change, elle est ramenée dans la nouvelle période.

Oui / Non / Pas encore répondu. Pour une garde partageable de plus de 4 h, un volontaire peut proposer
une partie seulement. Un gardien confirmé ne peut pas passer à « Non » : il doit annuler explicitement
sa garde (le propriétaire est alors prévenu). Son « Oui » n'est retiré que lorsqu'il n'a plus aucun
créneau confié sur la demande.

## Confirmation

Seul un responsable du chien confirme, uniquement parmi les volontaires, sur un créneau inclus dans la
demande et dans la proposition du volontaire. Deux gardes actives d'une même demande ne peuvent jamais
se chevaucher (contrainte en base). Plusieurs gardiens peuvent couvrir des parties différentes.

### Signalement et blocage

Tout membre peut signaler une demande, la fiche d'un chien ou un membre de son groupe (motif facultatif) :
le signalement est conservé pour l'équipe Dogcare et les administrateurs du groupe sont notifiés, sans le nom
de l'auteur. Tout membre peut en bloquer un autre : aucun des deux ne voit plus les demandes de l'autre ni ne
peut y répondre, et aucune notification ne circule entre eux. Une demande sur laquelle on a déjà une garde
confirmée reste visible (jamais de changement silencieux). Limite connue : un membre bloqué compte toujours
comme « sans réponse » pour les autres, ce qui peut retarder le statut « Sans solution ».

### Abonnement calendrier

Chaque membre peut s'abonner (Profil → « Mes gardes dans mon calendrier ») à un calendrier personnel
`webcal://` : il contient uniquement les gardes **confirmées** — celles qu'il assure et celles qui couvrent
ses chiens. Une garde à reconfirmer apparaît « À reconfirmer » (provisoire) ; une garde ou une demande
annulée disparaît du calendrier à la prochaine actualisation. Le lien est secret, renouvelable et
désactivable ; une réponse « Oui » non confirmée n'y figure jamais.

## Statuts calculés

Dimension stockée : `lifecycle_status` (active / cancelled). Dimension calculée (`src/domain/status.ts`) :

| Statut | Règle (dans cet ordre) |
| --- | --- |
| `cancelled` | demande annulée |
| `informational` | nécessité « information » |
| `confirmed` | gardes confirmées couvrant 100 % de la période |
| `partially_covered` | une partie couverte, une partie non |
| `volunteer_found` | aucun créneau confirmé, au moins un « Oui » utile |
| `uncovered` | tous les membres éligibles ont **explicitement** répondu « Non » |
| `potential_helpers` | des non-répondants se sont déclarés disponibles |
| `awaiting_responses` | sinon |

Éligibles = membres du groupe et personnes du cercle sollicitées sur la demande, moins les responsables du chien. **L'absence de réponse n'est jamais un refus** :
on n'affiche jamais « sans solution » tant que quelqu'un n'a pas répondu.

## Couleurs (toujours avec icône + libellé)

| Teinte | Sens |
| --- | --- |
| Vert sauge — Couvert | garde(s) confirmée(s) sur toute la période |
| Abricot — À organiser | en attente de réponses ou de confirmation |
| Rose-rouge — Sans solution | besoin indispensable, tout le monde a dit non |
| Rose-rouge hachuré — Partiellement couvert | une partie d'un besoin indispensable reste sans gardien |
| Lavande — Information | chien seul, pour information |
| Gris — Aucun besoin / sans réponse positive (besoin non indispensable) | |

La couleur d'un jour = le statut le plus urgent de ses besoins.

## Parcours couverts

A (première utilisation), B (disponibilités), C (besoin d'aide), D (je veux aider), E (personne ne peut
aider : alerte rouge, modification, relance via partage), F (garde annulée : recalcul, notification).

## Publication App Store

- Inscription ouverte : chacun crée son compte et son groupe ; les données restent privées par groupe.
- Compte de démonstration pour la revue d'Apple : seul compte autorisé à se connecter par mot de passe
  (lien discret « Compte de démonstration »), dans un groupe « Démo Dogcare » isolé et clairement fictif,
  préparé par `npm run demo:seed`.
- Pages publiques `/confidentialite` et `/assistance` (adresse de contact via `SUPPORT_EMAIL`).

## Arbitrages et décisions

- **Connexion par code e-mail** plutôt que lien magique : sur iPhone, un lien s'ouvre dans Safari et non
  dans l'app installée.
- **Disponibilités par créneaux**, pas en horaires libres : saisie beaucoup plus rapide ; les cas
  partiels sont signalés « À vérifier ».
- **Invitations réservées aux administrateurs** (MVP). Un administrateur peut nommer d'autres administrateurs.
- **Un groupe courant** sélectionné dans l'en-tête ; une demande s'ouvre même si elle appartient à un autre
  de mes groupes.
- **« Relancer »** ouvre la feuille de partage du téléphone avec un message et le lien de la demande
  (pas de notification cachée).
- **Notifications** : tout s'affiche toujours dans la cloche ; les préférences du Profil ne règlent que
  l'envoi push sur les appareils où l'utilisateur l'a activé.
- Les gardes d'un même gardien sur deux chiens en même temps ne sont pas bloquées (il peut promener deux
  chiens) ; la détection existe (`findAssignmentConflicts`) pour un affichage futur.
