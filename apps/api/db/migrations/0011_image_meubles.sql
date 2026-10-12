-- Image de la catégorie « Meubles » : la photo fournie (apps/web/public/categories/meubles.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/meubles.webp'
 WHERE slug = 'meubles' AND (image_url IS NULL OR image_url = '/demo/cat-meubles.svg');
