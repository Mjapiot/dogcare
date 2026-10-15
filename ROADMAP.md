# Feuille de route — Dogcare

## MVP (cette version)

- [x] Connexion par code e-mail, profil, onboarding (chien facultatif)
- [x] Groupes privés, invitations sécurisées, rôles admin/membre, quitter / retirer
- [x] Chiens : fiche, photo, responsables multiples, visibilité par groupe, archivage
- [x] Disponibilités par créneaux (2/4 semaines), saisie rapide, habitudes hebdomadaires, partage par groupe
- [x] Demandes (4 types, nécessité, partage entre plusieurs personnes), modification, annulation
- [x] Réponses Oui/Non (y compris partielles), écran « Demandes » avec réponse en un geste
- [x] Confirmation, annulation par le gardien ou le propriétaire, reconfirmation après modification
- [x] Couverture calculée, statuts, couleurs + icônes, tableau de bord, filtres (statut, chien, propriétaire)
- [x] Notifications internes, préférences, temps réel
- [x] PWA : manifeste, icônes, service worker minimal, page hors ligne, aide à l'installation iPhone
- [x] RLS complète testée, tests unitaires et base de données
- [ ] Tests E2E exécutés contre le projet réel (en attente de la clé serveur en local)
- [ ] Vérification manuelle sur iPhone (voir TEST_PLAN.md)
- [ ] SMTP personnalisé pour lever la limite d'e-mails de Supabase

## Version 2

- Notifications push iOS (Web Push + VAPID, envoi serveur, abonnements expirés, préférences)
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
