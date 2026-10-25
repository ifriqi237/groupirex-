# Génère offres-exemple.sql : python3 offres-exemple.py (depuis ce dossier).
import json
D="Prix indicatif de démonstration, modifiable par l’administrateur ; il sera confirmé avec le fournisseur avant toute commande."
O=[
 # slug, cat, name, title, desc, features, en_name, en_desc, base, ship, compare, cur, moq, target, img, countries
 ('ciment-50-kg','materiaux-construction','Ciment — sac de 50 kg','ACHAT GROUPÉ DE CIMENT — 50 KG',
  'Achetez votre ciment à prix groupé grâce à GROUPIREX. Réunissez-vous avec d’autres acheteurs pour bénéficier d’un prix avantageux sur vos achats de matériaux de construction. Prix : 4 200 FCFA le sac de 50 kg. '+D,
  ['Vendu au sac de 50 kg','Prix groupé : 4 200 FCFA le sac','Retrait au bureau GROUPDEALS de votre ville'],
  'Cement — 50 kg bag','Buy your cement at a group price with GROUPIREX. Join other buyers to get a better price on your building materials. Indicative demo price, editable by the administrator.',
  3800,400,None,'XAF',1,2000,'ciment',['CM','SN','CI']),
 ('riz-25-kg','agro-alimentaire','Riz de consommation — sac de 25 kg','ACHAT GROUPÉ DE RIZ — SAC DE 25 KG',
  'Réduisez le coût de vos achats alimentaires en participant à une commande collective de riz. Plus les acheteurs se regroupent, plus GROUPIREX peut faciliter l’accès à des offres négociées. '+D,
  ['Vendu au sac de 25 kg','Prix indicatif, à confirmer','Retrait au bureau GROUPDEALS de votre ville'],
  'Rice — 25 kg bag','Cut the cost of your food shopping by joining a group order of rice. Indicative demo price, editable by the administrator.',
  13500,1500,None,'XAF',1,1000,'riz',['CM','SN','CI']),
 ('abonnement-footax','abonnements','Abonnement FOOTAX','ABONNEMENT FOOTAX À 20 $ AU LIEU DE 50 $',
  'Profitez d’une offre spéciale d’achat groupé pour votre abonnement à FOOTAX, la plateforme qui permet aux footballeurs de présenter leurs talents, de publier leurs vidéos et de découvrir des opportunités auprès des clubs et recruteurs. 20 USD au lieu de 50 USD : 30 USD d’économie, soit 60 % de réduction. Offre de démonstration, en attente de la validation des conditions de vente avec FOOTAX.',
  ['20 USD au lieu de 50 USD','30 USD d’économie (−60 %)','Service en ligne : aucun frais de livraison'],
  'FOOTAX subscription','Special group-buying offer on your FOOTAX subscription, the platform where footballers showcase their talent, post videos and find opportunities with clubs and scouts. 20 USD instead of 50 USD. Demo offer, pending validation of terms with FOOTAX.',
  2000,0,5000,'USD',1,500,'footax','ALL'),
 ('ventilateur-sur-pied','electromenager','Ventilateur électrique sur pied','ACHAT GROUPÉ DE VENTILATEURS',
  'Équipez votre maison à prix avantageux en rejoignant un achat groupé de ventilateurs. La commande collective permet de réunir les besoins de plusieurs acheteurs afin de rechercher de meilleures conditions d’achat. '+D,
  ['Ventilateur domestique sur pied','Prix indicatif, à confirmer','Retrait au bureau GROUPDEALS de votre ville'],
  'Standing electric fan','Equip your home at a better price by joining a group purchase of fans. Indicative demo price, editable by the administrator.',
  16500,1500,None,'XAF',1,300,'ventilateur',['CM','SN','CI']),
 ('chaise-de-reception','meubles','Chaise de réception empilable','ACHAT GROUPÉ DE CHAISES DE RÉCEPTION',
  'Chaises empilables pour salles de fête, églises, restaurants et événements. En regroupant les commandes, GROUPIREX recherche de meilleures conditions d’achat. '+D,
  ['Empilable','Pour salles, restaurants et événements','Prix indicatif, à confirmer'],
  'Stackable banquet chair','Stackable chairs for halls, churches, restaurants and events. Indicative demo price, editable by the administrator.',
  8500,1000,None,'XAF',1,500,'chaise',['CM','SN','CI']),
 ('casque-moto','auto-motos','Casque de moto intégral','ACHAT GROUPÉ DE CASQUES DE MOTO',
  'Casques intégraux pour conducteurs de moto et de taxi-moto. Rejoignez l’achat groupé pour rouler protégé à meilleur prix. '+D,
  ['Casque intégral avec visière','Pour motos et taxis-motos','Prix indicatif, à confirmer'],
  'Full-face motorcycle helmet','Full-face helmets for motorcycle and moto-taxi riders. Indicative demo price, editable by the administrator.',
  11500,1000,None,'XAF',1,300,'casque',['CM','SN','CI']),
 ('smartphone-android-128-go','electronique','Smartphone Android 128 Go','ACHAT GROUPÉ DE SMARTPHONES',
  'Smartphones Android avec 128 Go de stockage, pour la famille ou pour équiper une équipe. Le regroupement des commandes permet de rechercher de meilleures conditions d’achat. '+D,
  ['Android, 128 Go de stockage','Pour particuliers et entreprises','Prix indicatif, à confirmer'],
  'Android smartphone, 128 GB','Android smartphones with 128 GB of storage. Indicative demo price, editable by the administrator.',
  53000,2000,None,'XAF',1,200,'smartphone',['CM','SN','CI']),
 ('perruque-cheveux-naturels','extensions','Perruque cheveux longs','ACHAT GROUPÉ DE PERRUQUES',
  'Perruques à cheveux longs pour les salons de coiffure et les particulières. En achetant à plusieurs, GROUPIREX recherche de meilleures conditions auprès des fabricants. '+D,
  ['Cheveux longs','Pour salons et particulières','Prix indicatif, à confirmer'],
  'Long-hair wig','Long-hair wigs for hair salons and individuals. Indicative demo price, editable by the administrator.',
  21000,1000,None,'XAF',1,300,'perruque',['CM','SN','CI']),
 ('liquide-vaisselle-5-l','menage','Liquide vaisselle — bidon de 5 L','ACHAT GROUPÉ DE LIQUIDE VAISSELLE',
  'Liquide vaisselle en bidon de 5 litres pour la maison, les restaurants et les bureaux. Achetez en groupe pour réduire le coût de vos produits d’entretien. '+D,
  ['Bidon de 5 litres','Pour maison, restaurants et bureaux','Prix indicatif, à confirmer'],
  'Dishwashing liquid — 5 L can','Dishwashing liquid in 5-litre cans for homes, restaurants and offices. Indicative demo price, editable by the administrator.',
  2500,500,None,'XAF',1,1000,'vaisselle',['CM','SN','CI']),
]
def q(s): return "'"+s.replace("'","''")+"'" if s is not None else 'NULL'
out=["-- Offres d'exemple : une par catégorie qui n'en avait pas. Rejouable sans doublon (adresse du produit unique).",
     "DO $$ DECLARE pid uuid; did uuid; admin uuid; BEGIN",
     "SELECT u.id INTO admin FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role_code = 'SUPER_ADMIN' ORDER BY u.created_at LIMIT 1;"]
