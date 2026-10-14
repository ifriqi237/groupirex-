-- Campagne affichée dans la grande carte de la bannière d'accueil, choisie par l'administration.
-- Une seule à la fois. Sans choix, la bannière montre la campagne à la une qui se termine le plus tôt.
-- Retour arrière : db/rollback/0024_campagne_banniere.down.sql
ALTER TABLE group_deals ADD COLUMN is_banner BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX group_deals_one_banner_idx ON group_deals ((true)) WHERE is_banner;
