# Design system — Dogcare

Inspiration : maquette de référence fournie (typographie éditoriale très grande, pilules noires, cartes
pastel par jour, fond gris chaud). Esprit : iOS premium, chaleureux, minimaliste, utilisable au pouce.

## Couleurs (`src/app/globals.css`)

| Jeton | Valeur | Usage |
| --- | --- | --- |
| `--canvas` | `#ebe8e2` | fond de l'application |
| `--surface` | `#fbfaf7` | cartes, feuilles (ivoire) |
| `--surface-2` | `#f3f1ec` | surfaces secondaires |
| `--ink` / `--ink-2` / `--ink-3` | `#1c1b19` / `#4a4843` / `#6e6b64` | texte anthracite (3 niveaux) |
| `--sage` | `#4f6f52` | accent vert sauge |
| `--beige` | `#e9dfcf` | avatars, accents chauds |

### Tons de statut (fond / texte, contraste > 7:1)

| Ton | Fond | Texte | Icône | Libellé |
| --- | --- | --- | --- | --- |
| covered | `#c9dcc4` | `#1d3a20` | cercle coché | Couvert |
| pending | `#f3cd98` | `#4f2e08` | horloge | À organiser |
| uncovered | `#eeb1ab` | `#5e1510` | cercle alerte | Sans solution |
| partial | `#eeb1ab` + hachures | `#5e1510` | cercle pointillé | Partiellement couvert |
| info | `#d2cbe8` | `#2b2450` | info | Information |
| muted / none | `#e2dfd8` | `#45423d` | barré | Sans réponse positive / Aucun besoin |

Règle : **jamais la couleur seule** — toujours icône + texte (et hachures pour « partiel »).

## Typographie

Inter Tight (auto-hébergée par `next/font`), proche de la grotesque de la maquette.
Très grands chiffres pour les dates (64–76 px, interlettrage −0.05em), titres 28–40 px, texte 15–17 px,
16 px minimum dans les champs (évite le zoom Safari).

## Formes et espacements

Rayons généreux : cartes 24–32 px, champs 16 px, boutons en pilule.

## Ambiance (octobre 2026)

Inspirée des maquettes santé « sauge » : lumière douce, surfaces givrées, grands chiffres.

- **Fond** : `--canvas` éclairé par deux halos fixes (chaud en haut à gauche, sauge en bas à droite), `body::before`.
- **`.glass`** : ivoire translucide + flou + liseré blanc + ombre longue. Barre d'onglets flottante, en-tête,
  sélecteur de vue, tuiles vides, raccourcis.
- **`.shadow-soft`** : ombre longue et légère des cartes (`Card` l'applique avec un liseré blanc).
- **Pastilles d'icône** sauge (`bg-sage/12 text-sage`) dans les titres de cartes du passeport.
- **Tuiles chiffrées** (âge, poids…) : givrées, grand chiffre 19–22 px, libellé 12–13 px.
- **Mouvement** (`motion`, `components/ui/motion.tsx`) : apparition en cascade des blocs (`Stagger` / `Rise`),
  pastille active de la barre d'onglets qui glisse (`layoutId`), curseur glissant du contrôle segmenté.
  Tout respecte « Réduire les animations » (`MotionConfig reducedMotion="user"` + règle CSS globale).
Marges latérales 16 px, espacement vertical 20–28 px entre sections.

## Composants

| Composant | Fichier |
| --- | --- |
| AppShell (en-tête + onglets) | `app/(app)/layout.tsx`, `components/app/*` |
| BottomNavigation (flottante, givrée) | `components/app/bottom-navigation.tsx` |
| PassportHero, PassportSection, PassportShare | `components/dogs/passport-*.tsx` |
| Stagger / Rise (animations d'apparition) | `components/ui/motion.tsx` |
| CalendarHeader / CalendarGrid / CalendarDay | `components/calendar/calendar-view.tsx` |
| AvailabilityMatrix / AvailabilitySelector | `components/availability/*` |
| DogAvatar, CareRequestCard, CoverageIndicator, RequestStatusBadge | `components/domain/request-bits.tsx` |
| CareRequestForm | `components/domain/care-request-form.tsx` |
| ResponseButtons | `components/domain/response-buttons.tsx` |
| MemberAvailabilityList (réponses des membres) | `components/domain/helper-list.tsx` |
| ConfirmationDialog | `components/domain/confirmation-dialog.tsx` |
| NotificationCenter | `app/(app)/notifications/page.tsx` |
| EmptyState, LoadingSkeleton, ErrorState, PillButton, Field… | `components/ui/kit.tsx`, `app/(app)/error.tsx` |

## Principes UX

- Zones tactiles ≥ 44 px ; actions principales en bas ou dans l'en-tête (« + » toujours visible).
- Retour immédiat : état optimiste, toasts, indicateurs de chargement.
- Feuilles (bottom sheets) pour les détails d'un jour, les filtres, les confirmations de créneau.
- Confirmation pour les actions sensibles (annuler, retirer, archiver, supprimer).
- Safe areas iOS (`viewport-fit=cover`, `env(safe-area-inset-*)`), `100dvh`, pas de scroll horizontal.
- `prefers-reduced-motion` respecté ; focus visible ; libellés accessibles (VoiceOver) sur chaque case
  du calendrier et de la grille de disponibilités.
- Thème clair uniquement pour le MVP (mode sombre en feuille de route).
