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

- Compte personnel par e-mail (code à usage unique). Profil : prénom affiché, fuseau horaire.
- Groupes privés : un administrateur au moins, des membres. Un utilisateur peut être dans plusieurs groupes.
- Invitation par lien sécurisé : créé par un administrateur, expiration (24 h → 30 j), nombre d'utilisations
  limité, révocable, connexion obligatoire avant d'adhérer.
- Un chien a une fiche unique, un ou plusieurs responsables, et est visible dans un ou plusieurs groupes.
  Archivable sans perdre l'historique. Aucune information de santé obligatoire.
- Ajouter un chien est facultatif : on peut simplement aider.

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

## Réponses

Oui / Non / Pas encore répondu. Pour une garde partageable de plus de 4 h, un volontaire peut proposer
une partie seulement. Un gardien confirmé ne peut pas passer à « Non » : il doit annuler explicitement
sa garde (le propriétaire est alors prévenu et son « Oui » est retiré).

## Confirmation

Seul un responsable du chien confirme, uniquement parmi les volontaires, sur un créneau inclus dans la
demande et dans la proposition du volontaire. Deux gardes actives d'une même demande ne peuvent jamais
se chevaucher (contrainte en base). Plusieurs gardiens peuvent couvrir des parties différentes.

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

Éligibles = membres du groupe moins les responsables du chien. **L'absence de réponse n'est jamais un refus** :
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
- **Web Push** reporté en phase 2 ; les notifications sont internes (cloche).
- Les gardes d'un même gardien sur deux chiens en même temps ne sont pas bloquées (il peut promener deux
  chiens) ; la détection existe (`findAssignmentConflicts`) pour un affichage futur.
