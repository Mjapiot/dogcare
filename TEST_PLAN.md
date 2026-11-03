# Plan de tests — Dogcare

## 1. Tests automatisés

| Suite | Commande | Contenu | Statut |
| --- | --- | --- | --- |
| Unitaires | `npm run test:unit` | intervalles, créneaux, fuseau Europe/Paris et changements d'heure, disponibilités (habitudes, priorité des saisies ponctuelles, « À vérifier »), couverture (exemple Emma/Chloé, minute manquante), statuts (absence de réponse ≠ refus, sans solution, partiel), conflits, assemblage des vues, tableau de bord, redirections sûres, codes de groupe, décisions d'envoi push, fichier iCalendar (échappement, pliage des lignes, titres), passeport (âge, poids, sexe, liens d'appel, états des liens), cercle (fenêtres d'invité en jours de Paris, élision « d'Aston »), personnes du cercle sur les demandes (règle de dates, vue de l'invité, éligibles et « Sans solution »), carnet de garde (fenêtre d'écriture, regroupement par jour, dernière nouvelle), autorisation de la tâche quotidienne, écran « Demandes » (échéances en jours de Paris, listes, résumé des réponses), moteur de planning (nuits d'affilée et changement d'heure, relais, équité, conflits, trous expliqués, déterminisme, suggestions), calendrier (agenda, barres du mois, résumé, filtres, disponibles d'un jour), Mes dispos (semaines, raccourcis, copie de semaine et changement d'heure, jauge, besoins par jour, résumé des habitudes), Profil (« Cette année », année civile de Paris), planning de vacances (plusieurs plages par personne, plafond de nuits propre et « jamais la nuit », lieu, dispos → offres avec priorité des saisies ponctuelles, proposition acceptée limitée à ses créneaux, regroupement par personne, candidats du cercle pour les trous, « Sans X »), statut « Personne à solliciter », lignes contiguës d'une même personne fusionnées, instants comparés par valeur (carnet), dates impossibles refusées, contexte envoyé à l'assistant (mes chiens, personnes autour, jamais les bloqués), redirection sans groupe et étape « Partager vos chiens », part d'un trou selon les nuits max d'une personne du cercle, routines (occurrences jour par jour, changement d'heure et heure inexistante, jours de la semaine, fait / à faire / à venir / non coché, libellés), assistant d'absence (dates jamais devinées, heures par défaut annoncées, période vérifiée y compris au changement d'heure, chien parmi plusieurs, règles limitées aux personnes connues, ambiguïtés, règles dans l'URL, appel Gemini simulé : requête, quota, panne, réponse invalide), plusieurs chiens (ensemble si possible, séparés sinon et créneaux « séparés », règles les plus strictes, chien gardé seul jamais avec un autre ni chez quelqu'un qui a un chien, autres gardes et limite de chiens à la fois, garde au chien inconnu = conflit, une carte par absence, assistant : chiens cités, « tous » supposé et annoncé), accueil « À faire maintenant » (ordre des cartes, demande proposée comptée une fois, demandes passées ou d'autrui exclues, gardes en cours et nuits passées, prochaine garde de la semaine), agenda (une carte par besoin sur son premier jour affiché, jours de Paris), mes dispos (cycle d'un toucher, habitude remplacée pour le jour, créneaux dispo parmi les jours à venir) | ✅ 210 tests |
| Base de données | `npm run test:db` | migrations réelles sur PostgreSQL embarqué : RLS (isolation entre groupes, intrus, usurpation d'identité), invitations (hash, révocation, expiration, quota), chiens, disponibilités et partage, demandes, réponses, confirmations concurrentes (contrainte d'exclusion, bornes semi-ouvertes), annulation, reconfirmation, notifications privées et non falsifiables, stockage, règles d'administration, suppression de compte, départs de membres, relances push, purge, règles issues de la revue (`tests/db/review-fixes.test.ts`), code de groupe, abonnement calendrier (isolation, annulations, jeton renouvelé), signalement et blocage (`tests/db/reports-blocks.test.ts`), passeport : accès santé/urgences, liens de partage (empreinte, expiration, révocation, rubriques, photo) (`tests/db/passport.test.ts`), cercle de confiance : rôles, réglages par personne, invités datés, proches hors groupe, invitations (usage unique, révocation, expiration), propriétaire protégé, liste filtrée (`tests/db/circle.test.ts`), personnes du cercle sur les demandes : visibilité, réponses, lecture limitée à soi, confirmation, retrait, départ, dates raccourcies, demande déplacée, signalement (`tests/db/request-invitees.test.ts`), carnet de garde : qui écrit et quand, lecture réservée, garde annulée ou à reconfirmer, photos (dépôt, lecture, chemins), notifications et préférence, signalement, purge à 90 jours et fichiers orphelins (`tests/db/care-log.test.ts`), rappels de la veille (une seule fois, gardes annulées ou à reconfirmer ignorées, besoins pas couverts, préférence, jours de Paris au changement d'heure) et notifications du cercle, élision « d'Aston » (`tests/db/reminders-circle-notifications.test.ts`), planning confirmé tout ou rien et réglages par chien (`tests/db/planning.test.ts`), correctifs de la revue : blocage et engagements, suppression de groupe, groupe des push, photo dans son dossier (`tests/db/review-fixes-2.test.ts`), rôle professionnel et préférences de garde (`tests/db/pro-helper-prefs.test.ts`), propositions ciblées : envoi (part de chacun, sollicitation du cercle, avis unique), contrôles (responsable, cercle, créneaux, déjà « Oui »), acceptation = « Oui » puis confirmation avec le lieu, refus, retrait, dates changées, isolation, « Planifier une absence » en une transaction (un seul avis, tout ou rien) (`tests/db/care-proposals.test.ts`), chien sans groupe : passeport, lien de partage, pet-sitter dans le cercle, partage avec un groupe créé ensuite (`tests/db/solo-passport.test.ts`), routines : désactivées par défaut, écriture réservée, lecture avec le chien, cochage unique pendant la garde, minute pile, 12 au plus, médicament réservé au droit Santé, suppression sans perte, rappel de la veille depuis le début de la garde (`tests/db/routines.test.ts`) ; propositions : une ligne par personne, créneaux nettoyés, refus annoncé sans « chez vous », polissage : compte du dernier responsable (besoins annulés, gardiens prévenus), carnet limité à 30 photos et photo citée non supprimable ; plusieurs chiens : demandes liées, un avis par absence (demande, proposition, offre d'aide), réponse unique pour tous les chiens, refus annoncé une fois, demande aux dates changées détachée, liens d'absence vérifiés (autre auteur, autres dates, même chien), « gardé seul » et chiens à la fois (droits, bornes, lecture) (`tests/db/multi-dogs.test.ts`) | ✅ 197 tests |
| Bout en bout | `npm run test:e2e` | parcours complet Julie/Emma/Chloé sur iPhone 13 émulé + intrus ; passeport (santé, urgences, lien partagé lu sans compte, révocation) ; cercle (invité sans santé, accès au seul passeport, notification « a rejoint le cercle », préférences de garde, retrait) ; écran « Demandes » (demande d'un cercle avec son badge, réponse en un geste, « Déjà répondu ») ; moteur de planning (deux « Oui » partiels confirmés en un geste) ; agenda (une carte par besoin, « Dispo ce jour », mois suivant) ; Mes dispos (besoin signalé sur son jour, raccourci « Le week-end ») ; Profil (« Cette année », page Notifications et préférence enregistrée) ; invité sollicité sur une demande (réponse depuis « Chiens confiés », confirmation, garde annulée au retrait) ; planifier une absence (proposition d'après les dispos, envoi, acceptation dans « Demandes », confirmation avec le lieu) ; passeport d'abord (inscription sans groupe, santé, lien de partage, « Mes chiens », groupe créé ensuite et chien partagé) ; routines (ajoutée par la propriétaire, cochée par la gardienne, vue faite par la propriétaire) ; carnet de garde (repas, prise en charge, photo ; lecture par la propriétaire, notification, invisible pour un autre membre) ; plusieurs chiens (absence d'Aston et Nala gardés ensemble, demandes liées, un seul avis, une réponse pour les deux) ; besoin d'une garde en 3 étapes (parcours complet : depuis un jour du calendrier, « Publier sans proposer » ; cercle sollicité en modifiant la demande) ; accueil (réponse « Oui » depuis une carte, « Emma peut garder Aston » à confirmer chez la propriétaire, garde en cours des deux côtés, barre du bas vers Chiens et Agenda) | ✅ garde : production le 2026-10-22 ; passeport : production le 2026-10-27 ; cercle : production le 2026-10-28 ; invité sur une demande, carnet de garde, notification du cercle, écran « Demandes » : production le 2026-10-28 ; moteur de planning, calendrier, Mes dispos, Profil et correctifs de la revue : production le 2026-10-29 ; rôle professionnel et préférences de garde : production le 2026-11-02 (suite complète, 10/10) ; planifier une absence : production le 2026-11-02 (suite complète, 11/11) ; lot de polissage : production le 2026-11-02 (11/11, calendrier relancé après mise à jour du libellé VoiceOver attendu) ; fluidité (région Dublin, cache, absence en une transaction) : production le 2026-11-02 (suite complète, 11/11, 4 workers) ; passeport d'abord : production le 2026-11-02 (12/12, le nouveau test relancé après fermeture de la feuille de partage) ; routines : production le 2026-11-03 (13/13, le nouveau test relancé après correction de son format d'heure et de son sélecteur) ; correctifs de la revue du 2026-11-03 : production le 2026-11-03 (13/13 du premier coup) ; plusieurs chiens : production le 2026-11-03 (14/14 du premier coup) ; refonte lots 1 et 2 (navigation, Accueil) : production le 2026-11-03 (15/15 ; parcours complet et routines relancés et passés : clic gêné une fois par la barre flottante pendant l'apparition de la page, feuille des routines fermée par un rafraîchissement) ; lot 3 (« Besoin d'une garde » en 3 étapes) et correctif des routines : production le 2026-11-03 (15/15 du premier coup) ; lot 4 (Agenda) : production le 2026-11-03 (15/15 du premier coup) ; lots 5 et 6 (Chiens, Profil, page d'une demande) : production le 2026-11-03 (15/15 ; première exécution pendant la bascule du déploiement, actions serveur de l'ancienne version, relancée) |
| Qualité | `npm run typecheck`, `npm run lint`, `npm run build` | | ✅ |

### Exécuter les tests E2E

Ils utilisent le **projet Supabase réel** (un seul projet) : des comptes `e2e+…@example.com` sont créés
via l'API d'administration (aucun e-mail envoyé), puis **supprimés avec leurs groupes en fin de test**.

```bash
# .env.local : SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
npx playwright install webkit
npm run test:e2e
# ou contre la production :
E2E_BASE_URL=https://dogcare-gamma.vercel.app npm run test:e2e
```

## 2. Tests manuels sur iPhone (à faire par le porteur du projet)

Safari iOS puis PWA installée (Partager → « Sur l'écran d'accueil »).

| # | Vérification | Attendu |
| --- | --- | --- |
| 1 | Installation | icône Dogcare, ouverture plein écran, barre d'état lisible |
| 2 | Connexion par lien | e-mail reçu, le lien ouvert depuis Mail rouvre l'app (même lancée à froid) et connecte **dans** l'app installée ; sur le web, connexion dans le même navigateur |
| 3 | Fermeture / réouverture | session conservée, données rafraîchies au retour |
| 4 | Safe areas | rien sous l'encoche / Dynamic Island ni sous la barre d'accueil |
| 5 | Calendrier | défilement fluide, couleurs + icônes + libellés, feuille du jour |
| 6 | Mes dispos | sélection d'une colonne + « Dispo » : 2 semaines remplies en < 1 min |
| 7 | Formulaires | pas de zoom au focus, sélecteurs de date/heure natifs, clavier ne masque pas le bouton |
| 8 | Photo du chien | prise de vue / galerie, envoi, affichage |
| 9 | Hors ligne (mode avion) | bandeau « Hors ligne », page hors ligne à la navigation, aucune action enregistrée |
| 10 | Déconnexion | retour à l'écran de connexion |
| 11 | VoiceOver | cases du calendrier et de la grille annoncées avec date, créneau et état |
| 12 | Taille de texte (Réglages > Accessibilité) | mise en page qui reste lisible |
| 13 | Push : Profil → « Activer sur cet appareil » (app installée) | demande d'autorisation iOS, puis « Activées » |
| 14 | Push : bouton « Tester » | notification reçue, même app fermée |
| 15 | Push : un autre compte crée une demande / répond / confirme | notification reçue app fermée ; la toucher ouvre la demande |
| 16 | Push : déconnexion puis action d'un autre membre | plus aucune notification sur cet appareil |
| 17 | Profil → « Ajouter au Calendrier » (PWA et app) | iOS propose de s'abonner ; les gardes confirmées apparaissent ; une garde annulée disparaît après actualisation |
| 18 | Nouveau compte : prénom → groupe → chien → habitudes | barre de progression animée, étapes facultatives passables, arrivée sur l'accueil |
| 19 | App iPhone : Profil → Mon calendrier → « Ajouter au Calendrier » | le lien `webcal://` ouvre la feuille d'abonnement de Calendrier (pas une page blanche) |
| 20 | App iPhone : carnet de garde → toucher une photo | la photo s'ouvre en grand dans l'app ; « Fermer » ou glisser la referme |
| 21 | VoiceOver sur la grille du mois | chaque jour annonce la date puis chaque chien avec son statut |
| 22 | Planifier une absence pour deux chiens, l'ami accepte depuis son iPhone | une seule notification « Pouvez-vous garder … et … ? », une seule carte, un seul geste ; « Même absence » sur chaque demande |
| 23 | Nouvelle barre du bas et Accueil | la pastille noire glisse ; chaque bouton est annoncé par VoiceOver ; les cartes « à faire » se lisent sans dépendre de la couleur ; rien n'est caché derrière la barre en fin de page |
| 24 | « Besoin d'une garde » sur iPhone | étapes 1 → 2 → 3 sans perte, champs date et heure natifs, « Modifier » revient à l'étape 2, l'assistant passe directement à l'étape 2 |
| 25 | Agenda sur iPhone | Besoins : une carte par besoin, mois précédent / suivant, « Revenir à aujourd'hui » ; Mes dispos : toucher une tuile change son état sans attendre, raccourcis, semaine suivante |
| 26 | Fiche d'un chien, Profil, page d'une demande | tuiles : un toucher ouvre, un second referme, l'éditeur garde sa saisie ; « Faire garder X » ; Profil sans rangées de chiens ; demande : la réponse est en haut, « Précisions et passeport » se replie ; rien ne passe sous la barre en bas de page |

## 3. Vérifications post-déploiement

1. Les 4 migrations apparaissent dans Supabase (Database → Migrations), sans erreur.
2. `https://dogcare-gamma.vercel.app/manifest.webmanifest` et `/pwa-icon/192` répondent.
3. Connexion par code en production, création d'un groupe, invitation d'un second compte.
4. Parcours E2E contre la production (`E2E_BASE_URL`).
5. Supabase → Advisors (Security, Performance) : aucune alerte critique. Attendus et voulus : 5 tables avec RLS sans politique
   (`audit_events`, `group_join_codes`, `join_code_attempts`, `calendar_feeds`, `content_reports`, accessibles seulement
   par fonctions) et 2 fonctions `SECURITY DEFINER` appelables sans compte (`calendar_feed_events`, `shared_passport`, protégées
   par jeton). Contrôles équivalents rejoués sur les migrations le 2026-10-28 : RLS partout, `search_path` fixé, politiques
   `(select auth.uid())`, aucune politique permissive en double, clés étrangères indexées.

## 4. App iPhone native

| # | Vérification | Attendu | Statut |
| --- | --- | --- | --- |
| 1 | Build simulateur (`xcodebuild … -sdk iphonesimulator`) | BUILD SUCCEEDED | ✅ |
| 2 | Lancement dans le simulateur | écran de connexion de production, encoche et barre d'état respectées | ✅ |
| 3 | Installation sur iPhone (TestFlight) | l'app s'installe et s'ouvre | ✅ |
| 4 | Profil → Activer les notifications → Tester | notification native reçue (nécessite les variables APNS_*) | ✅ 2026-10-21 (TestFlight) |
| 5 | Lien d'invitation (groupe `/invite/…` ou cercle `/circle/join/…`) ouvert depuis Mail/Messages | s'ouvre dans l'app, pas dans Safari | ⏳ |
| 6 | Mode avion au lancement | page « Vous êtes hors ligne » embarquée | ⏳ |
| 7 | Connexion par lien e-mail dans l'app (app ouverte ou fermée) | Mail → « Ouvrir dans Dogcare » → connecté, sans rechargement en boucle | ✅ 2026-10-23 (TestFlight) |
| 7 | Partager une invitation / relancer | feuille de partage iOS native | ⏳ |
