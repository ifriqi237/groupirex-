# GROUPDEALS

Plateforme panafricaine d'achats groupés de GROUPIREX.
« Achetons ensemble, Obtenons des prix bas »

Ce dépôt contient l'API, la base PostgreSQL, le site client (mobile d'abord), le back-office et l'espace des bureaux locaux. L'application mobile Flutter n'est pas incluse : elle se branchera sur la même API.

## Démarrer

Prérequis : Node.js 22 ou plus, PostgreSQL 14 ou plus.

```bash
npm install                       # crée aussi package-lock.json (absent de la livraison, voir « Limites »)
cp apps/api/.env.example apps/api/.env   # ajustez DATABASE_URL
createdb groupdeals
npm run build                     # site (apps/web/dist) puis API (apps/api/dist)
npm run seed:demo                 # migrations + jeu de démonstration
npm start                         # http://localhost:4000
```

En développement : `npm run dev` relance l'API à chaque modification, `npm run dev -w @groupdeals/web` reconstruit le site.

Avec Docker : `docker compose up --build`, puis `docker compose exec app node dist/cli.js seed-demo`.

### Comptes de démonstration

Mot de passe de tous les comptes : `Groupdeals2026!`

| Rôle | Email |
|---|---|
| Super administrateur | superadmin@groupdeals.test |
| Administrateur | admin@groupdeals.test |
| Responsable logistique | logistique@groupdeals.test |
| Responsable financier | finance@groupdeals.test |
| Modérateur | moderation@groupdeals.test |
| Responsable du bureau de Douala | bureau.douala@groupdeals.test |
| Agents de bureau | agent.douala@groupdeals.test, agent.dakar@groupdeals.test |
| Clients (Cameroun, Sénégal, Côte d'Ivoire) | paul@, jean@, esther@, awa@, mariama@, aminata@groupdeals.test |
| Clients anglophones (Kenya, Nigeria) | grace@, chinedu@groupdeals.test |

Le back-office est à `/admin`, l'espace bureau à `/agent`. Les taux de change du jeu de démonstration sont fictifs.

Premier administrateur d'une base vide : `npx tsx apps/api/src/cli.ts create-admin <email> <mot de passe>` (ou `node apps/api/dist/cli.js create-admin …`).

## Organisation du code

```
packages/core     Règles métier pures, sans base ni réseau : prix, monnaie, campagnes,
                  commandes, paiements, logistique, droits, Matching, médias. 82 tests.
apps/api          API REST /api/v1 (131 routes), PostgreSQL, tâches de fond, PDF, QR Codes.
  db/migrations   Schéma (42 tables) et données de référence (54 pays, 44 devises, 57 langues).
                  Une modification des données de référence passe par une nouvelle migration numérotée
                  (0003 renomme la catégorie « Gadgets » en « Gadgets publicitaires », 0004 ajoute six catégories,
                  0005 à 0016 donnent leur photo aux douze catégories livrées, 0017 ajoute les langues officielles d'Afrique, 0018 ouvre les 24 pays
                  d'Afrique qui manquaient avec leur monnaie ; les photos sont
                  dans apps/web/public/categories/, préparées par apps/web/scripts/category-image.py).
  db/i18n         Textes d'interface livrés : fr.json (référence), en.json.
  src/modules     Routes par domaine.   src/services  Commandes, paiements, prix, notifications.
  test            119 tests d'intégration contre un vrai PostgreSQL.
apps/web          Site client, back-office et espace bureau (React, une seule application).
  e2e/journey.mjs Parcours complet dans un navigateur (89 vérifications).
  public/photos   Photos des produits de démonstration (papier A4, sandales en cuir tressé, panneau solaire 550 W, chemise en wax, écouteurs Bluetooth, ensemble enfant, kit solaire, sac à main), préparées par
                  scripts/product-image.py et désignées par le champ `photo` du produit dans apps/api/src/seed-demo.ts.
                  En exploitation, les photos de produit se téléversent depuis le back-office.
                  Une photo sur fond blanc est montrée entière dans chaque cadre (liste, bannière, fiche) :
                  un produit haut n'est pas rogné. Les autres images remplissent le cadre (composant ProductImage).
```

### Écran d'accueil

Un visiteur qui arrive sur `/` voit l'écran d'inscription de la maquette : logo, slogan, cinq champs (nom, pays, email, WhatsApp avec indicatif, mot de passe) et le bouton « Validez ». La connexion et le mot de passe oublié reprennent le même habillage. Un membre connecté arrive directement sur les offres. Le lien « Voir les offres sans créer de compte » garde le catalogue ouvert aux visiteurs, comme le demande le cahier des charges.

- Code : `apps/web/src/pages/welcome.tsx`, styles à la fin de `apps/web/src/styles.css` (bloc « Écran d'accueil »).
- Le champ « Nom » est unique : le premier mot devient le prénom, le reste le nom de famille (qui peut être vide).
- Le décor (carte, avion, navire, camion, logo) est dessiné en vectoriel dans `apps/web/public/welcome/`, produit par `node apps/web/scripts/welcome-art.mjs`. Pour utiliser vos visuels définitifs, remplacez les fichiers en gardant leurs noms.
- La réduction annoncée dans le slogan est la constante `MAX_DISCOUNT` de `welcome.tsx`.

### Partenaires locaux

Le menu propose « Partenaires locaux » (en-tête, barre d'onglets du téléphone, pied de page). La page `/partners` fait choisir un pays dans un menu déroulant ; un clic sur « Voir les partenaires » ouvre `/partners/<pays>`, qui liste les partenaires du pays regroupés par ville : adresse, horaires, téléphone, WhatsApp, carte, et ce qu'on peut y faire (paiement sur place, retrait des colis).

Les partenaires affichés sont les bureaux locaux actifs, gérés dans le back-office, rubrique « Bureaux locaux » : en ajouter, modifier ou désactiver un met la page à jour. L'annuaire est public (`GET /local-partners/countries`, `GET /local-partners/<pays>`) et consultable pour n'importe quel pays desservi, sans compte.

Le menu déroulant propose les 54 pays d'Afrique (États membres de l'ONU), chacun avec son drapeau. La liste est dans `packages/core/src/africa.ts` ; elle est distincte des pays desservis : un pays que GROUPDEALS ne dessert pas encore s'affiche sans partenaire, avec un message qui le dit. Depuis la migration 0018, les 54 pays sont ouverts : chacun figure dans la liste des pays de l'inscription et du site, avec sa monnaie et son indicatif téléphonique (Zimbabwe : dollar américain). Les offres d'un pays n'apparaissent qu'une fois saisis, dans le back-office, le taux de change de sa monnaie et les frais de livraison des produits vers ce pays ; d'ici là, le client du pays voit le site sans offre ouverte chez lui.

- Code : `apps/web/src/pages/partners.tsx`, menu déroulant dans `apps/web/src/components/country-picker.tsx`, routes dans `apps/api/src/modules/offices.ts`.
- Drapeaux : `apps/web/public/flags/<code>.png`, extraits de la police Noto Color Emoji (licence SIL OFL 1.1) par `apps/web/scripts/flags-from-noto.py`. Ce sont des images, et non des émojis, pour s'afficher aussi sous Windows.

### Démonstration sans serveur

`apps/web/demo-dist/` contient le site complet sous forme de simples fichiers : il s'ouvre sans API ni base de données, et peut être déposé sur n'importe quel hébergement de fichiers statiques. Les réponses de l'API y sont rejouées à partir d'enregistrements de la vraie API (`apps/web/demo/fixtures`), et le parcours d'un client (inscription, commande, paiement simulé, réservation au bureau) est simulé dans le navigateur par `apps/web/src/demo/backend.ts`. Les écrans du personnel sont consultables ; leurs actions répondent « non enregistrée ». Rien n'est envoyé ni payé.

Les documents du client (facture proforma, facture, reçu) s'y téléchargent aussi : le PDF est produit dans le navigateur par `apps/web/src/demo/documents.ts`, avec le même rendu que l'API (`apps/api/src/services/pdf.ts`). Quand la démonstration est publiée dans une page qui ne peut pas télécharger seule, le fichier est remis à l'hôte de la page, qui demande confirmation avant de l'enregistrer (`apps/web/src/lib/files.ts`). Si la page n'a pas reçu ce droit, le téléchargement est tenté et un message prévient qu'il a pu ne pas aboutir.

```bash
npm run demo:build -w @groupdeals/web      # construit apps/web/demo-dist
npm run demo:record -w @groupdeals/web     # réenregistre les données (API lancée avec le jeu de démonstration)
npm run demo:test -w @groupdeals/web       # 42 vérifications dans un navigateur (servir demo-dist sur le port 4300)
```

La démonstration sert à montrer le produit. Elle ne remplace pas la mise en production : les règles (prix, seuils, paiements) n'y sont garanties que par la vraie API.

### Commande « Précédent »

Chaque page, sauf l'accueil, porte une commande « Précédent » sous l'en-tête (site, écrans de connexion, back-office, espace bureau). Elle ramène à la page d'où l'on vient ; si la page a été ouverte directement, elle remonte d'un niveau (« /orders/42 » vers « /orders »). Code : `goBack` dans `apps/web/src/lib/router.tsx`, bouton `BackButton` dans `apps/web/src/components/ui.tsx`.

### Style visuel

Polices Poppins (titres, prix) et Inter (textes). Encre `#0A1230` pour la bannière, les titres et le pied de page ; marine `#0D1B45` pour les catégories et la bande de confiance ; rose `#FF4F79` réservé aux boutons d'action ; vert `#0A7D36` pour le prix final et `#1BAA55` pour la jauge « conteneur » ; porcelaine `#F3F5F9` pour les fonds de section. La remise s'affiche sur une pastille rose pâle (`.badge--deal`). L'accueil enchaîne bannière, « Comment ça marche » (quatre étapes), catégories, offres, Matching et une bande de confiance (paiement vérifié, prix final livraison comprise, bureaux locaux). Les jetons sont en tête de `apps/web/src/styles.css`.

### Fond de la bannière d'accueil

Derrière la bannière, une scène maritime en transparence sur le bleu marine : une route pointillée entre deux ports, parcourue par un conteneur ; un port avec ses portiques ; deux porte-conteneurs qui avancent lentement sur trois rangs de vagues. Tout est dessiné en SVG dans `apps/web/src/components/sea.tsx` (aucune image à charger) et animé en CSS (`.sea…` dans `styles.css`). Les mouvements s'arrêtent si le visiteur a demandé moins d'animations sur son appareil.

### Carrousel du produit : dix photos et une vidéo

La page d'une offre présente le produit dans un carrousel : on fait défiler les photos et la vidéo en glissant du doigt, avec les flèches (à l'écran ou au clavier) ou par les vignettes ; un compteur indique la vue affichée et un lien mène directement à la vidéo. La vidéo n'est chargée que lorsque le client lance la lecture. Code : `Gallery` dans `apps/web/src/pages/deals.tsx`.

Un produit porte au plus dix photos et une vidéo (`PRODUCT_MEDIA_LIMITS` dans `packages/core/src/media.ts`). Le back-office affiche le décompte dans l'onglet « Photos et vidéos » de la fiche produit et n'envoie pas les fichiers en trop ; l'API refuse toute liste qui dépasse.

Dans la démonstration, les produits photographiés ont une galerie tirée de leur unique photo par `apps/web/scripts/product-gallery.py` : deux ou trois vues de détail et une vidéo de six secondes qui parcourt la photo. Ce sont des contenus de remplacement, à remplacer par de vraies prises de vue et une vraie vidéo.

L'espace des photos est ramené à 75 % de la largeur dont il disposait, le cadre restant carré : sur grand écran la colonne des photos rétrécit au profit de celle du prix (`.split--shots`), sur téléphone le cadre est centré (`.shots`, variable `--shot`). Sur l'accueil, la photo de l'offre vedette occupe de même 75 % de la largeur de sa carte (`.live__media`). Pour changer ces proportions, il suffit de modifier ces règles dans `apps/web/src/styles.css`.

### Proforma et facture à présenter au bureau local

Sur la page « Votre commande » (avant de confirmer), le bouton « Téléchargez votre proforma » remet au client une facture proforma en PDF : ses coordonnées, les produits au prix final, le total à payer, le mode de paiement choisi et la date de clôture de l'offre. Elle est disponible pour toute commande possible, quel que soit le montant. Elle n'est pas enregistrée et ne réserve rien (`POST /group-deals/:id/proforma`) ; sa référence est faite de la date et de six chiffres (`PF-20261005-482913`), hors de la série des factures. Elle explique comment régler au bureau local.

Quand le client confirme en choisissant de payer au bureau local, une facture proforma est émise avec sa réservation. Il la télécharge en PDF depuis la page de sa commande (même bouton « Téléchargez votre proforma ») et la présente au bureau : l'agent lit son QR Code ou saisit le numéro de réservation, puis encaisse. La facture porte le client, les produits au prix final, le total à payer, l'adresse du bureau, le numéro de réservation et la date limite. Après encaissement, le reçu se télécharge au même endroit (rubrique Documents) ; une commande payée en ligne y reçoit sa facture.

Chaque document (proforma, facture, reçu) montre une vignette du produit sur sa ligne et porte un QR Code : celui de la réservation, que lit l'agent du bureau ; sinon un QR Code qui ramène le client à sa commande, ou, pour la proforma de « Votre commande », à cette page avec les mêmes quantités. La vignette est convertie en JPEG à l'émission (`apps/api/src/services/doc-image.ts`) et conservée dans le document ; une image introuvable ne bloque jamais l'émission. Les documents émis avant cette version restent tels quels.

Le paiement au bureau reste réservé aux commandes d'au moins 500 000 FCFA (§22 et §47 du cahier des charges) ; ce seuil se règle dans le back-office.

Sur « Votre commande », dès que le client choisit « Payer au bureau local », un bureau est sélectionné d'office (le premier de la liste, ou de la ville filtrée) : le bouton « Réserver et payer au bureau » est donc actif tout de suite, et le client peut choisir un autre bureau. L'option n'est proposée que si un bureau du pays reçoit les paiements.

Quand le bouton de confirmation est grisé, la raison est écrite juste dessous, avec le geste qui le débloque. Le cas le plus fréquent est l'adresse email non vérifiée : le bouton « Vérifier mon adresse email » renvoie le lien sans quitter la page, et le bouton de confirmation se débloque dès que le client revient après l'avoir ouvert. Hors production, où aucun email ne part, l'API remet le lien et la page l'ouvre aussitôt : un clic suffit. Dans la démonstration autonome, un compte créé est considéré comme vérifié d'emblée, pour que rien ne bloque la commande.

### Écarts avec le §41 du cahier des charges

Le cahier des charges demandait NestJS et Next.js. L'environnement de développement n'avait pas accès au registre npm ; plutôt que livrer du code jamais exécuté, il a été convenu de livrer une version testée :

- **API** : TypeScript sur le serveur HTTP natif de Node, avec la même découpe en modules. Les routes, les schémas de validation (zod) et la base sont ceux qu'aurait une API NestJS ; le portage est mécanique.
- **Site** : React en application monopage, servie par l'API, au lieu de Next.js. Conséquence : pas de rendu côté serveur, donc un référencement naturel plus faible sur les fiches d'offre. À reprendre si le référencement devient un enjeu.
- **Base** : un client PostgreSQL est intégré (protocole étendu, TLS, SCRAM-SHA-256, pool, transactions). `DATABASE_DRIVER=pg` bascule sur le paquet `pg`.

Tout le reste suit le cahier des charges : PostgreSQL, API REST versionnée, JWT avec jeton de rafraîchissement, rôles et permissions, Flutterwave derrière une interface.

## Règles métier et où les trouver

| Règle | Code | Vérifiée par |
|---|---|---|
| Prix affiché = prix du produit + livraison du pays, en un seul montant | `core/price-engine.ts`, `api/services/pricing.ts` | tests core et API, parcours navigateur |
| Le prix suit le pays choisi ; les composants ne sortent jamais de l'API publique | `api/services/pricing.ts` (`offerDto`) | test « aucune ligne de livraison, aucun composant interne dans les réponses client » |
| Minimum de commande (MOQ) | `core/order-engine.ts` | 9 refusé quand le minimum est 10 |
| Paiement au bureau à partir de 500 000 FCFA, contrôlé par le serveur | `core/order-engine.ts`, `api/services/orders.ts` | 499 999 refusé, 500 000 accepté |
| Un paiement n'est confirmé qu'après vérification auprès du prestataire ; un webhook rejoué n'a aucun effet | `core/order-engine.ts` (`decidePayment`), `api/services/orders.ts` (`applyPayment`) | tests de montant, devise, double appel |
| Pas de survente : les commandes en attente retiennent leur quantité jusqu'à l'expiration | contrainte SQL `group_deals_no_oversell`, verrou sur la campagne | test « 10 commandes simultanées de 20 unités pour 100 places, exactement 5 passent » |
| Fin de campagne : prolonger, confirmer ou annuler et rembourser | `core/deal.ts`, `api/modules/admin-catalog.ts` | tests API |
| Étape logistique 7 impossible sans la 6, sauf forçage autorisé, motivé et journalisé | `core/logistics-engine.ts` | tests core et API |
| Un seul intérêt Matching par membre et par demande | contrainte d'unicité SQL | tests API |
| Chaque commande garde les composants de son prix et le taux du jour | colonnes `base_*`, `shipping_*`, `rates_used` de `order_items` | tests API |

Les montants sont des entiers en plus petite unité avec leur devise ; les taux sont des décimaux exacts. Aucun calcul de prix n'utilise de nombre flottant. Les prix sont arrondis vers le haut au pas de la devise ; la marge de sécurité de change ne s'applique qu'à la part convertie, et pas entre XAF et XOF (même parité).

## Sécurité

- Mots de passe hachés avec scrypt ; blocage après 5 échecs en 15 minutes.
- Jeton d'accès de 15 minutes gardé en mémoire ; jeton de rafraîchissement tournant dans un cookie `HttpOnly`, `SameSite=Strict`. Un jeton réutilisé révoque toute la session.
- Double authentification TOTP, obligatoire pour le personnel en production ; secret chiffré en AES-256-GCM.
- 8 rôles, 30 permissions ; les rôles de bureau sont limités à leur bureau. Le journal d'audit est en ajout seul (déclencheur SQL).
- En-têtes de sécurité et CSP, limitation du débit, en-tête anti-CSRF sur les routes à cookie, validation de toutes les entrées, requêtes SQL paramétrées.
- Webhooks de paiement : signature vérifiée, événements dédoublonnés en base.

## Textes et langues

Le texte français du code sert de clé : `t('Participer au GroupDeals')`. Les traductions sont en base (table `translations`) et se modifient dans le back-office, rubrique Langues. Ajouter une langue ne demande aucun code : on l'active et on saisit ses textes ; un texte manquant s'affiche en français. Le français et l'anglais sont livrés complets (1 126 textes).

Le sélecteur de langue propose les 57 langues officielles des pays d'Afrique (migration `0017`, qui documente la règle retenue et le pays de chaque langue) : français, anglais, arabe, portugais, espagnol et swahili en tête, puis les autres par ordre alphabétique. Seuls le français et l'anglais sont traduits aujourd'hui. Une langue sans traduction se choisit quand même : un message le signale, et les textes, les nombres, les dates et le sens de lecture restent ceux du français. Dès que ses textes sont saisis dans le back-office (rubrique Langues, qui affiche l'avancement de chaque langue), elle s'affiche normalement, de droite à gauche pour l'arabe et le hassanya. Pour retirer une langue du sélecteur, on la désactive dans la même rubrique.

