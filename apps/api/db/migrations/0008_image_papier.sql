-- Image de la catégorie « Papier » : la photo fournie (apps/web/public/categories/papier.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/papier.webp'
 WHERE slug = 'papier' AND (image_url IS NULL OR image_url = '/demo/cat-papier.svg');
