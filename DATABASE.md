# Base de données — Dogcare

PostgreSQL (Supabase). Migrations dans `supabase/migrations/`, appliquées automatiquement sur la
production à chaque push sur `main` (intégration GitHub de Supabase). Ne jamais modifier une migration
déjà appliquée : en créer une nouvelle (`YYYYMMDDHHMMSS_description.sql`).

| Fichier | Contenu |
| --- | --- |
| `…120000_core_schema.sql` | types, tables, contraintes, index, création automatique du profil |
| `…120100_security.sql` | fonctions d'accès (`private.*`), RLS, privilèges par colonne |
| `…120200_business_logic.sql` | RPC, triggers métier, notifications, audit |
| `…120300_storage_realtime.sql` | bucket `dog-photos` + politiques, publication temps réel |
| `20261016090000_web_push.sql` | état d'envoi push des notifications, RPC d'abonnement et de distribution |
| `20261016120000_native_push.sql` | appareils iOS natifs (`platform = 'ios'`, jeton APNs), RPC `register_native_push` |
| `20261023090000_reports_and_blocks.sql` | signalements (`content_reports`, `report_content`), blocages (`user_blocks`, `block_member`), visibilité des demandes et notifications entre membres bloqués |
| `20261022090000_calendar_feed.sql` | abonnement calendrier (`calendar_feeds`), RPC `get_calendar_feed_token`, `reset_calendar_feed_token`, `calendar_feed_events` |
| `20261021120000_group_join_codes.sql` | code de groupe permanent (`group_join_codes`), essais limités (`join_code_attempts`, 10 échecs / 15 min), RPC `get_group_join_code`, `reset_group_join_code`, `join_group_with_code` |
| `20261021110000_review_fixes_delivery.sql` | relances push (5 essais en 30 min), purge (notifications > 6 mois, audit > 1 an), index de lecture et de clés étrangères |
| `20261021100000_review_fixes_rules.sql` | préférences limitées au push, annulation d'un créneau parmi plusieurs, intégrité des réponses, information devenue besoin annoncée, passage en non partageable contrôlé, confirmation impossible sur une demande terminée |
| `20261021090000_review_fixes_departures.sql` | suppression de groupe avec demandes, retrait des engagements d'un membre qui part ou supprime son compte, écritures directes interdites sur `push_subscriptions` |

## Tables