Quand un même mot français demande deux traductions, la clé porte une précision après « § », jamais affichée : `t('Nom§nom complet')` donne « Nom » en français et « Name » en anglais.

Après avoir ajouté des textes dans le code :

```bash
npm run i18n          # met à jour apps/api/db/i18n/fr.json et liste les textes à traduire
npm run i18n:check    # échoue si une langue livrée est incomplète
```

Au démarrage, l'API n'ajoute que les textes manquants : une traduction corrigée dans le back-office n'est jamais écrasée.

## Tests

```bash
npm test                  # 82 tests des règles métier + 119 tests de l'API (PostgreSQL requis)
npm run typecheck         # core et API
npm run i18n:check
psql -v ON_ERROR_STOP=1 -d <base migrée> -f apps/api/db/test/constraints.test.sql   # 34 contraintes SQL
npm run test:e2e          # parcours navigateur ; l'API doit tourner avec le jeu de démonstration
```

Les tests de l'API créent et suppriment leurs propres bases. Ils se connectent avec `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` (par défaut `postgres` sans mot de passe sur `127.0.0.1:5432`) ; ce rôle doit pouvoir créer des bases. Deux tests d'authentification du client PostgreSQL (SCRAM et MD5) demandent des rôles dédiés et ne tournent qu'avec `PG_AUTH_TESTS=1` : voir l'en-tête de `apps/api/test/01-db-driver.test.ts`.

