-- Catégorie « Agro-alimentaire » : photo fournie par le propriétaire (entrepôt de sacs de riz).
-- Une image choisie dans le back-office n'est pas écrasée.
UPDATE categories SET image_url = '/categories/agro-alimentaire-photo.webp'
 WHERE slug = 'agro-alimentaire' AND (image_url IS NULL OR image_url = '/categories/agro-alimentaire.webp');
