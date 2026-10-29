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

## Passeport partagé

`/p/{jeton}` (page publique, `src/app/p/[token]/page.tsx`) : appelle avec la clé publique `shared_passport(jeton)`
(SECURITY DEFINER, `null` pour un lien inconnu, expiré, révoqué ou un chien archivé ; compte les ouvertures) et
signe la photo du chien grâce à une politique de stockage `anon` limitée à la photo actuelle d'un chien ayant un
lien actif. Rubriques en lecture : `src/components/dogs/passport-view.tsx` (partagées avec la fiche du chien),
édition par rubrique : `passport-section.tsx` + `passport-editors.tsx`, partage : `passport-share.tsx`.

## Cercle de confiance

Carte « Cercle de confiance » (responsables) : `components/dogs/circle-card.tsx`, actions `server/actions/circle.ts`,
règles d'affichage et fenêtres d'invité `domain/circle.ts`. Une personne invitée hors des groupes n'a pas de groupe :
`requireAppContext` la redirige vers `/circle` (« Chiens confiés »), `/circle/[dogId]` affiche le passeport en
lecture seule, `/circle/join/[token]` accepte l'invitation (l'onboarding saute alors les étapes de groupe).

Personnes du cercle sur les demandes : le formulaire de demande propose « Demander aussi à »
(`request_invitee_candidates`, règle de dates `circleCovers` dans `domain/circle.ts`, enregistrement par
`set_request_invitees` dans les actions de `server/actions/requests.ts`). Côté groupe, `getGroupSnapshot` charge les
invités (`request_invitees_of`) et `domain/views.ts` les compte comme éligibles (badge Proche / Invité dans les
réponses). Côté invité, `/circle` liste ses demandes et `/circle/requests/[id]` en montre une
(`my_invited_requests`, vue pure `domain/invited.ts`) : sa réponse, ses gardes, la couverture sans noms. Une
demande ouverte depuis `/requests/[id]` par quelqu'un hors de son groupe redirige vers `/circle/requests/[id]` ; une
personne sans groupe arrive sur `/circle` (y compris depuis une notification).

## Écran « Demandes »

`app/(app)/requests/page.tsx` réunit les demandes du groupe courant (`buildRequestViews`) et celles des cercles
(`my_invited_requests`, `buildInvitedView`) en éléments communs (`domain/requests-screen.ts` : `fromGroupView`,
`fromInvitedView`, `splitScreenItems`, `groupByHorizon`). Composants : `components/requests/` (onglets-liens à
pouce glissant, cartes, liste animée avec `motion`). La pastille de la barre d'onglets suit la même règle
(`app/(app)/layout.tsx`).

## Profil

`app/(app)/profile/page.tsx` (+ `profile/notifications`, `profile/calendar`) ; résumé de l'année
`domain/profile.ts` (`yearStats`, données `getYearGardes`) ; lignes de réglages `components/profile/settings-row.tsx`,
état des notifications lu sans rien demander `push-status.tsx`, `install-row.tsx` (`useCanInstall`).

## Mes dispos

`app/(app)/availability/page.tsx` (onglets-liens `ScreenTabs`) ; `components/availability/week-editor.tsx`
(semaine, sélection, raccourcis, copie, besoins) ; règles pures `domain/availability-screen.ts` (`weekStarts`,
`presetCells`, `copyPreviousWeek`, `filledCount`, `needsByDay`, `habitsSummary`) ; les besoins viennent des mêmes
éléments que l'écran « Demandes » (`fromGroupView` / `fromInvitedView`, `needsMyAnswer`).

## Calendrier

`app/(app)/calendar/page.tsx` charge le groupe sur la période (dispos comprises, `getGroupSnapshot` en mode
dates), filtre et prépare les éléments (`domain/calendar.ts` : `toCalItem`, `filterCalItems`, `calSummary`,
`availableOn`). Composants `components/calendar/` : `calendar-view.tsx` (en-tête, résumé, portée, glissement
animé), `agenda.tsx` (`agendaRows`), `month-grid.tsx` (`weekBars`), `day-sheet.tsx`, `legend.tsx`.

## Moteur de planning

Calcul pur et déterministe dans `domain/planner.ts` (`proposePlan` : glouton « va le plus loin » pour minimiser
les relais, nuits d'affilée plafonnées avec repère à 01:00 heure de Paris, absorption des tranches courtes,
explications) ; entrées construites par `domain/plan-inputs.ts` (offres = « Oui » moins les autres gardes via
`getBusyAssignments`, réglages du chien, suggestions pour les trous d'après les dispos). Carte
`components/planning/plan-card.tsx` (frise, ajustement, confirmation par `confirmPlan` → `confirm_plan`) sur
`/requests/[id]` ; réglages `components/planning/planning-rules.tsx` sur la fiche du chien.

## Carnet de garde

`components/care-log/care-log-section.tsx` (serveur) charge le carnet d'une demande (`getCareLog`, photos signées
1 h) et rappelle les consignes du passeport ; `care-log-composer.tsx` (boutons rapides, feuille « Détails », envoi
de la photo réduite par `lib/image.ts` dans le seau `care-logs` puis `addCareLog`) et `care-log-timeline.tsx`
(fil par jour de Paris, modification, suppression, signalement). Règles pures : `domain/care-log.ts`. Utilisée sur
`/requests/[id]` et `/circle/requests/[id]` ; l'accueil montre les gardes en cours avec la dernière nouvelle
(`getLatestCareNews`). La purge des photos tourne avec la distribution des push (`server/push.ts`).

## Tâche quotidienne

Vercel Cron appelle `/api/cron/daily` (`vercel.json`, 17:00 UTC) avec `CRON_SECRET` (`lib/cron.ts`, comparaison
à temps constant ; route publique dans `proxy.ts`, protégée par ce secret). `runDailyJob` (`server/push.ts`, seul
endroit qui utilise la clé secrète) appelle `run_daily_reminders` puis distribue les push.

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
