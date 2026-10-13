-- La catégorie « Électroménager » devient « Appareillage », avec une nouvelle illustration
-- (apps/web/public/categories/appareillage.webp, dessin original). Son adresse (slug) ne change pas,
-- pour que les liens existants restent valables. Un nom ou une image modifiés dans le back-office ne sont pas écrasés.
UPDATE categories
   SET name = 'Appareillage',
       description = 'Appareils électriques et électroniques, équipements et accessoires techniques.',
       i18n = jsonb_set(COALESCE(i18n, '{}'::jsonb), '{en}', '{"name": "Equipment", "description": "Electrical and electronic devices, equipment and technical accessories."}'::jsonb)
 WHERE slug = 'electromenager' AND name = 'Électroménager';

UPDATE categories
   SET image_url = '/categories/appareillage.webp'
 WHERE slug = 'electromenager' AND (image_url IS NULL OR image_url IN ('/categories/electromenager.webp', '/demo/cat-electromenager.svg'));
