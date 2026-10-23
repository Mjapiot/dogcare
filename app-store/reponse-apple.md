# Réponse à Apple — Guideline 2.1 (Information Needed)

## A. Vidéo à filmer sur ton iPhone (enregistrement d'écran iOS)

Réglages → Centre de contrôle → ajouter « Enregistrement de l'écran ». Lancer l'enregistrement, puis :

1. **App fermée** → toucher l'icône Dogcare (la vidéo doit commencer au lancement).
2. **Inscription / connexion** : saisir une adresse e-mail → « Recevoir un lien de connexion » → ouvrir Mail →
   toucher le lien → l'app s'ouvre connectée.
   - Montrer aussi l'écran de connexion « Compte de démonstration » (sans saisir le mot de passe à l'écran,
     ou en le saisissant : il est de toute façon donné à Apple).
3. **Onboarding** (avec un nouveau compte) : prénom → groupe (créer) → chien → habitudes.
4. **Usage normal** :
   - « Aujourd'hui » et le calendrier,
   - « Mes dispos » : sélectionner une colonne → « Dispo »,
   - « + » → publier une demande de garde,
   - ouvrir une demande d'un autre membre → « Oui, je peux »,
   - en propriétaire : « Confirmer » un volontaire → statut « Couvert ».
5. **Signalement** : ouvrir une demande d'un autre membre → « Signaler cette demande » → motif → envoyer.
6. **Blocage** : Profil → le groupe → un membre → « Bloquer » → confirmer (puis « Débloquer »).
7. **Suppression du compte** : Profil → « Supprimer mon compte » → confirmer → retour à l'écran de connexion
   (à faire avec un compte de test, pas ton compte principal ni le compte démo).

Astuce : utiliser deux comptes (le tien + un compte de test, ou le compte démo sur un second appareil) pour
avoir une demande d'un « autre membre ». Durée idéale : 2 à 4 minutes.

## B. Texte de réponse (à coller dans « Répondre à l'équipe de vérification des apps »)

```
Hello,

Thank you for your review. Please find below the requested information. A screen recording made on a physical iPhone running the latest iOS is attached.

1. Screen recording
The attached video starts with launching the app and shows: sign-up/sign-in with an e-mail link, onboarding (name, group, dog, weekly availability habits), the typical flow (declaring availability, posting a dog-sitting request, answering "Oui, je peux", confirming a volunteer), reporting a request, blocking and unblocking a member, and account deletion (Profil → "Supprimer mon compte").

2. Purpose and target audience
Dogcare is a free app for small private groups of friends who look after each other's dogs. It replaces scattered messages: members share when they could help (morning, afternoon, evening, night), owners post dog-sitting, visit or walk requests, members answer, and the owner confirms who takes care of the dog. The calendar shows at a glance which days are covered and which have no solution yet. Target audience: adult dog owners and their friends, in French.

3. Accessing the app
Accounts sign in with a one-time link sent by e-mail. For the review, use the demo account: on the login screen tap "Compte de démonstration" (below the e-mail form) and enter the credentials provided in App Review Information. The demo account belongs to a sample group "Démo Dogcare" (dogs Pistache and Moka, a request from another member to answer, a request awaiting confirmation, a partially covered weekend). No other setup or file is needed.

User-generated content: groups are private and only joined with an invitation link or a group code from an admin. Every member can report a request, a dog profile or a member ("Signaler"); reports are stored for our team and the group's admins are notified. Every member can block another member ("Bloquer" in the group page): neither sees the other's requests and no notification is exchanged. Admins can remove members. Support: dogcare@gmail.com.

4. External services
- Supabase (authentication by e-mail link, PostgreSQL database, file storage for dog photos)
- Vercel (web hosting of the app's server)
- Apple Push Notification service (notifications on iPhone)
No analytics, advertising, payment or AI service is used.

5. Regional differences
The app works the same way in every country and region. Its interface is in French.

6. Regulated industry / third-party material
Not applicable: the app does not operate in a regulated industry and contains no protected third-party material.

Best regards,
Maxence Japiot
```

## C. Remarques (champ « Remarques » de « Informations utiles à la vérification »)

Apple demande d'y recopier les mêmes informations : coller le texte B (sans la vidéo) à la place des
remarques actuelles.
