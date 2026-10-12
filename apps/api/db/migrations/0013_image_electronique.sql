-- Image de la catégorie « Électronique » : la photo fournie (apps/web/public/categories/electronique.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/electronique.webp'
 WHERE slug = 'electronique' AND (image_url IS NULL OR image_url = '/demo/cat-electronique.svg');