Le parcours navigateur couvre : prix par pays, passage à l'anglais, inscription et vérification de l'email, minimum de commande, paiement en ligne et facture PDF, seuil du paiement au bureau, réservation avec QR Code, encaissement par l'agent, Matching, les 19 écrans du back-office, validation d'une étape logistique, décision de fin de campagne. Il vérifie aussi qu'aucune page ne déborde en largeur sur mobile.

## Mise en production

Guide pas à pas en français : [`docs/MISE-EN-LIGNE.md`](docs/MISE-EN-LIGNE.md). Serveur Docker de production (base, application, HTTPS automatique avec Caddy, sauvegarde quotidienne) : `deploy/docker-compose.prod.yml`, avec `deploy/.env.production.example`, `deploy/backup.sh` et `deploy/restore.sh`.

Variables : voir `apps/api/.env.example`. L'API refuse de démarrer en production si une valeur obligatoire manque.

1. `NODE_ENV=production`, `PUBLIC_URL` en https, `TRUST_PROXY=true` derrière un répartiteur de charge.
2. `JWT_SECRET` (`openssl rand -base64 48`) et `ENCRYPTION_KEY` (`openssl rand -hex 32`). Perdre `ENCRYPTION_KEY` oblige le personnel à reconfigurer sa double authentification.
3. `PAYMENT_PROVIDER=flutterwave`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`. Dans le tableau de bord Flutterwave, déclarez le webhook `https://<domaine>/api/v1/payments/webhook`. **Faites un paiement réel de bout en bout en mode test avant l'ouverture** (voir « Limites »).
4. `DATABASE_URL` avec `?sslmode=require` ; sauvegardes quotidiennes de PostgreSQL et du dossier `UPLOADS_DIR`.
4 bis. Emails : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (obligatoires en production). Essai : `node dist/cli.js test-email <adresse>`.
4 ter. Identité de GROUPIREX (raison sociale, RCCM, NIU…) : back-office, Réglages ; elle s'imprime sur les factures et alimente les pages légales (`/legal/…`, brouillons à faire valider, voir `apps/web/src/pages/legal.tsx`).
5. Créez le super-administrateur (`create-admin`), activez sa double authentification, puis saisissez les vrais taux de change et les frais de livraison par pays avant de publier une campagne.
6. Avec plusieurs instances : `RUN_JOBS=true` sur une seule, et un stockage partagé pour `UPLOADS_DIR`. Le limiteur de débit est en mémoire, donc par instance.

