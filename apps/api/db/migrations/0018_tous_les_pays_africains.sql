-- Ouvre l'inscription aux 54 pays d'Afrique : ajoute les 24 pays qui manquaient et leur monnaie.
--
-- Un pays ajouté ici apparaît dans la liste des pays (inscription, choix du pays du site) et peut accueillir
-- des clients. Ses offres n'apparaissent qu'une fois réglés, dans le back-office, le taux de change de sa
-- monnaie et les frais de livraison des produits vers ce pays (comme pour tout pays déjà ouvert).
-- Langue par défaut : français pour les pays francophones, anglais sinon (même règle que 0002).
-- Zimbabwe : le dollar américain, monnaie la plus utilisée dans les paiements du pays.

INSERT INTO currencies (code, name, symbol, decimals, rounding_step) VALUES
  ('BWP', 'Pula botswanais',           'P',    2, 10),
  ('BIF', 'Franc burundais',           'FBu',  0, 100),
  ('CVE', 'Escudo cap-verdien',        'Esc',  2, 10),
  ('KMF', 'Franc comorien',            'CF',   0, 50),
  ('DJF', 'Franc djiboutien',          'Fdj',  0, 50),
  ('ERN', 'Nakfa érythréen',           'Nfk',  2, 10),
  ('SZL', 'Lilangeni swazi',           'E',    2, 10),
  ('GMD', 'Dalasi gambien',            'D',    2, 10),
  ('LSL', 'Loti lesothan',             'L',    2, 10),
  ('LRD', 'Dollar libérien',           'L$',   2, 10),
  ('LYD', 'Dinar libyen',              'LD',   3, 1),
  ('MGA', 'Ariary malgache',           'Ar',   0, 500),
  ('MWK', 'Kwacha malawien',           'MK',   2, 100),
  ('MUR', 'Roupie mauricienne',        'Rs',   2, 10),
  ('MRU', 'Ouguiya mauritanien',       'UM',   2, 10),
  ('NAD', 'Dollar namibien',           'N$',   2, 10),
  ('STN', 'Dobra santoméen',           'Db',   2, 10),
  ('SCR', 'Roupie seychelloise',       'SR',   2, 10),
  ('SLE', 'Leone sierra-léonais',      'Le',   2, 10),
  ('SOS', 'Shilling somalien',         'Sh',   2, 1000),
  ('SDG', 'Livre soudanaise',          'LS',   2, 100),
  ('SSP', 'Livre sud-soudanaise',      'SSP',  2, 100),
  ('ZMW', 'Kwacha zambien',            'K',    2, 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO countries (code, name, i18n, currency_code, phone_prefix, default_language) VALUES
  ('BW', 'Botswana',               '{"en":{"name":"Botswana"}}',              'BWP', '+267', 'en'),
  ('BI', 'Burundi',                '{"en":{"name":"Burundi"}}',               'BIF', '+257', 'fr'),
  ('CV', 'Cap-Vert',               '{"en":{"name":"Cape Verde"}}',            'CVE', '+238', 'en'),
  ('KM', 'Comores',                '{"en":{"name":"Comoros"}}',               'KMF', '+269', 'fr'),
  ('DJ', 'Djibouti',               '{"en":{"name":"Djibouti"}}',              'DJF', '+253', 'fr'),
  ('ER', 'Érythrée',               '{"en":{"name":"Eritrea"}}',               'ERN', '+291', 'en'),
  ('SZ', 'Eswatini',               '{"en":{"name":"Eswatini"}}',              'SZL', '+268', 'en'),
  ('GM', 'Gambie',                 '{"en":{"name":"Gambia"}}',                'GMD', '+220', 'en'),
  ('LS', 'Lesotho',                '{"en":{"name":"Lesotho"}}',               'LSL', '+266', 'en'),
  ('LR', 'Liberia',                '{"en":{"name":"Liberia"}}',               'LRD', '+231', 'en'),
  ('LY', 'Libye',                  '{"en":{"name":"Libya"}}',                 'LYD', '+218', 'en'),
  ('MG', 'Madagascar',             '{"en":{"name":"Madagascar"}}',            'MGA', '+261', 'fr'),
  ('MW', 'Malawi',                 '{"en":{"name":"Malawi"}}',                'MWK', '+265', 'en'),
  ('MU', 'Maurice',                '{"en":{"name":"Mauritius"}}',             'MUR', '+230', 'en'),
  ('MR', 'Mauritanie',             '{"en":{"name":"Mauritania"}}',            'MRU', '+222', 'fr'),
  ('NA', 'Namibie',                '{"en":{"name":"Namibia"}}',               'NAD', '+264', 'en'),
  ('ST', 'Sao Tomé-et-Principe',   '{"en":{"name":"São Tomé and Príncipe"}}', 'STN', '+239', 'en'),
  ('SC', 'Seychelles',             '{"en":{"name":"Seychelles"}}',            'SCR', '+248', 'en'),
  ('SL', 'Sierra Leone',           '{"en":{"name":"Sierra Leone"}}',          'SLE', '+232', 'en'),
  ('SO', 'Somalie',                '{"en":{"name":"Somalia"}}',               'SOS', '+252', 'en'),
  ('SD', 'Soudan',                 '{"en":{"name":"Sudan"}}',                 'SDG', '+249', 'en'),
  ('SS', 'Soudan du Sud',          '{"en":{"name":"South Sudan"}}',           'SSP', '+211', 'en'),
  ('ZM', 'Zambie',                 '{"en":{"name":"Zambia"}}',                'ZMW', '+260', 'en'),
  ('ZW', 'Zimbabwe',               '{"en":{"name":"Zimbabwe"}}',              'USD', '+263', 'en')
ON CONFLICT (code) DO NOTHING;
