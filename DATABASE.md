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
| `push_subscriptions` | appareils abonnés aux notifications push | un appareil (endpoint) appartient au compte connecté dessus ; supprimé après 404/410 ou 5 échecs |
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
- Garde-fous : un groupe garde toujours un admin (promotion automatique si le dernier supprime son compte),
  un groupe vide est supprimé, un chien garde un responsable (archivé si le dernier supprime son compte).

## Suppression de compte

`delete_my_account()` : supprime l'utilisateur ; profil, disponibilités, réponses, notifications supprimés
en cascade ; demandes conservées sans auteur ; chiens sans responsable archivés.

## Tests

`npm run test:db` exécute toutes les migrations sur un PostgreSQL embarqué (PGlite) qui émule les rôles,
`auth.uid()` et le stockage de Supabase, puis vérifie 45 scénarios d'autorisation et de règles métier.
