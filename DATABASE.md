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
| `20261031090000_care_log.sql` | carnet de garde : `care_log_entries`, seau privé `care-logs` (`<assignment_id>/<fichier>`), `private.care_log_open` (gardien d'une garde confirmée, de 2 h avant à 24 h après), `private.can_read_care_log`, RPC `add_care_log`, `update_care_log`, `delete_care_log`, purge `care_log_photos_to_purge` / `forget_care_log_photos` (clé secrète ; 90 jours après la garde et fichiers orphelins), type de notification `care_log` et préférence `care_log_enabled`, signalement d'une entrée (`report_content`, cible `care_log`) |
| `20261101090000_circle_notifications_reminders.sql` | types de notification `circle_update` et `care_reminder`, préférence `circle_enabled` (`reminders_enabled` utilisée), déclencheur `dog_circle_notify` (arrivée, départ, ajout, changement d'accès, retrait), `reminder_log` (anti-doublon), `run_daily_reminders(p_now)` (clé secrète : gardes du lendemain en jours de Paris, besoins indispensables pas couverts, fin d'accès des invités) |
| `20261102090000_french_elision.sql` | élision dans les messages écrits par la base (« Votre garde d'Aston est annulée », « la fiche d'Aston »…) : `care_requests_after_update`, `cancel_assignment`, `prune_request_invitee`, `add_care_log`, `report_content` passent par `private.de_name` |
| `20261103090000_planning.sql` | moteur de planning : réglages par chien `plan_max_nights` (1–14, défaut 3) et `plan_min_slice_hours` (1–12, défaut 3), RPC `confirm_plan(demande, tranches)` qui appelle `confirm_assignment` pour chaque tranche (mêmes contrôles et notifications) dans une seule transaction : tout ou rien, 50 tranches max |
| `20261104090000_review_fixes_2.sql` | revue du 2026-10-29 : un blocage ne coupe plus que les notifications qui sollicitent (`notify`), confirmation refusée entre membres bloqués et réponse verrouillée (`confirm_assignment` … `for update`), suppression de groupe uniquement par `delete_group` (gardes à venir annulées et notifiées), `claim_push_batch` renvoie `group_id` (lien `/circle/requests/…` pour une personne hors du groupe), photo d'un chien obligatoirement dans son dossier (`dogs_photo_in_own_folder`, `dog_photo_shared`), `special_needs` n'est plus modifiable |
| `20261110090000_review_fixes_3.sql` | revue du 2026-11-03 : routines « médicament » lisibles seulement avec le droit Santé (`can_view_dog_section`) ; occurrence cochée à la minute pile, double cochage simultané → « Déjà coché » ; `answer_proposal` verrouille la demande ; `send_proposals` refuse une personne en double et stocke des créneaux nettoyés ; refus annoncé aux responsables sans « chez vous » ; `confirm_plan` garde un lieu connu ; limite de 12 routines sous verrou ; rappel de la veille limité aux routines après le début de la garde ; index sur `routine_id`, `sent_by`, `created_by` ; Realtime sur `care_proposals`, `care_log_entries`, `dog_routines` |
| `20261109090000_routines.sql` | routines : `dogs.routines_enabled` (faux par défaut, modifiable par les responsables), table `dog_routines`, RPC `set_dog_routine` / `delete_dog_routine` ; `care_log_entries.routine_id` / `routine_at` (une occurrence cochée une fois, index unique) ; `add_care_log` accepte la routine cochée (même chien, routines activées, heure et jour de la routine, pendant la garde, au plus 3 h à l'avance) ; le rappel de la veille au gardien cite les routines du lendemain (`private.routines_text`) |
| `20261108090000_plan_absence_atomic.sql` | `plan_absence` (appelant, RLS) : la demande de « Planifier une absence » et ses propositions dans une seule transaction — l'avis « Nouvelle demande » d'une personne qui reçoit une proposition est remplacé avant tout envoi de push ; tout ou rien |
| `20261107090000_polish.sql` | suppression du compte du dernier responsable d'un chien : besoins à venir annulés (gardes annulées, gardiens prévenus par le déclencheur des demandes) ; carnet de garde : 30 fichiers max par garde (`private.care_log_photo_count`), fichier encore cité par une entrée non supprimable (`private.care_log_photo_in_use`) |
| `20261106090000_care_proposals.sql` | propositions ciblées (planning de vacances) : table `care_proposals`, type de notification `care_proposal` (préférence « nouvelles demandes », bloquée entre personnes bloquées), RPC `send_proposals`, `answer_proposal`, `withdraw_proposal` ; `care_assignments.place` rempli par `confirm_plan` (tranche `place`) ; l'invité sollicité par une proposition ne reçoit pas en plus « Nouvelle demande » ; dates changées ou demande annulée : propositions ouvertes retirées |
| `20261105090000_pro_role_helper_prefs.sql` | rôle de cercle `pro` (professionnel, sans dates, santé/urgences « pendant ses gardes » par défaut ; pris en compte par `has_direct_circle_access`, `circle_covers`, `my_circle_dogs`, `request_invitee_candidates`, invitations), « pendant ses gardes » possible dans les invitations, table `dog_helper_prefs` et RPC `set_helper_pref` |
| `20261028090000_dog_passport.sql` | passeport : colonnes d'identité et d'habitudes sur `dogs`, `dog_health`, `dog_emergency` (lecture : responsables et gardien d'une garde vivante, `private.can_view_dog_private`), liens de partage `dog_share_links` (empreinte du jeton), RPC `save_dog_health`, `save_dog_emergency`, `create_dog_share_link`, `revoke_dog_share_link`, `shared_passport` (anon), photo lisible par `anon` tant qu'un lien est actif |
| `20261022090000_calendar_feed.sql` | abonnement calendrier (`calendar_feeds`), RPC `get_calendar_feed_token`, `reset_calendar_feed_token`, `calendar_feed_events` |
| `20261021120000_group_join_codes.sql` | code de groupe permanent (`group_join_codes`), essais limités (`join_code_attempts`, 10 échecs / 15 min), RPC `get_group_join_code`, `reset_group_join_code`, `join_group_with_code` |
| `20261021110000_review_fixes_delivery.sql` | relances push (5 essais en 30 min), purge (notifications > 6 mois, audit > 1 an), index de lecture et de clés étrangères |
| `20261021100000_review_fixes_rules.sql` | préférences limitées au push, annulation d'un créneau parmi plusieurs, intégrité des réponses, information devenue besoin annoncée, passage en non partageable contrôlé, confirmation impossible sur une demande terminée |
| `20261021090000_review_fixes_departures.sql` | suppression de groupe avec demandes, retrait des engagements d'un membre qui part ou supprime son compte, écritures directes interdites sur `push_subscriptions` |

## Tables

| Table | Rôle | Points clés |
| --- | --- | --- |
| `profiles` | prénom affiché, fuseau, `max_dogs_at_once` (chiens gardés à la fois : 1 à 5, 2 par défaut, `null` = sans limite ; modifiable par soi, lu par les membres des mêmes groupes) | créée par trigger à l'inscription ; l'e-mail reste dans `auth.users` |
| `groups` | groupe privé | |
| `group_members` | appartenance | PK `(group_id, user_id)`, `role` admin/member, `share_availability` |
| `group_invitations` | liens d'invitation | **seule l'empreinte SHA-256 du jeton** est stockée ; expiration, `max_uses`, révocation |
| `dogs` | fiche chien | `archived_at` (archivage sans perte d'historique) ; `alone_only` (« Doit être gardé seul », modifiable par les responsables) |
| `dog_caretakers` | responsables d'un chien | owner / caretaker ; au moins un responsable garanti |
| `group_dogs` | chiens visibles dans un groupe | |
| `availability_rules` | habitudes hebdomadaires | unique `(user, weekday, slot)` |
| `availability_entries` | saisies ponctuelles (priment sur les habitudes) | unique `(user, date, slot)` ; date locale Europe/Paris |
| `care_requests` | besoin de garde | FK composite `(group_id, dog_id) → group_dogs` (le chien doit être dans le groupe) ; `ends_at > starts_at` ; ≤ 31 jours ; `revision` ; `absence_id` (demandes d'une même absence de plusieurs chiens : fixé à la création, jamais modifiable par un client ; trigger `care_requests_absence` : même auteur, même groupe, mêmes dates, chiens différents, 5 max ; remis à `null` si les dates changent) |
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
| `dog_routines` | routines d'un chien : type, nom, heures (Paris), jours ISO (null = tous), consigne ; 12 au plus | lecture : quiconque voit le chien (`can_view_dog`), et pour un médicament seulement avec le droit Santé (`can_view_dog_section`) ; écriture uniquement via `set_dog_routine` / `delete_dog_routine` (responsables) |
| `care_log_entries` | carnet de garde (repas, promenade, médicament, déposé, récupéré, photo, note) | lecture : l'auteur et les responsables du chien ; écriture uniquement via `add_care_log` / `update_care_log` / `delete_care_log` par le gardien de la garde, garde confirmée, de 2 h avant à 24 h après ; 200 entrées max par garde ; photo : fichier existant du dossier de la garde, jamais réutilisé, 30 fichiers max par garde, non supprimable tant qu'une entrée le cite ; `photo_removed_at` après la purge |
| `reminder_log` | rappels déjà envoyés `(kind, ref_id, user_id, for_date)` | aucun accès client ; écrit par `run_daily_reminders`, purgé après 30 jours |
| `dog_helper_prefs` | préférences de garde par chien et par personne : lieu (`helper` / `owner`), nuits d'affilée max (`null` = règle du chien, 0 = jamais la nuit), note | lecture : responsables du chien ; écriture via `set_helper_pref` (responsable ; personne d'un groupe ou du cercle du chien, pas un responsable) |
| `care_proposals` | part d'une absence proposée à une personne : créneaux (`slices` jsonb triés, disjoints, dans la demande ; 20 max), lieu, statut `pending` / `accepted` / `declined` / `withdrawn` ; une par personne et par demande | lecture : la personne et les responsables du chien ; écriture uniquement via `send_proposals` (responsable membre du groupe ; demande active et future ; ni responsable, ni personne bloquée, ni quelqu'un qui a déjà dit « Oui » ; hors groupe : cercle couvrant les créneaux, ajouté aux sollicités ; 20 personnes max ; remplace l'avis « Nouvelle demande » non lu), `answer_proposal` (la personne ; accepter = réponse « Oui » sur la plage, jamais une garde ; refuser = statut seul, responsables prévenus) et `withdraw_proposal` (responsable, proposition sans réponse) |
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

- `plan_absence_multi(group, dogs[], début, fin, description, propositions)` (*invoker*) : une demande par chien
  (liées par `absence_id` dès 2 chiens), puis `send_proposals` par chien, dans une seule transaction.
- `answer_proposal` : répond aussi aux autres propositions en attente de la même personne dans la même absence ;
  un refus donne un seul avis par responsable, nommant les chiens.

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

- `notifications_merge_absence` (après insertion d'un avis `new_request`, `care_proposal` du responsable ou
  `new_volunteer`) : les avis non lus et pas encore poussés d'une même absence, pour une même personne et un même
  auteur, deviennent un seul avis (« Pouvez-vous garder Aston et Nala ? »).

## Suppression de compte

`delete_my_account()` : supprime l'utilisateur ; profil, disponibilités, réponses, notifications supprimés
en cascade ; demandes conservées sans auteur ; chiens sans responsable archivés.

## Tests

`npm run test:db` exécute toutes les migrations sur un PostgreSQL embarqué (PGlite) qui émule les rôles,
`auth.uid()` et le stockage de Supabase, puis vérifie 73 scénarios d'autorisation et de règles métier.
