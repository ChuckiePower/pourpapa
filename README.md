# Visites 🤍

Le planning des visites à papa, à l'hôpital. Sans compte et sans mot de passe : on donne son prénom, on choisit quand on vient, et tout le monde voit qui vient et quand. **Deux personnes au maximum par jour**, de 14h à 20h (réglages modifiables dans l'admin, ainsi que le nombre de personnes en même temps). Un onglet **Photos** garde les moments des visites, jour après jour.

| Planning | Réserver | Photos | Défilement |
|---|---|---|---|
| ![](docs/ecrans/1-planning.png) | ![](docs/ecrans/3-reserver.png) | ![](docs/ecrans/8-photos.png) | ![](docs/ecrans/9-photos-defilement.png) |

**Choix techniques en deux lignes**
- **Vite + React + TypeScript + Tailwind.** L'app tourne entièrement dans le navigateur : elle est légère, installable sur le téléphone et lisible hors ligne, sans serveur à maintenir.
- **Supabase** (Postgres gratuit, avec temps réel). La règle des deux personnes est vérifiée par la base elle-même, dans une transaction verrouillée : impossible de la contourner depuis un téléphone.

## Mettre en ligne (environ 10 minutes)

Il faut un compte Vercel ; on peut se connecter avec GitHub.

1. Sur **vercel.com**, cliquer sur **Add New… → Project**, puis **Import** sur le dépôt `pourpapa`.
2. Remplacer le nom du projet par `visites-papa`, qui donnera le lien `visites-papa.vercel.app`. Ne rien changer d'autre, puis cliquer sur **Deploy**. Pour l'instant, la page affiche « Presque prêt » : c'est normal.
3. Dans le projet Vercel, ouvrir l'onglet **Storage → Create Database → Supabase**. Choisir l'offre gratuite et une région en Europe (Paris si elle est proposée), puis connecter la base au projet `visites-papa`. Vercel ajoute alors lui-même les variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Cliquer sur **Open in Supabase**, puis aller dans **SQL Editor → New query**. Coller tout le contenu de [`supabase/schema.sql`](supabase/schema.sql) et cliquer sur **Run**.
5. Ouvrir une nouvelle requête pour choisir le code admin (6 chiffres ou plus) :
   ```sql
   select private.set_admin_pin('ton-code');
   ```
6. Revenir dans Vercel, ouvrir **Deployments**, cliquer sur **⋯** à côté du dernier déploiement, puis sur **Redeploy**.
7. Ouvrir `https://visites-papa.vercel.app` et partager ce lien sur WhatsApp.

