-- Retour arrière de 0025 : ne retire une catégorie que si aucun produit ne l'utilise.
BEGIN;
DELETE FROM categories c WHERE c.slug IN ('materiaux-construction', 'agro-alimentaire', 'abonnements')
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id);
DELETE FROM schema_migrations WHERE name = '0025_categories_construction_agro_abonnements.sql';
COMMIT;
