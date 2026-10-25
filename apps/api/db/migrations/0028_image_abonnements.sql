-- Catégorie « Abonnements » : bouton rouge « Abonnez-vous ! » (dessin original, à la demande du propriétaire).
-- Une image choisie dans le back-office n'est pas écrasée.
UPDATE categories SET image_url = '/categories/abonnements-bouton.webp'
 WHERE slug = 'abonnements' AND (image_url IS NULL OR image_url = '/categories/abonnements.webp');
