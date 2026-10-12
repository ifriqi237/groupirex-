-- Image de la catégorie « Mode Enfant » : la photo fournie (apps/web/public/categories/mode-enfant.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/mode-enfant.webp'
 WHERE slug = 'mode-enfant' AND (image_url IS NULL OR image_url = '/demo/cat-mode-enfant.svg');
