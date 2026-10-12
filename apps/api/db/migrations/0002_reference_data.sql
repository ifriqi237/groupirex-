-- GROUPDEALS — données de référence, valables en production.
-- Aucun taux de change n'est fourni ici : sans taux saisi, le prix d'un produit en
-- devise étrangère n'est pas calculé (erreur FX_RATE_MISSING) plutôt que d'être faux.

INSERT INTO currencies (code, name, symbol, decimals, rounding_step) VALUES
  ('USD', 'Dollar américain',        '$',    2, 1),
  ('CNY', 'Yuan chinois',            '¥',    2, 1),
  ('EUR', 'Euro',                    '€',    2, 1),
  ('XAF', 'Franc CFA (CEMAC)',       'FCFA', 0, 5),
  ('XOF', 'Franc CFA (UEMOA)',       'FCFA', 0, 5),
  ('NGN', 'Naira nigérian',          '₦',    2, 1000),
  ('GHS', 'Cedi ghanéen',            'GH₵',  2, 10),
  ('KES', 'Shilling kényan',         'KSh',  2, 100),
  ('TZS', 'Shilling tanzanien',      'TSh',  2, 10000),
  ('UGX', 'Shilling ougandais',      'USh',  0, 100),
  ('RWF', 'Franc rwandais',          'FRw',  0, 10),
  ('ETB', 'Birr éthiopien',          'Br',   2, 100),
  ('ZAR', 'Rand sud-africain',       'R',    2, 10),
  ('AOA', 'Kwanza angolais',         'Kz',   2, 1000),
  ('MZN', 'Metical mozambicain',     'MT',   2, 100),
  ('CDF', 'Franc congolais',         'FC',   2, 10000),
  ('GNF', 'Franc guinéen',           'FG',   0, 500),
  ('MAD', 'Dirham marocain',         'DH',   2, 10),
  ('DZD', 'Dinar algérien',          'DA',   2, 1000),
  ('TND', 'Dinar tunisien',          'DT',   3, 100),
  ('EGP', 'Livre égyptienne',        'E£',   2, 10);

INSERT INTO languages (code, name, native_name, is_rtl, is_active, sort_order) VALUES
  ('fr', 'Français',  'Français',   false, true,  1),
  ('en', 'Anglais',   'English',    false, true,  2),
  ('pt', 'Portugais', 'Português',  false, false, 3),
  ('ar', 'Arabe',     'العربية',    true,  false, 4),
  ('sw', 'Swahili',   'Kiswahili',  false, false, 5),
  ('ha', 'Haoussa',   'Hausa',      false, false, 6),
  ('am', 'Amharique', 'አማርኛ',       false, false, 7),
  ('yo', 'Yoruba',    'Yorùbá',     false, false, 8),
  ('zu', 'Zoulou',    'isiZulu',    false, false, 9),
  ('ln', 'Lingala',   'Lingála',    false, false, 10),
  ('wo', 'Wolof',     'Wolof',      false, false, 11),
  ('bm', 'Bambara',   'Bamanankan', false, false, 12);

