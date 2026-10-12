-- Image de la catégorie « Énergie solaire » : la photo fournie (apps/web/public/categories/energie-solaire.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/energie-solaire.webp'
 WHERE slug = 'energie-solaire' AND (image_url IS NULL OR image_url = '/demo/cat-energie-solaire.svg');
