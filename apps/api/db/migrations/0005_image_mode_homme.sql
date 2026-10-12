-- Image de la catégorie « Mode Homme » : la photo fournie (apps/web/public/categories/mode-homme.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/mode-homme.webp'
 WHERE slug = 'mode-homme' AND (image_url IS NULL OR image_url = '/demo/cat-mode-homme.svg');
