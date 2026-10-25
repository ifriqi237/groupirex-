-- Catégorie « Matériaux de construction » : photo fournie par le propriétaire (bois, tubes PVC, fer à béton,
-- sable, gravier, briques, sacs de ciment). Une image choisie dans le back-office n'est pas écrasée.
UPDATE categories SET image_url = '/categories/materiaux-construction-photo.webp'
 WHERE slug = 'materiaux-construction' AND (image_url IS NULL OR image_url = '/categories/materiaux-construction.webp');
