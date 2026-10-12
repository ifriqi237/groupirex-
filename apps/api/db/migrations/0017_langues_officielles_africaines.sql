-- Le sélecteur de langue propose toutes les langues officielles des pays d'Afrique (57 langues).
--
-- Règle retenue : toute langue à laquelle la constitution ou la loi d'un des 54 États donne un statut
-- officiel (ou de langue de travail de l'État) au niveau national, hors langues des signes. S'y ajoutent
-- quatre grandes langues nationales déjà prévues dans les données de référence (haoussa, lingala, wolof, yoruba).
-- Pour le Burkina Faso, dont la Constitution révisée officialise « les langues nationales » sans les nommer,
-- on retient les trois langues véhiculaires : mooré, dioula et peul.
--
-- Une langue active apparaît dans le sélecteur. Tant qu'elle n'a pas de traductions (table `translations`,
-- saisies dans le back-office, rubrique Langues), ses textes s'affichent en français.
-- Les six premières (les plus répandues) restent en tête ; les autres suivent dans l'ordre alphabétique de leur nom.
INSERT INTO languages (code, name, native_name, is_rtl, is_active, sort_order) VALUES
  ('fr',   'Français',                 'Français',                    false, true,  1),  -- 21 pays, dont le Cameroun, la Côte d’Ivoire, le Sénégal, la RD Congo et Madagascar
  ('en',   'Anglais',                  'English',                     false, true,  2),  -- une vingtaine de pays, dont le Nigeria, le Ghana, le Kenya et l’Afrique du Sud
  ('ar',   'Arabe',                    'العربية',                     true,  true,  3),  -- Algérie, Comores, Djibouti, Égypte, Libye, Maroc, Mauritanie, Somalie, Soudan, Tchad, Tunisie
  ('pt',   'Portugais',                'Português',                   false, true,  4),  -- Angola, Cap-Vert, Guinée-Bissau, Guinée équatoriale, Mozambique, Sao Tomé-et-Principe
  ('es',   'Espagnol',                 'Español',                     false, true,  5),  -- Guinée équatoriale
  ('sw',   'Swahili',                  'Kiswahili',                   false, true,  6),  -- Kenya, Ouganda, Rwanda, Tanzanie
  ('om',   'Oromo',                    'Afaan Oromoo',                false, true,  7),  -- Éthiopie (langue de travail fédérale depuis 2020)
  ('af',   'Afrikaans',                'Afrikaans',                   false, true,  8),  -- Afrique du Sud
  ('bm',   'Bambara',                  'Bamanankan',                  false, true,  9),  -- Mali
  ('bmq',  'Bomu',                     'Bomu',                        false, true, 10),  -- Mali
  ('bze',  'Bozo',                     'Bozo',                        false, true, 11),  -- Mali
  ('bwg',  'Barwe',                    'Chibarwe',                    false, true, 12),  -- Zimbabwe
  ('ny',   'Chichewa',                 'Chichewa',                    false, true, 13),  -- Zimbabwe ; langue nationale au Malawi
  ('ndc',  'Ndau',                     'chiNdau',                     false, true, 14),  -- Zimbabwe
  ('sn',   'Shona',                    'chiShona',                    false, true, 15),  -- Zimbabwe
  ('toi',  'Tonga',                    'chiTonga',                    false, true, 16),  -- Zimbabwe
  ('dts',  'Dogon',                    'Dɔgɔsɔ',                      false, true, 17),  -- Mali
  ('ff',   'Peul',                     'Fulfulde',                    false, true, 18),  -- Mali, Burkina Faso
  ('ha',   'Haoussa',                  'Hausa',                       false, true, 19),  -- Niger (langue nationale depuis 2025)
  ('rw',   'Kinyarwanda',              'Ikinyarwanda',                false, true, 20),  -- Rwanda
  ('rn',   'Kirundi',                  'Ikirundi',                    false, true, 21),  -- Burundi
  ('nr',   'Ndébélé du Sud',           'isiNdebele — South Africa',   false, true, 22),  -- Afrique du Sud
  ('nd',   'Ndébélé du Nord',          'isiNdebele — Zimbabwe',       false, true, 23),  -- Zimbabwe
  ('xh',   'Xhosa',                    'isiXhosa',                    false, true, 24),  -- Afrique du Sud, Zimbabwe, Lesotho (depuis 2025)
  ('zu',   'Zoulou',                   'isiZulu',                     false, true, 25),  -- Afrique du Sud
  ('dyu',  'Dioula',                   'Julakan',                     false, true, 26),  -- Burkina Faso
  ('crs',  'Créole seychellois',       'Kreol Seselwa',               false, true, 27),  -- Seychelles
  ('ln',   'Lingala',                  'Lingála',                     false, true, 28),  -- langue nationale en RD Congo et au Congo (non officielle)
  ('mg',   'Malgache',                 'Malagasy',                    false, true, 29),  -- Madagascar
  ('myk',  'Minyanka',                 'Mamara',                      false, true, 30),  -- Mali
  ('man',  'Malinké',                  'Maninkakan',                  false, true, 31),  -- Mali
  ('mos',  'Mooré',                    'Mooré',                       false, true, 32),  -- Burkina Faso
  ('nmq',  'Nambya',                   'Nambya',                      false, true, 33),  -- Zimbabwe
  ('aa',   'Afar',                     'Qafar af',                    false, true, 34),  -- Éthiopie (langue de travail fédérale depuis 2020)
  ('sg',   'Sango',                    'Sängö',                       false, true, 35),  -- République centrafricaine
  ('nso',  'Sotho du Nord (sepedi)',   'Sepedi',                      false, true, 36),  -- Afrique du Sud
  ('st',   'Sotho du Sud',             'Sesotho',                     false, true, 37),  -- Lesotho, Afrique du Sud, Zimbabwe
  ('tn',   'Tswana',                   'Setswana',                    false, true, 38),  -- Afrique du Sud, Zimbabwe ; langue nationale au Botswana
  ('zdj',  'Comorien',                 'Shikomori',                   false, true, 39),  -- Comores
  ('qph',  'Phuthi',                   'siPhuthi',                    false, true, 40),  -- Lesotho (depuis 2025) — pas de code ISO 639 : « qph » est un code d’usage privé
  ('ss',   'Swati',                    'siSwati',                     false, true, 41),  -- Eswatini, Afrique du Sud
  ('snk',  'Soninké',                  'Soninke',                     false, true, 42),  -- Mali
  ('so',   'Somali',                   'Soomaali',                    false, true, 43),  -- Somalie ; Éthiopie (langue de travail fédérale depuis 2020)
  ('ses',  'Songhaï',                  'Soŋoy',                       false, true, 44),  -- Mali
  ('shz',  'Sénoufo',                  'Syenara',                     false, true, 45),  -- Mali
  ('taq',  'Tamasheq',                 'Tamasheq',                    false, true, 46),  -- Mali
  ('zgh',  'Tamazight',                'Tamaziɣt — ⵜⴰⵎⴰⵣⵉⵖⵜ',         false, true, 47),  -- Maroc, Algérie
  ('kck',  'Kalanga',                  'TjiKalanga',                  false, true, 48),  -- Zimbabwe
  ('ve',   'Venda',                    'Tshivenḓa',                   false, true, 49),  -- Afrique du Sud, Zimbabwe
  ('hio',  'Tshwao (koïsan)',          'Tshwao (Koisan)',             false, true, 50),  -- Zimbabwe
  ('wo',   'Wolof',                    'Wolof',                       false, true, 51),  -- langue nationale au Sénégal (non officielle)
  ('kao',  'Kassonké',                 'Xaasongaxanŋo',               false, true, 52),  -- Mali
  ('ts',   'Tsonga',                   'Xitsonga',                    false, true, 53),  -- Afrique du Sud, Zimbabwe (shangani)
  ('yo',   'Yoruba',                   'Yorùbá',                      false, true, 54),  -- langue reconnue au Nigeria (non officielle)
  ('mey',  'Hassanya',                 'حسانية',                      true,  true, 55),  -- Mali
  ('ti',   'Tigrigna',                 'ትግርኛ',                        false, true, 56),  -- Érythrée ; Éthiopie (langue de travail fédérale depuis 2020)
  ('am',   'Amharique',                'አማርኛ',                        false, true, 57)  -- Éthiopie
ON CONFLICT (code) DO UPDATE
   SET name = EXCLUDED.name, native_name = EXCLUDED.native_name, is_rtl = EXCLUDED.is_rtl,
       is_active = true, sort_order = EXCLUDED.sort_order;