## Limites connues

Ce qui suit n'a pas pu être exécuté ou n'est pas livré ; à traiter avant l'ouverture au public.

- **Flutterwave** : l'intégration (`api/services/gateway.ts`) suit la documentation de l'API v3 mais n'a jamais appelé Flutterwave. Tous les tests de paiement passent par le prestataire simulé. Mobile Money, carte et autres moyens dépendent de ce que Flutterwave active sur votre compte et par pays.
- **Notifications** : l'email part par SMTP (`api/services/email.ts`, testé contre un faux serveur SMTP, pas encore contre un vrai). Push et WhatsApp ne sont pas branchés : il faut implémenter `ChannelSender` (`api/services/notify.ts`) pour ces canaux. Sans `SMTP_HOST` (hors production), les emails sont écrits dans le journal de l'API.
- **Docker** : `Dockerfile` et `docker-compose.yml` n'ont pas été construits (pas de démon Docker dans l'environnement de développement).
- **Dépendances** : pas de `package-lock.json` (registre npm inaccessible). Le premier `npm install` le crée ; validez-le dans votre dépôt.
- **Vérification des types du site** : `npm run typecheck -w @groupdeals/web` n'a pas été lancé (types de React indisponibles hors ligne). Le site est compilé par esbuild et testé dans un navigateur ; attendez-vous à quelques erreurs de typage à corriger. Le core et l'API passent `tsc` en mode strict.
- **Adaptateur `pg`** : écrit, non testé. Le client intégré est celui qui a été testé.
- **Médias** : stockés sur le disque local (`UPLOADS_DIR`). Pas de stockage objet (S3) ni de CDN.
- **Suivi maritime** : la position du navire est saisie à la main ; l'interface `VesselTrackingProvider` est prête pour un fournisseur.
- **Cartes** : les bureaux s'affichent sur une carte OpenStreetMap intégrée, non vérifiée hors ligne.
- **PDF** : factures et reçus en français et en anglais, caractères latins uniquement.
- **Charge** : les temps de réponse mesurés (moins de 15 ms) portent sur le jeu de démonstration, sur une seule machine. Aucun test de charge n'a été fait.
- **Application mobile Flutter** : hors de cette livraison, comme convenu ; elle utilisera la même API.
