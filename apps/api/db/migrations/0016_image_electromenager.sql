-- Image de la catégorie « Électroménager » : la photo fournie (apps/web/public/categories/electromenager.webp).
-- Une image déjà choisie dans le back-office n'est pas remplacée.
UPDATE categories
   SET image_url = '/categories/electromenager.webp'
 WHERE slug = 'electromenager' AND (image_url IS NULL OR image_url = '/demo/cat-electromenager.svg');