INSERT INTO countries (code, name, i18n, currency_code, phone_prefix, default_language) VALUES
  ('CM', 'Cameroun',             '{"en":{"name":"Cameroon"}}',                 'XAF', '+237', 'fr'),
  ('GA', 'Gabon',                '{"en":{"name":"Gabon"}}',                    'XAF', '+241', 'fr'),
  ('CG', 'Congo',                '{"en":{"name":"Congo"}}',                    'XAF', '+242', 'fr'),
  ('TD', 'Tchad',                '{"en":{"name":"Chad"}}',                     'XAF', '+235', 'fr'),
  ('CF', 'Centrafrique',         '{"en":{"name":"Central African Republic"}}', 'XAF', '+236', 'fr'),
  ('GQ', 'Guinée équatoriale',   '{"en":{"name":"Equatorial Guinea"}}',        'XAF', '+240', 'fr'),
  ('SN', 'Sénégal',              '{"en":{"name":"Senegal"}}',                  'XOF', '+221', 'fr'),
  ('CI', 'Côte d''Ivoire',       '{"en":{"name":"Côte d''Ivoire"}}',           'XOF', '+225', 'fr'),
  ('BJ', 'Bénin',                '{"en":{"name":"Benin"}}',                    'XOF', '+229', 'fr'),
  ('BF', 'Burkina Faso',         '{"en":{"name":"Burkina Faso"}}',             'XOF', '+226', 'fr'),
  ('ML', 'Mali',                 '{"en":{"name":"Mali"}}',                     'XOF', '+223', 'fr'),
  ('NE', 'Niger',                '{"en":{"name":"Niger"}}',                    'XOF', '+227', 'fr'),
  ('TG', 'Togo',                 '{"en":{"name":"Togo"}}',                     'XOF', '+228', 'fr'),
  ('GW', 'Guinée-Bissau',        '{"en":{"name":"Guinea-Bissau"}}',            'XOF', '+245', 'fr'),
  ('GN', 'Guinée',               '{"en":{"name":"Guinea"}}',                   'GNF', '+224', 'fr'),
  ('CD', 'RD Congo',             '{"en":{"name":"DR Congo"}}',                 'CDF', '+243', 'fr'),
  ('NG', 'Nigeria',              '{"en":{"name":"Nigeria"}}',                  'NGN', '+234', 'en'),
  ('GH', 'Ghana',                '{"en":{"name":"Ghana"}}',                    'GHS', '+233', 'en'),
  ('KE', 'Kenya',                '{"en":{"name":"Kenya"}}',                    'KES', '+254', 'en'),
  ('TZ', 'Tanzanie',             '{"en":{"name":"Tanzania"}}',                 'TZS', '+255', 'en'),
  ('UG', 'Ouganda',              '{"en":{"name":"Uganda"}}',                   'UGX', '+256', 'en'),
  ('RW', 'Rwanda',               '{"en":{"name":"Rwanda"}}',                   'RWF', '+250', 'fr'),
  ('ET', 'Éthiopie',             '{"en":{"name":"Ethiopia"}}',                 'ETB', '+251', 'en'),
  ('ZA', 'Afrique du Sud',       '{"en":{"name":"South Africa"}}',             'ZAR', '+27',  'en'),
  ('AO', 'Angola',               '{"en":{"name":"Angola"}}',                   'AOA', '+244', 'en'),
  ('MZ', 'Mozambique',           '{"en":{"name":"Mozambique"}}',               'MZN', '+258', 'en'),
  ('MA', 'Maroc',                '{"en":{"name":"Morocco"}}',                  'MAD', '+212', 'fr'),
  ('DZ', 'Algérie',              '{"en":{"name":"Algeria"}}',                  'DZD', '+213', 'fr'),
  ('TN', 'Tunisie',              '{"en":{"name":"Tunisia"}}',                  'TND', '+216', 'fr'),
  ('EG', 'Égypte',               '{"en":{"name":"Egypt"}}',                    'EGP', '+20',  'en');

INSERT INTO roles (code, label) VALUES
  ('SUPER_ADMIN',       'Super administrateur'),
  ('ADMIN',             'Administrateur'),
  ('LOGISTICS_MANAGER', 'Responsable logistique'),
  ('FINANCE_MANAGER',   'Responsable financier'),
  ('OFFICE_MANAGER',    'Responsable de bureau'),
  ('OFFICE_AGENT',      'Agent de bureau'),
  ('MODERATOR',         'Modérateur'),
  ('CUSTOMER',          'Client');
-- Les permissions et leur répartition par rôle sont synchronisées au démarrage de
-- l'API depuis la matrice de @groupdeals/core (source unique).

INSERT INTO payment_methods (code, label, min_total_amount, min_total_currency) VALUES
  ('ONLINE', 'Paiement en ligne', NULL, NULL),
  ('OFFICE', 'Paiement au bureau local', 500000, 'XAF');

INSERT INTO settings (key, value) VALUES
  ('pricing.reference_currency',   '"USD"'),
  ('pricing.fx_buffer_bps',        '200'),
  ('pricing.max_rate_age_hours',   '72'),
  ('pricing.pegged_currencies',    '[["XAF","XOF"]]'),
  ('reporting.currency',           '"XAF"'),
  ('orders.online_hold_minutes',   '30'),
  ('orders.office_hold_hours',     '72'),
  ('orders.require_verified_email','true'),
  ('matching.alert_threshold',     '50'),
  ('deals.ending_soon_hours',      '48');

INSERT INTO categories (slug, name, description, icon, sort_order, i18n) VALUES
  ('mode-homme',      'Mode Homme',      'Vêtements, chaussures et accessoires pour homme.',  'shirt',  1, '{"en":{"name":"Men''s Fashion","description":"Clothing, shoes and accessories for men."}}'),
  ('mode-femme',      'Mode Femme',      'Vêtements, chaussures et accessoires pour femme.',  'dress',  2, '{"en":{"name":"Women''s Fashion","description":"Clothing, shoes and accessories for women."}}'),
  ('mode-enfant',     'Mode Enfant',     'Vêtements et chaussures pour enfant.',              'baby',   3, '{"en":{"name":"Kids'' Fashion","description":"Clothing and shoes for children."}}'),
  ('papier',          'Papier',          'Ramettes, cahiers et fournitures de papeterie.',    'paper',  4, '{"en":{"name":"Paper","description":"Reams, notebooks and stationery."}}'),
  ('energie-solaire', 'Énergie solaire', 'Panneaux, batteries, onduleurs et kits solaires.',  'sun',    5, '{"en":{"name":"Solar Energy","description":"Panels, batteries, inverters and solar kits."}}'),
  ('gadgets',         'Gadgets',         'Électronique et accessoires du quotidien.',         'gadget', 6, '{"en":{"name":"Gadgets","description":"Everyday electronics and accessories."}}');
