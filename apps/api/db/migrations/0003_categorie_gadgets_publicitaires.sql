-- La catégorie « Gadgets » devient « Gadgets publicitaires ».
-- Son adresse (slug « gadgets ») ne change pas : les liens existants restent valables.
-- Une catégorie déjà renommée dans le back-office n'est pas touchée.
UPDATE categories
   SET name = 'Gadgets publicitaires',
       description = 'Objets publicitaires, électronique et accessoires du quotidien.',
       i18n = jsonb_set(
                jsonb_set(COALESCE(i18n, '{}'::jsonb), '{en,name}', '"Promotional Gadgets"', true),
                '{en,description}', '"Promotional items, everyday electronics and accessories."', true)
 WHERE slug = 'gadgets' AND name = 'Gadgets';
