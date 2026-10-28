# Plan de tests — Dogcare

## 1. Tests automatisés

| Suite | Commande | Contenu | Statut |
| --- | --- | --- | --- |
| Unitaires | `npm run test:unit` | intervalles, créneaux, fuseau Europe/Paris et changements d'heure, disponibilités (habitudes, priorité des saisies ponctuelles, « À vérifier »), couverture (exemple Emma/Chloé, minute manquante), statuts (absence de réponse ≠ refus, sans solution, partiel), conflits, assemblage des vues, tableau de bord, redirections sûres, codes de groupe, décisions d'envoi push, fichier iCalendar (échappement, pliage des lignes, titres), passeport (âge, poids, sexe, liens d'appel, états des liens), cercle (fenêtres d'invité en jours de Paris, élision « d'Aston »), personnes du cercle sur les demandes (règle de dates, vue de l'invité, éligibles et « Sans solution »), carnet de garde (fenêtre d'écriture, regroupement par jour, dernière nouvelle), autorisation de la tâche quotidienne | ✅ 132 tests |
| Base de données | `npm run test:db` | migrations réelles sur PostgreSQL embarqué : RLS (isolation entre groupes, intrus, usurpation d'identité), invitations (hash, révocation, expiration, quota), chiens, disponibilités et partage, demandes, réponses, confirmations concurrentes (contrainte d'exclusion, bornes semi-ouvertes), annulation, reconfirmation, notifications privées et non falsifiables, stockage, règles d'administration, suppression de compte, départs de membres, relances push, purge, règles issues de la revue (`tests/db/review-fixes.test.ts`), code de groupe, abonnement calendrier (isolation, annulations, jeton renouvelé), signalement et blocage (`tests/db/reports-blocks.test.ts`), passeport : accès santé/urgences, liens de partage (empreinte, expiration, révocation, rubriques, photo) (`tests/db/passport.test.ts`), cercle de confiance : rôles, réglages par personne, invités datés, proches hors groupe, invitations (usage unique, révocation, expiration), propriétaire protégé, liste filtrée (`tests/db/circle.test.ts`), personnes du cercle sur les demandes : visibilité, réponses, lecture limitée à soi, confirmation, retrait, départ, dates raccourcies, demande déplacée, signalement (`tests/db/request-invitees.test.ts`), carnet de garde : qui écrit et quand, lecture réservée, garde annulée ou à reconfirmer, photos (dépôt, lecture, chemins), notifications et préférence, signalement, purge à 90 jours et fichiers orphelins (`tests/db/care-log.test.ts`), rappels de la veille (une seule fois, gardes annulées ou à reconfirmer ignorées, besoins pas couverts, préférence, jours de Paris au changement d'heure) et notifications du cercle (`tests/db/reminders-circle-notifications.test.ts`) | ✅ 147 tests |
| Bout en bout | `npm run test:e2e` | parcours complet Julie/Emma/Chloé sur iPhone 13 émulé + intrus ; passeport (santé, urgences, lien partagé lu sans compte, révocation) ; cercle (invité sans santé, accès au seul passeport, notification « a rejoint le cercle », retrait) ; invité sollicité sur une demande (réponse depuis « Chiens confiés », confirmation, garde annulée au retrait) ; carnet de garde (repas, prise en charge, photo ; lecture par la propriétaire, notification, invisible pour un autre membre) | ✅ garde : production le 2026-10-22 ; passeport : production le 2026-10-27 ; cercle : production le 2026-10-28 ; invité sur une demande et carnet de garde : production le 2026-10-28 (suite complète, 5/5) |
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
