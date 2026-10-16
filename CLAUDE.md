@AGENTS.md

# Dogcare — règles du projet pour Claude Code

## Produit

PWA privée (iPhone d'abord) pour qu'un groupe d'amis coordonne la garde de ses chiens. Priorités absolues :
simplicité d'utilisation, fiabilité des informations de garde, visibilité immédiate des jours sans solution.
Voir PRODUCT_SPEC.md. Le porteur du projet communique en français ; code, noms et commits en anglais ;
interface en français.

## Stack imposée

Next.js 16 App Router (Proxy = ex-Middleware, `src/proxy.ts`), React 19, TypeScript strict, Tailwind 4,
shadcn/ui (radix), Lucide, Zod 4, Supabase (`@supabase/ssr`), Vitest, Playwright, Vercel.
**Lire `node_modules/next/dist/docs/` avant d'utiliser une API Next.js** (versions récentes).

## Architecture (voir ARCHITECTURE.md)

- `src/domain/` : logique métier pure et testée — tout calcul de dispo, couverture, statut s'y trouve.
  Jamais de logique métier dans les composants.
- `src/server/` : lecture (`data.ts`), session, Server Actions (`actions/`). Chaque action : validation Zod,
  appel Supabase en tant qu'utilisateur, `toUserMessage` pour les erreurs, `revalidatePath`.
- `supabase/migrations/` : source de vérité du schéma. Ne jamais modifier une migration déjà poussée sur
  `main` (elle est appliquée en production automatiquement) : créer une nouvelle migration.

## Règles métier invariantes

1. Disponibilité ≠ réponse « Oui » ≠ garde confirmée.
2. L'absence de réponse n'est jamais un refus ; « Sans solution » uniquement si tous les éligibles ont dit Non.
3. Intervalles semi-ouverts `[début, fin)`, `timestamptz`, fuseau Europe/Paris ; jamais de comparaison
   de chaînes de dates.
4. Une demande n'est « couverte » que si 100 % de la période a une garde confirmée.
5. Deux gardes non annulées d'une même demande ne se chevauchent jamais (contrainte d'exclusion).
6. Un engagement confirmé n'est jamais modifié en silence (reconfirmation + notification).
7. Une saisie ponctuelle de disponibilité prime toujours sur une habitude.
8. La couleur n'est jamais le seul porteur de sens (icône + libellé).

## Sécurité

- RLS sur toutes les tables ; toute règle critique est garantie en base, pas seulement dans l'UI.
- Ne jamais faire confiance à un `user_id` venant du client (utiliser `auth.uid()` / défaut en base).
- Fonctions `SECURITY DEFINER` : `set search_path = ''`, noms qualifiés, `revoke` pour `public`/`anon`.
- Aucun secret dans le dépôt (public). Jamais de clé secrète dans une variable `NEXT_PUBLIC_`.
  La clé secrète Supabase n'est utilisée que dans `src/server/push.ts` (distribution des push) et les tests E2E.
- Aucune donnée privée mise en cache par le service worker ; aucune action possible hors ligne.

## App iOS (Capacitor)

- `ios/` est versionné. Après modification de `capacitor.config.ts` ou d'un plugin : `npm run ios:sync`.
- Toute API native passe par `src/lib/native.ts` / `components/app/native-bridge.tsx` et doit avoir un
  comportement web équivalent (l'app web reste la référence).
- Ne jamais commiter `ios/App/App/capacitor.config.json` pointant vers localhost.

## Commandes

```bash
npm run typecheck && npm run lint && npm test && npm run build   # = npm run check
npm run test:e2e   # nécessite SUPABASE_SECRET_KEY dans .env.local
```

## Critères de qualité

- Tout changement de règle métier : test unitaire (`tests/unit`) ou base (`tests/db`) correspondant.
- Toute nouvelle table : RLS + politiques + test d'isolation dans `tests/db/migrations.test.ts`.
- Zones tactiles ≥ 44 px, champs ≥ 16 px, libellés accessibles, safe areas.
- Ne jamais affirmer qu'une fonctionnalité marche sans l'avoir vérifiée ; distinguer implémenté / testé /
  non terminé.

## Documentation

Mettre à jour dans le même commit : PRODUCT_SPEC.md (règles), DATABASE.md (schéma/RLS), ARCHITECTURE.md
(structure), TEST_PLAN.md (tests), ROADMAP.md (avancement), README.md (installation/déploiement).