for (slug,cat,name,title,desc,feat,en_n,en_d,base,ship,cmp,cur,moq,target,img,countries) in O:
    i18n=json.dumps({'en':{'name':en_n,'description':en_d}},ensure_ascii=False)
    out.append(f"""IF NOT EXISTS (SELECT 1 FROM products WHERE slug = {q(slug)}) THEN
  INSERT INTO products (category_id, slug, name, description, features, specifications, sale_unit, pieces_per_sale_unit, moq, base_price_amount, base_price_currency, compare_at_amount, is_active, i18n, created_by)
  VALUES ((SELECT id FROM categories WHERE slug = {q(cat)}), {q(slug)}, {q(name)}, {q(desc)}, {q(json.dumps(feat,ensure_ascii=False))}::jsonb, '[]'::jsonb, 'UNIT', 1, {moq}, {base}, {q(cur)}, {cmp if cmp else 'NULL'}, true, {q(i18n)}::jsonb, admin) RETURNING id INTO pid;
  INSERT INTO product_media (product_id, kind, url, thumbnail_url, alt, sort_order) VALUES (pid, 'IMAGE', '/demo/offre-{img}.svg', '/demo/offre-{img}.svg', {q(name)}, 0);""")
    cond = "c.is_active" if countries=='ALL' else "c.code IN (" + ",".join(q(c) for c in countries) + ")"
    out.append(f"""  INSERT INTO product_countries (product_id, country_code) SELECT pid, c.code FROM countries c WHERE {cond};
  INSERT INTO shipping_rates (product_id, country_code, amount, currency_code, freight_cost, customs_cost, created_by) SELECT pid, c.code, {ship}, c.currency_code, 0, 0, admin FROM countries c WHERE {cond};
  INSERT INTO group_deals (product_id, slug, title, stored_status, base_price_amount, base_price_currency, compare_at_amount, target_quantity, min_quantity, starts_at, ends_at, is_featured, created_by)
  VALUES (pid, {q(slug+'-2026-10')}, {q(title)}, 'PUBLISHED', {base}, {q(cur)}, {cmp if cmp else 'NULL'}, {target}, {moq}, now(), now() + interval '30 days', false, admin) RETURNING id INTO did;
  INSERT INTO audit_logs (actor_id, actor_roles, action, entity_type, entity_id, after, reason) VALUES (NULL, '{{}}', 'deal.create', 'deal', did, jsonb_build_object('title', {q(title)}), 'Offre d''exemple créée à la demande du propriétaire');
END IF;""")
out.append("END $$;")
open('offres.sql','w').write('\n'.join(out))
