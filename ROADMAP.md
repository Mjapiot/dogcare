# Feuille de route — Dogcare

## MVP (cette version)

- [x] Connexion par lien e-mail (retour dans l'app iPhone), profil, onboarding guidé avec progression (chien et habitudes facultatifs)
- [x] Groupes privés, invitations sécurisées, rôles admin/membre, quitter / retirer
- [x] Chiens : fiche, photo, responsables multiples, visibilité par groupe, archivage
- [x] Disponibilités par créneaux (2/4 semaines), saisie rapide, habitudes hebdomadaires, partage par groupe
- [x] Demandes (4 types, nécessité, partage entre plusieurs personnes), modification, annulation
- [x] Réponses Oui/Non (y compris partielles), écran « Demandes » avec réponse en un geste
- [x] Confirmation, annulation par le gardien ou le propriétaire, reconfirmation après modification
- [x] Couverture calculée, statuts, couleurs + icônes, tableau de bord, filtres (statut, chien, propriétaire)
- [x] Notifications internes, préférences, temps réel
- [x] Notifications push (Web Push + VAPID), test depuis le profil, désabonnement à la déconnexion
- [x] Notification de test reçue sur un vrai iPhone (PWA installée) — 2026-10-16
- [ ] Notification déclenchée par l'action d'un autre membre, reçue app fermée
- [x] PWA : manifeste, icônes, service worker minimal, page hors ligne, aide à l'installation iPhone
- [x] App iPhone native (Capacitor) : notifications APNs, liens universels, partage natif, hors ligne
- [x] App iPhone sur TestFlight (version 1.0 build 1)
- [x] Version 1.0 (build 202610221858) soumise à la vérification App Store — 2026-10-22
- [x] Signalement et blocage (demandé par Apple, règle 1.2) — 2026-10-23
- [x] Réponse à Apple (vidéo sur iPhone + informations) et nouvelle soumission — 2026-10-23
- [x] Approuvée par Apple et publiée sur l'App Store (version 1.0) — 2026-10-27 : https://apps.apple.com/fr/app/dogcare-garde-entre-amis/id6823693947
- [x] Notification native (APNs) reçue sur iPhone via TestFlight — 2026-10-21
- [x] Abonnement calendrier (gardes confirmées dans le Calendrier de l'iPhone, mises à jour automatiques) — abonnement vérifié sur iPhone le 2026-10-22
- [x] Code de groupe permanent, compte de démonstration, pages confidentialité et assistance
- [x] Compte de démonstration préparé (`npm run demo:seed`) et `SUPPORT_EMAIL` renseigné
- [x] RLS complète testée, tests unitaires et base de données
- [x] Tests E2E exécutés contre la production (2026-10-22)
- [ ] Vérification manuelle sur iPhone (voir TEST_PLAN.md)
- [ ] SMTP personnalisé pour lever la limite d'e-mails de Supabase

## Sprint en cours : « Le pet-sitter dans la boucle » (validé le 2026-10-28)

Objectif : j'invite ma pet-sitter, elle accepte la garde, reçoit un rappel, remplit le carnet, je vois les photos.
Chaque lot fait l'objet d'une spec validée avant d'être codé.

1. [x] Correctifs rapides
   - [x] `/circle/join/*` dans les liens universels (aujourd'hui l'invitation au cercle s'ouvre dans Safari)
   - [x] Advisors Supabase (sécurité, performance) après les migrations passeport et cercle
2. [x] Invités et proches hors groupe : répondre aux demandes et être confirmés sur les gardes du chien (en production le 2026-10-28, testé de bout en bout)
3. [x] Carnet de garde (repas, promenade, médicament, dépôt/récupération, photo ou commentaire) tenu par le gardien confirmé (en production le 2026-10-28, testé de bout en bout)
4. [x] Notifications du cercle (accès donné, fin d'accès, invitation acceptée) et rappel la veille d'une garde — notifications du cercle en production le 2026-10-28 ; rappels en production, tâche quotidienne vérifiée le 2026-11-03 (rappels enregistrés le 2026-11-02 à 17 h 41 UTC)
5. [x] Refonte de l'écran « Demandes » (en production le 2026-10-28)

Hors code, côté porteur du projet : étiquettes de confidentialité App Store (contacts d'urgence, vétérinaire),
tests manuels iPhone restants, SMTP personnalisé.

## Version 2

Vision : « Toute la vie de votre animal, partagée avec les bonnes personnes ». Ordre validé :

1. [x] Passeport numérique : 4 rubriques, santé/urgences protégées, lien de partage temporaire (en production le 2026-10-27)
2. [x] Cercle de confiance par chien : 5 rôles, accès santé/urgences par personne, invités datés et proches hors groupe (en production le 2026-10-28, parcours invité testé de bout en bout)
   - [x] Invités : répondre aux demandes et être confirmés sur les gardes du chien (en production le 2026-10-28)
   - [x] Notifications liées au cercle (en production le 2026-10-28)
3. [x] Carnet de garde (repas, promenade, médicament, dépôt/récupération, photo ou commentaire) — en production le 2026-10-28
4. [ ] Moteur de planning sous contraintes avec proposition à valider
   - [x] Planning de vacances, livraison 1 : rôle « Professionnel » et préférences de garde par personne (lieu, nuits max, note) — en production le 2026-11-02
   - [x] Planning de vacances, livraison 2 : moteur alimenté par les dispos, propositions ciblées, parcours « Planifier une absence » — en production le 2026-11-02
   - [x] Assistant « Décrivez votre absence » (langage naturel → dates et règles, Gemini gratuit) — en production le 2026-11-02, vérifié avec une vraie phrase
   - [x] Une demande à la fois : nuits d'affilée max, tranche minimale, conflits, confirmation tout ou rien (en production le 2026-10-29)
   - [x] Plusieurs chiens à la fois : absence de plusieurs chiens (ensemble si possible, sinon séparés et annoncés), une réponse pour tous, un avis par absence, cumul limité par personne, « Doit être gardé seul » — en production le 2026-11-03 (E2E 14/14 du premier coup)
   - [ ] Transport (qui dépose, qui récupère)
5. [x] Routines (désactivées par défaut) : type, heures, jours, consigne ; cochées dans le carnet pendant la garde, suivies par le propriétaire, citées dans le rappel de la veille — en production le 2026-11-03
- [x] Passeport sans groupe (« passeport d'abord ») : choix à l'inscription, espace « Mes chiens », fiche complète en solo (lien de partage, cercle), partage proposé en entrant dans un groupe — en production le 2026-11-02

- Résumé hebdomadaire (préférence déjà prévue en base) — les rappels de la veille sont dans le sprint en cours
- Invitations par les membres (option par groupe)
- Affichage des conflits d'un gardien (deux gardes simultanées)
- Créneaux configurables par groupe dans l'interface
- [x] Refonte du Calendrier : agenda, barres du mois, résumé, disponibles du jour (en production le 2026-10-29)
- [x] Refonte de Mes dispos : semaine par semaine, raccourcis, copie de semaine, besoins du groupe (en production le 2026-10-29)
- [x] Refonte du Profil : carte et « Cette année », mon monde, réglages en liste, page Notifications (en production le 2026-10-29)
- [x] Correctifs de la revue du 2026-11-03 (aucun critique) : médicaments et droit Santé, cochage unique à la minute, verrous, règles du cercle appliquées, dates impossibles, heure d'été, assistant (bloqués, journal), « Personne à solliciter », VoiceOver et couleurs, Realtime élargi, squelettes, libellés — en production le 2026-11-03
- [x] Fluidité : fonctions à Dublin près de la base, cache 30 s des onglets, squelettes par onglet, animation d'entrée une fois, lectures en parallèle, absence créée en une transaction — en production le 2026-11-02 (changement d'onglet : 0,4 s au lieu de 1 à 2,5 s ; immédiat en revenant sur un onglet)
- [x] Lot de polissage (accessibilité, fiabilité, détails d'interface) : « Personne à solliciter », VoiceOver du mois, textes agrandis, feuille du jour et sens des animations, cartes sortantes inactives, planning sans doublon, tris par instants, photos du carnet dans l'app, compte du dernier responsable, limites photos, rafraîchissements — en production le 2026-11-02
- [x] Correctifs de la revue du 2026-10-29 : blocage et engagements, suppression de groupe, lien des invités, bouton Fermer 44 px, planning et nuits confirmées, ménage quotidien, pastille allégée, mineurs (en production le 2026-10-29)
- [ ] Refonte du parcours (prototype validé le 2026-11-03), 6 lots :
  - [x] Lots 1 et 2 : briques visuelles, barre du bas flottante (Accueil, Agenda, Chiens, Profil), « Besoin d'une garde » dans l'en-tête, Accueil « À faire maintenant » — en production le 2026-11-03 (E2E 15/15, 2 relancés après un aléa de minutage)
  - [ ] Lot 3 : le « + » unique en 3 étapes (types « pour info », « souhaitée », « non partageable » supprimés à la création)
  - [ ] Lot 4 : Agenda comme la maquette (Besoins en grandes cartes, Mes dispos), sans grille du mois
  - [ ] Lot 5 : Chiens (fusion de `/circle`, fiche en 4 tuiles)
  - [ ] Lot 6 : Profil, page d'une demande allégée, ménage
- Mode sombre
- Types TypeScript générés depuis la base (`supabase gen types`)

## Plus tard

- Historique et statistiques simples des gardes
- Export / abonnement iCal en lecture seule
- Multi-langue
