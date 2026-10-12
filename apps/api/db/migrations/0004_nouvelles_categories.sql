-- Six nouvelles catégories : meubles, auto-motos, électronique, extensions, ménage, électroménager.
-- Une catégorie déjà créée à la main avec la même adresse (slug) est laissée telle quelle.
INSERT INTO categories (slug, name, description, icon, sort_order, i18n) VALUES
  ('meubles',        'Meubles',        'Canapés, lits, tables, chaises et rangements.',                                     'sofa',    7,  '{"en":{"name":"Furniture","description":"Sofas, beds, tables, chairs and storage."}}'),
  ('auto-motos',     'Auto-Motos',     'Motos, pièces détachées et accessoires pour voitures et deux-roues.',               'car',     8,  '{"en":{"name":"Cars & Motorcycles","description":"Motorcycles, spare parts and accessories for cars and two-wheelers."}}'),
  ('electronique',   'Électronique',   'Téléphones, téléviseurs, ordinateurs et accessoires.',                              'phone',   9,  '{"en":{"name":"Electronics","description":"Phones, TVs, computers and accessories."}}'),
  ('extensions',     'Extensions',     'Extensions de cheveux, perruques, tissages, faux cils, faux ongles et autres produits de beauté.', 'hair', 10, '{"en":{"name":"Hair & Beauty Extensions","description":"Hair extensions, wigs, weaves, false lashes, false nails and other beauty products."}}'),
  ('menage',         'Ménage',         'Produits d''entretien, ustensiles et articles pour la maison.',                     'broom',   11, '{"en":{"name":"Household","description":"Cleaning products, utensils and items for the home."}}'),
  ('electromenager', 'Électroménager', 'Réfrigérateurs, cuisinières, machines à laver, ventilateurs et petit électroménager.', 'fridge', 12, '{"en":{"name":"Home Appliances","description":"Fridges, cookers, washing machines, fans and small appliances."}}')
ON CONFLICT (slug) DO NOTHING;

-- L'électronique a maintenant sa catégorie : celle des gadgets publicitaires se recentre sur son sujet.
UPDATE categories
   SET description = 'Objets publicitaires et accessoires à personnaliser.',
       i18n = jsonb_set(i18n, '{en,description}', '"Promotional items and accessories to customise."', true)
 WHERE slug = 'gadgets' AND description = 'Objets publicitaires, électronique et accessoires du quotidien.';
