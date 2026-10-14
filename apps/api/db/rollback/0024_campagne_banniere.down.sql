BEGIN;
DROP INDEX IF EXISTS group_deals_one_banner_idx;
ALTER TABLE group_deals DROP COLUMN IF EXISTS is_banner;
DELETE FROM schema_migrations WHERE name = '0024_campagne_banniere.sql';
COMMIT;
