# Dogcare

Application web progressive (PWA) privée pour qu'un groupe d'amis coordonne la garde de ses chiens :
**anticiper les gardes, connaître les disponibilités de ses amis et repérer immédiatement les jours sans solution.**

- Calendrier partagé (vue « Aujourd'hui », 2 semaines, mois) avec un code couleur + icône + libellé par statut
- Disponibilités par créneaux (matin, après-midi, soir, nuit) et habitudes hebdomadaires
- Demandes de garde, réponses Oui / Non, confirmation par le propriétaire, gardes partagées entre plusieurs personnes
- Calcul de couverture fiable (créneaux non couverts identifiés à la minute près)
- Notifications dans l'application, groupes privés sur invitation, sécurité garantie par la base de données (RLS)

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

Aucune clé secrète n'est nécessaire au fonctionnement de l'application.

### Réglages Supabase à faire une fois (tableau de bord)

1. **Authentication → Emails → Templates → Magic Link** : le contenu doit afficher le code `{{ .Token }}`
   (connexion par code à 6 chiffres, indispensable pour l'app installée sur iPhone). Modèle conseillé :
   ```html
   <h2>Votre code Dogcare</h2>
   <p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
   <p>Ce code expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>
   ```
2. **Authentication → URL Configuration** : Site URL `https://dogcare-gamma.vercel.app`, et ajouter
   `https://dogcare-gamma.vercel.app/**` et `http://localhost:3000/**` aux Redirect URLs.
3. **Authentication → Emails → SMTP** : l'envoi intégré est limité à quelques e-mails par heure.
   Avant d'inviter tout le groupe, configurer un SMTP (ex. Resend) avec un domaine vérifié.

## Sécurité

- Aucune donnée n'est accessible sans être membre du groupe : règles RLS testées automatiquement.
- Aucun secret dans le dépôt (public). `.env.local` est ignoré par Git.
- Les liens d'invitation ne sont stockés que sous forme d'empreinte (SHA-256), expirent et sont révocables.