**Sans passer par l'onglet Storage de Vercel.** Créer un projet gratuit sur supabase.com. Dans les réglages de l'API, copier l'adresse du projet (Project URL) et la clé publique (`anon` ou `publishable`). Dans Vercel, les ajouter sous **Settings → Environment Variables** avec les noms `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Faire ensuite les étapes 4 à 6.

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `VITE_SUPABASE_URL` (ou `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`) | Adresse du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` (ou `…_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`…) | Clé **publique** de Supabase |
| `VITE_REALTIME` | Facultatif : mettre `off` pour couper le temps réel. Le planning se rafraîchit alors toutes les minutes. |

Ne jamais mettre la clé `service_role` ni une clé `sb_secret_…` : le build les refuse.

### Déployer une mise à jour

Chaque `git push` sur `main` redéploie automatiquement. On peut aussi déployer à la main avec `npx vercel --prod`.

Si `supabase/schema.sql` a changé, il faut le recoller dans l'éditeur SQL. Le script peut être relancé sans risque : il ne touche pas aux données. Il crée aussi le bucket de stockage `photos`.

## Utilisation

- **Planning** : on touche un espace libre pour réserver. Une place libre à côté de quelqu'un affiche « Rejoindre ».
- **Aujourd'hui** : qui est là en ce moment, qui vient ensuite, ce qui reste libre. C'est la page à ouvrir devant l'hôpital.
- **Mes visites** : modifier ou annuler ses visites. Le **lien de modification** permet de les retrouver sur un autre téléphone.
- **Photos** : on ajoute une photo pendant la visite (appareil photo ou galerie, avec une légende). Elles s'affichent jour après jour (« Jour 1 », « Jour 2 »…), et « Tout faire défiler depuis le jour 1 » les montre en plein écran, une par une ou en lecture automatique. Chacun peut supprimer ses propres photos, l'admin toutes.
- **Mots** : les petits mots laissés à la réservation, affichés en grand pour les montrer à papa.
- **Admin** : l'adresse `/admin`, protégée par le code PIN. On y trouve l'annonce, les blocages de période (avec la liste des personnes à prévenir), toutes les visites, les consignes, les réglages et les petits mots.

## Comment la règle des 2 personnes est garantie

- Les téléphones peuvent **lire** le planning, mais n'écrivent jamais directement dans les tables : la sécurité par ligne (RLS) l'interdit. Réserver, modifier et annuler passent par des fonctions Postgres.
- Chaque fonction prend un **verrou par jour** (`pg_advisory_xact_lock`), puis vérifie deux choses : le total de la journée (2 personnes par défaut) et le nombre de personnes présentes **tranche de 30 min par tranche**. Si c'est refusé, elle propose d'autres moments ou d'autres jours encore libres.
- En plus, un **trigger** revérifie la capacité à chaque écriture, même pour une requête SQL tapée à la main.
- Les horaires sont stockés en **date locale + minutes depuis minuit**, à l'heure de Paris. Le passage à l'heure d'hiver ne décale donc rien.

## Confidentialité

- Le lien n'est pas référencé (`noindex`, `robots.txt`). Il n'y a aucun traqueur, et les polices sont hébergées avec l'app.
- On n'enregistre que des prénoms, des horaires et les petits mots : aucune donnée médicale.
- Chaque téléphone garde une clé secrète ; la base n'en connaît que l'empreinte (sha256).
- Les visites passées depuis plus de 30 jours sont supprimées automatiquement.
- Les photos sont réduites sur le téléphone (1600 px) et réenregistrées, ce qui retire leurs métadonnées (position GPS comprise). Elles sont rangées sous des noms impossibles à deviner, mais toute personne qui a le lien de l'app peut les voir, comme le planning. Elles sont gardées jusqu'à ce que leur auteur ou l'admin les supprime. La suppression efface aussi le fichier, grâce à la fonction `api/photo-cleanup.ts` et à la clé secrète `SUPABASE_SERVICE_ROLE_KEY` que l'intégration Vercel–Supabase ajoute d'elle-même (côté serveur seulement).
- Les petits mots restent jusqu'à ce que leur auteur ou l'admin les supprime, même si la visite est annulée.

## Tests

Il faut un Postgres local, par défaut `postgres://dev:dev@127.0.0.1:5432/postgres`. Une autre adresse se donne avec `TEST_PG_ADMIN_URL`.

```bash
npm test          # 59 tests : 2 personnes par jour, règle « en même temps » (exemples A/B/C/D, bord à bord),
                  # réservations simultanées, trigger, photos, droits d'accès, admin, purge, logique client, agenda
npm run screens   # 12 parcours Playwright en rendu mobile + contrôle d'accessibilité axe + cibles ≥ 48 px
```

## Développement local

```bash
npm ci
node scripts/seed-dev.mjs                 # base « visites_dev » avec des exemples (code admin : 123456)
node scripts/dev-api.mjs                  # imite l'API Supabase sur http://127.0.0.1:54321
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=dev VITE_REALTIME=off npm run dev
```

## Organisation du code

```
supabase/schema.sql      tables, règle de capacité, fonctions serveur, droits, purge
src/lib/                 capacité côté client (affichage), dates à l'heure de Paris, cache hors ligne, temps réel
src/components/          timeline, bande de jours, feuille de réservation, interface
src/screens/             Planning, Aujourd'hui, Mes visites, Photos, Mots, Admin
api/ics.ts               fichier agenda (.ics), aussi servi comme fonction Vercel
api/photo-cleanup.ts     efface le fichier d'une photo supprimée (fonction Vercel)
tests/ et e2e/           tests automatisés
```
