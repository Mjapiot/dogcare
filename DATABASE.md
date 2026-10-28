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
| `20261029090000_dog_circle.sql` | cercle de confiance : `dog_circle` (rôle proche/entourage/invité, accès santé/urgences, dates), `dog_circle_invitations` (empreinte du jeton, usage unique, 7 j), `private.can_view_dog` étendue aux proches et invités actifs, `private.can_view_dog_section` (politiques de `dog_health` / `dog_emergency`), RPC `dog_section_access`, `dog_circle_list`, `my_circle_dogs`, `set_circle_member`, `remove_circle_member`, `create_circle_invitation`, `revoke_circle_invitation`, `get_circle_invitation`, `accept_circle_invitation` ; le propriétaire ne peut être retiré que par lui-même |
| `20261030090000_request_invitees.sql` | personnes du cercle sollicitées sur une demande : `care_request_invitees`, `private.circle_covers` (proche, ou invité dont les dates couvrent la période), `care_requests` lisibles par leurs invités, réponses et gardes lisibles par leur auteur, `can_respond` et `confirm_assignment` ouverts aux invités (dans leurs dates), `notify` sans groupe pour une personne hors du groupe, `announce_request` étendue aux invités ; annulation des gardes (avec notifications) quand une personne quitte le cercle ou que ses dates changent ; RPC `set_request_invitees`, `request_invitee_candidates`, `request_invitees_of`, `my_invited_requests`, `leave_dog_circle` ; `report_content` ouvert à l'invité pour sa demande |
| `20261028090000_dog_passport.sql` | passeport : colonnes d'identité et d'habitudes sur `dogs`, `dog_health`, `dog_emergency` (lecture : responsables et gardien d'une garde vivante, `private.can_view_dog_private`), liens de partage `dog_share_links` (empreinte du jeton), RPC `save_dog_health`, `save_dog_emergency`, `create_dog_share_link`, `revoke_dog_share_link`, `shared_passport` (anon), photo lisible par `anon` tant qu'un lien est actif |
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
| `dog_health` | santé du chien (allergies, traitements, vétérinaire, notes) | lecture : `private.can_view_dog_private` (responsables, gardien d'une garde non annulée de J-7 à sa fin) ; écriture via `save_dog_health` (responsables) |
| `dog_emergency` | contacts d'urgence (`jsonb`, 5 max, format contrôlé en base) et consignes | mêmes règles ; écriture via `save_dog_emergency` |
| `dog_circle` | réglages du cercle par personne | lecture : la personne et les responsables ; écriture via `set_circle_member` / `remove_circle_member` / `accept_circle_invitation` ; un invité n'a accès qu'entre `starts_at` et `ends_at` ; « entourage » sans effet hors des groupes |
| `care_request_invitees` | personnes du cercle (proches, invités) sollicitées sur une demande, hors de son groupe | lecture : la personne et les membres du groupe de la demande ; écriture via `set_request_invitees` (responsable du chien ; personne du cercle couvrant toute la période, ni responsable ni membre du groupe ; 20 max ; retrait refusé tant qu'une garde est confiée). L'invité lit la demande, **sa** réponse et **ses** gardes ; `my_invited_requests` lui donne les créneaux confirmés sans noms. Retrait du cercle, départ (`leave_dog_circle`) ou dates raccourcies : gardes hors dates annulées et notifiées (`private.prune_request_invitee`) ; demande déplacée hors de ses dates : il n'est plus sollicité |
| `dog_circle_invitations` | invitations directes au cercle | **seule l'empreinte** est stockée ; usage unique, 7 jours ; lecture par les responsables |
| `dog_share_links` | liens temporaires de partage du passeport | **seule l'empreinte SHA-256 du jeton** est stockée ; lecture par les responsables ; création/révocation via RPC ; 1 h à 30 j, 10 liens actifs max ; `shared_passport(jeton)` (anon) ne renvoie que les rubriques choisies |
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
