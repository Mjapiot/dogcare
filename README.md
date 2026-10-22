# Dogcare

Application web progressive (PWA) privée pour qu'un groupe d'amis coordonne la garde de ses chiens :
**anticiper les gardes, connaître les disponibilités de ses amis et repérer immédiatement les jours sans solution.**

- Calendrier partagé (vue « Aujourd'hui », 2 semaines, mois) avec un code couleur + icône + libellé par statut
- Disponibilités par créneaux (matin, après-midi, soir, nuit) et habitudes hebdomadaires
- Demandes de garde, réponses Oui / Non, confirmation par le propriétaire, gardes partagées entre plusieurs personnes
- Calcul de couverture fiable (créneaux non couverts identifiés à la minute près)
- Notifications dans l'application et notifications push (iPhone : app installée sur l'écran d'accueil)
- Groupes privés sur invitation, sécurité garantie par la base de données (RLS)

Documentation : [PRODUCT_SPEC](PRODUCT_SPEC.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) ·
[DESIGN_SYSTEM](DESIGN_SYSTEM.md) · [TEST_PLAN](TEST_PLAN.md) · [ROADMAP](ROADMAP.md) · [CLAUDE.md](CLAUDE.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · shadcn/ui · Lucide · Zod ·
Supabase (PostgreSQL, Auth, Storage, Realtime) · Vitest · Playwright · Vercel.

## Démarrer en local

Prérequis : Node.js 20.9+ (testé avec Node 24).

```bash
npm install
cp .env.example .env.local   # puis renseigner l'URL et la clé publishable Supabase
npm run dev                  # http://localhost:3000
```

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run typecheck` | Vérification TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Tests unitaires + tests base de données (PostgreSQL embarqué, sans Docker) |
| `npm run test:e2e` | Parcours complet dans un navigateur (nécessite `SUPABASE_SECRET_KEY` en local) |
| `npm run build` | Build de production |
| `npm run check` | Tout ce qui précède sauf E2E |

## Base de données

Les migrations SQL sont dans `supabase/migrations/`. Le projet Supabase est relié au dépôt GitHub :
**chaque push sur `main` applique automatiquement les nouvelles migrations** (option « Deploy to production »
de l'intégration GitHub de Supabase). Détails dans [DATABASE.md](DATABASE.md).

## Déploiement (Vercel)

Le projet Vercel est relié au dépôt : chaque push sur `main` déploie la production
(`dogcare-gamma.vercel.app`), chaque branche/PR obtient une URL de prévisualisation.

Variables d'environnement Vercel (Production + Preview) :

- `SUPABASE_URL` (Supabase → Project Settings → Data API → Project URL)
- `SUPABASE_PUBLISHABLE_KEY` (Supabase → Project Settings → API Keys)

Les noms préfixés `NEXT_PUBLIC_` sont aussi acceptés. Ces deux valeurs sont publiques par nature
(la sécurité repose sur la RLS) : le serveur les transmet au navigateur pour le temps réel et les photos.

Pour les notifications push (facultatif — sans elles, l'app fonctionne avec la cloche) :

- `SUPABASE_SECRET_KEY` (Supabase → Project Settings → API Keys → Secret keys) — **secret**
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (**secret**), `VAPID_SUBJECT` (`mailto:…`) — générées avec
  `npx web-push generate-vapid-keys`

La clé secrète Supabase n'est utilisée que côté serveur, pour retrouver les appareils des membres à notifier.
Elle ne doit jamais porter le préfixe `NEXT_PUBLIC_`.

### Réglages Supabase à faire une fois (tableau de bord)

1. **Authentication → Emails → Templates → Magic Link** : garder le modèle par défaut. La connexion se fait
   uniquement par lien (pas de code). Le lien doit être ouvert sur l'appareil qui l'a demandé.
2. **Authentication → URL Configuration** : Site URL `https://dogcare-gamma.vercel.app`, et ajouter
   `https://dogcare-gamma.vercel.app/**`, `http://localhost:3000/**` et `app.dogcare.ios://**` (retour du lien
   de connexion dans l'app iPhone) aux Redirect URLs.
3. **Authentication → Emails → SMTP** : l'envoi intégré est limité à quelques e-mails par heure.
   Avant d'inviter beaucoup de monde, configurer un SMTP (ex. Resend) avec un domaine vérifié.

## Sécurité

- Aucune donnée n'est accessible sans être membre du groupe : règles RLS testées automatiquement.
- Aucun secret dans le dépôt (public). `.env.local` est ignoré par Git.
- Les liens d'invitation ne sont stockés que sous forme d'empreinte (SHA-256), expirent et sont révocables.

## Application iPhone native (Capacitor)

Le dossier `ios/` contient l'app native (`app.dogcare.ios`, équipe Apple `G2SC6845GS`). Elle charge le site
de production et ajoute : notifications natives (APNs), ouverture des liens Dogcare dans l'app (liens
universels), partage natif, retours haptiques, page hors ligne embarquée.

```bash
npm run ios:sync    # après toute modification de capacitor.config.ts ou des plugins
npm run ios:open    # ouvre Xcode → choisir l'iPhone → ▶︎ Run
```

Développement contre un serveur local : `CAP_SERVER_URL=http://localhost:3000 npx cap sync ios`
(ne pas commiter `ios/App/App/capacitor.config.json`, il est régénéré).

Variables Vercel pour les notifications natives (clé APNs créée sur developer.apple.com → Keys) :

- `APNS_KEY_ID` (10 caractères), `APNS_TEAM_ID` = `G2SC6845GS`
- `APNS_PRIVATE_KEY` : contenu complet du fichier `.p8` — **secret**
- `APNS_BUNDLE_ID` (facultatif, défaut `app.dogcare.ios`)

Les liens universels reposent sur `https://dogcare-gamma.vercel.app/.well-known/apple-app-site-association`.
Si le domaine change, mettre à jour ce fichier, `ios/App/App/App.entitlements`, `capacitor.config.ts`,
`native-shell/offline.html` et `src/components/app/native-bridge.tsx`.

### Publication App Store

Variables Vercel supplémentaires :

- `SUPPORT_EMAIL` : adresse de contact affichée sur `/assistance` et `/confidentialite` (obligatoire avant soumission).
- `DEMO_ACCOUNT_EMAIL` : adresse du compte de démonstration (affiche le lien « Compte de démonstration »).

Préparer le compte de démonstration (une fois, puis à chaque besoin) : dans `.env.local`, renseigner
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DEMO_ACCOUNT_EMAIL`, `DEMO_ACCOUNT_PASSWORD` (12 caractères minimum),
puis `npm run demo:seed`. Identifiants à donner à Apple dans App Store Connect → « Informations de connexion ».

### TestFlight

- Fiche App Store Connect : « Dogcare – Garde entre amis » (`app.dogcare.ios`, SKU `dogcare-ios`).
  Sur l'écran d'accueil, l'app s'appelle « Dogcare ».
- Groupe interne « Testeurs internes » avec distribution automatique : toute nouvelle version envoyée y
  est proposée sans revue Apple.
- Nouvelle version : `npm run ios:testflight` (compile, signe pour l'App Store et envoie ; le numéro de
  build est horodaté automatiquement).
