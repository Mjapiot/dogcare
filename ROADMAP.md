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

1. [ ] Correctifs rapides
   - [ ] `/circle/join/*` dans les liens universels (aujourd'hui l'invitation au cercle s'ouvre dans Safari)
   - [ ] Advisors Supabase (sécurité, performance) après les migrations passeport et cercle
2. [ ] Invités et proches hors groupe : répondre aux demandes et être confirmés sur les gardes du chien
3. [ ] Carnet de garde (repas, promenade, médicament, dépôt/récupération, photo ou commentaire) tenu par le gardien confirmé
4. [ ] Notifications du cercle (accès donné, fin d'accès, invitation acceptée) et rappel la veille d'une garde
5. [ ] Refonte de l'écran « Demandes »

Hors code, côté porteur du projet : étiquettes de confidentialité App Store (contacts d'urgence, vétérinaire),
tests manuels iPhone restants, SMTP personnalisé.

## Version 2

Vision : « Toute la vie de votre animal, partagée avec les bonnes personnes ». Ordre validé :

1. [x] Passeport numérique : 4 rubriques, santé/urgences protégées, lien de partage temporaire (en production le 2026-10-27)
2. [x] Cercle de confiance par chien : 5 rôles, accès santé/urgences par personne, invités datés et proches hors groupe (en production le 2026-10-28, parcours invité testé de bout en bout)
   - [ ] Invités : répondre aux demandes et être confirmés sur les gardes du chien
   - [ ] Notifications liées au cercle
3. [ ] Carnet de garde (repas, promenade, médicament, dépôt/récupération, photo ou commentaire)
4. [ ] Moteur de planning sous contraintes (nuits max, lieux, incompatibilités) avec proposition à valider
5. [ ] Routines (désactivées par défaut)
- Passeport sans groupe (entrée « passeport d'abord » dans l'onboarding)

- Rappels la veille d'une garde, résumé hebdomadaire (préférences déjà prévues en base)
- Invitations par les membres (option par groupe)
- Affichage des conflits d'un gardien (deux gardes simultanées)
- Créneaux configurables par groupe dans l'interface
- Mode sombre
- Types TypeScript générés depuis la base (`supabase gen types`)

## Plus tard

- Historique et statistiques simples des gardes
- Export / abonnement iCal en lecture seule
- Multi-langue
