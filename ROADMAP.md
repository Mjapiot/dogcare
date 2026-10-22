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
- [x] Notification native (APNs) reçue sur iPhone via TestFlight — 2026-10-21
- [x] Abonnement calendrier (gardes confirmées dans le Calendrier de l'iPhone, mises à jour automatiques) — abonnement vérifié sur iPhone le 2026-10-22
- [x] Code de groupe permanent, compte de démonstration, pages confidentialité et assistance
- [x] Compte de démonstration préparé (`npm run demo:seed`) et `SUPPORT_EMAIL` renseigné
- [x] RLS complète testée, tests unitaires et base de données
- [x] Tests E2E exécutés contre la production (2026-10-22)
- [ ] Vérification manuelle sur iPhone (voir TEST_PLAN.md)
- [ ] SMTP personnalisé pour lever la limite d'e-mails de Supabase

## Version 2

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