| Table | Rôle | Points clés |
| --- | --- | --- |
| `profiles` | prénom affiché, fuseau | créée par trigger à l'inscription ; l'e-mail reste dans `auth.users` |
| `groups` | groupe privé | |
| `group_members` | appartenance | PK `(group_id, user_id)`, `role` admin/member, `share_availability` |
| `group_invitations` | liens d'invitation | **seule l'empreinte SHA-256 du jeton** est stockée ; expiration, `max_uses`, révocation |
| `dogs` | fiche chien | `archived_at` (archivage sans perte d'historique) |
| `dog_caretakers` | responsables d'un chien | owner / caretaker ; au moins un responsable garanti |
| `group_dogs` | chiens visibles dans un groupe | |
| `availability_rules` | habitudes hebdomadaires | unique `(user, weekday, slot)` |
| `availability_entries` | saisies ponctuelles (priment sur les habitudes) | unique `(user, date, slot)` ; date locale Europe/Paris |
| `care_requests` | besoin de garde | FK composite `(group_id, dog_id) → group_dogs` (le chien doit être dans le groupe) ; `ends_at > starts_at` ; ≤ 31 jours ; `revision` |
| `request_responses` | Oui / Non | unique `(request_id, user_id)` ; sous-période proposée optionnelle |
| `care_assignments` | gardes confirmées | **contrainte d'exclusion** : deux gardes non annulées d'une même demande ne se chevauchent jamais (`tstzrange [)`) ; statut `confirmed` / `pending_reconfirmation` / `cancelled` |
| `notifications` | notifications internes | écrites uniquement par la base |
| `notification_preferences` | préférences | absence de ligne = tout activé |
| `push_subscriptions` | appareils abonnés aux notifications push | écriture uniquement via `register_push_subscription` / `register_native_push` (le client ne peut que lire et supprimer ses appareils) ; format d'adresse contrôlé en base ; le serveur n'appelle que des services connus (FCM, Apple, Mozilla, Windows) |
| `group_join_codes` | code permanent d'un groupe (8 caractères sans ambiguïté) | aucun accès direct : lecture et changement réservés aux admins via RPC |
| `content_reports` | signalements (demande, chien, membre) | aucun accès client : écrit par `report_content` (membre du groupe, cible du groupe, 20 / heure), lu par l'équipe Dogcare ; notifie les admins sans révéler l'auteur |
| `user_blocks` | blocages entre membres | lecture et suppression de ses propres blocages ; création via `block_member` ; `private.request_visible` masque les demandes entre membres bloqués (sauf garde vivante), `can_respond` et `notify` en tiennent compte |
| `calendar_feeds` | jeton secret de l'abonnement calendrier (un par membre) | aucun accès direct : `get_calendar_feed_token` / `reset_calendar_feed_token` pour son propre jeton ; `calendar_feed_events(jeton)` (anon) ne renvoie que les gardes confirmées du propriétaire du jeton |
| `join_code_attempts` | essais de code échoués | limite les tentatives par compte ; purgés après 1 jour |
| `audit_events` | journal des événements critiques | aucun accès client |

Écarts assumés par rapport au schéma initial proposé :
- disponibilités stockées par **créneau** (et non par heures libres) et **par utilisateur** avec partage
  par groupe (`group_members.share_availability`) ;
- notifications reliées directement à `request_id` (clé étrangère) plutôt qu'un couple type/id générique ;
- `avatar_path` prévu mais non utilisé (initiales affichées).

## Sécurité (RLS)

RLS activée sur **toutes** les tables. `anon` n'a aucun droit. `authenticated` a la lecture, et l'écriture
seulement sur les colonnes légitimes (privilèges par colonne). Les actions sensibles passent par des RPC.

| Donnée | Lecture | Écriture |
| --- | --- | --- |
| Groupes, membres | membres du groupe | renommer/supprimer : admin ; partage de dispos : soi-même ; quitter : soi ; retirer : admin |
| Invitations | admins du groupe | RPC `create_invitation`, `revoke_invitation`, `accept_invitation` |
| Chiens, responsables | responsables + membres des groupes où le chien est visible | modifier : responsables ; créer : RPC `create_dog` |
| Disponibilités | soi + membres des groupes où l'on partage | soi uniquement (`user_id = auth.uid()`) |
| Demandes | membres du groupe | créer/modifier : responsable du chien **et** membre du groupe |
| Réponses | membres du groupe | soi uniquement, si éligible (membre, non responsable, demande active et future) |
| Gardes | membres du groupe | RPC `confirm_assignment`, `cancel_assignment`, `answer_reconfirmation` |
| Notifications | destinataire | marquer lu / supprimer : destinataire ; création : base uniquement |
| Photos (Storage) | si le chien est visible | responsables, dossier `<dog_id>/` |

Fonctions d'aide (`private.is_group_member`, `can_view_dog`, …) : `SECURITY DEFINER`, `search_path = ''`,
dans un schéma non exposé par l'API, ne répondent que pour l'utilisateur courant (pas de boucle de RLS).
Les fonctions internes (`private.notify`, `private.audit`, …) ne sont exécutables par personne côté client.

## RPC exposées

`create_group`, `set_member_role`, `create_invitation`, `revoke_invitation`, `get_invitation`,
`accept_invitation`, `create_dog`, `add_dog_caretaker`, `confirm_assignment`, `cancel_assignment`,
`answer_reconfirmation`, `delete_my_account`, `register_push_subscription`.
Réservées au serveur (`service_role`) : `claim_push_batch` (réservation atomique des notifications à
envoyer, `FOR UPDATE SKIP LOCKED`, abandon au-delà de 30 min) et `complete_push_batch`. Toutes exigent un utilisateur connecté et vérifient ses
droits ; les erreurs métier sont levées en français avec le code `P0001`.

## Triggers métier

- Nouvelle demande → notification des membres éligibles (sauf « information »).
- Nouveau « Oui » → notification des responsables du chien.
- Demande annulée → gardes annulées, gardiens et volontaires prévenus.
- Horaires/type modifiés → gardes impactées en reconfirmation (ou annulées si hors période), réponses
  remises à zéro, notifications.
- Départ d'un membre (il quitte, est retiré, ou supprime son compte) : ses gardes **futures** sont annulées,
  ses réponses aux demandes à venir retirées et les responsables du chien notifiés ; l'historique passé est conservé.
- Supprimer un groupe supprime ses demandes (un chien ne peut toujours pas être retiré d'un groupe où il a des demandes).
- Garde-fous : un groupe garde toujours un admin (promotion automatique si le dernier supprime son compte),
  un groupe vide est supprimé, un chien garde un responsable (archivé si le dernier supprime son compte).

## Suppression de compte

`delete_my_account()` : supprime l'utilisateur ; profil, disponibilités, réponses, notifications supprimés
en cascade ; demandes conservées sans auteur ; chiens sans responsable archivés.

## Tests

`npm run test:db` exécute toutes les migrations sur un PostgreSQL embarqué (PGlite) qui émule les rôles,
`auth.uid()` et le stockage de Supabase, puis vérifie 73 scénarios d'autorisation et de règles métier.
