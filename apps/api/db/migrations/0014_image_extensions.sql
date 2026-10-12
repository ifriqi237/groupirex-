-- Image de la catégorie « Extensions » : la photo fournie (apps/web/public/categories/extensions.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/extensions.webp'
 WHERE slug = 'extensions' AND (image_url IS NULL OR image_url = '/demo/cat-extensions.svg');
