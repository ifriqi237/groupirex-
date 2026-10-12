# Mettre GROUPDEALS en ligne

Ce guide liste ce qui est prêt, ce qu'il reste à fournir ou décider, et les étapes pour ouvrir le site.
Il est écrit pour être suivi par GROUPIREX avec l'aide d'un technicien pour les étapes « serveur ».

## 0. Situation actuelle (12 octobre 2026)

- Le site tourne en **pré-ouverture** sur **groupirex.com** (hébergement Node.js Hostinger, déployé automatiquement à chaque envoi sur la branche `main` du dépôt GitHub `ifriqi237/groupirex-`).
- La base est un projet Supabase **dédié**, « groupdeals » (Paris), dans un schéma privé `groupdeals` que l'API publique de Supabase ne voit pas.
- Mode `NODE_ENV=staging` : paiements simulés (un bandeau « Pré-ouverture » le dit à chaque visiteur), aucun email envoyé.
- Tant qu'aucune boîte d'envoi n'est branchée, le réglage « email vérifié pour commander » est désactivé (sinon personne ne pourrait commander). **À réactiver** dans *Back-office → Réglages* dès que les emails partent.
- Limite connue de cet hébergement : l'application peut être mise en veille quand personne ne visite le site ; les tâches planifiées (expiration des commandes non payées, rappels) s'exécutent alors au réveil suivant. Un VPS (§3) n'a pas cette limite.

## 1. Ce qui est prêt dans le code

| Domaine | État |
|---|---|
| Site client, back-office, espace des bureaux | Prêts et testés (parcours complet automatisé) |
| Base de données PostgreSQL | Prête (migrations appliquées au démarrage) |
| Emails (vérification, mot de passe oublié, notifications) | Prêts : envoi SMTP, à brancher sur une boîte d'envoi |
| Factures, proformas, reçus en PDF | Prêts ; l'identité de GROUPIREX se règle dans le back-office |
| Pages légales (mentions, conditions, confidentialité) | **Brouillons** à compléter et à faire valider par un juriste |
| Paiement en ligne Flutterwave | Écrit, **jamais essayé avec un vrai compte** |
| Serveur de production (Docker, HTTPS, sauvegardes) | Fichiers prêts dans `deploy/`, à lancer sur le serveur |
| Référencement : robots.txt, plan du site | Prêts (`/robots.txt`, `/sitemap.xml`) |
| Notifications WhatsApp et push | Non branchées (aucun fournisseur choisi) |
| Application mobile | Hors de cette livraison |

## 2. Ce que GROUPIREX doit fournir ou décider

