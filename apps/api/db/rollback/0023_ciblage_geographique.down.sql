-- Retour arrière de 0023_ciblage_geographique.sql (à lancer à la main, jamais automatiquement).
-- Toutes les campagnes redeviennent visibles dans tous les pays où le produit est livré.
BEGIN;
DROP TABLE IF EXISTS group_deal_countries;
DROP INDEX IF EXISTS group_deals_geographic_scope_idx;
DROP INDEX IF EXISTS orders_deal_country_idx;
ALTER TABLE users DROP COLUMN IF EXISTS country_changed_at;
ALTER TABLE group_deals DROP COLUMN IF EXISTS goal_scope, DROP COLUMN IF EXISTS geographic_scope;
DELETE FROM schema_migrations WHERE name = '0023_ciblage_geographique.sql';
COMMIT;
