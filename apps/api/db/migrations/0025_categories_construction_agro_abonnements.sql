-- Trois nouvelles catégories : Matériaux de construction, Agro-alimentaire, Abonnements.
-- Elles s'ajoutent au système de catégories existant (accueil, filtres, fiches, back-office, Matching).
-- Le site n'a pas de sous-catégories : les familles de produits sont citées dans la description,
-- ce qui les rend trouvables par la recherche, sans ajouter de nouvelle structure.
-- Illustrations originales : apps/web/public/categories/*.webp
-- Une catégorie déjà créée à la main avec la même adresse (slug) est laissée telle quelle.
INSERT INTO categories (slug, name, description, icon, image_url, sort_order, i18n) VALUES
  ('materiaux-construction', 'Matériaux de construction',
   'Ciment et liants, fer à béton et acier, sable, gravier et granulats, carrelage et revêtements, peinture et finitions, plomberie, électricité, menuiserie et matériaux divers.',
   'brick', '/categories/materiaux-construction.webp', 13,
   '{"en":{"name":"Building materials","description":"Cement and binders, rebar and steel, sand, gravel and aggregates, tiles and coverings, paint and finishes, plumbing, electrical, joinery and other materials."}}'),
  ('agro-alimentaire', 'Agro-alimentaire',
   'Céréales et féculents, riz, maïs et farine, huiles alimentaires, sucre et produits sucrés, produits alimentaires transformés, produits agricoles et matières premières, boissons et autres produits alimentaires.',
   'wheat', '/categories/agro-alimentaire.webp', 14,
   '{"en":{"name":"Food & agriculture","description":"Cereals and starches, rice, maize and flour, cooking oils, sugar and sweet products, processed foods, agricultural products and raw materials, drinks and other food products."}}'),
  ('abonnements', 'Abonnements',
   'Télévision et divertissement, Internet et forfaits de données, logiciels et outils numériques, services professionnels et autres abonnements, négociés à plusieurs.',
   'calendar', '/categories/abonnements.webp', 15,
   '{"en":{"name":"Subscriptions","description":"TV and entertainment, Internet and data plans, software and digital tools, professional services and other subscriptions, negotiated as a group."}}')
ON CONFLICT (slug) DO NOTHING;
