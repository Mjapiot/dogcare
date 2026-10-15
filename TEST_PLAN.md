# Plan de tests — Dogcare

## 1. Tests automatisés

| Suite | Commande | Contenu | Statut |
| --- | --- | --- | --- |
| Unitaires | `npm run test:unit` | intervalles, créneaux, fuseau Europe/Paris et changements d'heure, disponibilités (habitudes, priorité des saisies ponctuelles, « À vérifier »), couverture (exemple Emma/Chloé, minute manquante), statuts (absence de réponse ≠ refus, sans solution, partiel), conflits, assemblage des vues, tableau de bord | ✅ 54 tests |
| Base de données | `npm run test:db` | migrations réelles sur PostgreSQL embarqué : RLS (isolation entre groupes, intrus, usurpation d'identité), invitations (hash, révocation, expiration, quota), chiens, disponibilités et partage, demandes, réponses, confirmations concurrentes (contrainte d'exclusion, bornes semi-ouvertes), annulation, reconfirmation, notifications privées et non falsifiables, stockage, règles d'administration, suppression de compte | ✅ 41 tests |
| Bout en bout | `npm run test:e2e` | parcours complet Julie/Emma/Chloé sur iPhone 13 émulé + intrus | ⏳ écrit, à exécuter avec `SUPABASE_SECRET_KEY` |
| Qualité | `npm run typecheck`, `npm run lint`, `npm run build` | | ✅ |

### Exécuter les tests E2E

Ils utilisent le **projet Supabase réel** (un seul projet) : des comptes `e2e+…@example.com` sont créés
via l'API d'administration (aucun e-mail envoyé), puis **supprimés avec leurs groupes en fin de test**.

```bash
# .env.local : NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
npx playwright install webkit
npm run test:e2e
# ou contre la production :
E2E_BASE_URL=https://dogcare-mu.vercel.app npm run test:e2e
```

## 2. Tests manuels sur iPhone (à faire par le porteur du projet)

Safari iOS puis PWA installée (Partager → « Sur l'écran d'accueil »).

| # | Vérification | Attendu |
| --- | --- | --- |
| 1 | Installation | icône Dogcare, ouverture plein écran, barre d'état lisible |
| 2 | Connexion par code | e-mail reçu avec un code, saisie auto-proposée par le clavier iOS, connexion **dans** l'app installée |
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

## 3. Vérifications post-déploiement

1. Les 4 migrations apparaissent dans Supabase (Database → Migrations), sans erreur.
2. `https://dogcare-mu.vercel.app/manifest.webmanifest` et `/pwa-icon/192` répondent.
3. Connexion par code en production, création d'un groupe, invitation d'un second compte.
4. Parcours E2E contre la production (`E2E_BASE_URL`).
5. Supabase → Advisors (Security, Performance) : aucune alerte critique.
