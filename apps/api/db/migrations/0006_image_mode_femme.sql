-- Image de la catégorie « Mode Femme » : la photo fournie (apps/web/public/categories/mode-femme.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/mode-femme.webp'
 WHERE slug = 'mode-femme' AND (image_url IS NULL OR image_url = '/demo/cat-mode-femme.svg');
