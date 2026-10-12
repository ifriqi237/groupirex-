-- Image de la catégorie « Ménage » : la photo fournie (apps/web/public/categories/menage.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/menage.webp'
 WHERE slug = 'menage' AND (image_url IS NULL OR image_url = '/demo/cat-menage.svg');