1. **Un nom de domaine** pour GROUPDEALS (par exemple groupdeals.com), avec accès à sa zone DNS.
2. **Un serveur** (voir le §3).
3. **Un compte de paiement** : Flutterwave (prévu par le cahier des charges), avec les moyens de paiement activés pour chaque pays visé. Faire d'abord tous les essais en mode test. Autre possibilité : PawaPay (Mobile Money), déjà utilisé par IFRIQI ; son branchement à GROUPDEALS reste à écrire.
4. **Une boîte d'envoi d'emails** sur le domaine, par exemple `no-reply@groupdeals.com` (la messagerie de l'hébergeur suffit pour démarrer).
5. **L'identité légale de GROUPIREX** : raison sociale, forme juridique, capital, adresse du siège, RCCM, NIU, téléphone, email de contact, directeur de la publication, hébergeur. Elle se saisit dans *Back-office → Réglages → Identité de l'entreprise* et s'imprime sur les factures.
6. **Les règles commerciales** encore ouvertes dans les conditions générales (passages surlignés) : délai de remboursement, délai de retrait au bureau et frais de garde, conditions d'annulation d'une commande payée, délai de réclamation, droit applicable et tribunal compétent.
7. **Une relecture juridique** des trois pages légales, puis passer `LEGAL_DRAFT` à `false` dans `apps/web/src/pages/legal.tsx` (le bandeau « document de travail » disparaît).
8. **Les données d'exploitation**, saisies dans le back-office avant d'ouvrir une offre : vrais taux de change, frais de livraison de chaque produit vers chaque pays, bureaux locaux et leurs agents, catalogue et photos (avec le droit de les utiliser).

## 3. Où héberger GROUPDEALS

GROUPDEALS a besoin de **Node.js 22** et d'une base **PostgreSQL**.

**Option recommandée — un serveur VPS** (par exemple une offre VPS Hostinger sous Ubuntu, avec au moins 2 processeurs et 4 à 8 Go de mémoire). Tout tourne sur la même machine avec Docker : la base, l'application, le HTTPS automatique et les sauvegardes quotidiennes. C'est l'option décrite au §4.

**Option possible — hébergement Node.js mutualisé + base PostgreSQL séparée.** L'hébergement web mutualisé ne fournit pas PostgreSQL (seulement MySQL) : il faudrait une base PostgreSQL gérée à part (par exemple un projet Supabase **dédié à GROUPDEALS**, en mode « session » du pooler, connexion chiffrée). Les médias seraient stockés sur l'hébergement. Cette option est moins simple à sauvegarder et à surveiller.

> Le compte Hostinger relié contient déjà le site **ifriqi.com**, et le projet Supabase existant sert à IFRIQI. GROUPDEALS ne doit pas partager ce site ni cette base : prévoyez un serveur, un domaine et une base qui lui sont propres.

## 4. Mise en ligne sur un VPS, pas à pas

1. **DNS** : chez le fournisseur du domaine, créez un enregistrement `A` pour `groupdeals.com` et pour `www` vers l'adresse IP du serveur.
2. **Serveur** : installez Docker (`curl -fsSL https://get.docker.com | sh`), puis copiez le projet sur le serveur.
3. **Configuration** : dans `deploy/`, copiez `.env.production.example` en `.env` et remplissez chaque valeur. Générez les secrets avec `openssl rand -base64 48` (JWT_SECRET), `openssl rand -hex 32` (ENCRYPTION_KEY) et `openssl rand -base64 32` (POSTGRES_PASSWORD). **Gardez une copie de ce fichier en lieu sûr** : perdre ENCRYPTION_KEY oblige le personnel à reconfigurer sa double authentification.
4. **Démarrage** : `cd deploy && docker compose -f docker-compose.prod.yml up -d --build`. Le certificat HTTPS est obtenu automatiquement en une minute environ.
5. **Vérification** : `https://groupdeals.com/healthz` doit répondre `{"status":"ok"}`.
6. **Email d'essai** : `docker compose -f docker-compose.prod.yml exec app node dist/cli.js test-email votre@adresse.com`.
7. **Premier administrateur** : `docker compose -f docker-compose.prod.yml exec app node dist/cli.js create-admin admin@groupdeals.com "<mot de passe de 12 caractères ou plus>"`, puis connectez-vous et activez la double authentification.
8. **Flutterwave** : dans le tableau de bord Flutterwave, déclarez le webhook `https://groupdeals.com/api/v1/payments/webhook` et le même « secret hash » que `FLUTTERWAVE_WEBHOOK_HASH`.
9. **Back-office** : saisissez l'identité de l'entreprise, les taux de change, les frais de livraison, les bureaux et leurs agents, puis le catalogue.

## 5. Avant d'ouvrir au public

- [ ] Un paiement Flutterwave **réel de bout en bout** en mode test : commande, paiement, retour sur le site, commande « payée », facture.
- [ ] Puis un vrai paiement de petit montant avec les clés de production, et son remboursement.
- [ ] Une réservation payée au bureau par un agent (lecture du QR code, encaissement, reçu).
- [ ] Une inscription réelle : l'email de vérification arrive (vérifier aussi le dossier « indésirables »).
- [ ] Un « mot de passe oublié » réel.
- [ ] La double authentification activée pour chaque compte du personnel.
- [ ] Une sauvegarde **restaurée** sur une base d'essai (`deploy/restore.sh`), et une copie des sauvegardes hors du serveur.
- [ ] Les pages légales complétées et validées ; `LEGAL_DRAFT` à `false`.
- [ ] Le site vérifié sur un téléphone Android d'entrée de gamme et en connexion 3G.
- [ ] Le domaine déclaré dans Google Search Console avec le plan du site `https://groupdeals.com/sitemap.xml`.

## 6. Après l'ouverture

- Surveillez `https://groupdeals.com/healthz` avec un service de surveillance gratuit (alerte par email ou SMS en cas de panne).
- Mises à jour : `git pull` puis `docker compose -f docker-compose.prod.yml up -d --build` (les migrations s'appliquent seules).
- Vérifiez chaque semaine que les sauvegardes du dossier `deploy/backups/` sont bien copiées ailleurs.
