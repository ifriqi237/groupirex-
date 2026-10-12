-- Image de la catégorie « Auto-Motos » : la photo fournie (apps/web/public/categories/auto-motos.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/auto-motos.webp'
 WHERE slug = 'auto-motos' AND (image_url IS NULL OR image_url = '/demo/cat-auto-motos.svg');
