-- Image de la catégorie « Gadgets publicitaires » : la photo fournie (apps/web/public/categories/gadgets.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/gadgets.webp'
 WHERE slug = 'gadgets' AND (image_url IS NULL OR image_url = '/demo/cat-gadgets.svg');
