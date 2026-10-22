# Architecture — Dogcare

## Vue d'ensemble

```
iPhone (PWA) ──HTTPS──> Vercel (Next.js App Router)
                          │  Server Components : lecture des données (session utilisateur)
                          │  Server Actions    : écritures validées par Zod
                          ▼
                       Supabase
                          ├─ PostgreSQL : schéma, contraintes, RLS, fonctions (RPC), triggers
                          ├─ Auth       : lien e-mail (PKCE), retour app via app.dogcare.ios://
                          ├─ Storage    : photos des chiens (bucket privé, URL signées)
                          └─ Realtime   : rafraîchissement des écrans (filtré par RLS)
```

Toutes les requêtes à la base se font **en tant qu'utilisateur connecté** (clé publishable + session) :
la RLS s'applique partout. Seule exception : la distribution des notifications push (`src/server/push.ts`)
utilise la clé secrète côté serveur pour lire les abonnements des destinataires.

## Abonnement calendrier

`/calendar/{jeton}.ics` (route publique, `src/app/calendar/[file]/route.ts`) : le Calendrier d'iOS l'interroge
sans session. La route appelle avec la clé publique la fonction `calendar_feed_events(jeton)` (SECURITY DEFINER,
rien pour un jeton inconnu) puis génère le fichier iCalendar (`src/lib/ics.ts`, `src/lib/calendar-feed.ts`).
Le profil affiche un lien `webcal://` : dans l'app native, Capacitor le confie à iOS qui propose l'abonnement.

## Notifications push

1. Une action (demande, réponse, confirmation…) crée des notifications en base (triggers/RPC).
2. La Server Action programme `schedulePushDispatch()` via `after()` : après la réponse HTTP, le serveur
   réserve atomiquement les notifications en attente (`claim_push_batch`), les envoie avec `web-push`
   (VAPID) ou APNs à chaque appareil du destinataire. Les décisions sont pures et testées (`src/lib/push-delivery.ts`) :
   une notification sans aucun appareil atteint à cause d'une erreur temporaire est remise en file
   (`release_push_batch`, 5 essais max), un appareil n'est oublié qu'après 5 échecs consécutifs (jamais pour
   une erreur de configuration serveur). Chaque passage purge aussi les données anciennes.
3. Le service worker affiche la notification ; la toucher ouvre la demande concernée.

Sur iPhone, les push exigent l'app installée sur l'écran d'accueil (iOS 16.4+) et une autorisation
demandée après un geste (Profil → « Activer sur cet appareil »). À la déconnexion, l'appareil est désabonné.

## Arborescence

```
src/
  app/                 routes (App Router)
    (app)/             écrans connectés : layout = AppShell (en-tête, onglets, temps réel)
    login, auth/confirm, onboarding (prénom, groupe, habitudes), invite/[token], offline
    manifest.ts, icon.tsx, apple-icon.tsx, pwa-icon/[variant]   PWA
  domain/              logique métier PURE et testée (aucune dépendance React/Supabase)
    config.ts          créneaux, fuseau horaire
    intervals.ts       intervalles semi-ouverts [début, fin) : fusion, soustraction
    time.ts            dates locales, Europe/Paris, changements d'heure, créneaux
    availability.ts    résolution des disponibilités (ponctuel > habitude), évaluation d'une période
    coverage.ts        couverture d'une demande, détection de conflits
    status.ts          statuts calculés, tons, libellés
    views.ts           assemblage des données en modèles d'écran (RequestView, jours, tableau de bord)
  server/              code serveur uniquement
    session.ts         utilisateur, profil, groupes, groupe courant, garde d'accès des écrans
    data.ts            requêtes de lecture (paginées par 1000, listes d'identifiants découpées)
    actions/*.ts       Server Actions (auth, groupes, chiens, dispos, demandes, notifications)
    errors.ts          messages d'erreur sûrs pour l'utilisateur
  components/
    ui/                primitives (kit.tsx + shadcn : dialog, sheet, switch, sonner)
    app/               en-tête, navigation inférieure, mises à jour temps réel
    calendar/          vues calendrier
    availability/      matrice de disponibilités, habitudes, partage
    domain/            cartes de demande, badges, réponses, confirmations
    dogs/ groups/ profile/ pwa/
  lib/                 clients Supabase, env, format FR, validation Zod, types
  proxy.ts             rafraîchissement de session + redirection vers /login (vérif. optimiste)
supabase/migrations/   schéma, sécurité, logique métier SQL, stockage et temps réel
tests/unit             logique métier (Vitest)
tests/db               migrations + RLS + RPC sur PostgreSQL embarqué (PGlite)
tests/e2e              parcours complet (Playwright, projet Supabase réel)
public/sw.js           service worker minimal
```

## App iPhone native

`ios/` est un projet Xcode Capacitor 8 qui charge le site de production (`server.url`) : le site a
besoin de son serveur (auth, actions), il n'est donc pas embarqué. Le code web détecte l'app
(`src/lib/native.ts`) et utilise les plugins : notifications APNs (`register_native_push` + envoi HTTP/2
dans `src/server/apns.ts`), liens universels et taps de notifications (`components/app/native-bridge.tsx`),
partage, haptique, barre d'état. Sans réseau, l'app affiche `native-shell/offline.html` (embarquée).

## Choix techniques

| Sujet | Choix | Pourquoi |
| --- | --- | --- |
| Rendu | Server Components + Server Actions, `cacheComponents` désactivé | Tout dépend de l'utilisateur : rendu par requête, modèle simple |
| État client | Aucune librairie globale | `useTransition`, état local, `router.refresh()` |
| Règles critiques | En base (RLS, contraintes, RPC `SECURITY DEFINER`) | Impossible à contourner depuis le client |
| Statuts | Calculés en TypeScript (`src/domain`) à partir des lignes lues | Testables, une seule source de vérité |
| Notifications | Générées par des triggers/RPC SQL, puis envoyées en push par le serveur | Atomiques avec l'action, impossibles à falsifier, pas de webhook à configurer |
| Temps | `timestamptz`, intervalles `[début, fin)`, `@date-fns/tz` | Pas de comparaison de chaînes, DST correct |
| Auth | Code e-mail (OTP) via `@supabase/ssr` | Reste dans la PWA installée sur iPhone |
| Temps réel | Supabase Realtime → `router.refresh()` + rafraîchissement au retour dans l'app | L'app reste juste même sans connexion temps réel |
| Hors ligne | Service worker : assets statiques + page /offline | Aucune donnée privée en cache, aucune action hors ligne |
| App iOS | Capacitor (coquille native + plugins) | Une seule base de code, fonctions natives là où elles comptent |
| Photos | Redimensionnées sur l'appareil (1024 px, WebP/JPEG), bucket privé 5 Mo | Légères, métadonnées EXIF supprimées |

## Flux d'une action (exemple : confirmer une garde)

1. Le propriétaire touche « Confirmer » → `confirmAssignment` (Server Action) valide les entrées (Zod).
2. Appel RPC `confirm_assignment` : verrou sur la demande, vérification responsable / volontaire /
   créneau, insertion protégée par la contrainte d'exclusion, notification au gardien, journal d'audit.
3. `revalidatePath` + Realtime → tous les écrans concernés se rafraîchissent.
4. Les statuts sont recalculés par `src/domain/views.ts`.

## Gestion des états d'écran

Chargement (`loading.tsx`, squelettes), vide (`EmptyState`), erreur (`error.tsx`, messages FR non
révélateurs), non autorisé (redirection `/login`, 404 pour une ressource inaccessible), hors ligne
(bandeau + page `/offline`).
