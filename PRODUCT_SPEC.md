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

### Passeport d'abord (sans groupe)

Le passeport est gratuit et utile sans groupe, pour attirer de nouveaux utilisateurs avant leur première garde.

- À l'inscription, après le prénom, l'écran « Votre groupe » propose aussi **« Juste le passeport de mon chien »** :
  le chien est créé sans groupe.
- **« Mes chiens »** (`/circle`) est l'accueil de quelqu'un sans groupe : ses chiens (passeport modifiable), les
  chiens qu'on lui confie dans un cercle, les demandes et propositions qui lui sont adressées, son compte.
- En solo : passeport complet (photo, identité, habitudes, santé, urgences), **lien de partage**, **cercle de
  confiance** (inviter son pet-sitter comme « Professionnel » ou un proche). Pas de planning ni de carnet de garde :
  ils demandent une demande, donc un groupe. La carte « Organiser des gardes entre amis » mène à la création ou à
  l'adhésion d'un groupe.
- En créant ou rejoignant un groupe (création, code, lien), l'écran **« Vos chiens dans « … » »** propose de partager
  chaque chien avec ce groupe, coché par défaut, modifiable ensuite depuis la fiche. Il est sauté s'il n'y a rien à
  partager ; s'il y a déjà un chien, l'étape « Votre chien » de l'onboarding est sautée.

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
| Professionnel | pet-sitter rémunéré invité directement, jusqu'à ce qu'on le retire | pendant ses gardes | non |

- **Pour les gardes**, réglé par les responsables pour chaque personne : où le chien est gardé (chez elle ou
  chez moi), nuits d'affilée maximum (« jamais la nuit » possible ; sinon la règle du chien) et une note
  (« ils ont un chat »). Le planning de vacances s'en sert : le plafond propre à une personne prime sur la règle du chien.
- On invite un proche, un invité ou un professionnel par un **lien à usage unique** (7 jours, révocable, empreinte seule
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

## Carnet de garde

Pendant une garde **confirmée**, son gardien (membre du groupe ou personne du cercle) tient le carnet :
Repas, Promenade, Médicament, Déposé (prise en charge), Récupéré, Photo, Note.

- Un geste note l'entrée à l'heure actuelle ; « Détails » permet de choisir l'heure, un mot (500 car.) et une
  photo (réduite sur le téléphone). Les consignes du passeport (repas, promenades, traitements si la rubrique
  Santé lui est accessible) sont rappelées au-dessus des boutons.
- Ouvert de 2 h avant le début de la garde à 24 h après sa fin (heure de l'entrée comprise dans cette fenêtre),
  fermé si la garde est annulée ou à reconfirmer. Le gardien modifie ou supprime ses entrées pendant ce temps.
- Lecture : le gardien et les responsables du chien seulement. Seul le gardien écrit ; un responsable peut
  signaler une entrée.
- Déposé, Récupéré et les photos préviennent les responsables (push désactivable : Profil → « Carnet de
  garde ») ; repas, promenades, médicaments et notes restent dans l'app.
- Pendant une garde en cours, l'accueil du responsable montre « Aston chez Léa · dernière nouvelle ».
- Les photos sont supprimées 90 jours après la fin de la garde ; le texte reste.

### Routines (désactivées par défaut)

- Sur la fiche du chien, un responsable **active les routines** puis les liste : type (repas, promenade,
  médicament, autre), nom, 1 à 6 heures (heure de Paris), tous les jours ou certains jours, consigne courte
  (« ½ comprimé dans la pâtée »). 12 routines au plus. Qui voit le chien voit ses routines, sauf les médicaments,
  qui suivent le droit Santé du cercle.
- Pendant une garde, le carnet du gardien commence par **« Routines du jour »** : chaque occurrence se coche d'un
  geste (une entrée du carnet du type de la routine) et se décoche ; une occurrence ne se coche qu'une fois, pendant
  la garde, jusqu'à 3 h avant son heure. Les responsables voient la même liste : « Fait à 08h12 par Emma »,
  « Pas encore coché », « Non coché ».
- Le rappel de la veille au gardien cite les routines du lendemain. Pas de notification à l'heure d'une routine ni
  d'alerte en cas d'oubli (visibles seulement).
- Supprimer une routine laisse dans le carnet ce qui a été coché.

## Rappels et notifications du cercle

- **Rappel la veille** (vers 18 h, heure de Paris) : pour chaque garde confirmée qui commence le lendemain, le
  gardien (« Demain : garde d'Aston ») et les responsables (« Demain : Léa garde Aston »). Une garde annulée ou à
  reconfirmer n'est pas rappelée.
- **Alerte** aux responsables si un besoin **indispensable** qui commence le lendemain n'est pas entièrement couvert.
- **Cercle** : invitation acceptée ou départ → les responsables ; ajout, changement d'accès (avec le résumé) ou
  retrait par un responsable → la personne ; un invité est prévenu la veille de la fin de son accès.
- Chaque rappel n'est envoyé qu'une fois (journal en base). Préférences push : « Rappels de la veille » et
  « Cercle de confiance » dans le Profil.

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

### Écran « Mes dispos »

Trois onglets : **Prochains jours** (une semaine à la fois sur 4 semaines, flèches ou glisser, jauge « créneaux
renseignés », raccourcis Toute la semaine / Les soirs / Le week-end qui préparent une sélection, « Comme la semaine
dernière » qui recopie les saisies jour par jour de la semaine précédente — les habitudes s'appliquent déjà
d'elles-mêmes), **Habitudes** (grille hebdomadaire et résumé en clair) et **Partage** (par groupe). Un besoin du
groupe qui attend ma réponse apparaît sur ses jours (« Aston a besoin d'aide · Répondre ») : répondre reste un geste
séparé, une dispo n'est jamais une réponse.

### Évaluation d'une période

Pour une demande donnée, chaque membre est :
`Potentiellement disponible` (tous les créneaux touchés sont « disponible »), `À vérifier` (une partie
seulement), `Indisponible` (tout est « indisponible ») ou `Disponibilité inconnue`.

## Demandes de garde

Types : **Chien seul** (information), **Visite ou promenade**, **Garde**, **Garde partielle**.
Nécessité : information / souhaitable / indispensable (« Chien seul » est toujours une information).
Champs : chien, groupe (groupe courant), type, début, fin, nécessité, précisions, partage possible entre
plusieurs personnes. Durée maximale : 31 jours.

### Écran « Demandes »

Trois onglets : **À répondre** (regroupées par échéance : aujourd'hui, demain, cette semaine, plus tard ; une
section repliable « Déjà répondu » permet de changer d'avis), **Mes gardes** (reconfirmations d'abord, puis la
garde en cours avec un accès au carnet, puis les suivantes) et **Mes demandes** (statut, barre de couverture,
« 2 oui · 1 non · 3 sans réponse », « Relancer » s'il manque des réponses). Les demandes des cercles où l'on est
sollicité y figurent avec un badge « Cercle d'Aston » et comptent dans la pastille de l'onglet.

### Proposition de planning

Sur une demande partageable qui a des trous et au moins un « Oui », le responsable voit une **proposition de
planning** : l'app répartit ce qui reste entre les volontaires, il ajuste si besoin et **confirme tout d'un coup**
(toutes les tranches ou aucune, chaque gardien prévenu).

- Une tranche ne va qu'à quelqu'un dont le « Oui » la couvre, et jamais pendant une autre de ses gardes.
- Jamais plus de N nuits d'affilée par gardien (réglage du chien, 3 par défaut ; « Ajuster » permet de passer
  outre, avec un avertissement). Ce plafond est volontairement un conseil, pas un verrou en base : le responsable
  garde le dernier mot. Les réglages eux-mêmes sont bornés en base (1–14 nuits, 1–12 h).
- Ordre de priorité : couvrir le plus possible, le moins de relais, la répartition la plus équitable, puis qui a
  répondu en premier. Les tranches plus courtes que le minimum (réglage du chien, 3 h) sont données à un voisin
  quand c'est possible. Chaque tranche et chaque trou est expliqué.
- Pour un trou, les membres sans réponse qui se sont déclarés disponibles sont suggérés ; « Relancer » passe par
  la feuille de partage.
- Les préférences de garde comptent : nuits d'affilée max propres à chacun (« jamais la nuit » = jamais de nuit),
  lieu affiché sur chaque tranche (« chez Emma » / « chez moi ») et conservé sur la garde confirmée.
- Une proposition acceptée ne compte que pour ses créneaux (pas toute la plage du « Oui »).

### Planifier une absence (`/plan`)

Depuis l'accueil ou la fiche du chien, le responsable indique quand il part et quand il rentre. L'app propose
**qui garde quand, et où**, d'après les **dispos partagées** des membres du groupe (une saisie ponctuelle prime sur
une habitude ; une absence de saisie n'est pas une dispo), leurs autres gardes, la règle du chien et les
préférences de chacun. Rien n'est envoyé sans lui.

- Chaque trou est expliqué, avec trois issues : **solliciter quelqu'un du cercle de confiance** (professionnels
  d'abord, puis proches, puis invités dont les dates couvrent le trou), **modifier la répartition** (« Sans
  Emma » recalcule sans elle ; « Changer les dates ») et **prestation professionnelle** (s'il n'y a pas de pet-sitter
  dans le cercle, lien pour en inviter un comme « Professionnel » ; pas de place de marché).
- « Envoyer les propositions » publie une demande partageable (garde, nécessaire) dans le groupe et envoie à chacun
  **sa part** (créneaux et lieu). Les personnes du cercle hors du groupe sont sollicitées sur la demande en même
  temps. Un membre qui reçoit une proposition n'a pas en plus l'avis « Nouvelle demande ».
- **Accepter une proposition = un « Oui » sur ces créneaux**, jamais une garde confirmée : le responsable confirme
  ensuite la proposition de planning (tout ou rien). **Refuser** prévient le responsable et n'est pas un « Non » à
  toute la demande.
- Le responsable voit les propositions envoyées (en attente, acceptée, refusée, retirée) et peut retirer une
  proposition sans réponse (la personne est prévenue). Changer les dates de la demande ou l'annuler retire les
  propositions ouvertes.
- **Décrivez votre absence** (si l'assistant est configuré) : une phrase (« Je pars vendredi 18 h, retour lundi
  matin, pas plus de 2 nuits chez mes parents, Léa jamais la nuit ») est comprise par Gemini (Google), qui ne fait
  que la traduire en chien, dates et règles. L'app vérifie tout : dates jamais devinées (sinon « je n'ai pas
  compris »), heure par défaut annoncée, retour après le départ, période future, 31 jours max ; une règle ne vaut
  que pour une personne connue du groupe ou du cercle (nom inconnu ou ambigu : signalé et ignoré). Les
  suppositions sont affichées, tout reste modifiable et rien n'est calculé ni envoyé avant « Proposer une
  répartition ». Les règles valent **pour cette absence seulement** (elles priment sur les préférences enregistrées,
  sans les modifier). La phrase n'est pas enregistrée ; l'écran prévient qu'elle est envoyée à Google. Quota
  atteint ou panne : « Assistant indisponible », le formulaire reste là.
- Pas encore : contraintes de transport.

### Plusieurs chiens à la fois

- Une absence peut concerner **plusieurs de mes chiens** (tous cochés par défaut, 5 au plus). Le moteur cherche
  d'abord quelqu'un qui les garde **tous ensemble** (règle de nuits la plus stricte des chiens, tranche minimale la
  plus longue) ; ce que personne ne peut prendre pour tous est réparti **chien par chien**, et l'écran l'annonce
  (« Séparés … : personne ne peut tous les garder à ce moment-là »). Chaque trou dit pour quel chien il vaut.
- Il y a **une demande par chien**, liées entre elles (mêmes dates, même groupe, même auteur ; la base le vérifie) :
  couverture, carnet, routines et calendrier restent par chien. Une demande dont on change les dates quitte
  l'absence. La page d'une demande liée affiche « Même absence » avec les autres chiens.
- Un ami reçoit **un seul avis** par absence (« Pouvez-vous garder Aston et Nala ? ») et **une seule carte** ;
  **sa réponse vaut pour tous les chiens** (accepter = « Oui » sur chacun ; refuser = un seul avis au responsable,
  « Emma ne peut pas garder Aston et Nala »). Les avis « Nouvelle demande » et « peut aider pour » d'une absence
  sont aussi regroupés.
- **Cumul** : quelqu'un qui garde déjà un chien peut en prendre un autre, dans la limite de son réglage
  « Chiens gardés à la fois » (Profil : 1, 2, 3 ou sans limite ; 2 par défaut). Une garde dont l'app ne voit pas le
  chien compte comme un conflit, par prudence.
- **Doit être gardé seul** (réglage du chien, affiché dans ses habitudes avec une icône) : le chien n'est jamais
  confié à quelqu'un qui garde un autre chien au même moment (dans l'absence ou ailleurs), ni chez quelqu'un qui a
  lui-même un chien du groupe (seulement si la garde a lieu chez le propriétaire). Il est planifié après les autres.
- L'assistant comprend « Aston et Nala », « les deux », « les chiens » ; aucun chien cité : tous, avec la
  supposition affichée.
- Pas encore : demande manuelle de plusieurs chiens (« Nouvelle demande » reste par chien) ; chiens d'un ami
  invisibles dans le groupe ignorés pour « gardé seul ».

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

### Suppression d'un groupe

Un administrateur supprime un groupe par la fonction dédiée : les gardes encore à venir sont d'abord annulées, et
leurs gardiens et les responsables des chiens sont prévenus. Aucune suppression directe n'est possible.

### Départ d'un membre

Si un gardien quitte le groupe, en est retiré ou supprime son compte, ses gardes à venir sont annulées
et le propriétaire est prévenu : le jour redevient « à organiser » au lieu de rester faussement couvert.
Si le dernier responsable d'un chien supprime son compte, les besoins à venir du chien sont annulés : gardiens et
volontaires sont prévenus, et le chien est archivé.

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
de l'auteur. Tout membre peut en bloquer un autre : aucun des deux ne voit plus les demandes de l'autre ni ne peut y répondre,
on ne peut plus confier de garde à quelqu'un avec qui on est bloqué, et les messages qui sollicitent (nouvelle
demande, proposition d'aide) ne circulent plus entre eux. Les messages sur un engagement (garde confirmée, annulée,
à reconfirmer, demande modifiée ou annulée, rappel, carnet) passent toujours : un engagement n'est jamais modifié
en silence. Une demande sur laquelle on a déjà une garde confirmée reste visible. Limite connue : un membre bloqué
compte toujours comme « sans réponse » pour les autres, ce qui peut retarder le statut « Sans solution ».

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

## Calendrier

- **Agenda** (vue par défaut, 4 semaines) : une carte par besoin, même sur plusieurs jours (période, couverture,
  gardiens, statut) ; les jours où rien ne commence sont regroupés (« rien de prévu » ou « en cours : Aston »).
- **Mois** : chaque besoin est une barre sur ses jours (coupée par semaine, au plus 3 lignes, « +n » au-delà).
- Résumé de la période (sans solution, à organiser, couverts) qui sert de filtre ; portée Tout / Mes chiens /
  Mes gardes ; filtres par chien et propriétaire ; glisser pour changer de période.
- La feuille d'un jour montre ses besoins et **qui s'est déclaré disponible**, créneau par créneau (seulement les
  dispos partagées avec le groupe) — une indication, jamais un engagement.

## Profil

Une carte personnelle (initiales, prénom modifiable, e-mail, et pour soi seul « Cette année : N gardes assurées ·
N reçues pour vos chiens », gardes confirmées et terminées de l'année civile), puis mes chiens et les chiens qui me
sont confiés (rangées de photos), mes groupes (membres, rôle), des réglages en liste avec leur état
(Notifications, Abonnement calendrier, Chiens gardés à la fois, Installer l'application seulement dans un navigateur, Confidentialité,
Assistance) et le compte. La page Notifications réunit l'activation sur l'appareil et les préférences push par
thème.

## Couleurs (toujours avec icône + libellé)

| Teinte | Sens |
| --- | --- |
| Vert sauge — Couvert | garde(s) confirmée(s) sur toute la période |
| Abricot — À organiser | en attente de réponses ou de confirmation |
| Rose-rouge — Sans solution | besoin indispensable, tout le monde a dit non |
| Rose-rouge — Personne à solliciter | besoin indispensable, personne d'autre ne peut être sollicité (aucun autre membre, ou tous bloqués) : invitez quelqu'un ou demandez à votre cercle ; compté « à organiser », pas « sans solution » |
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
